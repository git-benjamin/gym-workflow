/** Hono server entry point.
 *
 *  Routes:
 *    GET  /health             → liveness check
 *    POST /webhook/hevy       → Hevy webhook (auth via random token in any header)
 *    POST /api/chat           → JSON chat (bearer-auth via API_TOKEN)
 *    GET  /api/chat/sessions  → list saved chat sessions
 *    GET  /api/chat/sessions/:id → load one session's turns
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { loadEnvrc } from "./env.js";
import { logger } from "./log.js";
import { applyRoute } from "./routes/apply.js";
import { chatRoute } from "./routes/chat.js";
import { webhookRoute } from "./routes/webhook.js";

loadEnvrc();

const app = new Hono();

// Structured request logging — every request emits a single log line on completion.
app.use("/*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration_ms = Date.now() - start;
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms,
    },
    `${c.req.method} ${c.req.path} → ${c.res.status} (${duration_ms}ms)`,
  );
});

// Expo web (default port 8081) + dev LAN access. Tighten for prod.
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin ?? "*",
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/webhook", webhookRoute);

// Bearer auth for /api/* — single-user, single shared token in API_TOKEN.
app.use("/api/*", async (c, next) => {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    // Dev mode — no token configured.
    return next();
  }
  const auth = c.req.header("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : auth;
  if (presented !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

app.route("/api/chat", chatRoute);
app.route("/api/apply", applyRoute);

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, ({ port: p }) => {
  logger.info({ port: p }, `listening on http://localhost:${p}`);
});
