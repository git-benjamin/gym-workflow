/** Build a self-contained HTML dashboard with two interactive Plotly charts:
 *
 *    1. Body weight (kg) + gym reps by month — single chart, dual y-axis.
 *
 *    2. Estimated 1RM (Epley) growth per exercise, with a search multi-select
 *       so you can choose which lifts to display.
 *
 *  Output: weight_data/charts.html — open directly in a browser. */
import { readFileSync, writeFileSync } from "node:fs";
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

// ── Body weight ───────────────────────────────────────────────────────────
const weightCsv = readFileSync(
  resolve(
    repoRoot(),
    "weight_data",
    "Measurement-Summary-2014-12-11-to-2026-05-06.csv",
  ),
  "utf8",
);
const weightAcc = new Map<string, { sum: number; count: number }>();
for (const line of weightCsv.trim().split("\n").slice(1)) {
  const [date, w] = line.split(",");
  if (!date || !w) continue;
  const month = date.slice(0, 7);
  const weight = parseFloat(w);
  if (!Number.isFinite(weight)) continue;
  const b = weightAcc.get(month) ?? { sum: 0, count: 0 };
  b.sum += weight;
  b.count += 1;
  weightAcc.set(month, b);
}
const weightSeries = [...weightAcc.entries()]
  .map(([m, b]) => ({ month: m, value: b.sum / b.count }))
  .sort((a, b) => a.month.localeCompare(b.month));

// ── Hevy aggregation ──────────────────────────────────────────────────────
const monthlyReps = new Map<string, number>();
const monthlyVolume = new Map<string, number>();
const exerciseMaxE1rm = new Map<string, Map<string, number>>(); // id -> month -> e1rm
const exerciseTitles = new Map<string, { title: string; lastSeen: string }>();

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
      const seen = exerciseTitles.get(id);
      if (!seen || w.start_time > seen.lastSeen) {
        exerciseTitles.set(id, { title: ex.title, lastSeen: w.start_time });
      }
      let exMonths = exerciseMaxE1rm.get(id);
      if (!exMonths) {
        exMonths = new Map();
        exerciseMaxE1rm.set(id, exMonths);
      }
      for (const s of ex.sets) {
        const reps = s.reps ?? 0;
        const wkg = s.weight_kg ?? 0;
        if (reps <= 0) continue;
        monthlyReps.set(month, (monthlyReps.get(month) ?? 0) + reps);
        if (wkg > 0) {
          monthlyVolume.set(month, (monthlyVolume.get(month) ?? 0) + wkg * reps);
          const e1rm = wkg * (1 + reps / 30);
          if (e1rm > (exMonths.get(month) ?? 0)) {
            exMonths.set(month, e1rm);
          }
        }
      }
    }
    totalWorkouts += 1;
  }
  process.stderr.write(`page ${page}/${pageCount} (${totalWorkouts} workouts)\r`);
  page += 1;
} while (page <= pageCount);

process.stderr.write("\n");

const repsSeries = [...monthlyReps.entries()]
  .map(([month, value]) => ({ month, value }))
  .sort((a, b) => a.month.localeCompare(b.month));
const volumeSeries = [...monthlyVolume.entries()]
  .map(([month, value]) => ({ month, value }))
  .sort((a, b) => a.month.localeCompare(b.month));

// Per-exercise 1RM series; sort exercises by data-point count descending so
// the most-trained lifts appear first in the multi-select.
interface ExerciseSeries {
  id: string;
  title: string;
  points: { month: string; e1rm: number }[];
}
const exerciseSeries: ExerciseSeries[] = [];
for (const [id, months] of exerciseMaxE1rm) {
  if (months.size === 0) continue;
  const title = exerciseTitles.get(id)?.title ?? id;
  const points = [...months.entries()]
    .map(([month, e1rm]) => ({ month, e1rm }))
    .sort((a, b) => a.month.localeCompare(b.month));
  exerciseSeries.push({ id, title, points });
}
exerciseSeries.sort((a, b) => b.points.length - a.points.length || a.title.localeCompare(b.title));

const defaultExerciseIds = exerciseSeries.slice(0, 10).map((e) => e.id);

