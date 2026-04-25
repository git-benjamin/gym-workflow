/**
 * Hevy public API client. Mirrors hevy.py:
 *   - api-key header from .envrc
 *   - typed exception classes per status code
 *   - retry on 429 (Retry-After honoured) and 5xx / network errors
 *   - exponential backoff with jitter for non-429 retries
 */
import {
  ExerciseHistory,
  Routine,
  RoutineEnvelope,
  RoutinesPage,
  UserInfo,
  Workout,
  WorkoutsCount,
  WorkoutsPage,
} from "@gym/shared";
import { z } from "zod";

import { requireEnv } from "./env.js";

const BASE_URL = "https://api.hevyapp.com";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

// ── Errors ────────────────────────────────────────────────────────────────
export class HevyAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown,
  ) {
    super(message);
    this.name = "HevyAPIError";
  }
}
export class AuthenticationError extends HevyAPIError {
  override readonly name = "AuthenticationError";
}
export class ValidationError extends HevyAPIError {
  override readonly name = "ValidationError";
}
export class NotFoundError extends HevyAPIError {
  override readonly name = "NotFoundError";
}
export class RateLimitError extends HevyAPIError {
  override readonly name = "RateLimitError";
  constructor(public retryAfter: number, response?: unknown) {
    super(`Rate limited; suggested retry after ${retryAfter}s`, 429, response);
  }
}
export class ServerError extends HevyAPIError {
  override readonly name = "ServerError";
}
export class NetworkError extends HevyAPIError {
  override readonly name = "NetworkError";
}

// ── Helpers ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const backoff = (attempt: number) => (2 ** attempt) * 1000 + Math.random() * 1000;

function parseRetryAfter(header: string | null): number {
  if (!header) return 5;
  const n = Number(header);
  return Number.isFinite(n) ? n : 5;
}

async function safeJson(r: Response): Promise<unknown> {
  const text = await r.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function request<T extends z.ZodTypeAny>(
  schema: T,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  const apiKey = requireEnv("HEVY_API_KEY");

  const url = new URL(BASE_URL + path);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  let lastNetErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let r: Response;
    try {
      r = await fetch(url, {
        method,
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      lastNetErr = err;
      if (attempt + 1 < MAX_ATTEMPTS) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new NetworkError(
        `network error after ${MAX_ATTEMPTS} attempts: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (r.ok) {
      const body = await safeJson(r);
      return schema.parse(body);
    }

    const body = await safeJson(r);
    if (r.status === 401 || r.status === 403) {
      throw new AuthenticationError(
        "Authentication failed. Verify HEVY_API_KEY.",
        r.status,
        body,
      );
    }
    if (r.status === 404) {
      throw new NotFoundError(`Not found: ${method} ${path}`, 404, body);
    }
    if (r.status === 400) {
      throw new ValidationError("Validation failed", 400, body);
    }
    if (r.status === 429) {
      const retryAfter = parseRetryAfter(r.headers.get("retry-after"));
      if (attempt + 1 < MAX_ATTEMPTS) {
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new RateLimitError(retryAfter, body);
    }
    if (r.status >= 500) {
      if (attempt + 1 < MAX_ATTEMPTS) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new ServerError(`server error ${r.status}`, r.status, body);
    }
    throw new HevyAPIError(`Unexpected status ${r.status}`, r.status, body);
  }

  throw new NetworkError("retry loop exhausted");
}

// ── Public functions ──────────────────────────────────────────────────────
export const getUserInfo = () => request(UserInfo, "GET", "/v1/user/info");

export const listWorkouts = (page = 1, pageSize = 5) =>
  request(WorkoutsPage, "GET", "/v1/workouts", { query: { page, pageSize } });

export const getWorkout = (workoutId: string) =>
  request(Workout, "GET", `/v1/workouts/${workoutId}`);

export const workoutsCount = () =>
  request(WorkoutsCount, "GET", "/v1/workouts/count");

export const listRoutines = (page = 1, pageSize = 5) =>
  request(RoutinesPage, "GET", "/v1/routines", { query: { page, pageSize } });

export const getRoutine = (routineId: string) =>
  request(RoutineEnvelope, "GET", `/v1/routines/${routineId}`).then((r) => r.routine);

export const updateRoutine = (routineId: string, payload: { routine: unknown }) =>
  request(z.unknown(), "PUT", `/v1/routines/${routineId}`, { body: payload });

export const getExerciseHistory = (
  exerciseTemplateId: string,
  page = 1,
  pageSize = 30,
) =>
  request(ExerciseHistory, "GET", `/v1/exercise_history/${exerciseTemplateId}`, {
    query: { page, pageSize },
  });
