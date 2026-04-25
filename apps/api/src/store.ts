/** Local JSON store for workout reviews and chat sessions. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Routine, Workout, WorkoutReview } from "@gym/shared";

import { repoRoot } from "./env.js";

const REVIEWS_DIR = () => resolve(repoRoot(), "reviews");
const CHATS_DIR = () => resolve(repoRoot(), "chats");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Reviews ──────────────────────────────────────────────────────────────
export interface ReviewRecord {
  workout_id: string;
  routine_id: string | null;
  workout_title: string;
  workout_start_time: string;
  reviewed_at: string;
  model: string;
  review: WorkoutReview;
  workout: Workout;
  routine: Routine;
  history?: Record<string, ExerciseHistorySession[]>;
}

export interface ExerciseHistorySession {
  workout_id: string;
  workout_title: string;
  workout_start_time: string;
  sets: Array<{
    set_type: string | null;
    weight_kg: number | null;
    reps: number | null;
    rpe: number | null;
  }>;
}

const reviewPath = (workoutId: string) => resolve(REVIEWS_DIR(), `${workoutId}.json`);

export function reviewExists(workoutId: string): boolean {
  return existsSync(reviewPath(workoutId));
}

export function saveReview(record: ReviewRecord): string {
  ensureDir(REVIEWS_DIR());
  const path = reviewPath(record.workout_id);
  writeFileSync(path, JSON.stringify(record, null, 2));
  return path;
}

export function loadReview(workoutId: string): ReviewRecord | null {
  const path = reviewPath(workoutId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ReviewRecord;
}

export function listReviews(limit?: number): ReviewRecord[] {
  ensureDir(REVIEWS_DIR());
  const records: ReviewRecord[] = [];
  for (const name of readdirSync(REVIEWS_DIR())) {
    if (!name.endsWith(".json")) continue;
    records.push(JSON.parse(readFileSync(resolve(REVIEWS_DIR(), name), "utf8")));
  }
  records.sort((a, b) =>
    (b.workout_start_time ?? "").localeCompare(a.workout_start_time ?? ""),
  );
  return limit ? records.slice(0, limit) : records;
}

// ── Chat sessions ────────────────────────────────────────────────────────
/** Single conversation turn; mirrors Gemini's Content with text + optional tool-call metadata for the UI. */
export interface ChatTurn {
  role: "user" | "model";
  text: string;
  tool_calls?: Array<{ name: string; input: unknown; output: unknown }>;
  ts: string;
}

const chatPath = (sessionId: string) => resolve(CHATS_DIR(), `${sessionId}.json`);

export function loadChat(sessionId: string): ChatTurn[] {
  const path = chatPath(sessionId);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as ChatTurn[];
}

export function saveChat(sessionId: string, turns: ChatTurn[]): void {
  ensureDir(CHATS_DIR());
  writeFileSync(chatPath(sessionId), JSON.stringify(turns, null, 2));
}

export function listChatSessions(): Array<{ session_id: string; updated_at: string; turns: number }> {
  ensureDir(CHATS_DIR());
  const out: Array<{ session_id: string; updated_at: string; turns: number }> = [];
  for (const name of readdirSync(CHATS_DIR())) {
    if (!name.endsWith(".json")) continue;
    const sessionId = name.slice(0, -".json".length);
    const turns = loadChat(sessionId);
    const last = turns[turns.length - 1];
    out.push({
      session_id: sessionId,
      updated_at: last?.ts ?? "",
      turns: turns.length,
    });
  }
  out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}
