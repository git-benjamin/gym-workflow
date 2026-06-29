# gym-workflow

Hevy workout analytics pipeline: Hevy API → Parquet on Supabase S3 → Gemini analysis → Supabase `analyses` table → email via Resend.

## Repo layout

```
health/training/scripts/
  fetch.py          — Hevy API → JSON files
  sync.py           — JSON → Parquet on Supabase S3 (DuckDB)
  analyse.py        — Parquet context → Gemini → analyses table + email
  garmin_ingest.py  — Garmin Connect → daily_health (manual or scheduled CI)
  mfp_ingest.py     — MyFitnessPal → nutrition_logs / weight_logs / meal_entries
                      (local Chrome cookies OR MFP_COOKIES_JSON secret in CI)
  lib/storage.py    — DuckDB S3 connection factory
.github/workflows/
  hevy-sync.yml       — triggered by Cloudflare Worker on new Hevy workout
  hevy-analysis.yml   — triggered after sync; runs analyse.py
                        (workflow_dispatch supports workout_id + force inputs)
  hevy-backfill.yml   — manual backfill
  garmin-ingest.yml   — daily 22:00 UTC; uses GARMIN_OAUTH1/2_TOKEN secrets
  mfp-ingest.yml      — daily 22:00 UTC; uses MFP_COOKIES_JSON secret
```

## analyse.py context strategy

Each analysis call includes:
- **Today's workout** — all sets, all columns
- **Full same-type history** — all Push / Pull / Legs sessions ever, most recent first (`workouts_*.parquet` glob across all years)
- **Last 10 sessions** — any type, for recency context

Excluded (not auto-ingested via pipeline): `daily_health`, `nutrition_logs`, `weight_logs`, `medication_logs`.

Token budget: ~30-50K tokens per call. Free tier limit is 250K TPM / 20 RPD. No truncation needed at current data volume. Revisit if same-type history exceeds ~1500 sets.

## Email notifications

Analysis is emailed via Resend after each successful generation.
- Requires `RESEND_API_KEY` in GitHub Actions secrets
- `from` address must be a verified domain in Resend dashboard
- `NOTIFY_EMAIL` hardcoded in workflow as `benjamin_dang@outlook.com`

## GitHub secrets required

```
# Hevy pipeline
SUPABASE_URL, SUPABASE_KEY, SUPABASE_BUCKET
SUPABASE_S3_ENDPOINT, SUPABASE_S3_KEY, SUPABASE_S3_SECRET, SUPABASE_S3_REGION
GEMINI_API_KEY
RESEND_API_KEY

# Garmin ingest (refresh token valid 30 days; auto-refresh at runtime)
GARMIN_OAUTH1_TOKEN  — JSON contents of ~/.garth/oauth1_token.json
GARMIN_OAUTH2_TOKEN  — JSON contents of ~/.garth/oauth2_token.json

# MFP ingest (MFP session cookies; expire ~30 days, manual refresh required)
MFP_COOKIES_JSON  — JSON cookie list from `mfp_ingest.py --export-cookies`
```

### Refreshing MFP cookies (when ingest fails with auth error)

```bash
source /Users/benjamindang/Documents/Repositories/git-benjamin/gym-workflow/.envrc
source health/training/scripts/.venv/bin/activate
cd health/training/scripts
# Make sure Chrome Profile 1 has an active MFP session
python mfp_ingest.py --export-cookies | gh secret set MFP_COOKIES_JSON
```

## Manual scripts (run locally)

```bash
# Ingest Garmin step/HR data (requires ~/.garth session)
python health/training/scripts/garmin_ingest.py --start-date 2022-08-28

# Ingest MFP nutrition + weight (requires Chrome Profile 1 cookies)
python health/training/scripts/mfp_ingest.py --start-date 2021-07-01

# Ingest CPAP, substances, cycling from os repo
python health/training/scripts/misc_health_ingest.py --os-repo ~/Documents/Repositories/git-benjamin/os
```

Env vars live in `../.envrc` (four directories up from scripts/).

Scripts require the project venv:
```bash
source /Users/benjamindang/Documents/Repositories/git-benjamin/gym-workflow/.envrc
source health/training/scripts/.venv/bin/activate
```

## Skills for this repo

| Skill | When to use |
|-------|-------------|
| `openclaw-skills-hevy` | Analysing workout data — push/pull/legs sessions, exercise progression, all-time peaks |
| `ben-health-data` | Querying Supabase for nutrition, weight, Garmin TDEE; running MFP/Garmin ingest scripts |
| `ben-training-context` | Ben's physical profile, training goals, limitations, current training state and philosophy |
| `ben-health-data` | Also covers `medication_logs` table — retatrutide dose history, taper schedule |
