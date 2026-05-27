/** Build a single markdown report for a trend-analysis agent.
 *
 * Combines:
 *   1. Profile — goals, biomechanics, programming philosophy, from profile.md
 *   2. Body weight — all-time, from weight_data/Measurement-Summary-*.csv
 *   3. Nutrition — current-year weekly averages, from nutrition_data/nutrition.csv
 *   4. Nutrition baseline protocol — meals + supplements + macros on a good day
 *   5. Pre-year monthly aggregate — from data_migration/final/summary_by_month.csv
 *   6. Pre-year per-exercise monthly bests — from data_migration/final/exercises_by_month.csv
 *   7. Cycling history — rides 2023-2024 from cycling_data/cycling_data.md
 *   8. Medication log — free-form journal at medication_data/retatrutide.md
 *   9. Current-year workouts — full set-level detail, from data/workouts/{year}/*.json
 *
 * Output: data/trend-report-{YYYY-MM-DD}.md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { repoRoot } from "../env.js";

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = Number(TODAY.slice(0, 4));
const ROOT = repoRoot();

// ── Inputs ───────────────────────────────────────────────────────────────
const WEIGHT_CSV = resolve(ROOT, "weight_data/Measurement-Summary-2014-12-11-to-2026-05-06.csv");
const BODYCOMP_CSV = resolve(ROOT, "weight_data/body_composition.csv");
const NUTRITION_CSV = resolve(ROOT, "nutrition_data/nutrition.csv");
const PRE_SUMMARY_CSV = resolve(ROOT, "data_migration/final/summary_by_month.csv");
const PRE_EXERCISES_CSV = resolve(ROOT, "data_migration/final/exercises_by_month.csv");
const PROFILE_MD = resolve(ROOT, "profile.md");
const MEDICATION_MD = resolve(ROOT, "medication_data/retatrutide.md");
const BASELINE_MD = resolve(ROOT, "nutrition_data/baseline_protocol.md");
const CYCLING_MD = resolve(ROOT, "cycling_data/cycling_data.md");
const WORKOUTS_DIR = resolve(ROOT, "data/workouts", String(YEAR));

const OUT = resolve(ROOT, `data/trend-report-${TODAY}.md`);

// ── Helpers ──────────────────────────────────────────────────────────────
function readCsv(path: string): string[][] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(","));
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => "---");
  return [headers, sep, ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

// ── Section 1: profile ──────────────────────────────────────────────────
function sectionProfile(): string {
  // profile.md leads with "# Profile" — drop that line so it nests cleanly
  // under our "## 1. Profile" header instead of becoming a competing H1.
  const raw = readFileSync(PROFILE_MD, "utf8").trimEnd();
  const stripped = raw.replace(/^#\s+Profile\s*\n+/i, "").trimStart();
  return [
    `## 1. Profile`,
    ``,
    `Static context: training goals, biomechanics, restrictions, programming philosophy, equipment access. The trend agent should treat this as the lens through which the time-series data is interpreted.`,
    ``,
    stripped,
  ].join("\n");
}

// ── Section 2: body weight (all entries) ─────────────────────────────────
function sectionWeight(): string {
  const rows = readCsv(WEIGHT_CSV).slice(1); // drop header
  const parsed = rows.map(([date, w]) => ({ date: date!, weight: parseFloat(w!) }));
  let min = parsed[0]!, max = parsed[0]!;
  for (const e of parsed) {
    if (e.weight < min.weight) min = e;
    if (e.weight > max.weight) max = e;
  }
  const latest = parsed[parsed.length - 1]!;

  const [bcHeader, ...bcRows] = readCsv(BODYCOMP_CSV);

  const lines = [
    `## 2. Body weight & body composition`,
    ``,
    `### 2a. Body-composition snapshots`,
    ``,
    `Dated measurements that include body-fat %. Sparse — most days are scale-only (Section 2b).`,
    ``,
    table(bcHeader!, bcRows),
    ``,
    `### 2b. Daily weigh-ins — all entries`,
    ``,
    `${parsed.length} measurements, ${parsed[0]!.date} → ${latest.date}.`,
    ``,
    `- min: **${min.weight} kg** on ${min.date}`,
    `- max: **${max.weight} kg** on ${max.date}`,
    `- latest: **${latest.weight} kg** on ${latest.date}`,
    ``,
    table(["date", "weight (kg)"], parsed.map((e) => [e.date, e.weight.toFixed(1)])),
  ];
  return lines.join("\n");
}

// ── Section 2: nutrition (current-year weekly averages) ─────────────────
function sectionNutrition(): string {
  const [header, ...rows] = readCsv(NUTRITION_CSV);
  const inYear = rows.filter((r) => r[0]!.startsWith(`${YEAR}-`));
  return [
    `## 3. Nutrition — weekly averages, ${YEAR}`,
    ``,
    `${inYear.length} weeks of data.`,
    ``,
    table(header!, inYear),
  ].join("\n");
}

// ── Section 3: nutrition baseline protocol ──────────────────────────────
function sectionBaseline(): string {
  const raw = readFileSync(BASELINE_MD, "utf8").trimEnd();
  return [
    `## 4. Nutrition — baseline protocol`,
    ``,
    `Target daily intake on a "good day" — meals, supplements, macros, hydration, cost. Treat as the upper bound of adherence; Section 2's weekly averages are the realised behaviour.`,
    ``,
    raw,
  ].join("\n");
}

// ── Section 4: pre-year monthly aggregate ───────────────────────────────
function sectionPreYearSummary(): string {
  const [header, ...rows] = readCsv(PRE_SUMMARY_CSV);
  const pre = rows.filter((r) => Number(r[0]!.slice(0, 4)) < YEAR);
  return [
    `## 5. Workouts before ${YEAR} — monthly aggregate`,
    ``,
    `${pre.length} months from ${pre[0]?.[0] ?? "(none)"} → ${pre[pre.length - 1]?.[0] ?? "(none)"}. Body-weight column is sparse pre-2019 (only logged ad-hoc).`,
    ``,
    table(header!, pre),
  ].join("\n");
}

// ── Section 5: pre-year per-exercise monthly bests ──────────────────────
function sectionPreYearExercises(): string {
  const [header, ...rows] = readCsv(PRE_EXERCISES_CSV);
  // header: month,exercise,exercise_template_id,max_volume_kg,max_weight_kg,e1rm_kg
  const pre = rows.filter((r) => Number(r[0]!.slice(0, 4)) < YEAR);
  // Drop the exercise_template_id column for the markdown — adds bytes, no signal.
  const trimmedHeader = [header![0]!, header![1]!, header![3]!, header![4]!, header![5]!];
  const trimmed = pre.map((r) => [r[0]!, r[1]!, r[3]!, r[4]!, r[5]!]);
  return [
    `## 6. Workouts before ${YEAR} — per-exercise monthly bests`,
    ``,
    `For each (month, exercise) pair: heaviest set volume, heaviest weight used, estimated 1RM (Epley). Captures strength progression across years.`,
    ``,
    `${pre.length} rows from ${pre[0]?.[0] ?? "(none)"} → ${pre[pre.length - 1]?.[0] ?? "(none)"}.`,
    ``,
    table(trimmedHeader, trimmed),
  ].join("\n");
}

// ── Section 7: cycling history ──────────────────────────────────────────
interface Ride {
  date: string; // YYYY-MM-DD
  title: string;
  durationSec: number;
  distanceKm: number;
  elevationM: number;
}

function parseDurationToSec(s: string): number {
  const parts = s.split(":").map((p) => Number(p));
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return 0;
}

function formatHm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sectionCycling(): string {
  const raw = readFileSync(CYCLING_MD, "utf8");
  const rides: Ride[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim() === "Sport") continue;
    const fields = line.split("\t").map((f) => f.trim()).filter((f) => f.length > 0);
    // expect: Ride, "Day, M/D/YYYY", title, duration, "NN.NN km", "NN m"
    if (fields[0] !== "Ride" || fields.length < 6) continue;
    const dateStr = fields[1]!.replace(/^[A-Za-z]+,\s*/, ""); // strip "Sun, "
    const [m, d, y] = dateStr.split("/").map((p) => Number(p));
    if (!y || !m || !d) continue;
    rides.push({
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      title: fields[2]!,
      durationSec: parseDurationToSec(fields[3]!),
      distanceKm: parseFloat(fields[4]!.replace(/\s*km/, "")),
      elevationM: parseFloat(fields[5]!.replace(/\s*m/, "")),
    });
  }
  rides.sort((a, b) => a.date.localeCompare(b.date));

  const totalDistance = rides.reduce((s, r) => s + r.distanceKm, 0);
  const totalElev = rides.reduce((s, r) => s + r.elevationM, 0);
  const totalDur = rides.reduce((s, r) => s + r.durationSec, 0);

  const rows = rides.map((r) => [
    r.date,
    r.title,
    formatHm(r.durationSec),
    r.distanceKm.toFixed(2),
    String(r.elevationM),
  ]);

  return [
    `## 7. Cycling — historical rides`,
    ``,
    `${rides.length} rides from ${rides[0]?.date ?? "(none)"} → ${rides[rides.length - 1]?.date ?? "(none)"}. Cycling was a regular cardio modality during this window but has not been logged since; treat as historical cardiovascular context.`,
    ``,
    `- total distance: **${totalDistance.toFixed(1)} km**`,
    `- total elevation: **${totalElev.toLocaleString("en-US")} m**`,
    `- total moving time: **${formatHm(totalDur)}**`,
    ``,
    table(["date", "title", "duration", "distance (km)", "elevation (m)"], rows),
  ].join("\n");
}

