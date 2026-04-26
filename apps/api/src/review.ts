/** Gemini-backed workout reviewer: rate a session, recommend routine edits. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GoogleGenAI, Type } from "@google/genai";
import { WorkoutReview, type Workout, type Routine } from "@gym/shared";

import { repoRoot, requireEnv } from "./env.js";
import { logger } from "./log.js";
import * as hevy from "./hevy.js";
import * as store from "./store.js";
import type { ExerciseHistorySession } from "./store.js";

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const HISTORY_SESSIONS = 5;

// ── Response schema for Gemini ──────────────────────────────────────────
/** Mirrors the Zod WorkoutReview from packages/shared. Hand-written to stay flexible
 *  across @google/genai SDK versions (avoids zod-to-jsonschema dependency). */
const WORKOUT_REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rating: { type: Type.INTEGER, description: "Overall session quality, 1-10." },
    summary: { type: Type.STRING, description: "2-3 sentences: how the session went vs the plan." },
    per_exercise: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          exercise_title: { type: Type.STRING },
          exercise_template_id: {
            type: Type.STRING,
            description: "Hevy template id from the routine — copy verbatim.",
          },
          observation: {
            type: Type.STRING,
            description: "1-2 sentences on planned vs actual: under/over-target, bottlenecks, surprises.",
          },
          suggested_note_change: {
            type: Type.STRING,
            nullable: true,
            description:
              "Full replacement text for the routine exercise's notes, or null if no change. " +
              "MUST be a superset of the existing notes — preserve every line of the current note " +
              "verbatim and only ADD or AMEND. NEVER remove existing note content.",
          },
          suggested_weight_change: {
            type: Type.STRING,
            nullable: true,
            description: 'Plain English weight adjustment, or null. e.g. "+2.5kg set 1", "hold".',
          },
          suggested_rep_range_change: {
            type: Type.STRING,
            nullable: true,
            description: "Plain English rep_range adjustment, or null.",
          },
          suggested_set_edits: {
            type: Type.ARRAY,
            nullable: true,
            description:
              "Structured per-set edits matching the prose suggestions above. " +
              "Include one entry per set you want to modify, omit unchanged sets. " +
              "Use null when no weight/rep changes are needed.",
            items: {
              type: Type.OBJECT,
              properties: {
                set_index: {
                  type: Type.INTEGER,
                  description: "0-based index matching the routine set's `index` field.",
                },
                weight_kg: { type: Type.NUMBER, nullable: true },
                rep_range_start: { type: Type.INTEGER, nullable: true },
                rep_range_end: { type: Type.INTEGER, nullable: true },
              },
              required: ["set_index"],
            },
          },
        },
        required: ["exercise_title", "exercise_template_id", "observation"],
      },
    },
  },
  required: ["rating", "summary", "per_exercise"],
};

// ── Prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `\
You review a single completed workout against the routine it was started from.

Your output is consumed by an automated workflow that may apply your suggestions back \
to the routine via the Hevy API. The user has set strict scope limits:

- DO recommend changes to: per-exercise routine notes, planned weight_kg, planned rep_range.
- DO NOT recommend: adding exercises, removing exercises, or reordering exercises. \
The structural shape of the routine is the user's call.
- DO NOT remove any existing note content. When you suggest a note change, the \
new note MUST contain every line of the current note verbatim — only add or amend.
- DO NOT change set RPE expectations or rest_seconds — out of scope.
- Skipped exercises (in routine but not in workout) are intentional session-level decisions \
(often A/B alternatives or "Optional" exercises noted in the routine prose). Do NOT \
suggest removing them from the routine.
- Unplanned exercises (in workout but not in routine) stay session-only. Do NOT \
suggest adding them to the routine.

When you suggest a weight or rep_range change, also populate suggested_set_edits \
with structured per-set entries matching your prose. Use the routine sets' index \
field as set_index. This lets the workflow apply your changes programmatically.

Match routine and workout exercises by exercise_template_id, not by index — workout \
order may differ from routine order.

Schema notes:
- Routine sets use rep_range: {start, end} (target). Workout sets use reps (actual).
- Routine has rest_seconds per exercise; workout doesn't surface rest directly.
- RPE 10 in workout sets means the user took the set to technical failure.

Use EXERCISE HISTORY (last 5 prior sessions per exercise, current session excluded) \
to ground weight/rep recommendations in trend, not a single data point:
- If the user has progressed steadily session-over-session, suggesting "+weight" is supported.
- If the weight/reps have stalled across 3+ sessions, recommend a deload, technique review, \
or rest, NOT more load.
- If a session is a clear PR vs recent history, name it explicitly in the observation.
- If history shows a long absence and they're returning to an exercise, treat current numbers \
as a re-acclimation baseline, not a regression.
- Honour the user's body-recomposition deficit context (from PROFILE): strength stalls in a \
deficit are expected and should not be flagged as failures.

