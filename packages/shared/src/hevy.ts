import { z } from "zod";

// ── Sets ────────────────────────────────────────────────────────────────
export const SetType = z.enum(["normal", "warmup", "failure", "dropset"]);
export type SetType = z.infer<typeof SetType>;

/** Workout sets carry actual reps + RPE. */
export const WorkoutSet = z.object({
  index: z.number().int(),
  type: SetType,
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
  distance_meters: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  rpe: z.number().nullable(),
  custom_metric: z.unknown().nullable(),
});
export type WorkoutSet = z.infer<typeof WorkoutSet>;

/** Routine sets carry rep_range targets, no RPE. */
export const RepRange = z.object({
  start: z.number().int().nullable(),
  end: z.number().int().nullable(),
});

export const RoutineSet = z.object({
  index: z.number().int(),
  type: SetType,
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
  distance_meters: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  custom_metric: z.unknown().nullable(),
  rep_range: RepRange.optional(),
});
export type RoutineSet = z.infer<typeof RoutineSet>;

// ── Exercises ───────────────────────────────────────────────────────────
export const WorkoutExercise = z.object({
  index: z.number().int(),
  title: z.string(),
  notes: z.string().nullable().transform((v) => v ?? ""),
  exercise_template_id: z.string(),
  superset_id: z.string().nullable(),
  sets: z.array(WorkoutSet),
});
export type WorkoutExercise = z.infer<typeof WorkoutExercise>;

export const RoutineExercise = z.object({
  index: z.number().int(),
  title: z.string(),
  notes: z.string().nullable().transform((v) => v ?? ""),
  exercise_template_id: z.string(),
  superset_id: z.string().nullable(),
  sets: z.array(RoutineSet),
  rest_seconds: z.number().int().nullable().optional(),
});
export type RoutineExercise = z.infer<typeof RoutineExercise>;

// ── Workouts & routines ─────────────────────────────────────────────────
export const Workout = z.object({
  id: z.string(),
  title: z.string(),
  routine_id: z.string().nullable(),
  description: z.string().nullable(),
  start_time: z.string(),
  end_time: z.string(),
  updated_at: z.string(),
  created_at: z.string(),
  exercises: z.array(WorkoutExercise),
});
export type Workout = z.infer<typeof Workout>;

export const Routine = z.object({
  id: z.string(),
  title: z.string(),
  folder_id: z.string().nullable(),
  updated_at: z.string(),
  created_at: z.string(),
  exercises: z.array(RoutineExercise),
});
export type Routine = z.infer<typeof Routine>;

// ── Paginated responses ─────────────────────────────────────────────────
export const WorkoutsPage = z.object({
  page: z.number().int(),
  page_count: z.number().int(),
  workouts: z.array(Workout),
});
export type WorkoutsPage = z.infer<typeof WorkoutsPage>;

export const RoutinesPage = z.object({
  page: z.number().int(),
  page_count: z.number().int(),
  routines: z.array(Routine),
});
export type RoutinesPage = z.infer<typeof RoutinesPage>;

export const RoutineEnvelope = z.object({ routine: Routine });

export const WorkoutsCount = z.object({
  workout_count: z.number().int(),
});

export const UserInfo = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
  }),
});

// ── Exercise history ────────────────────────────────────────────────────
/** Each entry is a single set with workout metadata embedded. Newest-first by start_time. */
export const ExerciseHistorySet = z.object({
  workout_id: z.string(),
  workout_title: z.string(),
  workout_start_time: z.string(),
  workout_end_time: z.string(),
  exercise_template_id: z.string(),
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
  distance_meters: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  rpe: z.number().nullable(),
  custom_metric: z.unknown().nullable(),
  set_type: SetType,
});
export type ExerciseHistorySet = z.infer<typeof ExerciseHistorySet>;

export const ExerciseHistory = z.object({
  exercise_history: z.array(ExerciseHistorySet),
});
