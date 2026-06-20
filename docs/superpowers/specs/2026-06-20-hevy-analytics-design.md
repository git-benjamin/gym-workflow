# Hevy Analytics — Design Spec
_2026-06-20_

## Goal

Automated post-workout analysis pipeline: Hevy API → structured storage → LLM analysis → stored output. Triggered daily via GitHub Actions. No weekly cron for now.

---

## Stack

| Layer | Tool | Notes |
|---|---|---|
| Source | Hevy API | Existing API key in `.envrc` |
| Ingest | Python scripts | Replaces existing `fetch-year.ts` |
| Storage (workout data) | Parquet on Supabase Storage (S3-compatible) | Open table format — portable, not locked to Postgres |
| Query engine | DuckDB | Reads Parquet from Supabase Storage via S3 interface |
| Storage (analyses) | Supabase PostgreSQL | `analyses` table — small, frequently queried metadata |
| Analysis | Claude API (Haiku) | ~$0.002/analysis |
| Delivery | TBD | |
| Webhook receiver | Cloudflare Worker (free) | Receives Hevy webhook, forwards to GH `repository_dispatch` |
| Orchestration | GitHub Actions | Webhook-triggered (primary) + daily cron fallback |

---

## Data Model

### Workout data — Parquet on Supabase Storage

One consolidated file per year: `data/workouts_{year}.parquet`. Rewritten idempotently on each sync. Consolidation is intentional — per-workout Parquet files have ~3KB metadata overhead that dominates at low row counts (30 rows/workout), making them less efficient than JSON. A single annual file gives columnar compression meaningful rows to work with (~4,000 rows/year).

Schema (denormalized, one row per set):

```
workout_id            STRING
workout_title         STRING
start_time            TIMESTAMP
end_time              TIMESTAMP
routine_id            STRING
exercise_index        INT
exercise_title        STRING
exercise_notes        STRING
exercise_template_id  STRING
superset_id           STRING
set_index             INT
set_type              STRING    -- warmup | normal
weight_kg             DOUBLE
reps                  INT
rpe                   DOUBLE
duration_seconds      DOUBLE
distance_meters       DOUBLE
```

Example DuckDB query:
```sql
SELECT * FROM read_parquet('s3://bucket/data/workouts_2026.parquet')
WHERE workout_title ILIKE '%Push%'
ORDER BY start_time DESC
LIMIT 3
```

### Routine data — Parquet on Supabase Storage

One consolidated file: `data/routines.parquet`. All routine versions, all IDs. Append-only semantics: each detected change adds new rows (differentiated by `synced_at`), existing rows never modified. File is rewritten on each sync with the full history intact.

Schema (denormalized, one row per routine set):

```
hevy_id               STRING
title                 STRING
updated_at            TIMESTAMP    -- from Hevy, used to detect change
synced_at             TIMESTAMP    -- when this file was written
exercise_index        INT
exercise_title        STRING
exercise_notes        STRING
exercise_template_id  STRING
set_index             INT
set_type              STRING
weight_kg             DOUBLE
reps                  INT
rpe                   DOUBLE
rest_seconds          INT
set_notes             STRING
```

To resolve the active routine for a given workout:
```sql
SELECT * FROM read_parquet('s3://bucket/routines/{hevy_id}/*.parquet')
WHERE updated_at <= {workout.start_time}
ORDER BY updated_at DESC
LIMIT 1
```

### `analyses` — Supabase PostgreSQL

```sql
id             SERIAL PRIMARY KEY
type           TEXT              -- post_workout
workout_id     TEXT              -- Hevy workout ID
generated_at   TIMESTAMPTZ
content        TEXT              -- LLM output
model          TEXT
tokens_used    INTEGER
```

---

## Scripts (`health/training/scripts/`)

### `fetch.py`
Replaces `fetch-year.ts`. Pulls new workouts and routines from Hevy API to JSON files in `workouts/{year}/` and `routines/`. Idempotent — skips existing files.

### `sync.py`
Reads JSON files. For each new workout JSON, writes a Parquet file to Supabase Storage. For each routine JSON, checks if `updated_at` has changed vs the latest version in Storage — if so, writes a new Parquet file. Idempotent.

