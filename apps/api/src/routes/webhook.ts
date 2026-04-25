/** POST /webhook/hevy — Hevy posts here on workout-saved.
 *  Auth: scan all incoming headers for the configured token (header name is unknown to us).
 *  Must respond 200 within 5s; review runs in the background. */
import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod";

import * as review from "../review.js";

const PayloadSchema = z.object({
  workoutId: z.string().min(1),
});

function constantTimeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function verifyToken(headers: Headers): { ok: boolean; matched: string[] } {
  const expected = process.env.HEVY_WEBHOOK_TOKEN;
  if (!expected) return { ok: true, matched: [] }; // dev mode
  const matched: string[] = [];
  headers.forEach((value, name) => {
    if (constantTimeEq(value, expected)) matched.push(name);
  });
  return { ok: matched.length > 0, matched };
}

async function runReviewSafely(workoutId: string): Promise<void> {
  try {
    await review.reviewWorkout(workoutId);
    console.log(`[webhook] review completed for workout_id=${workoutId}`);
  } catch (err) {
    console.error(
      `[webhook] review FAILED for workout_id=${workoutId}: ${(err as Error).constructor.name}: ${(err as Error).message}`,
    );
  }
}

export const webhookRoute = new Hono();

webhookRoute.post("/hevy", async (c) => {
  const headerNames: string[] = [];
  c.req.raw.headers.forEach((_, name) => headerNames.push(name));
  console.log(`[webhook] inbound headers: ${JSON.stringify(headerNames)}`);

  const { ok, matched } = verifyToken(c.req.raw.headers);
  if (matched.length > 0) {
    console.log(`[webhook] token matched header(s): ${JSON.stringify(matched)}`);
  }
  if (!ok) {
    console.log("[webhook] auth FAILED — rejecting");
    return c.json({ error: "invalid auth token" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json({ error: `invalid JSON body: ${(err as Error).message}` }, 400);
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "missing workoutId in body" }, 400);
  }

  console.log(`[webhook] queued review for workout_id=${parsed.data.workoutId}`);
  // Fire-and-forget — Hono returns immediately, the review runs in the background.
  void runReviewSafely(parsed.data.workoutId);

  return c.json({ ok: true });
});