// ── Section 8: medication log ────────────────────────────────────────────
function sectionMedication(): string {
  const raw = readFileSync(MEDICATION_MD, "utf8").trimEnd();
  return [
    `## 8. Medication — retatrutide log`,
    ``,
    `Free-form journal of retatrutide dosing and side effects. Dates are DD/MM/YYYY. Doses given in syringe-units (50 units = 1 mL) and mg; vial concentration changes are noted inline ("new batch", "/10mg" etc).`,
    ``,
    "```",
    raw,
    "```",
  ].join("\n");
}

// ── Section 9: current-year workouts (full detail) ──────────────────────
interface Set { type: string; weight_kg: number | null; reps: number | null; rpe: number | null }
interface Exercise { title: string; notes: string | null; sets: Set[] }
interface Workout {
  id: string;
  title: string;
  routine_id: string | null;
  start_time: string;
  end_time: string;
  exercises: Exercise[];
}

function formatSet(s: Set, idx: number): string {
  const parts: string[] = [`set ${idx + 1}`];
  if (s.weight_kg != null && s.reps != null) parts.push(`${s.weight_kg} kg × ${s.reps}`);
  else if (s.reps != null) parts.push(`${s.reps} reps`);
  if (s.type !== "normal") parts.push(`_${s.type}_`);
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.join(", ");
}

