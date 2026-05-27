/** TS parity check against verify.py — hits the live Hevy account. */
import * as hevy from "./hevy.js";

function preview(label: string, value: unknown, limit = 480) {
  const s = JSON.stringify(value, null, 0);
  const out = s.length > limit ? `${s.slice(0, limit)} …` : s;
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
  console.log(out);
}

async function main() {
  preview("user/info", await hevy.getUserInfo());
  preview("workouts/count", await hevy.workoutsCount());

  const workouts = await hevy.listWorkouts(1, 2);
  preview("listWorkouts(pageSize=2)", workouts);

  const routines = await hevy.listRoutines(1, 2);
  preview("listRoutines(pageSize=2)", routines);

  const firstWorkout = workouts.workouts[0];
  if (firstWorkout) {
    preview(`getWorkout(${firstWorkout.id})`, await hevy.getWorkout(firstWorkout.id));
  }

  const firstRoutine = routines.routines[0];
  if (firstRoutine) {
    preview(`getRoutine(${firstRoutine.id})`, await hevy.getRoutine(firstRoutine.id));
  }

  // Error mapping smoke test
  try {
    await hevy.getWorkout("00000000-0000-0000-0000-000000000000");
    console.log("\n✗ expected NotFoundError on bogus id, got success");
  } catch (e) {
    if (e instanceof hevy.NotFoundError) {
      console.log(`\n✓ NotFoundError: ${e.message} (status=${e.statusCode}, body=${JSON.stringify(e.response)})`);
    } else {
      console.log(`\n✗ expected NotFoundError, got ${(e as Error).constructor.name}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
