/** Gemini agent: function-calling loop with hevy + store tools, used by /api/chat. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from "@google/genai";

import { repoRoot, requireEnv } from "./env.js";
import { logger } from "./log.js";
import * as hevy from "./hevy.js";
import * as review from "./review.js";
import * as store from "./store.js";

/** Read at call time, not module-load time — server.ts's loadEnvrc() runs
 *  AFTER this module's imports resolve, so a top-level const would freeze
 *  to the default before .envrc lands. */
const model = (): string => process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Line-level note diff: returns lines that appear in `after` but not in `before`,
 *  trimmed and de-duped. Treats blank lines as identity. */
function noteDiffLines(before: string, after: string): string[] {
  const beforeSet = new Set(
    (before ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (after ?? "").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (beforeSet.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Pre-render the diff markdown so flash-lite doesn't have to assemble it
 *  from a 30 KB tool result. Grouped per exercise to match the review format.
 *  Always opens with an explicit "preview only" disclaimer and ends with a
 *  "## Confirm apply?" prompt — the second-confirm step before any PUT. */
function formatAmendmentDiff(
  changes: Array<{
    exercise_title: string;
    field: "notes" | "weight_kg" | "rep_range";
    set_index?: number;
    before: unknown;
    after: unknown;
  }>,
  errors: string[],
  _routineId: string,
): string {
  const lines: string[] = [];
  lines.push("> **Preview only.** Nothing has been pushed to Hevy yet — confirm below to apply.");
  lines.push("");
  lines.push("## Diff");
  lines.push("");
  if (changes.length === 0) {
    lines.push("_No applicable changes._");
  } else {
    const byExercise = new Map<string, typeof changes>();
    for (const c of changes) {
      if (!byExercise.has(c.exercise_title)) byExercise.set(c.exercise_title, []);
      byExercise.get(c.exercise_title)!.push(c);
    }
    for (const [title, group] of byExercise) {
      lines.push(`### ${title}`);
      for (const c of group) {
        if (c.field === "notes") {
          const newLines = noteDiffLines(String(c.before ?? ""), String(c.after ?? ""));
          if (newLines.length === 0) {
            lines.push(`_Notes change is whitespace-only — skipping._`);
          } else {
            lines.push(`**Notes appended** (${newLines.length} new line${newLines.length === 1 ? "" : "s"}):`);
            for (const nl of newLines) lines.push(`> + ${nl}`);
          }
        } else if (c.field === "weight_kg") {
          lines.push(
            `**Set ${(c.set_index ?? 0) + 1} weight:** ${c.before}kg → ${c.after}kg`,
          );
        } else if (c.field === "rep_range") {
          const b = c.before as { start: number | null; end: number | null };
          const a = c.after as { start: number | null; end: number | null };
          lines.push(
            `**Set ${(c.set_index ?? 0) + 1} rep range:** ${b.start ?? "?"}–${b.end ?? "?"} → ${a.start ?? "?"}–${a.end ?? "?"}`,
          );
        }
      }
      lines.push("");
    }
  }
  if (errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const e of errors) lines.push(`- ${e}`);
    lines.push("");
  }
  lines.push("## Confirm apply?");
  lines.push("");
  lines.push(
    "Reply **push to hevy** to update the routine, or **cancel** to discard. " +
      "The proposed body is also saved to `examples/proposed-routine-update.json`.",
  );
  return lines.join("\n");
}

/** Pre-render the post-workout review (rating + summary + per-exercise feedback +
 *  per-exercise amendment deltas), joined into one string. Server-side splitter
 *  on '## Suggested routine amendments' makes this two visual bubbles. */
function formatPostWorkoutReview(record: store.ReviewRecord): string {
  const r = record.review;
  const routine = record.routine;
  const lines: string[] = [];

  lines.push(`## Review — Rating: ${r.rating}/10`);
  lines.push("");
  lines.push(r.summary);
  lines.push("");
  lines.push("## Per-exercise feedback");
  lines.push("");
  for (const ex of r.per_exercise) {
    lines.push(`- **${ex.exercise_title}** — ${ex.observation}`);
  }
  lines.push("");

  // Splitter — server splits the response into two bubbles here.
  lines.push("## Suggested routine amendments");
  lines.push("");

  let amendmentsCount = 0;
  for (const ex of r.per_exercise) {
    if (!ex.exercise_template_id) continue;
    const routineEx = routine.exercises.find(
      (e) => e.exercise_template_id === ex.exercise_template_id,
    );
    if (!routineEx) continue;

    const exLines: string[] = [];

    if (ex.suggested_note_change) {
      const newLines = noteDiffLines(routineEx.notes ?? "", ex.suggested_note_change);
      if (newLines.length > 0) {
        exLines.push(`**Notes appended** (${newLines.length} new line${newLines.length === 1 ? "" : "s"}):`);
        for (const nl of newLines) exLines.push(`> + ${nl}`);
      }
    }

    for (const edit of ex.suggested_set_edits ?? []) {
      const set = routineEx.sets.find((s) => s.index === edit.set_index);
      if (!set) continue;
      if (edit.weight_kg != null && edit.weight_kg !== set.weight_kg) {
        exLines.push(
          `**Set ${edit.set_index + 1} weight:** ${set.weight_kg}kg → ${edit.weight_kg}kg`,
        );
      }
      const beforeRange = set.rep_range ?? { start: null, end: null };
      const afterStart = edit.rep_range_start ?? beforeRange.start;
      const afterEnd = edit.rep_range_end ?? beforeRange.end;
      const rangeChanged =
        (edit.rep_range_start !== undefined && edit.rep_range_start !== beforeRange.start) ||
        (edit.rep_range_end !== undefined && edit.rep_range_end !== beforeRange.end);
      if (rangeChanged) {
        exLines.push(
          `**Set ${edit.set_index + 1} rep range:** ${beforeRange.start ?? "?"}–${beforeRange.end ?? "?"} → ${afterStart ?? "?"}–${afterEnd ?? "?"}`,
        );
      }
    }

    if (exLines.length === 0) continue;
    lines.push(`### ${ex.exercise_title}`);
    for (const l of exLines) lines.push(l);
    lines.push("");
    amendmentsCount++;
  }

  if (amendmentsCount === 0) {
    lines.push("_No amendments suggested — the session is already on plan._");
  } else {
    lines.push("## Apply?");
    lines.push("");
    lines.push("Click **Preview amendments** to see the full diff (no changes pushed yet), or **cancel** to skip.");
  }

  return lines.join("\n");
}

/** Success markdown for the actual apply step. */
function formatApplySuccess(routineTitle: string, routineId: string, durationMs: number): string {
  return [
    `## ✓ Applied to Hevy`,
    "",
    `Routine **${routineTitle}** updated.`,
    "",
    `\`PUT /v1/routines/${routineId}\` succeeded in ${durationMs}ms. Open Hevy to verify the changes are visible on the routine.`,
  ].join("\n");
}

function formatApplyFailure(routineId: string, error: string): string {
  return [
    `## ✗ Apply failed`,
    "",
    `\`PUT /v1/routines/${routineId}\` returned an error:`,
    "",
    "```",
    error,
    "```",
    "",
    "Routine on Hevy is unchanged. The proposed body is still saved to " +
      "`examples/proposed-routine-update.json` if you want to investigate or retry manually.",
  ].join("\n");
}

// ── Tool implementations ─────────────────────────────────────────────────
type Tool = (args: Record<string, unknown>) => Promise<unknown> | unknown;

/** Resolve the workout_id arg to an actual id, defaulting to the latest workout. */
async function resolveWorkoutId(args: Record<string, unknown>): Promise<string | null> {
  const explicit = args.workout_id;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const { workouts } = await hevy.listWorkouts(1, 1);
  return workouts[0]?.id ?? null;
}

const tools: Record<string, Tool> = {
  async latest_workout() {
    const { workouts } = await hevy.listWorkouts(1, 1);
    const w = workouts[0];
    if (!w) return { error: "no workouts on this account" };
    return { id: w.id, title: w.title, start_time: w.start_time, routine_id: w.routine_id };
  },

  /** Returns pre-rendered markdown for the post-workout review (both bubbles). */
  async post_workout_review_response(args) {
    const workoutId = await resolveWorkoutId(args);
    if (!workoutId) return { error: "no workouts on this account" };
    let record = store.loadReview(workoutId);
    if (!record) {
      // Trigger a fresh review and reload from disk.
      await review.reviewWorkout(workoutId);
      record = store.loadReview(workoutId);
      if (!record) return { error: "review failed to persist" };
    }
    return {
      workout_id: record.workout_id,
      rating: record.review.rating,
      cached: !!record.reviewed_at,
      markdown: formatPostWorkoutReview(record),
    };
  },
  async get_workout(args) {
    return await hevy.getWorkout(String(args.workout_id));
  },
  async list_workouts(args) {
    return await hevy.listWorkouts(
      Number(args.page ?? 1),
      Number(args.page_size ?? 5),
    );
  },
  async workouts_count() {
    return await hevy.workoutsCount();
  },
  async get_routine(args) {
    return await hevy.getRoutine(String(args.routine_id));
  },
  async list_routines(args) {
    return await hevy.listRoutines(
      Number(args.page ?? 1),
      Number(args.page_size ?? 5),
    );
  },
  async get_exercise_history(args) {
    return await hevy.getExerciseHistory(
      String(args.exercise_template_id),
      1,
      Number(args.page_size ?? 30),
    );
  },
  list_reviews(args) {
    return store.listReviews(args.limit !== undefined ? Number(args.limit) : 10);
  },
  load_review(args) {
    const r = store.loadReview(String(args.workout_id));
    return r ?? { error: `no saved review for workout ${args.workout_id}` };
  },
  async review_workout(args) {
    return await review.reviewWorkout(String(args.workout_id), {
      force: Boolean(args.force ?? false),
    });
  },
  async propose_amendments_from_review(args) {
    const workoutId = await resolveWorkoutId(args);
    if (!workoutId) return { error: "no workouts on this account" };
    const record = store.loadReview(workoutId);
    if (!record) {
      return { error: `no saved review for workout ${workoutId}. Call review_workout first.` };
    }
    const routineId = record.routine_id;
    if (!routineId) return { error: "review has no routine_id; cannot propose amendments" };

    interface Edit {
      exercise_template_id: string;
      notes?: string;
      sets?: Array<{
        set_index: number;
        weight_kg?: number | null;
        rep_range_start?: number | null;
        rep_range_end?: number | null;
      }>;
    }

    const edits: Edit[] = [];
    for (const ex of record.review.per_exercise) {
      if (!ex.exercise_template_id) continue;
      const hasNote = ex.suggested_note_change != null;
      const hasSets = (ex.suggested_set_edits?.length ?? 0) > 0;
      if (!hasNote && !hasSets) continue;
      const e: Edit = { exercise_template_id: ex.exercise_template_id };
      if (hasNote && ex.suggested_note_change) e.notes = ex.suggested_note_change;
      if (hasSets && ex.suggested_set_edits) e.sets = ex.suggested_set_edits;
      edits.push(e);
    }

    if (edits.length === 0) {
      return {
        markdown: "_No actionable amendments in this review — nothing to apply._",
        diff_count: 0,
        error_count: 0,
      };
    }

    // Delegate to compute_routine_update for the actual diff + validation.
    const result = (await tools.compute_routine_update!({
      routine_id: routineId,
      edits,
    })) as {
      proposed_routine: unknown;
      changes: Array<{
        exercise_template_id: string;
        exercise_title: string;
        field: "notes" | "weight_kg" | "rep_range";
        set_index?: number;
        before: unknown;
        after: unknown;
      }>;
      errors: string[];
    };

    // Persist the proposed routine in the slimmer PUT-body shape so the file
    // is directly applicable via `curl --data @...` (no client-side stripping
    // needed). The full GET response carries fields Hevy rejects on PUT.
    const exampleDir = resolve(repoRoot(), "examples");
    mkdirSync(exampleDir, { recursive: true });
    const payloadPath = resolve(exampleDir, "proposed-routine-update.json");
    writeFileSync(
      payloadPath,
      JSON.stringify(
        hevy.toPutRoutineBody(result.proposed_routine as Parameters<typeof hevy.toPutRoutineBody>[0]),
        null,
        2,
      ),
    );

    // Pre-render the markdown the agent should echo verbatim.
    const md = formatAmendmentDiff(result.changes, result.errors, routineId);

    return {
      routine_id: routineId,
      diff_count: result.changes.length,
      error_count: result.errors.length,
      proposed_routine_path: "examples/proposed-routine-update.json",
      markdown: md,
    };
  },

  async apply_routine_update(args) {
    const workoutId = await resolveWorkoutId(args);
    if (!workoutId) return { error: "no workouts on this account" };
    const record = store.loadReview(workoutId);
    if (!record) {
      return { error: `no saved review for workout ${workoutId}. Call review_workout first.` };
    }
    const routineId = record.routine_id;
    if (!routineId) return { error: "review has no routine_id; cannot apply" };

    const payloadPath = resolve(repoRoot(), "examples", "proposed-routine-update.json");
    if (!existsSync(payloadPath)) {
      return {
        error:
          "no proposed update on disk. Call propose_amendments_from_review first " +
          "to generate the payload, then confirm.",
      };
    }
    const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as { routine: unknown };

    const t0 = Date.now();
    try {
      await hevy.updateRoutine(routineId, payload);
    } catch (err) {
      const e = err as Error;
      logger.error(
        {
          routine_id: routineId,
          err_name: e.constructor?.name,
          err_message: e.message,
          response: (e as { response?: unknown }).response,
        },
        "apply_routine_update failed",
      );
      const upstream =
        (e as { response?: unknown }).response != null
          ? `${e.message}: ${JSON.stringify((e as { response?: unknown }).response).slice(0, 300)}`
          : e.message;
      return {
        applied: false,
        routine_id: routineId,
        markdown: formatApplyFailure(routineId, upstream),
      };
    }

    const after = await hevy.getRoutine(routineId);
    const ms = Date.now() - t0;
    logger.info(
      { routine_id: routineId, duration_ms: ms, exercises: after.exercises.length },
      "apply_routine_update succeeded",
    );
    return {
      applied: true,
      routine_id: routineId,
      duration_ms: ms,
      markdown: formatApplySuccess(after.title, routineId, ms),
    };
  },

  async compute_routine_update(args) {
    const routineId = String(args.routine_id);
    const edits = (args.edits ?? []) as Array<{
      exercise_template_id: string;
      notes?: string | null;
      sets?: Array<{
        set_index: number;
        weight_kg?: number | null;
        rep_range_start?: number | null;
        rep_range_end?: number | null;
      }>;
    }>;

    const current = await hevy.getRoutine(routineId);
    const proposed = JSON.parse(JSON.stringify(current)) as typeof current;
    const changes: Array<{
      exercise_template_id: string;
      exercise_title: string;
      field: "notes" | "weight_kg" | "rep_range";
      set_index?: number;
      before: unknown;
      after: unknown;
    }> = [];
    const errors: string[] = [];

    for (const edit of edits) {
      const ex = proposed.exercises.find(
        (e) => e.exercise_template_id === edit.exercise_template_id,
      );
      if (!ex) {
        errors.push(`exercise_template_id ${edit.exercise_template_id} not in routine`);
        continue;
      }

      if (edit.notes !== undefined && edit.notes !== null) {
        const before = ex.notes;
        if (!edit.notes.includes(before.trim()) && before.trim().length > 0) {
          errors.push(
            `proposed note for "${ex.title}" does not preserve existing content — refusing`,
          );
          continue;
        }
        changes.push({
          exercise_template_id: edit.exercise_template_id,
          exercise_title: ex.title,
          field: "notes",
          before,
          after: edit.notes,
        });
        ex.notes = edit.notes;
      }

      for (const s of edit.sets ?? []) {
        const set = ex.sets.find((x) => x.index === s.set_index);
        if (!set) {
          errors.push(`set_index ${s.set_index} not on exercise "${ex.title}"`);
          continue;
        }
        if (s.weight_kg !== undefined && s.weight_kg !== null) {
          changes.push({
            exercise_template_id: edit.exercise_template_id,
            exercise_title: ex.title,
            field: "weight_kg",
            set_index: s.set_index,
            before: set.weight_kg,
            after: s.weight_kg,
          });
          set.weight_kg = s.weight_kg;
        }
        if (s.rep_range_start !== undefined || s.rep_range_end !== undefined) {
          const beforeRange = set.rep_range ?? { start: null, end: null };
          const afterRange = {
            start: s.rep_range_start ?? beforeRange.start,
            end: s.rep_range_end ?? beforeRange.end,
          };
          changes.push({
            exercise_template_id: edit.exercise_template_id,
            exercise_title: ex.title,
            field: "rep_range",
            set_index: s.set_index,
            before: beforeRange,
            after: afterRange,
          });
          set.rep_range = afterRange;
        }
      }
    }

    return {
      proposed_routine: proposed,
      changes,
      errors,
      patch_payload_note:
        "proposed_routine is the body that would be PUT to /v1/routines/{routine_id}. " +
        "This tool only previews — it does not call Hevy.",
    };
  },
};

// ── Tool declarations for Gemini ────────────────────────────────────────
const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "latest_workout",
    description: "Return id, title, and start_time of the most recent workout.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_workout",
    description: "Fetch full details of a single workout (sets, reps, RPE, per-exercise notes) by id.",
    parameters: {
      type: Type.OBJECT,
      properties: { workout_id: { type: Type.STRING } },
      required: ["workout_id"],
    },
  },
  {
    name: "list_workouts",
    description: "List workouts, newest first. page_size 1-10.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        page: { type: Type.INTEGER },
        page_size: { type: Type.INTEGER },
      },
    },
  },
  {
    name: "workouts_count",
    description: "Total number of workouts on the account.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_routine",
    description: "Fetch a routine (planned exercises, target rep ranges, rest_seconds, notes) by id.",
    parameters: {
      type: Type.OBJECT,
      properties: { routine_id: { type: Type.STRING } },
      required: ["routine_id"],
    },
  },
  {
    name: "list_routines",
    description: "List routines.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        page: { type: Type.INTEGER },
        page_size: { type: Type.INTEGER },
      },
    },
  },
  {
    name: "get_exercise_history",
    description:
      "Fetch recent set history of one exercise. Returns flat sets newest-first by workout. " +
      "page_size counts SETS; ~30 spans ~5-7 prior sessions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        exercise_template_id: { type: Type.STRING },
        page_size: { type: Type.INTEGER },
      },
      required: ["exercise_template_id"],
    },
  },
  {
    name: "list_reviews",
    description: "List past saved workout reviews, newest first by workout date.",
    parameters: {
      type: Type.OBJECT,
      properties: { limit: { type: Type.INTEGER } },
    },
  },
  {
    name: "load_review",
    description: "Load the saved review for a specific workout, or {error} if none exists.",
    parameters: {
      type: Type.OBJECT,
      properties: { workout_id: { type: Type.STRING } },
      required: ["workout_id"],
    },
  },
  {
    name: "review_workout",
    description:
      "Run (or load cached) review for a workout. Returns the structured review JSON " +
      "(rating, summary, per_exercise + suggested edits). For the 'review my latest workout' " +
      "flow, prefer post_workout_review_response which returns pre-rendered markdown.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workout_id: {
          type: Type.STRING,
          description: "Optional. If omitted, defaults to the most recent workout.",
        },
        force: { type: Type.BOOLEAN },
      },
    },
  },
  {
    name: "post_workout_review_response",
    description:
      "PREFERRED entry for 'review my latest workout'. Returns pre-rendered markdown " +
      "covering both visual bubbles (review + suggested amendments). The chat surface " +
      "splits the output into two bubbles automatically. Calls review_workout internally " +
      "if no cached review exists. Echo `markdown` verbatim — do not reformat.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workout_id: {
          type: Type.STRING,
          description: "Optional. If omitted, defaults to the most recent workout.",
        },
      },
    },
  },
  {
    name: "propose_amendments_from_review",
    description:
      "PREFERRED for the 'yes' / 'preview amendments' confirm step. Returns pre-rendered " +
      "preview markdown with line-level note diffs, weight/rep changes, and a '## Confirm " +
      "apply?' prompt. Echo `markdown` verbatim. Defaults to the latest workout if " +
      "workout_id is omitted.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workout_id: {
          type: Type.STRING,
          description: "Optional. If omitted, defaults to the most recent workout.",
        },
      },
    },
  },
  {
    name: "apply_routine_update",
    description:
      "ACTUALLY pushes the proposed routine update to Hevy via PUT /v1/routines/{id}. " +
      "Mutates the user's account. Only call after the user has explicitly confirmed " +
      "with words like 'push to hevy', 'apply to hevy', 'confirm apply', 'push it' — " +
      "NEVER on a plain 'yes', which is reserved for the preview step. Defaults to the " +
      "latest workout if workout_id is omitted.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workout_id: {
          type: Type.STRING,
          description: "Optional. If omitted, defaults to the most recent workout.",
        },
      },
    },
  },
  {
    name: "compute_routine_update",
    description:
      "Preview applying structured edits to a routine. Returns the proposed full routine " +
      "(the body that would PUT to /v1/routines/{id}), a per-change diff, and errors for any " +
      "edits that violate scope (notes that drop existing content, missing exercises/sets). " +
      "DOES NOT call Hevy — it's a preview only. Use this for one-off, manual edits — for " +
      "the 'yes/apply' confirm step prefer propose_amendments_from_review.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        routine_id: { type: Type.STRING },
        edits: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              exercise_template_id: { type: Type.STRING },
              notes: {
                type: Type.STRING,
                nullable: true,
                description:
                  "Replacement note text. MUST be a superset of the existing note — never remove content.",
              },
              sets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    set_index: { type: Type.INTEGER },
                    weight_kg: { type: Type.NUMBER, nullable: true },
                    rep_range_start: { type: Type.INTEGER, nullable: true },
                    rep_range_end: { type: Type.INTEGER, nullable: true },
                  },
                  required: ["set_index"],
                },
              },
            },
            required: ["exercise_template_id"],
          },
        },
      },
      required: ["routine_id", "edits"],
    },
  },
];