function formatWorkout(w: Workout): string {
  const date = w.start_time.slice(0, 10);
  const durationMin = Math.round(
    (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000,
  );
  const lines: string[] = [];
  lines.push(`### ${date} — ${w.title}`);
  lines.push("");
  lines.push(`_routine_id: ${w.routine_id ?? "(none)"}, duration: ${durationMin} min_`);
  lines.push("");
  for (const ex of w.exercises) {
    lines.push(`**${ex.title}**`);
    for (let i = 0; i < ex.sets.length; i++) lines.push(`- ${formatSet(ex.sets[i]!, i)}`);
    if (ex.notes && ex.notes.trim()) {
      lines.push(`- _notes:_ ${ex.notes.replace(/\n+/g, " / ").trim()}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function sectionCurrentYear(): string {
  const files = readdirSync(WORKOUTS_DIR).filter((n) => n.endsWith(".json"));
  const workouts: Workout[] = files
    .map((n) => JSON.parse(readFileSync(resolve(WORKOUTS_DIR, n), "utf8")) as Workout)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const head = [
    `## 9. ${YEAR} workouts — full detail`,
    ``,
    `${workouts.length} workouts from ${workouts[0]?.start_time.slice(0, 10) ?? "(none)"} → ${workouts[workouts.length - 1]?.start_time.slice(0, 10) ?? "(none)"}.`,
    ``,
  ].join("\n");

  return head + workouts.map(formatWorkout).join("\n");
}

// ── Compose ──────────────────────────────────────────────────────────────
const md = [
  `# Training & body-composition trend report`,
  ``,
  `_Generated ${TODAY}. Source-of-truth for ${YEAR} workouts: Hevy API. Source-of-truth for pre-${YEAR} workouts: Strong + Repcount CSV exports imported into Hevy on 2026-05-06._`,
  ``,
  `---`,
  ``,
  sectionProfile(),
  ``,
  `---`,
  ``,
  sectionWeight(),
  ``,
  `---`,
  ``,
  sectionNutrition(),
  ``,
  `---`,
  ``,
  sectionBaseline(),
  ``,
  `---`,
  ``,
  sectionPreYearSummary(),
  ``,
  `---`,
  ``,
  sectionPreYearExercises(),
  ``,
  `---`,
  ``,
  sectionCycling(),
  ``,
  `---`,
  ``,
  sectionMedication(),
  ``,
  `---`,
  ``,
  sectionCurrentYear(),
  ``,
].join("\n");

writeFileSync(OUT, md);
console.log(`wrote ${OUT} (${(md.length / 1024).toFixed(1)} KB, ${md.split("\n").length} lines)`);
