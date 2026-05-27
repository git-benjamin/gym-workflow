/** POST /api/apply/proposed — push examples/proposed-routine-update.json to Hevy.
 *  Bypasses the chat agent entirely. Use when you've already reviewed the diff
 *  and just want to apply, or when Gemini is rate-limited. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Hono } from "hono";

import { repoRoot } from "../env.js";
import * as hevy from "../hevy.js";
import { logger } from "../log.js";

interface ProposedPayload {
  routine: { title: string };
}

async function findRoutineIdByTitle(title: string): Promise<string | null> {
  let page = 1;
  while (page <= 5) {
    const { routines, page_count } = await hevy.listRoutines(page, 10);
    const match = routines.find((r) => r.title === title);
    if (match) return match.id;
    if (page >= page_count) return null;
    page++;
  }
  return null;
}

export const applyRoute = new Hono();

applyRoute.get("/proposed", (c) => {
  const path = resolve(repoRoot(), "examples", "proposed-routine-update.json");
  if (!existsSync(path)) {
    return c.json({ exists: false });
  }
  const stat = require("node:fs").statSync(path);
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    routine: { title: string; exercises: unknown[] };
  };
  return c.json({
    exists: true,
    routine_title: payload.routine.title,
    exercise_count: payload.routine.exercises.length,
    file_modified_at: new Date(stat.mtimeMs).toISOString(),
    file_size_bytes: stat.size,
  });
});

applyRoute.post("/proposed", async (c) => {
  const path = resolve(repoRoot(), "examples", "proposed-routine-update.json");
  if (!existsSync(path)) {
    return c.json(
      {
        error:
          "no proposed-routine-update.json on disk. Generate one with `pnpm api:post-workout` " +
          "or via the chat's REVIEW + PREVIEW flow first.",
      },
      400,
    );
  }
  const payload = JSON.parse(readFileSync(path, "utf8")) as ProposedPayload;

  const routineId = await findRoutineIdByTitle(payload.routine.title);
  if (!routineId) {
    return c.json(
      {
        error: `no routine titled "${payload.routine.title}" on the account. Re-run post-workout to refresh the file.`,
      },
      400,
    );
  }

  const t0 = Date.now();
  try {
    await hevy.updateRoutine(routineId, payload as { routine: unknown });
  } catch (err) {
    const e = err as Error;
    logger.error(
      {
        routine_id: routineId,
        err_name: e.constructor?.name,
        err_message: e.message,
        upstream: (e as { response?: unknown }).response,
        duration_ms: Date.now() - t0,
      },
      "direct apply failed",
    );
    return c.json(
      {
        applied: false,
        routine_id: routineId,
        error: e.message,
        upstream: (e as { response?: unknown }).response ?? null,
      },
      500,
    );
  }

  const after = await hevy.getRoutine(routineId);
  const ms = Date.now() - t0;
  logger.info(
    { routine_id: routineId, duration_ms: ms, exercises: after.exercises.length },
    "direct apply succeeded",
  );
  return c.json({
    applied: true,
    routine_id: routineId,
    routine_title: after.title,
    duration_ms: ms,
  });
});
