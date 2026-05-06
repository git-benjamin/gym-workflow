/** Per-(YYYY-MM, exercise) aggregation:
 *    max_volume_kg     — heaviest single-set volume (weight_kg * reps)
 *    max_weight_kg     — heaviest weight lifted (any reps)
 *    e1rm_kg           — max modelled 1-rep max via Epley: w * (1 + reps/30)
 *
 *  Sets with no weight or no reps are skipped (bodyweight-only, etc.).
 *  Grouped by exercise_template_id; label uses the most recent title seen. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvrc, repoRoot, requireEnv } from "../env.js";

loadEnvrc();

interface RawSet { reps: number | null; weight_kg: number | null }
interface RawExercise {
  exercise_template_id: string;
  title: string;
  sets: RawSet[];
}
interface RawWorkout { start_time: string; exercises: RawExercise[] }
interface RawPage { page_count: number; workouts: RawWorkout[] }

interface Bucket {
  exerciseId: string;
  month: string;
  maxVolume: number;
  maxWeight: number;
  maxE1rm: number;
}

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

const buckets = new Map<string, Bucket>(); // key: `${month}|${exerciseId}`
const titles = new Map<string, { title: string; lastSeen: string }>();

let page = 1;
let pageCount = 1;
let totalWorkouts = 0;

do {
  const res = await fetchPage(page);
  pageCount = res.page_count;
  for (const w of res.workouts) {
    const month = w.start_time.slice(0, 7);
    for (const ex of w.exercises) {
      const id = ex.exercise_template_id;
      const seen = titles.get(id);
      if (!seen || w.start_time > seen.lastSeen) {
        titles.set(id, { title: ex.title, lastSeen: w.start_time });
      }
      for (const s of ex.sets) {
        const reps = s.reps ?? 0;
        const wkg = s.weight_kg ?? 0;
        if (reps <= 0 || wkg <= 0) continue;
        const volume = wkg * reps;
        const e1rm = wkg * (1 + reps / 30);
        const key = `${month}|${id}`;
        const b = buckets.get(key) ?? {
          exerciseId: id,
          month,
          maxVolume: 0,
          maxWeight: 0,
          maxE1rm: 0,
        };
        if (volume > b.maxVolume) b.maxVolume = volume;
        if (wkg > b.maxWeight) b.maxWeight = wkg;
        if (e1rm > b.maxE1rm) b.maxE1rm = e1rm;
        buckets.set(key, b);
      }
    }
    totalWorkouts += 1;
  }
  process.stderr.write(`page ${page}/${pageCount} (${totalWorkouts} workouts)\r`);
  page += 1;
} while (page <= pageCount);

process.stderr.write("\n");

const rows = [...buckets.values()].sort((a, b) => {
  if (a.month !== b.month) return a.month.localeCompare(b.month);
  const ta = titles.get(a.exerciseId)?.title ?? a.exerciseId;
  const tb = titles.get(b.exerciseId)?.title ?? b.exerciseId;
  return ta.localeCompare(tb);
});

// Write CSV
const outDir = resolve(repoRoot(), "data_migration", "final");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "exercises_by_month.csv");

const csv: string[] = [
  "month,exercise,exercise_template_id,max_volume_kg,max_weight_kg,e1rm_kg",
];
for (const r of rows) {
  const title = titles.get(r.exerciseId)?.title ?? r.exerciseId;
  const escaped = title.includes(",") || title.includes('"')
    ? `"${title.replaceAll('"', '""')}"`
    : title;
  csv.push(
    [
      r.month,
      escaped,
      r.exerciseId,
      r.maxVolume.toFixed(2),
      r.maxWeight.toFixed(2),
      r.maxE1rm.toFixed(2),
    ].join(","),
  );
}
writeFileSync(outPath, csv.join("\n") + "\n");

console.log(`wrote ${outPath}  (${rows.length} rows, ${titles.size} distinct exercises)`);

// Print every month as its own section
const byMonth = new Map<string, Bucket[]>();
for (const r of rows) {
  const arr = byMonth.get(r.month) ?? [];
  arr.push(r);
  byMonth.set(r.month, arr);
}

for (const month of [...byMonth.keys()].sort()) {
  console.log(`\n${month}`);
  console.log("exercise                                 max_vol   max_w    e1rm");
  console.log("-------------------------------------- --------  ------  ------");
  const monthRows = byMonth.get(month)!;
  for (const r of monthRows) {
    const title = (titles.get(r.exerciseId)?.title ?? r.exerciseId).slice(0, 38).padEnd(38);
    console.log(
      `${title} ${r.maxVolume.toFixed(0).padStart(8)}  ${r.maxWeight.toFixed(1).padStart(6)}  ${r.maxE1rm.toFixed(1).padStart(6)}`,
    );
  }
}
