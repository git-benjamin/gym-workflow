import { z } from "zod";

export const ExerciseReview = z.object({
  exercise_title: z.string(),
  observation: z.string(),
  suggested_note_change: z.string().nullable(),
  suggested_weight_change: z.string().nullable(),
  suggested_rep_range_change: z.string().nullable(),
});
export type ExerciseReview = z.infer<typeof ExerciseReview>;

export const WorkoutReview = z.object({
  rating: z.number().int().min(1).max(10),
  summary: z.string(),
  per_exercise: z.array(ExerciseReview),
});
export type WorkoutReview = z.infer<typeof WorkoutReview>;
