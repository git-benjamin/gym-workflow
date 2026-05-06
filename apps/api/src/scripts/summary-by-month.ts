/** Per-month summary CSV joining body weight + Hevy gym data:
 *
 *    yyyy_mm                — calendar month
 *    max_body_weight_kg     — max measurement that month (blank if none)
 *    total_reps             — sum of all set reps from gym workouts
 *    total_volume_kg        — sum of weight_kg * reps across all sets
 *    total_duration_hours   — sum of (end_time - start_time) across workouts, decimal hours
 *
 *  Output: data_migration/final/summary_by_month.csv
 *  Months with at least one signal (weight or gym) are included; fully-empty
 *  months are omitted. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvrc, repoRoot, requireEnv } from "../env.js";

loadEnvrc();

interface RawSet { reps: number | null; weight_kg: number | null }
interface RawExercise { sets: RawSet[] }
interface RawWorkout {
  start_time: string;
  end_time: string;
  exercises: RawExercise[];
}
interface RawPage { page_count: number; workouts: RawWorkout[] }

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

// ── Body weight: max per month ────────────────────────────────────────────
const weightCsv = readFileSync(
  resolve(
    repoRoot(),
    "weight_data",
    "Measurement-Summary-2014-12-11-to-2026-05-06.csv",
  ),
  "utf8",
);
const maxWeight = new Map<string, number>();
for (const line of weightCsv.trim().split("\n").slice(1)) {
  const [date, w] = line.split(",");
  if (!date || !w) continue;
  const v = parseFloat(w);
  if (!Number.isFinite(v)) continue;
  const month = date.slice(0, 7);
  const cur = maxWeight.get(month);
  if (cur === undefined || v > cur) maxWeight.set(month, v);
}

// ── Hevy: monthly reps + volume + duration ────────────────────────────────
interface GymBucket { reps: number; volume: number; durationMs: number }
const gym = new Map<string, GymBucket>();

let page = 1;
let pageCount = 1;
let totalWorkouts = 0;

do {
  const res = await fetchPage(page);
  pageCount = res.page_count;
  for (const w of res.workouts) {
    const month = w.start_time.slice(0, 7);
    const b = gym.get(month) ?? { reps: 0, volume: 0, durationMs: 0 };
    const dur = Date.parse(w.end_time) - Date.parse(w.start_time);
    if (Number.isFinite(dur) && dur > 0) b.durationMs += dur;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const reps = s.reps ?? 0;
        const wkg = s.weight_kg ?? 0;
        if (reps <= 0) continue;
        b.reps += reps;
        if (wkg > 0) b.volume += wkg * reps;
      }
    }
    gym.set(month, b);
    totalWorkouts += 1;
  }
  process.stderr.write(`page ${page}/${pageCount} (${totalWorkouts} workouts)\r`);
  page += 1;
} while (page <= pageCount);

process.stderr.write("\n");

// ── Outer join + CSV ──────────────────────────────────────────────────────
const months = new Set<string>([...maxWeight.keys(), ...gym.keys()]);
const sorted = [...months].sort();

const rows: string[] = [
  "yyyy_mm,max_body_weight_kg,total_reps,total_volume_kg,total_duration_hours",
];
for (const m of sorted) {
  const w = maxWeight.get(m);
  const g = gym.get(m);
  const cells = [
    m,
    w !== undefined ? w.toFixed(2) : "",
    g ? String(g.reps) : "",
    g ? g.volume.toFixed(2) : "",
    g ? (g.durationMs / 3_600_000).toFixed(2) : "",
  ];
  rows.push(cells.join(","));
}

const outDir = resolve(repoRoot(), "data_migration", "final");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "summary_by_month.csv");
writeFileSync(outPath, rows.join("\n") + "\n");

console.log(`wrote ${outPath} (${sorted.length} months)`);
