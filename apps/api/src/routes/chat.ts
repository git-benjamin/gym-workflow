/** POST /api/chat and GET /api/chat/sessions — JSON chat surface for the Expo app. */
import type { Content } from "@google/genai";
import { Hono } from "hono";
import { z } from "zod";

import { runAgentTurn } from "../chat-agent.js";
import * as store from "../store.js";

const ChatRequestSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().min(1),
});

/** Project a stored ChatTurn back into Gemini Content. */
function turnToContent(turn: store.ChatTurn): Content {
  return {
    role: turn.role,
    parts: [{ text: turn.text }],
  };
}

export const chatRoute = new Hono();

chatRoute.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json({ error: `invalid JSON: ${(err as Error).message}` }, 400);
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "expected { session_id, message }", details: parsed.error.flatten() }, 400);
  }

  const { session_id, message } = parsed.data;
  const stored = store.loadChat(session_id);
  const history: Content[] = stored.map(turnToContent);

  const result = await runAgentTurn(message, history);

  // Persist user + model turns (history was mutated in-place by the agent loop).
  const now = new Date().toISOString();
  stored.push({ role: "user", text: message, ts: now });
  stored.push({
    role: "model",
    text: result.text,
    tool_calls: result.tool_calls.length > 0 ? result.tool_calls : undefined,
    ts: new Date().toISOString(),
  });
  store.saveChat(session_id, stored);

  return c.json({
    session_id,
    text: result.text,
    tool_calls: result.tool_calls,
  });
});

chatRoute.get("/sessions", (c) => {
  return c.json({ sessions: store.listChatSessions() });
});

chatRoute.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const turns = store.loadChat(id);
  return c.json({ session_id: id, turns });
});
