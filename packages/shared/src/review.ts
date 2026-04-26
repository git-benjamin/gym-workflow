import { z } from "zod";

/** Structured set-level edit, matched to the prose `suggested_weight_change` /
 *  `suggested_rep_range_change` so the agent can apply changes programmatically. */
export const SuggestedSetEdit = z.object({
  set_index: z.number().int(),
  weight_kg: z.number().nullable().optional(),
  rep_range_start: z.number().int().nullable().optional(),
  rep_range_end: z.number().int().nullable().optional(),
});
export type SuggestedSetEdit = z.infer<typeof SuggestedSetEdit>;

export const ExerciseReview = z.object({
  exercise_title: z.string(),
  /** Hevy template id; lets us match this review entry to the routine exercise.
   *  Optional for backward-compat with reviews persisted before this field existed. */
  exercise_template_id: z.string().optional(),
  observation: z.string(),
  /** Full replacement text for the routine note. MUST be a superset of the existing
   *  note (no content removed); only additions/amendments allowed. */
  suggested_note_change: z.string().nullable().optional(),
  /** Human-readable rationale for weight changes (e.g. "+2.5kg set 1, hold sets 2-3"). */
  suggested_weight_change: z.string().nullable().optional(),
  /** Human-readable rationale for rep_range changes. */
  suggested_rep_range_change: z.string().nullable().optional(),
  /** Structured per-set edits matching the prose suggestions; optional for backward-compat. */
  suggested_set_edits: z.array(SuggestedSetEdit).nullable().optional(),
});
export type ExerciseReview = z.infer<typeof ExerciseReview>;

export const WorkoutReview = z.object({
  rating: z.number().int().min(1).max(10),
  summary: z.string(),
  per_exercise: z.array(ExerciseReview),
});
export type WorkoutReview = z.infer<typeof WorkoutReview>;