### `analyse.py`
For each workout not yet in the `analyses` table:
1. Use DuckDB to query today's workout from Supabase Storage Parquet
2. Use DuckDB to query last 3 sessions of same type\*
3. Use DuckDB to resolve the active routine version for this workout
4. Build prompt (system + six-module analysis prompt)
5. Call Claude API (Haiku)
6. Insert result into `analyses` table (Supabase PostgreSQL)

\* Workout type classified primarily by `routine_id` matching known routine IDs. Title-based `ILIKE '%Push%' / '%Pull%' / '%Leg%'` used as fallback for ad-hoc sessions without a `routine_id`. This classification is heuristic and may require manual correction for non-standard session titles.

---

## Trigger Architecture

### Hevy Webhook → Cloudflare Worker → GitHub Actions

```
Hevy saves workout
  → POST {workoutId} to Cloudflare Worker (with auth header)
  → Worker validates auth header
  → Worker calls GitHub repository_dispatch with workoutId as payload
  → GitHub Actions triggered: fetch.py --workout-id {id} → sync.py → analyse.py
```

Cloudflare Worker is stateless — receives, validates, forwards. Free tier: 100k req/day.

Daily cron at 6pm AWST (`0 10 * * *`) remains as fallback. On cron runs, `fetch.py` runs without `--workout-id` and fetches all new workouts (existing behaviour).

### GitHub Actions minutes (free tier: 2,000/month)

| Source | Runs/month | Min/run | Total |
|---|---|---|---|
| Webhook (new workout) | ~11 | ~5 | ~55 min |
| Daily cron (fallback, mostly no-op) | 30 | ~2 | ~60 min |
| **Total** | | | **~115 min** |

Well within 2,000 min/month limit at current training volume.

### `fetch.py` — workout-id optimisation

Accepts optional `--workout-id` argument:
- If provided (webhook run): `GET /v1/workouts/{workoutId}` — fetch only that workout
- If absent (cron run): paginate all workouts, skip existing files (current behaviour)

### GitHub Actions workflow

```yaml
# .github/workflows/hevy-sync.yml
on:
  repository_dispatch:
    types: [hevy_workout_created]
  schedule:
    - cron: '0 10 * * *'   # 6pm AWST = 10:00 UTC, daily fallback
  workflow_dispatch:

jobs:
  sync:
    steps:
      - fetch.py --workout-id ${{ github.event.client_payload.workoutId || '' }}
      - sync.py
      - analyse.py
```

### Secrets

GitHub Actions: `HEVY_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_KEY`, `SUPABASE_S3_SECRET`, `ANTHROPIC_API_KEY`, `GH_PAT` (Cloudflare Worker uses this to call `repository_dispatch`)

Cloudflare Worker env vars: `HEVY_WEBHOOK_AUTH`, `GH_PAT`, `GH_REPO`

---

## LLM Prompt Framework

### System prompt (static, every call)

```
Profile: 188cm, 135kg. Knee hyperextension history — avoid flagging standing
hip hinge under heavy load as a regression. Glutes underdeveloped from years
of knee compensation. Chest overdeveloped relative to shoulders and triceps.

Current strategies:
- Push (Tricep Bypass): pec dec first to pre-exhaust chest, compound press
  then targets triceps and anterior delts.
- Pull (Bicep Bypass): versa grips on all compound pulls to remove bicep
  bottleneck, isolate biceps fresh at end of session.
- Legs: seated leg curl first to pre-exhaust hamstrings, hip thrust then
  targets glutes as primary mover.

Goals: glute hypertrophy, lateral delt width, tricep and lat development,
trap/rhomboid activation, close left-right glute asymmetry.

Training style: RPE 10 to failure. 3-4s eccentrics and iso holds. Qualitative
notes logged per set — treat these as primary signal over raw numbers.
```

### Post-workout analysis prompt (six modules)

