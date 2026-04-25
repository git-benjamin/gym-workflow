/** Gemini agent: function-calling loop with hevy + store tools, used by /api/chat. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from "@google/genai";

import { repoRoot, requireEnv } from "./env.js";
import * as hevy from "./hevy.js";
import * as store from "./store.js";

const MODEL = "gemini-2.5-flash";

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
- Base weight/rep recommendations on multi-session trends, not single sessions.
- For ambiguous questions, fetch a small slice of data first and refine, rather than
  asking many clarifying questions up front.
- Match routine and workout exercises by exercise_template_id, not index.

When you don't know an id, fetch it (latest_workout, list_workouts, list_routines).
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
      model: MODEL,
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
        let output: unknown;
        try {
          output = tool ? await tool(args) : { error: `unknown tool: ${name}` };
        } catch (err) {
          output = {
            error: `${(err as Error).constructor?.name ?? "Error"}: ${(err as Error).message}`,
          };
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
