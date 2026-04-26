/** POST /api/chat and GET /api/chat/sessions — JSON chat surface for the Expo app. */
import type { Content } from "@google/genai";
import { Hono } from "hono";
import { z } from "zod";

import { runAgentTurn } from "../chat-agent.js";
import { logger } from "../log.js";
import * as store from "../store.js";

const ChatRequestSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().min(1),
});

/** Post-workout responses come back as one big string; split into two bubbles —
 *  the review (rating + summary + per-exercise feedback) and the amendments
 *  (suggested edits + apply prompt). Other responses stay as a single bubble. */
function splitIntoBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const idx = trimmed.search(/\n##\s+Suggested routine amendments/i);
  if (idx > 0) {
    return [trimmed.slice(0, idx).trim(), trimmed.slice(idx).trim()];
  }
  return [trimmed];
}

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

  const start = Date.now();
  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn(message, history);
  } catch (err) {
    const e = err as Error;
    const msg = e.message ?? String(e);
    const lower = msg.toLowerCase();
    const isQuota =
      lower.includes("resource_exhausted") ||
      lower.includes("quota") ||
      msg.includes("429");
    if (isQuota) {
      const retryMatch = msg.match(/retry in ([\d.]+)s/i);
      const retrySeconds = retryMatch?.[1] ? Number(retryMatch[1]) : null;
      logger.warn(
        { session_id, retry_seconds: retrySeconds, duration_ms: Date.now() - start },
        "gemini quota exhausted",
      );
      return c.json(
        {
          error:
            "Gemini quota exhausted. Free tier resets daily; bump to a paid tier or switch " +
            "the MODEL constant in chat-agent.ts to gemini-2.5-flash-lite for a higher daily cap.",
          retry_seconds: retrySeconds,
          upstream: msg.slice(0, 400),
        },
        429,
      );
    }
    logger.error(
      { session_id, err_name: e.constructor?.name, err_message: msg, duration_ms: Date.now() - start },
      "chat turn failed",
    );
    return c.json({ error: msg.slice(0, 600) }, 500);
  }

  logger.info(
    {
      session_id,
      input_chars: message.length,
      output_chars: result.text.length,
      tool_call_count: result.tool_calls.length,
      tool_names: result.tool_calls.map((t) => t.name),
      duration_ms: Date.now() - start,
    },
    "chat turn complete",
  );

  // Split into visual bubbles and persist them as separate model turns,
  // so re-hydrating a session shows the same shape the user originally saw.
  const bubbles = splitIntoBubbles(result.text);
  const now = new Date().toISOString();
  stored.push({ role: "user", text: message, ts: now });

  if (bubbles.length === 0) {
    stored.push({
      role: "model",
      text: result.text,
      tool_calls: result.tool_calls.length > 0 ? result.tool_calls : undefined,
      ts: new Date().toISOString(),
    });
  } else {
    bubbles.forEach((bubble, i) => {
      stored.push({
        role: "model",
        text: bubble,
        // Attach tool_calls only to the first bubble — the work that produced
        // them was the same agent step regardless of how the output is split.
        tool_calls: i === 0 && result.tool_calls.length > 0 ? result.tool_calls : undefined,
        ts: new Date().toISOString(),
      });
    });
  }
  store.saveChat(session_id, stored);

  return c.json({
    session_id,
    // Keep `text` for any consumer that still wants the joined view.
    text: result.text,
    // New shape: array of { text, tool_calls? } visual bubbles.
    messages: (bubbles.length > 0 ? bubbles : [result.text]).map((text, i) => ({
      text,
      tool_calls: i === 0 ? result.tool_calls : [],
    })),
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
