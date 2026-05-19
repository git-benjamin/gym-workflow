/** Fetch every workout in the current year + their linked routines (deduped).
 *
 * Walks every page of /v1/workouts and keeps the ones whose start_time falls
 * inside the year — Hevy orders this endpoint by updated_at (or created_at),
 * so backfilled / imported historical workouts can appear anywhere in the
 * feed, and we can't early-terminate on start_time.
 *
 * Uses raw fetch (not the typed @gym/shared schema) because legacy workouts
 * have numeric superset_id values the schema rejects. The schema's other
 * guarantees aren't useful here — we just persist whatever Hevy returns.
 *
 * Routines are fetched via the typed client (current routines are well-shaped).
 *
 * Idempotent: existing files are skipped, so re-runs only fetch new workouts
 * and new routines.
 *
 * Outputs:
 *   data/workouts/{year}/{safe-start-time}__{workout_id}.json
 *   data/routines/{routine_id}.json
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvrc, repoRoot, requireEnv } from "../env.js";
import * as hevy from "../hevy.js";
import { NotFoundError } from "../hevy.js";

loadEnvrc();

const YEAR = new Date().getUTCFullYear();
const CUTOFF = `${YEAR}-01-01T00:00:00`;
const PAGE_SIZE = 10;
const MAX_ATTEMPTS = 4;

const DATA_ROOT = resolve(repoRoot(), "data");
const WORKOUTS_DIR = resolve(DATA_ROOT, "workouts", String(YEAR));
const ROUTINES_DIR = resolve(DATA_ROOT, "routines");

mkdirSync(WORKOUTS_DIR, { recursive: true });
mkdirSync(ROUTINES_DIR, { recursive: true });

const apiKey = requireEnv("HEVY_API_KEY");

interface RawWorkout {
  id: string;
  start_time: string;
  routine_id: string | null;
  [key: string]: unknown;
}
interface RawPage { page: number; page_count: number; workouts: RawWorkout[] }

async function fetchPage(page: number): Promise<RawPage> {
  const url = `https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=${PAGE_SIZE}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = await fetch(url, {
      headers: { "api-key": apiKey, accept: "application/json" },
    });
    if (r.ok) return (await r.json()) as RawPage;
    if (r.status === 429) {
      const retry = Number(r.headers.get("retry-after") ?? "5");
      await new Promise((res) => setTimeout(res, retry * 1000));
      continue;
    }
    if (r.status >= 500) {
      await new Promise((res) => setTimeout(res, (2 ** attempt) * 1000));
      continue;
    }
    throw new Error(`hevy ${r.status}: ${await r.text()}`);
  }
  throw new Error("retry loop exhausted");
}

const existingRoutineIds = new Set(
  readdirSync(ROUTINES_DIR)
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length)),
);

function workoutPath(startTime: string, workoutId: string): string {
  const safe = startTime.replace(/:/g, "-");
  return resolve(WORKOUTS_DIR, `${safe}__${workoutId}.json`);
}

function routinePath(routineId: string): string {
  return resolve(ROUTINES_DIR, `${routineId}.json`);
}

let fetched = 0;
let skipped = 0;
let outOfYear = 0;
let newRoutines = 0;
let page = 1;
let pageCount = 1;

do {
  const res = await fetchPage(page);
  pageCount = res.page_count;

  for (const w of res.workouts) {
    if (w.start_time < CUTOFF) {
      outOfYear += 1;
      continue;
    }

    const path = workoutPath(w.start_time, w.id);
    if (existsSync(path)) {
      skipped += 1;
    } else {
      writeFileSync(path, JSON.stringify(w, null, 2));
      fetched += 1;
    }

    if (w.routine_id && !existingRoutineIds.has(w.routine_id)) {
      try {
        const routine = await hevy.getRoutine(w.routine_id);
        writeFileSync(routinePath(w.routine_id), JSON.stringify(routine, null, 2));
        existingRoutineIds.add(w.routine_id);
        newRoutines += 1;
      } catch (err) {
        if (err instanceof NotFoundError) {
          console.warn(`warn: routine ${w.routine_id} not found, skipping`);
          existingRoutineIds.add(w.routine_id);
        } else {
          throw err;
        }
      }
    }
  }

  process.stderr.write(
    `page ${page}/${pageCount} — fetched ${fetched}, skipped ${skipped}, out-of-year ${outOfYear}, +${newRoutines} routines\r`,
  );
  page += 1;
} while (page <= pageCount);

process.stderr.write("\n");

console.log(
  `done: fetched ${fetched} workouts, ${newRoutines} new routines, skipped ${skipped} existing, ignored ${outOfYear} pre-${YEAR}`,
);
console.log(`  workouts: ${WORKOUTS_DIR}`);
console.log(`  routines: ${ROUTINES_DIR}`);