// ── System prompt ────────────────────────────────────────────────────────
function loadProfile(): string {
  const path = resolve(repoRoot(), "profile.md");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function systemInstruction(): string {
  return `\
You are an evidence-based hypertrophy coach with access to the user's Hevy training history
and saved workout reviews. Use tools to fetch real data — never make up numbers.

USER PROFILE:
${loadProfile()}

Style:
- Concise. Cite dates, weights, reps, RPE from real data; never invent numbers.
- Markdown tables for set-by-set data; prose for analysis.
- Routine edit scope: only weight, rep_range, and notes. Do NOT propose adding,
  removing, or reordering exercises in routines — the structural shape is the user's call.
- NEVER remove existing note content. Note changes must be a superset of the current note.
- Do NOT change RPE or rest_seconds — out of scope.
- Base weight/rep recommendations on multi-session trends, not single sessions.
- For ambiguous questions, fetch a small slice of data first and refine, rather than
  asking many clarifying questions up front.
- Match routine and workout exercises by exercise_template_id, not index.

When you don't know an id, fetch it (latest_workout, list_workouts, list_routines).

POST-WORKOUT FLOW — three single-tool steps. Always pass NO arguments to these
tools (they default to the most recent workout). Always echo the tool's
\`markdown\` field verbatim.

1. When the user asks to review their latest workout (or any "post-workout review"
   phrasing): call \`post_workout_review_response\` and echo its \`markdown\`.
   The server splits the output into two bubbles automatically (review +
   suggested amendments) on the "## Suggested routine amendments" boundary.

2. FIRST confirm — preview. If the user replies "yes" / "preview" / "apply"
   to the "## Apply?" prompt: call \`propose_amendments_from_review\` with NO
   arguments and echo \`markdown\`. The output starts with "Preview only —
   nothing has been pushed yet" and ends with "## Confirm apply?". The actual
   PUT has NOT happened.

3. SECOND confirm — push. If the user replies "push to hevy" / "push it" /
   "apply to hevy" / "confirm apply": call \`apply_routine_update\` with NO
   arguments and echo \`markdown\` (either "✓ Applied to Hevy" or "✗ Apply
   failed"). This is the only tool that mutates Hevy.

GUARDRAILS for the apply step:
- Never call \`apply_routine_update\` on a plain "yes" — "yes" is reserved for
  the preview (step 2).
- Always pass NO arguments to these tools — they default to the latest workout.
  Do NOT guess or hallucinate a workout_id.
- If the user's intent is unclear, ask for explicit "push to hevy" confirmation
  rather than guessing.
`;
}

// ── Public agent loop ────────────────────────────────────────────────────
export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: unknown;
}

