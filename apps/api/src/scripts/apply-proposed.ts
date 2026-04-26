/** Apply examples/proposed-routine-update.json to Hevy via PUT /v1/routines/{id}.
 *
 *  This is the only script that actually MUTATES your Hevy account. Run only
 *  after reviewing the proposed payload (the contents of examples/post-workout-diff.md).
 *
 *  The JSON file is already in Hevy's PUT body shape (see hevy.toPutRoutineBody).
 *
 *  Usage:
 *    pnpm api:apply-proposed              # apply
 *    pnpm api:apply-proposed --dry-run    # show before/after, no PUT
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvrc, repoRoot } from "../env.js";
import * as hevy from "../hevy.js";
import { logger } from "../log.js";

loadEnvrc();

const dryRun = process.argv.includes("--dry-run");

const payloadPath = resolve(repoRoot(), "examples", "proposed-routine-update.json");
if (!existsSync(payloadPath)) {
  console.error(
    `No proposed routine at ${payloadPath}. Run \`pnpm api:post-workout\` first.`,
  );
  process.exit(1);
}

interface PutBody {
  routine: {
    title: string;
    notes: string | null;
    exercises: Array<{
      exercise_template_id: string;
      notes: string;
      sets: Array<{ weight_kg: number | null; reps: number | null; rep_range?: { start: number | null; end: number | null } | null }>;
    }>;
  };
}

const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as PutBody;

// We need the routine_id to PUT to. The PUT body itself doesn't carry id, so
// match by title against the user's routines.
// Hevy caps page size at 10 — paginate if needed.
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

const routineId = await findRoutineIdByTitle(payload.routine.title);
if (!routineId) {
  console.error(
    `Could not find a routine titled "${payload.routine.title}" on the account. ` +
      "Either re-run pnpm api:post-workout or set the routine title to match.",
  );
  process.exit(1);
}

console.log(`Target routine: ${payload.routine.title}`);
console.log(`           id:  ${routineId}`);
console.log(`    exercises:  ${payload.routine.exercises.length}`);
console.log(`     dry-run?:  ${dryRun}`);
console.log("");

console.log("Fetching current routine for before/after diff…");
const before = await hevy.getRoutine(routineId);

console.log("");
console.log("Per-exercise change preview (matched by exercise_template_id):");

for (const proposed of payload.routine.exercises) {
  const beforeEx = before.exercises.find(
    (e) => e.exercise_template_id === proposed.exercise_template_id,
  );
  if (!beforeEx) {
    console.log(`  • [unknown ${proposed.exercise_template_id}] (not in current routine)`);
    continue;
  }
  const beforeWeights = beforeEx.sets.map((s) => s.weight_kg);
  const proposedWeights = proposed.sets.map((s) => s.weight_kg);
  const weightChange = JSON.stringify(beforeWeights) !== JSON.stringify(proposedWeights);
  const notesChange = beforeEx.notes !== proposed.notes;
  if (!weightChange && !notesChange) continue;
  console.log(`  • ${beforeEx.title}`);
  if (weightChange) {
    console.log(`      weights: ${JSON.stringify(beforeWeights)}  →  ${JSON.stringify(proposedWeights)}`);
  }
  if (notesChange) {
    console.log(
      `      notes length: ${beforeEx.notes.length}  →  ${proposed.notes.length} (Δ ${proposed.notes.length - beforeEx.notes.length})`,
    );
  }
}

if (dryRun) {
  console.log("");
  console.log("dry-run; no PUT made.");
  process.exit(0);
}

console.log("");
console.log(`Applying via PUT /v1/routines/${routineId}…`);
const t0 = Date.now();
try {
  const resp = await hevy.updateRoutine(routineId, payload);
  const ms = Date.now() - t0;
  logger.info({ routine_id: routineId, duration_ms: ms }, "PUT /v1/routines/{id} succeeded");
  console.log(`✓ apply succeeded in ${ms}ms`);
  console.log("  response sample:", JSON.stringify(resp).slice(0, 200));
} catch (err) {
  const e = err as Error;
  logger.error(
    {
      routine_id: routineId,
      err_name: e.constructor?.name,
      err_message: e.message,
      response: (e as { response?: unknown }).response,
      duration_ms: Date.now() - t0,
    },
    "PUT /v1/routines/{id} failed",
  );
  console.error(`✗ apply failed: ${e.constructor.name}: ${e.message}`);
  if ((e as { response?: unknown }).response) {
    console.error("   upstream:", JSON.stringify((e as { response?: unknown }).response).slice(0, 600));
  }
  process.exit(1);
}

console.log("");
console.log("Re-fetching to verify…");
const after = await hevy.getRoutine(routineId);
let appliedCount = 0;
for (const proposed of payload.routine.exercises) {
  const ex = after.exercises.find((e) => e.exercise_template_id === proposed.exercise_template_id);
  if (!ex) continue;
  const proposedWeights = JSON.stringify(proposed.sets.map((s) => s.weight_kg));
  const afterWeights = JSON.stringify(ex.sets.map((s) => s.weight_kg));
  const weightsMatch = proposedWeights === afterWeights;
  const notesMatch = proposed.notes === ex.notes;
  if (weightsMatch && notesMatch) appliedCount++;
}
console.log(`✓ ${appliedCount}/${payload.routine.exercises.length} exercises confirmed updated.`);
