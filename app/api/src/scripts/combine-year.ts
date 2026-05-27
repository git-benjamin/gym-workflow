/** Combine per-workout files for a year into a single oldest-first array.
 *
 * Reads data/workouts/{year}/*.json (written by fetch-year.ts) and emits
 * data/workouts-{year}.json. Pure local I/O, no API calls.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { repoRoot } from "../env.js";

const YEAR = Number(process.argv[2] ?? new Date().getUTCFullYear());
if (!Number.isInteger(YEAR) || YEAR < 2000) {
  throw new Error(`invalid year: ${process.argv[2]}`);
}

const SRC = resolve(repoRoot(), "data", "workouts", String(YEAR));
const OUT = resolve(repoRoot(), "data", `workouts-${YEAR}.json`);

if (!existsSync(SRC)) throw new Error(`no workouts dir: ${SRC} — run fetch-year first`);

interface RawWorkout { start_time: string }

const files = readdirSync(SRC).filter((n) => n.endsWith(".json"));
const workouts: RawWorkout[] = files.map((n) =>
  JSON.parse(readFileSync(resolve(SRC, n), "utf8")) as RawWorkout,
);

workouts.sort((a, b) => a.start_time.localeCompare(b.start_time));

writeFileSync(OUT, JSON.stringify(workouts, null, 2));

const sizeMb = statSync(OUT).size / 1024 / 1024;
console.log(`combined ${workouts.length} workouts → ${OUT} (${sizeMb.toFixed(2)} MB)`);
if (workouts.length > 0) {
  console.log(`  earliest: ${workouts[0]!.start_time}`);
  console.log(`  latest:   ${workouts[workouts.length - 1]!.start_time}`);
}
