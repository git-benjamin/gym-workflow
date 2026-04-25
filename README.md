# gym-workflow

Personal workflow that fires when a [Hevy](https://www.hevyapp.com/) workout
completes, reviews the session against the planned routine using Gemini, and
surfaces ad-hoc questions over the user's training history through a chat
agent. The optimiser may suggest edits to routine notes, planned weights, and
rep ranges — but never adds, removes, or reorders exercises in routines.

## The loop

1. Author a routine in Hevy with cues in the per-exercise notes.
2. Start the routine, train, add per-exercise notes during the session.
3. Save the workout — fires the Hevy webhook.
4. The API fetches the workout + routine + recent exercise history, hands them
   to Gemini with a structured-output schema, persists the review.
5. Open the Expo app and ask follow-ups; the chat agent has tools to drill
   into any of your training data.

## Architecture

```
                          ┌────────────────────┐
   Hevy ──webhook──▶      │    apps/api        │
                          │  Hono + Gemini     │
   apps/ui (Expo) ──────▶ │  POST /webhook/hevy│
   chat over /api/chat    │  POST /api/chat    │
                          └─────────┬──────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  reviews/*.json    │
                          │  chats/*.json      │
                          └────────────────────┘
```

| Path | What |
| --- | --- |
| [apps/api/src/hevy.ts](apps/api/src/hevy.ts) | Hevy client: typed errors, retry on 429/5xx, Zod-validated responses |
| [apps/api/src/review.ts](apps/api/src/review.ts) | Gemini-backed reviewer with structured output + longitudinal exercise history |
| [apps/api/src/chat-agent.ts](apps/api/src/chat-agent.ts) | Function-calling agent for the chat surface |
| [apps/api/src/store.ts](apps/api/src/store.ts) | Local JSON store: `reviews/{workoutId}.json`, `chats/{sessionId}.json` |
| [apps/api/src/server.ts](apps/api/src/server.ts) | Hono server, bearer auth on `/api/*` |
| [apps/ui](apps/ui) | Expo app (iOS / Android / web) |
| [packages/shared](packages/shared) | Zod schemas shared between api and ui |

## Setup

```bash
pnpm install

# Add to .envrc
HEVY_API_KEY=...                  # https://hevy.com/settings?developer (Hevy Pro)
GEMINI_API_KEY=...                # AI Studio key
HEVY_WEBHOOK_TOKEN=...            # set after registering the webhook in Hevy
API_TOKEN=...                     # any random string; bearer for /api/*

pnpm api:smoke   # verify Hevy client against your account
pnpm api:dev     # start the server on http://localhost:3000
pnpm ui:dev      # start the Expo dev server
```

## Hevy API integration

Auth: API key is sent as the `api-key` header on every request. Hevy Pro
required.

### Schema notes

Response wrapping is inconsistent across endpoints — [packages/shared](packages/shared/src/hevy.ts)
encodes each shape as a Zod schema and the client unwraps where useful:

| Endpoint | Shape |
| --- | --- |
| `GET /v1/user/info` | `{ data: {...} }` |
| `GET /v1/workouts` | `{ page, page_count, workouts: [...] }` |
| `GET /v1/workouts/{id}` | flat workout object |
| `GET /v1/routines/{id}` | `{ routine: {...} }` (unwrapped by the client) |

`workout.routine_id` is a top-level field, so webhook → workout → routine is
one extra GET. Per-exercise notes live at `exercises[].notes` on both
workouts and routines — that's the field the optimiser reads and writes.

Routine sets carry `rep_range: { start, end }` (target); workout sets carry
`reps` (actual). Match exercises across the two by `exercise_template_id`,
not by `index` — workout order may differ from routine order.

### Error handling & retry

[apps/api/src/hevy.ts](apps/api/src/hevy.ts) maps HTTP status to typed
exception classes:

- `AuthenticationError` (401/403), `ValidationError` (400),
  `NotFoundError` (404), `RateLimitError` (429), `ServerError` (5xx),
  `NetworkError` (transport/timeout) — all subclass `HevyAPIError`.
- 429 → honours the server's `Retry-After` header (defaults to 5s if
  missing), retries up to 4 attempts.
- 5xx and transport errors → exponential backoff with jitter (~1s, ~2s, ~4s).
- 4xx other than 429 → fail fast, no retry.

Patterns adopted from the unofficial TS client
[mustafamohsen/HevyAPI](https://github.com/mustafamohsen/HevyAPI): the
status-code → exception mapping and the `Retry-After` parsing approach. We
add automatic retry on 429 (their client throws and lets the caller decide).

## Webhook trigger

Hevy POSTs to a subscribed URL when a workout is saved. Payload:

```json
{ "workoutId": "..." }
```

Must respond `200 OK` within 5 seconds.
[apps/api/src/routes/webhook.ts](apps/api/src/routes/webhook.ts) acks
immediately and runs the review in the background — Gemini takes 5-15s.
Idempotency is free: the reviewer short-circuits on cached reviews, so Hevy
retries don't double-bill Gemini.

**Subscription is manual.** Register the callback URL and an auth token
through Hevy's developer settings (no API for this). Hevy generates a random
token and includes it in a header on each webhook POST. The handler scans all
incoming headers for the configured token using `crypto.timingSafeEqual`
(constant-time, header name doesn't matter).

Setup:

1. Run `pnpm api:dev` and expose via Cloudflare Tunnel:
   `cloudflared tunnel --url http://localhost:3000`
2. Register `https://<tunnel-host>/webhook/hevy` in Hevy's developer settings.
3. Add `HEVY_WEBHOOK_TOKEN=<the-token-Hevy-gave-you>` to `.envrc`.
4. Save a workout in Hevy. Watch the api logs:
   - `[webhook] inbound headers: [...]` — confirms reach
   - `[webhook] token matched header(s): [...]` — confirms verify
   - `[webhook] review completed for workout_id=...` — review persisted

In dev (no `HEVY_WEBHOOK_TOKEN` set), the handler accepts all callers — fine
for local testing, **must be set before exposing the tunnel publicly**.

## Optimiser scope

The optimiser may edit:

- Per-exercise `notes` on the routine (cues, setup, target intent).
- Planned `weight_kg` on routine sets.
- Planned `rep_range` on routine sets.

The optimiser must **not**:

- Remove exercises from the routine — even if skipped in the workout. Skips
  are session-level decisions; A/B alternatives and "Optional" exercises live
  in notes-prose and are intentional.
- Add new exercises to the routine — unplanned exercises stay session-only.
- Reorder exercises in the routine.

The structural shape of the routine (which exercises, how many, in what
order) is the user's call. The optimiser tunes the dials inside that shape.

## Open questions

- Notification of review completion: review writes to disk silently; chat or
  filesystem tells you it happened. v2 candidates for "ping me when ready":
  in-app notifications via the Expo app foreground state, ntfy.sh, push
  notifications (paid Apple Dev only).
- Hosting: laptop + Cloudflare Tunnel works but laptop must be awake.
  Migration target: Cloud Run + Firestore (storage) for always-on.
- Closing the loop: applying `suggested_*` fields back to the routine via
  `PUT /v1/routines/{id}` with human-in-loop confirmation in the chat.