```
Today's workout: {workout_data}
Last 3 sessions of same type: {prior_sessions_data}
Active routine: {routine_data}

Analyse across these six modules:

1. PROGRESSION
   Per exercise: weight/reps/RPE vs last session.
   Label each: increased / held / regressed.

2. PLANNED VS ACTUAL
   Compare routine set targets to logged sets.
   Flag deviations; include note reason if logged.

3. STRATEGY VALIDATION
   Did the pre-exhaust or bypass work this session?
   Evidence: which muscle gave out first, qualitative note language
   ("felt glutes", "quads taking over", "bicep bottleneck").

4. QUALITATIVE SIGNALS
   Extract from set notes:
   - Pain: location, when in set it started, any radiation pattern
   - Activation quality: "can't feel" / "felt it strongly" / left vs right
   - Technique flags: compensation patterns, joint instability

5. FLAGS (explicit, not buried in prose)
   - Plateau: same weight + reps for 3+ sessions → name the exercise
   - Pain pattern: any radiating pain → flag first, before other analysis
   - Eccentric overload: 4s eccentric on more than 2 exercises → flag

6. ONE NEXT ACTION
   Single clearest change for the next session of this type. Not a list.
```

---

## Ad-hoc Question Library

Reusable prompt templates for manual queries against the Parquet store via DuckDB:

| Type | Template |
|---|---|
| Plateau diagnosis | "Exercise {X} has logged the same weight for {N} sessions. Query the last 8 sessions and diagnose: volume, set count, eccentric load, session position, pre-fatigue from prior exercises." |
| Strategy validation | "For the last 5 {push/pull/leg} sessions, extract qualitative notes mentioning muscle activation. Determine whether the {bypass/pre-exhaust} strategy is shifting failure to the target muscle." |
| Equipment decision | "Compare {exercise A} vs {exercise B} for {goal}, given profile context. Which better fits the current routine structure?" |
| Technique coaching | "I cannot feel {muscle} in {exercise}. Based on my profile and recent notes, diagnose likely causes and give 3 cues ordered by probability of fixing it." |
| Session selection | "Today is {date}. Last {push/pull/leg} was {N} days ago. Recommend tonight's session based on recency and gaps." |
| Routine revision | "Based on the last {N} sessions of {type}, revise the routine. Preserve: {list}. Change: {list}." |

---

## Blog Dot Points (technical, narrative TBD)

- Hevy API → Python → Parquet on Supabase Storage → DuckDB → Claude API → `analyses` table
- Open table format: consolidated annual Parquet (`workouts_2026.parquet`, `routines.parquet`) on S3-compatible storage — portable, not locked to any DB engine
- Three scripts: `fetch.py`, `sync.py`, `analyse.py` — all idempotent
- Trigger: Hevy webhook → Cloudflare Worker (validates auth, forwards to GitHub `repository_dispatch`) → GitHub Actions. Daily cron as fallback. Near-instant analysis after each workout save.
- `fetch.py` accepts `--workout-id`: on webhook runs fetches only the new workout via `GET /v1/workouts/{id}`; on cron runs paginates all
- GitHub Actions free tier: ~115 min/month at current training volume, limit is 2,000
- Routine versioning: each detected change appends new rows (differentiated by `synced_at`) — append-only, full version history retained in single file
- Planned vs actual: DuckDB join between routine Parquet and workout Parquet on `exercise_template_id`, diff weight/reps
- Post-workout LLM prompt: six modules — progression, planned vs actual, strategy validation, qualitative signal extraction, flags, one next action
- Workout type classification: `routine_id` primary, title heuristic fallback
- Plateau detection: DuckDB query across workout Parquet, flag if weight + reps static for 3+ sessions on same exercise
- Pain pattern extraction: parse set-level notes for location, onset rep, radiation pattern
- Ad-hoc question library: six named prompt templates for manual analysis
- **Storage sizing:** 45 workouts = 305KB JSON. Per-workout Parquet is not more efficient at this scale — Parquet metadata overhead (~3KB/file) dominates when rows per file are low. Consolidated annual Parquet (~27KB/year vs ~900KB for per-file) wins because columnar compression only kicks in across many rows. This is the same trade-off Databricks OPTIMIZE solves at enterprise scale by compacting small files — we make the decision upfront by design.
- Stack cost: Supabase free tier (1GB Storage, ~39,000 years to fill at current training volume) + GitHub Actions free tier + Claude Haiku ~$0.002/analysis

---

## Out of Scope (for now)

- Weekly digest cron
- Frontend / dashboard
- Multi-year data (2025 and prior)
- Nutrition or sleep data integration
- Delivery layer (TBD)