export interface AgentResult {
  text: string;
  tool_calls: ToolCallTrace[];
}

/**
 * Run one user-message turn through the agent.
 * `history` is the prior conversation as Gemini Content[]; this function appends to it.
 */
export async function runAgentTurn(
  userMessage: string,
  history: Content[],
): Promise<AgentResult> {
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });

  history.push({ role: "user", parts: [{ text: userMessage }] });

  const toolCalls: ToolCallTrace[] = [];
  let finalText = "";
  /** Tracks the most recent tool-result `markdown` field so we can fall back
   *  to it when the model fails to echo (flash-lite hits finish_reason=STOP
   *  with zero parts after some long pre-rendered tool results). */
  let lastToolMarkdown: string | null = null;

  // Manual function-call loop. Cap iterations so a buggy tool can't infinite-loop.
  for (let step = 0; step < 8; step++) {
    const response = await ai.models.generateContent({
      model: model(),
      contents: history,
      config: {
        systemInstruction: systemInstruction(),
        // Pass only declarations (no JS callables) — the SDK has nothing to auto-invoke,
        // so AFC is effectively off and we run the loop manually.
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: 0.3,
      },
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCallParts = parts.filter((p) => p.functionCall);

    if (functionCallParts.length === 0) {
      finalText = parts.map((p) => p.text ?? "").join("");
      if (!finalText.trim()) {
        const finishReason = candidate?.finishReason;
        if (lastToolMarkdown) {
          // Pre-rendered tool result is exactly what the model was supposed to
          // echo. Use it directly so flash-lite's empty-output failure mode is
          // a no-op rather than a user-facing fallback.
          logger.info(
            { parts_count: parts.length, finish_reason: finishReason, step, source: "tool_markdown" },
            "agent empty — falling back to tool's pre-rendered markdown",
          );
          finalText = lastToolMarkdown;
        } else {
          logger.warn(
            { parts_count: parts.length, finish_reason: finishReason, step },
            "agent returned empty response — emitting generic fallback",
          );
          finalText =
            "I didn't generate a response — please rephrase your request, or try " +
            "a more specific question (e.g. \"review my latest workout\" or \"apply " +
            "the suggested changes\").";
        }
      }
      if (candidate?.content) history.push(candidate.content);
      break;
    }

    if (candidate?.content) history.push(candidate.content);

    const responseParts = await Promise.all(
      functionCallParts.map(async (p) => {
        const fc = p.functionCall!;
        const name = fc.name ?? "";
        const args = (fc.args ?? {}) as Record<string, unknown>;
        const tool = tools[name];
        const tStart = Date.now();
        let output: unknown;
        try {
          output = tool ? await tool(args) : { error: `unknown tool: ${name}` };
          logger.debug({ tool: name, args, duration_ms: Date.now() - tStart }, "tool call");
        } catch (err) {
          output = {
            error: `${(err as Error).constructor?.name ?? "Error"}: ${(err as Error).message}`,
          };
          logger.warn(
            { tool: name, args, error: (err as Error).message, duration_ms: Date.now() - tStart },
            "tool call failed",
          );
        }
        toolCalls.push({ name, input: args, output });
        // Capture the tool's pre-rendered markdown for the empty-response
        // fallback (see lastToolMarkdown above).
        if (output && typeof output === "object" && "markdown" in output) {
          const m = (output as { markdown?: unknown }).markdown;
          if (typeof m === "string" && m.trim()) lastToolMarkdown = m;
        }
        return {
          functionResponse: { name, response: { result: output } },
        };
      }),
    );

    history.push({ role: "user", parts: responseParts });
  }

  return { text: finalText, tool_calls: toolCalls };
}
