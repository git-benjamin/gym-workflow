/** Dump the most recent workout + its routine to examples/ as canonical reference shapes. */
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { repoRoot, loadEnvrc } from "../env.js";
import * as hevy from "../hevy.js";

loadEnvrc();

const EXAMPLES = resolve(repoRoot(), "examples");
mkdirSync(EXAMPLES, { recursive: true });

const { workouts } = await hevy.listWorkouts(1, 1);
const workout = workouts[0];
if (!workout) throw new Error("no workouts on this account");

const routine = workout.routine_id ? await hevy.getRoutine(workout.routine_id) : null;

const workoutPath = resolve(EXAMPLES, "workout.json");
const routinePath = resolve(EXAMPLES, "routine.json");

writeFileSync(workoutPath, JSON.stringify(workout, null, 2));
console.log(`wrote ${workoutPath}`);
console.log(`  title: ${workout.title}`);
console.log(`  start_time: ${workout.start_time}`);
console.log(`  exercises: ${workout.exercises.length}`);
console.log(`  routine_id: ${workout.routine_id ?? "(none)"}`);

if (routine) {
  writeFileSync(routinePath, JSON.stringify(routine, null, 2));
  console.log(`wrote ${routinePath}`);
  console.log(`  title: ${routine.title}`);
  console.log(`  exercises: ${routine.exercises.length}`);
} else {
  console.log("no routine_id on the workout — skipped routine dump");
}
