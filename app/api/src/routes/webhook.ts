/** POST /webhook/hevy — Hevy posts here on workout-saved.
 *  Auth: scan all incoming headers for the configured token (header name is unknown to us).
 *  Must respond 200 within 5s; review runs in the background. */
import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod";

import { logger } from "../log.js";
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
  const start = Date.now();
  try {
    const review_ = await review.reviewWorkout(workoutId);
    logger.info(
      { workout_id: workoutId, rating: review_.rating, duration_ms: Date.now() - start },
      "webhook review completed",
    );
  } catch (err) {
    logger.error(
      {
        workout_id: workoutId,
        error_name: (err as Error).constructor?.name,
        error_message: (err as Error).message,
        duration_ms: Date.now() - start,
      },
      "webhook review failed",
    );
  }
}

export const webhookRoute = new Hono();

webhookRoute.post("/hevy", async (c) => {
  const headerNames: string[] = [];
  c.req.raw.headers.forEach((_, name) => headerNames.push(name));
  logger.info({ headers: headerNames }, "webhook inbound");

  const { ok, matched } = verifyToken(c.req.raw.headers);
  if (matched.length > 0) {
    logger.info({ matched }, "webhook token matched");
  }
  if (!ok) {
    logger.warn("webhook auth failed — rejecting");
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

  logger.info({ workout_id: parsed.data.workoutId }, "webhook queued review");
  // Fire-and-forget — Hono returns immediately, the review runs in the background.
  void runReviewSafely(parsed.data.workoutId);

  return c.json({ ok: true });
});