Be concise. Only return a suggested_* field when there's a real signal — null is fine.
Rating rubric: 10 = nailed plan + good notes; 7-8 = solid with minor under-performance; \
5-6 = clear bottlenecks/missed targets; <5 = session derailed (skipped most, very low intensity).
`;

function loadProfile(): string {
  const path = resolve(repoRoot(), "profile.md");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function systemInstruction(): string {
  const profile = loadProfile();
  return profile ? `USER PROFILE:\n${profile}\n\n${SYSTEM_PROMPT}` : SYSTEM_PROMPT;
}

// ── History gathering ───────────────────────────────────────────────────
async function gatherExerciseHistory(
  workout: Workout,
  nSessions = HISTORY_SESSIONS,
): Promise<Record<string, ExerciseHistorySession[]>> {
  const currentWorkoutId = workout.id;
  const seen = new Set<string>();
  const uniqueExercises = workout.exercises.filter((ex) => {
    if (seen.has(ex.exercise_template_id)) return false;
    seen.add(ex.exercise_template_id);
    return true;
  });

  // Sets-per-session is small (<10); pad generously to span N sessions plus the current.
  const pageSize = nSessions * 8 + 10;
  const results = await Promise.all(
    uniqueExercises.map(async (ex) => {
      const raw = await hevy.getExerciseHistory(ex.exercise_template_id, 1, pageSize);
      const sessionsByWid = new Map<string, ExerciseHistorySession>();
      for (const s of raw.exercise_history) {
        if (s.workout_id === currentWorkoutId) continue;
        let session = sessionsByWid.get(s.workout_id);
        if (!session) {
          if (sessionsByWid.size >= nSessions) break;
          session = {
            workout_id: s.workout_id,
            workout_title: s.workout_title,
            workout_start_time: s.workout_start_time,
            sets: [],
          };
          sessionsByWid.set(s.workout_id, session);
        }
        session.sets.push({
          set_type: s.set_type,
          weight_kg: s.weight_kg,
          reps: s.reps,
          rpe: s.rpe,
        });
      }
      return [ex.exercise_template_id, [...sessionsByWid.values()]] as [string, ExerciseHistorySession[]];
    }),
  );
  return Object.fromEntries(results);
}

function formatSet(s: ExerciseHistorySession["sets"][number]): string {
  const parts: string[] = [];
  if (s.weight_kg !== null && s.reps !== null) parts.push(`${s.weight_kg}kg×${s.reps}`);
  else if (s.reps !== null) parts.push(`BW×${s.reps}`);
  if (s.rpe !== null) parts.push(`RPE${s.rpe}`);
  if (s.set_type && s.set_type !== "normal") parts.push(s.set_type);
  return parts.join(" ") || "?";
}

function formatHistory(
  history: Record<string, ExerciseHistorySession[]>,
  workout: Workout,
): string {
  const titles = new Map(workout.exercises.map((ex) => [ex.exercise_template_id, ex.title]));
  const lines: string[] = [];
  for (const [tid, sessions] of Object.entries(history)) {
    lines.push(`[${tid}] ${titles.get(tid) ?? tid}`);
    if (sessions.length === 0) {
      lines.push("  (no prior sessions)");
      continue;
    }
    for (const sess of sessions) {
      const date = (sess.workout_start_time ?? "").slice(0, 10);
      const sets = sess.sets.map(formatSet).join(", ");
      lines.push(`  ${date} (${sess.workout_title}): ${sets}`);
    }
  }
  return lines.join("\n");
}

function buildUserPrompt(workout: Workout, routine: Routine, historyText: string): string {
  return `\
ROUTINE (planned):
${JSON.stringify(routine, null, 2)}

WORKOUT (actual, this session):
${JSON.stringify(workout, null, 2)}

EXERCISE HISTORY (last ${HISTORY_SESSIONS} prior sessions per exercise, current session excluded):
${historyText}

Produce the review.`;
}

// ── Public API ──────────────────────────────────────────────────────────
function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
}

export interface ReviewOptions {
  force?: boolean;
}

export async function reviewWorkout(
  workoutId: string,
  options: ReviewOptions = {},
): Promise<WorkoutReview> {
  if (!options.force) {
    const cached = store.loadReview(workoutId);
    if (cached) {
      logger.info(
        { workout_id: workoutId, reviewed_at: cached.reviewed_at, model: cached.model },
        "review cache hit",
      );
      return cached.review;
    }
  }

  logger.info({ workout_id: workoutId }, "review starting");
  const workout = await hevy.getWorkout(workoutId);
  if (!workout.routine_id) {
    throw new Error(`workout ${workoutId} has no routine_id; cannot compare`);
  }
  const routine = await hevy.getRoutine(workout.routine_id);

  const tHistory = Date.now();
  const history = await gatherExerciseHistory(workout);
  logger.debug(
    { workout_id: workoutId, exercises: Object.keys(history).length, duration_ms: Date.now() - tHistory },
    "history gathered",
  );
  const historyText = formatHistory(history, workout);

  const tGemini = Date.now();
  const ai = client();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildUserPrompt(workout, routine, historyText),
    config: {
      systemInstruction: systemInstruction(),
      responseMimeType: "application/json",
      responseSchema: WORKOUT_REVIEW_SCHEMA,
      temperature: 0.3,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned empty response");
  const review = WorkoutReview.parse(JSON.parse(text));
  logger.info(
    { workout_id: workoutId, model: MODEL, rating: review.rating, duration_ms: Date.now() - tGemini },
    "gemini reviewed",
  );

  const path = store.saveReview({
    workout_id: workout.id,
    routine_id: workout.routine_id,
    workout_title: workout.title,
    workout_start_time: workout.start_time,
    reviewed_at: new Date().toISOString(),
    model: MODEL,
    review,
    workout,
    routine,
    history,
  });
  logger.info({ workout_id: workoutId, path }, "review saved");
  return review;
}

export async function reviewLatestWorkout(options: ReviewOptions = {}): Promise<WorkoutReview> {
  const { workouts } = await hevy.listWorkouts(1, 1);
  const first = workouts[0];
  if (!first) throw new Error("no workouts on this account");
  return reviewWorkout(first.id, options);
}
