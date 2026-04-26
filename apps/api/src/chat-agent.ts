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

/** Pre-render the diff markdown so flash-lite doesn't have to assemble it
 *  from a 30 KB tool result. Grouped per exercise to match the review format. */
function formatAmendmentDiff(
  changes: Array<{
    exercise_title: string;
    field: "notes" | "weight_kg" | "rep_range";
    set_index?: number;
    before: unknown;
    after: unknown;
  }>,
  errors: string[],
  routineId: string,
): string {
  const lines: string[] = [];
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
          lines.push(`**Notes amended.** Existing content preserved; new lines appended.`);
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
  lines.push("## Patch payload");
  lines.push("");
  lines.push("Saved to `examples/proposed-routine-update.json`. To apply manually:");
  lines.push("");
  lines.push("```bash");
  lines.push(`curl -X PUT "https://api.hevyapp.com/v1/routines/${routineId}" \\`);
  lines.push(`  -H "api-key: $HEVY_API_KEY" \\`);
  lines.push(`  -H "content-type: application/json" \\`);
  lines.push(`  --data @examples/proposed-routine-update.json`);
  lines.push("```");
  lines.push("");
  lines.push(
    "_Not yet automated end-to-end — confirmation lives in the chat; the actual PUT is manual._",
  );
  return lines.join("\n");
}

// ── Tool implementations ─────────────────────────────────────────────────
type Tool = (args: Record<string, unknown>) => Promise<unknown> | unknown;

const tools: Record<string, Tool> = {
  async latest_workout() {
    const { workouts } = await hevy.listWorkouts(1, 1);
    const w = workouts[0];
    if (!w) return { error: "no workouts on this account" };
    return { id: w.id, title: w.title, start_time: w.start_time, routine_id: w.routine_id };
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
    const workoutId = String(args.workout_id);
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

    // Persist the full proposed routine to disk so the user (or a future
    // apply tool) can fetch it. The chat reply does NOT include the full
    // body — flash-lite chokes when asked to re-emit ~30 KB of JSON.
    const exampleDir = resolve(repoRoot(), "examples");
    mkdirSync(exampleDir, { recursive: true });
    const payloadPath = resolve(exampleDir, "proposed-routine-update.json");
    writeFileSync(
      payloadPath,
      JSON.stringify({ routine: result.proposed_routine }, null, 2),
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
      "Run (or load cached) review for a workout. Returns rating, summary, per-exercise " +
      "feedback, and structured suggested edits. Set force=true to bypass cache.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workout_id: { type: Type.STRING },
        force: { type: Type.BOOLEAN },
      },
      required: ["workout_id"],
    },
  },
  {
    name: "propose_amendments_from_review",
    description:
      "PREFERRED for the post-workout 'yes/apply' confirm step. Loads the saved review for " +
      "the given workout_id, builds the edits internally from its suggested_note_change + " +
      "suggested_set_edits fields, and runs compute_routine_update. Returns proposed_routine, " +
      "changes, errors. Single argument — much easier than rebuilding edits by hand.",
    parameters: {
      type: Type.OBJECT,
      properties: { workout_id: { type: Type.STRING } },
      required: ["workout_id"],
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

POST-WORKOUT FLOW (when user asks to review their latest workout, or "post-workout review"):

1. Call latest_workout to get the workout id, then review_workout(workout_id) for the review.
   The review pulls prior sessions and the routine automatically.

2. Reply with one structured response in this order:

   ## Review — Rating: X/10
   {summary}

   ## Per-exercise feedback
   - **{exercise_title}** — {one-sentence observation}

   ## Suggested routine amendments
   One sub-heading per exercise that has changes. **DO NOT use markdown tables here**
   — note text has newlines and pipe characters that break tables. Use this exact format:

   ### {exercise_title}
   **Notes appended:** {ONLY the new line(s) being added, prefixed with a "+ ". DO NOT
   include the existing note text — the user already has it. Compute the diff yourself.}
   **Set N weight:** {old}kg → {new}kg
   **Set N rep range:** {old.start}–{old.end} → {new.start}–{new.end}
   **Why:** {one short sentence}

   Omit any field that doesn't change. Skip exercises that have no suggestions entirely.

   ## Apply?
   Would you like to amend your current routine with these changes? Reply **yes** to
   generate the patch payload, or **cancel** to skip.

3. If the user replies yes/apply/confirm to the "## Apply?" prompt:

   a. Call latest_workout to get the workout_id.
   b. Call propose_amendments_from_review(workout_id).
   c. The tool returns a \`markdown\` field with the full pre-rendered response
      (per-exercise diff, errors if any, and a curl command to apply the patch).
      Output that markdown VERBATIM as your reply. Do NOT summarise, restructure,
      or re-render the proposed routine — the tool already did that work and
      saved the JSON to examples/proposed-routine-update.json. You may add ONE
      short opening sentence ("Here's the diff and how to apply it:") if useful,
      but otherwise echo the markdown as-is.
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
        logger.warn(
          { parts_count: parts.length, finish_reason: finishReason, step },
          "agent returned empty response — emitting fallback",
        );
        finalText =
          "I didn't generate a response — please rephrase your request, or try " +
          "a more specific question (e.g. \"review my latest workout\" or \"apply " +
          "the suggested changes\").";
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
        return {
          functionResponse: { name, response: { result: output } },
        };
      }),
    );

    history.push({ role: "user", parts: responseParts });
  }

  return { text: finalText, tool_calls: toolCalls };
}
