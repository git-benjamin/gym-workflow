/** Aggregate Hevy workouts by YYYY-MM: sum(workouts), sum(reps), sum(volume_kg).
 *
 *  Calls /v1/workouts directly (raw fetch, no zod) — older workouts have
 *  numeric superset_id values that the shared Workout schema rejects, and
 *  this script doesn't need that field. */
import { loadEnvrc, requireEnv } from "../env.js";

loadEnvrc();

interface RawSet { reps: number | null; weight_kg: number | null }
interface RawExercise { sets: RawSet[] }
interface RawWorkout { start_time: string; exercises: RawExercise[] }
interface RawPage { page: number; page_count: number; workouts: RawWorkout[] }

interface Bucket { workouts: number; reps: number; volume: number }

const apiKey = requireEnv("HEVY_API_KEY");
const PAGE_SIZE = 10;

async function fetchPage(page: number): Promise<RawPage> {
  const url = `https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=${PAGE_SIZE}`;
  for (let attempt = 0; attempt < 4; attempt++) {
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

const buckets = new Map<string, Bucket>();
let page = 1;
let pageCount = 1;
let totalWorkouts = 0;

do {
  const res = await fetchPage(page);
  pageCount = res.page_count;
  for (const w of res.workouts) {
    const ym = w.start_time.slice(0, 7);
    const b = buckets.get(ym) ?? { workouts: 0, reps: 0, volume: 0 };
    b.workouts += 1;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const reps = s.reps ?? 0;
        const wkg = s.weight_kg ?? 0;
        b.reps += reps;
        b.volume += wkg * reps;
      }
    }
    buckets.set(ym, b);
    totalWorkouts += 1;
  }
  process.stderr.write(`page ${page}/${pageCount} (${totalWorkouts} workouts)\r`);
  page += 1;
} while (page <= pageCount);

process.stderr.write("\n");

const rows = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));

const totals: Bucket = { workouts: 0, reps: 0, volume: 0 };
for (const [, b] of rows) {
  totals.workouts += b.workouts;
  totals.reps += b.reps;
  totals.volume += b.volume;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

console.log("month     workouts      reps   volume_kg");
console.log("-------   --------   -------   ---------");
for (const [ym, b] of rows) {
  console.log(
    `${ym}   ${fmt(b.workouts).padStart(8)}   ${fmt(b.reps).padStart(7)}   ${fmt(b.volume).padStart(9)}`,
  );
}
console.log("-------   --------   -------   ---------");
console.log(
  `TOTAL     ${fmt(totals.workouts).padStart(8)}   ${fmt(totals.reps).padStart(7)}   ${fmt(totals.volume).padStart(9)}`,
);