// ── HTML output ───────────────────────────────────────────────────────────
const payload = {
  weight: weightSeries,
  reps: repsSeries,
  exercises: exerciseSeries,
  defaultExerciseIds,
};
void volumeSeries;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Gym &amp; weight dashboard</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
<style>
  * { box-sizing: border-box; }
  body {
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0; padding: 24px; max-width: 1200px; margin: 0 auto;
    color: #1f2937; background: #fafafa;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 8px; color: #374151; }
  .meta { color: #6b7280; margin-bottom: 16px; }
  .chart {
    background: white; border: 1px solid #e5e7eb; border-radius: 6px;
    padding: 12px;
  }
  .controls {
    display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start;
  }
  .controls label { font-weight: 500; }
  #ex-filter {
    padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px;
    width: 220px; font: inherit;
  }
  #ex-select {
    flex: 1; min-height: 220px; padding: 4px;
    border: 1px solid #d1d5db; border-radius: 4px; font: inherit;
  }
  .hint { color: #6b7280; font-size: 12px; margin-top: 4px; }
</style>
</head>
<body>
<h1>Gym &amp; weight dashboard</h1>
<p class="meta" id="meta"></p>

<h2>Body weight &amp; gym reps by month</h2>
<div id="trend-chart" class="chart" style="height: 460px;"></div>

<h2>Estimated 1-rep max growth (Epley)</h2>
<div class="controls">
  <div style="display:flex; flex-direction:column; gap:4px;">
    <label for="ex-filter">filter:</label>
    <input id="ex-filter" placeholder="search exercises…" />
    <p class="hint">cmd/ctrl-click to multi-select</p>
  </div>
  <select id="ex-select" multiple size="14"></select>
</div>
<div id="e1rm-chart" class="chart" style="height: 520px;"></div>

<script>
const DATA = ${JSON.stringify(payload)};

document.getElementById("meta").textContent =
  "weight: " + DATA.weight.length + " months · reps: " + DATA.reps.length +
  " months · exercises: " + DATA.exercises.length;

const monthToDate = (m) => m + "-01";

// ── Trend chart (dual y-axis) ───────────────────────────────────────────
Plotly.newPlot("trend-chart", [
  {
    name: "Body weight (kg)",
    x: DATA.weight.map((p) => monthToDate(p.month)),
    y: DATA.weight.map((p) => p.value),
    type: "scatter", mode: "lines+markers",
    line: { color: "#0ea5e9", width: 2 },
    marker: { size: 5 },
    hovertemplate: "%{x|%Y-%m}<br>%{y:.1f} kg<extra></extra>",
    yaxis: "y",
  },
  {
    name: "Gym reps",
    x: DATA.reps.map((p) => monthToDate(p.month)),
    y: DATA.reps.map((p) => p.value),
    type: "bar",
    marker: { color: "#10b981", opacity: 0.6 },
    hovertemplate: "%{x|%Y-%m}<br>%{y:,} reps<extra></extra>",
    yaxis: "y2",
  },
], {
  margin: { t: 30, r: 70, b: 60, l: 70 },
  xaxis: {
    type: "date",
    tickformat: "%Y-%m",
    tickangle: -45,
    dtick: "M3",
  },
  yaxis: {
    title: "Body weight (kg)",
    side: "left",
    color: "#0ea5e9",
    zeroline: false,
  },
  yaxis2: {
    title: "Gym reps",
    side: "right",
    overlaying: "y",
    color: "#10b981",
    zeroline: false,
  },
  legend: { orientation: "h", y: 1.12, x: 0 },
  hovermode: "x unified",
  bargap: 0.15,
}, { responsive: true, displayModeBar: true });

// ── 1RM chart ───────────────────────────────────────────────────────────
const select = document.getElementById("ex-select");
const filter = document.getElementById("ex-filter");
const exerciseById = new Map(DATA.exercises.map((e) => [e.id, e]));

function renderOptions(query) {
  const q = (query || "").toLowerCase().trim();
  const selected = new Set(Array.from(select.selectedOptions).map((o) => o.value));
  select.innerHTML = "";
  for (const ex of DATA.exercises) {
    if (q && !ex.title.toLowerCase().includes(q)) continue;
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title + "  (" + ex.points.length + " mo)";
    if (selected.has(ex.id)) opt.selected = true;
    select.appendChild(opt);
  }
}

function selectedIds() {
  return Array.from(select.selectedOptions).map((o) => o.value);
}

const PALETTE = [
  "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

function renderE1rmChart() {
  const ids = selectedIds();
  const traces = ids.map((id, i) => {
    const ex = exerciseById.get(id);
    return {
      name: ex.title,
      x: ex.points.map((p) => monthToDate(p.month)),
      y: ex.points.map((p) => p.e1rm),
      type: "scatter", mode: "lines+markers",
      line: { width: 2, color: PALETTE[i % PALETTE.length] },
      marker: { size: 6 },
      hovertemplate: ex.title + "<br>%{x|%Y-%m}<br>%{y:.1f} kg<extra></extra>",
    };
  });
  Plotly.react("e1rm-chart", traces, {
    margin: { t: 20, r: 20, b: 60, l: 60 },
    xaxis: { type: "date", tickformat: "%Y-%m", tickangle: -45 },
    yaxis: { title: "Estimated 1RM (kg)" },
    legend: { orientation: "h", y: -0.2 },
    hovermode: "x unified",
  }, { responsive: true });
}

// Initial selection: top-10 most-trained exercises
renderOptions("");
for (const opt of select.options) {
  if (DATA.defaultExerciseIds.includes(opt.value)) opt.selected = true;
}
renderE1rmChart();

select.addEventListener("change", renderE1rmChart);
filter.addEventListener("input", (e) => renderOptions(e.target.value));
</script>
</body>
</html>
`;

const outPath = resolve(repoRoot(), "weight_data", "charts.html");
writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
console.log(`  weight months:    ${weightSeries.length}`);
console.log(`  reps months:      ${repsSeries.length}`);
console.log(`  exercises:        ${exerciseSeries.length}`);
console.log(`  default selected: ${defaultExerciseIds.length} most-trained`);
console.log("open with: open " + outPath);
