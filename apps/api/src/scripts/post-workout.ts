/** Run the full post-workout flow against the latest workout, dump artifacts to examples/.
 *
 *  Output:
 *    examples/review.json                  → WorkoutReview from Gemini (rating, summary, per-exercise + structured edits)
 *    examples/proposed-routine-update.json → full routine body to PUT to /v1/routines/{id}
 *    examples/post-workout-diff.md         → human-readable diff (current vs proposed)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvrc, repoRoot } from "../env.js";
import * as hevy from "../hevy.js";
import { logger } from "../log.js";
import { reviewWorkout } from "../review.js";

loadEnvrc();

const EXAMPLES = resolve(repoRoot(), "examples");
mkdirSync(EXAMPLES, { recursive: true });

const { workouts } = await hevy.listWorkouts(1, 1);
const workout = workouts[0];
if (!workout) throw new Error("no workouts on this account");
if (!workout.routine_id) throw new Error("workout has no routine_id; cannot proceed");

logger.info(
  { workout_id: workout.id, routine_id: workout.routine_id, title: workout.title },
  "post-workout flow starting",
);

// Force a fresh review so the new schema fields (exercise_template_id, suggested_set_edits) are populated.
const review = await reviewWorkout(workout.id, { force: true });
writeFileSync(resolve(EXAMPLES, "review.json"), JSON.stringify(review, null, 2));
logger.info({ rating: review.rating }, "review generated");

// Build structured edits from the review.
const currentRoutine = await hevy.getRoutine(workout.routine_id);
const proposed = JSON.parse(JSON.stringify(currentRoutine)) as typeof currentRoutine;

interface DiffEntry {
  exercise_title: string;
  field: "notes" | "weight_kg" | "rep_range";
  set_index?: number;
  before: unknown;
  after: unknown;
}
const diff: DiffEntry[] = [];
const errors: string[] = [];

for (const review_ex of review.per_exercise) {
  const tid = review_ex.exercise_template_id;
  if (!tid) continue;
  const ex = proposed.exercises.find((e) => e.exercise_template_id === tid);
  if (!ex) continue;

  if (review_ex.suggested_note_change && review_ex.suggested_note_change !== ex.notes) {
    if (ex.notes.trim() && !review_ex.suggested_note_change.includes(ex.notes.trim())) {
      errors.push(`note for "${ex.title}": proposed text drops existing content — refused`);
    } else {
      diff.push({
        exercise_title: ex.title,
        field: "notes",
        before: ex.notes,
        after: review_ex.suggested_note_change,
      });
      ex.notes = review_ex.suggested_note_change;
    }
  }

  for (const setEdit of review_ex.suggested_set_edits ?? []) {
    const set = ex.sets.find((s) => s.index === setEdit.set_index);
    if (!set) {
      errors.push(`"${ex.title}" set_index ${setEdit.set_index} not found`);
      continue;
    }
    if (setEdit.weight_kg !== undefined && setEdit.weight_kg !== null) {
      diff.push({
        exercise_title: ex.title,
        field: "weight_kg",
        set_index: setEdit.set_index,
        before: set.weight_kg,
        after: setEdit.weight_kg,
      });
      set.weight_kg = setEdit.weight_kg;
    }
    if (
      (setEdit.rep_range_start !== undefined && setEdit.rep_range_start !== null) ||
      (setEdit.rep_range_end !== undefined && setEdit.rep_range_end !== null)
    ) {
      const before = set.rep_range ?? { start: null, end: null };
      const after = {
        start: setEdit.rep_range_start ?? before.start,
        end: setEdit.rep_range_end ?? before.end,
      };
      diff.push({
        exercise_title: ex.title,
        field: "rep_range",
        set_index: setEdit.set_index,
        before,
        after,
      });
      set.rep_range = after;
    }
  }
}

writeFileSync(
  resolve(EXAMPLES, "proposed-routine-update.json"),
  JSON.stringify({ routine: proposed }, null, 2),
);

const md: string[] = [
  `# Post-workout review — ${workout.title}`,
  "",
  `**Workout:** ${workout.id}  `,
  `**Routine:** ${workout.routine_id}  `,
  `**Rating:** ${review.rating}/10`,
  "",
  `## Summary`,
  "",
  review.summary,
  "",
  `## Per-exercise feedback`,
  "",
];
for (const ex of review.per_exercise) {
  md.push(`- **${ex.exercise_title}** — ${ex.observation}`);
}
md.push("", `## Suggested amendments`, "");
if (diff.length === 0) {
  md.push("_No structural amendments suggested._");
} else {
  md.push("| Exercise | Field | Set | Current | Suggested |");
  md.push("| --- | --- | --- | --- | --- |");
  for (const d of diff) {
    md.push(
      `| ${d.exercise_title} | ${d.field} | ${d.set_index ?? "—"} | ${JSON.stringify(d.before)} | ${JSON.stringify(d.after)} |`,
    );
  }
}
if (errors.length > 0) {
  md.push("", `## Errors / refused edits`, "");
  for (const e of errors) md.push(`- ${e}`);
}
md.push(
  "",
  "## How to apply",
  "",
  "Run `PUT https://api.hevyapp.com/v1/routines/" + workout.routine_id + "` with the body in",
  "[examples/proposed-routine-update.json](proposed-routine-update.json) (api-key header required).",
  "Not yet automated — manual confirmation step lives in the chat agent.",
);

writeFileSync(resolve(EXAMPLES, "post-workout-diff.md"), md.join("\n") + "\n");

logger.info(
  { diff_count: diff.length, error_count: errors.length },
  "post-workout flow complete — see examples/",
);

console.log("");
console.log(`Wrote:`);
console.log(`  examples/review.json                  (rating ${review.rating}/10)`);
console.log(`  examples/proposed-routine-update.json (${diff.length} change${diff.length === 1 ? "" : "s"})`);
console.log(`  examples/post-workout-diff.md         (human-readable diff)`);
if (errors.length > 0) console.log(`  ${errors.length} edit(s) refused — see diff.md`);
