# Repo restructure: health warehouse as primary, Hevy app demoted

**Date:** 2026-05-27
**Status:** Approved for implementation planning
**Type:** Folder restructure + path updates (no feature changes)

---

## Context

This repo started in April 2026 as `gym-workflow` — a Hevy webhook + chat
agent for post-workout review and routine optimisation. Over the past
weeks it has accumulated a substantial personal health-data warehouse:
weight, nutrition, CPAP, Garmin, medications, vitamins, cycling, plus a
set of analysis scripts and GP-facing reports.

The Hevy app is in maintenance mode; the health warehouse is the actively
growing part of the repo. The directory structure still reflects the
original priority, leaving 25+ top-level entries with inconsistent naming
(`weight_data` vs `vitamins` vs `garmin_export`) and unclear ownership.

## Goals

1. Make the directory structure reflect that **health tracking is now the
   primary use of the repo**.
2. Group all personal health data under one clear umbrella (`health/`).
3. Demote the Hevy app to a single self-contained folder (`app/`).
4. Standardise folder naming (drop `_data` suffix; keep names short).
5. Preserve the co-located `<domain>/<data + scripts + reports>` pattern
   that emerged organically in `garmin/` and `sleep/` — it works.
6. Keep the Hevy app functional after the move (all scripts run, all
   tests pass).
7. One atomic commit so `main` is never in a broken state.

## Non-goals

- No code refactoring beyond path updates required by the move.
- No rename of the repo itself (`gym-workflow` → `health-workflow`) —
  separate decision, separate commit.
- No changes to feature behaviour or scripts' output.
- No consolidation of `meds/` and `vitamins/` (kept distinct: prescribed
  vs OTC).
- No move of `profile.md` (stays at root as project-wide context).

## Target structure

```
gym-workflow/
  README.md                         (rewritten: leads with health, has app section)
  profile.md                        (unchanged)
  .envrc, .gitignore                (unchanged)
  package.json                      (unchanged at root — workspace toolchain)
  pnpm-workspace.yaml               (paths updated)
  pnpm-lock.yaml, tsconfig.base.json  (unchanged at root)

  app/                              Hevy app, self-contained
    api/                            ← was apps/api/
    ui/                             ← was apps/ui/
    shared/                         ← was packages/shared/
    examples/                       ← was top-level examples/
    hevy-openapi.yaml               ← was at root

  chats/, reviews/                  (gitignored, written by app at runtime; stay at root)

  health/                           Personal health warehouse
    training/                       Hevy training data
      workouts-2026.json            ← was data/workouts-2026.json
      workouts/                     ← was data/workouts/
      routines/                     ← was data/routines/
      trend-reports/
        2026-05-19.md               ← was data/trend-report-2026-05-19.md
    body/                           ← was weight_data/
    sleep/                          (unchanged at root → moved to health/)
    garmin/                         (unchanged at root → moved to health/)
    nutrition/                      ← was nutrition_data/
    meds/                           ← was medication_data/
    vitamins/                       (unchanged at root → moved to health/)
    cardio/                         ← was cycling_data/
    reports/                        (unchanged at root → moved to health/)

  tools/
    data_migration/                 ← was top-level

  garmin_export/                    (unchanged, gitignored)
```

## Specific file moves

### Folder renames / relocations

| From | To |
|---|---|
| `apps/api/` | `app/api/` |
| `apps/ui/` | `app/ui/` |
| `packages/shared/` | `app/shared/` |
| `examples/` | `app/examples/` |
| `hevy-openapi.yaml` | `app/hevy-openapi.yaml` |
| `data/workouts-2026.json` | `health/training/workouts-2026.json` |
| `data/workouts/` | `health/training/workouts/` |
| `data/routines/` | `health/training/routines/` |
| `data/trend-report-2026-05-19.md` | `health/training/trend-reports/2026-05-19.md` |
| `weight_data/` | `health/body/` |
| `nutrition_data/` | `health/nutrition/` |
| `medication_data/` | `health/meds/` |
| `vitamins/` | `health/vitamins/` |
| `cycling_data/` | `health/cardio/` |
| `sleep/` | `health/sleep/` |
| `garmin/` | `health/garmin/` |
| `reports/` | `health/reports/` |
| `data_migration/` | `tools/data_migration/` |

After the moves, `apps/`, `packages/`, and `data/` are removed (empty).

### Files staying in place

- `profile.md`, `README.md`, `.envrc`, `.gitignore`
- `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`
- `pnpm-workspace.yaml` (content updated, file stays)
- `chats/`, `reviews/` (gitignored runtime state)
- `garmin_export/` (gitignored raw export)

## Code changes required

### `pnpm-workspace.yaml`

```yaml
packages:
  - "app/api"
  - "app/ui"
  - "app/shared"
```

### Path constants in `app/api/src/`

The Hevy app uses `repoRoot()` from `env.ts` plus relative `resolve()`
calls. The function `repoRoot()` walks up the filesystem to find the
workspace marker and continues to work after the move — no change.

The relative paths inside `resolve()` calls need updating:

| File | Current path | New path |
|---|---|---|
| `app/api/src/scripts/fetch-year.ts` | `data/workouts/{year}/`, `data/routines/` | `health/training/workouts/{year}/`, `health/training/routines/` |
| `app/api/src/scripts/combine-year.ts` | `data/workouts/{year}/`, `data/workouts-{year}.json` | `health/training/workouts/{year}/`, `health/training/workouts-{year}.json` |
| `app/api/src/scripts/build-trend-report.ts` | reads: `data/workouts/{year}/`, `weight_data/Measurement-Summary-*.csv`, `weight_data/body_composition.csv`, `nutrition_data/nutrition.csv`, `nutrition_data/baseline_protocol.md`, `data_migration/final/summary_by_month.csv`, `data_migration/final/exercises_by_month.csv`, `medication_data/retatrutide.md`, `cycling_data/cycling_data.md`. Writes: `data/trend-report-{date}.md` | reads: `health/training/workouts/{year}/`, `health/body/Measurement-Summary-*.csv`, `health/body/body_composition.csv`, `health/nutrition/nutrition.csv`, `health/nutrition/baseline_protocol.md`, `tools/data_migration/final/summary_by_month.csv`, `tools/data_migration/final/exercises_by_month.csv`, `health/meds/retatrutide.md`, `health/cardio/cycling_data.md`. Writes: `health/training/trend-reports/{date}.md` |
| `app/api/src/scripts/aggregate-by-month.ts` | reads from `data/`, writes to `data_migration/final/` | reads from `health/training/`, writes to `tools/data_migration/final/` |
| `app/api/src/scripts/aggregate-exercises-by-month.ts` | `data_migration/final/` | `tools/data_migration/final/` |
| `app/api/src/scripts/summary-by-month.ts` | `data_migration/final/` | `tools/data_migration/final/` |
| `app/api/src/scripts/build-charts.ts` | `weight_data/charts.html` and weight CSV | `health/body/charts.html` and `health/body/...` |
| `app/api/src/scripts/post-workout.ts` | `examples/` | `app/examples/` |
| `app/api/src/scripts/dump-latest.ts` | `examples/` | `app/examples/` |
| `app/api/src/scripts/apply-proposed.ts` | `examples/proposed-routine-update.json` | `app/examples/proposed-routine-update.json` |
| `app/api/src/routes/apply.ts` | `examples/proposed-routine-update.json` | `app/examples/proposed-routine-update.json` |
| `app/api/src/chat-agent.ts` | `examples/`, `profile.md` | `app/examples/`, `profile.md` (root profile unchanged) |
| `app/api/src/review.ts` | `profile.md` | `profile.md` (unchanged) |
| `app/api/src/store.ts` | `reviews/`, `chats/` | `reviews/`, `chats/` (unchanged — gitignored runtime state stays at root) |

### Local Python scripts in `health/sleep/` and `health/garmin/`

These scripts use `Path(__file__).resolve().parent.parent` to find the
repo root. After the move, each script gets nested one level deeper
(e.g. `garmin/ingest.py` → `health/garmin/ingest.py`). The `parent.parent`
chain needs one more `.parent`:

| Script | Current | New |
|---|---|---|
| `health/garmin/ingest.py` | `parent.parent` | `parent.parent.parent` |
| `health/garmin/analyse_hr.py` | same fix | same fix |
| `health/garmin/analyse_sleep.py` | same fix | same fix |
| `health/sleep/oscar_analyse.py` | same fix | same fix |
| `health/sleep/oscar_details_analyse.py` | same fix | same fix |

Also: `health/garmin/ingest.py` reads `data/workouts-2026.json` for the
workout-HR alignment step. That reference becomes `health/training/workouts-2026.json`.

### `tools/data_migration/migrate.py`

The script uses `Path(__file__).resolve().parent` to find its own
directory and reads from `source/` / writes to `working/` + `final/`
within that. The move into `tools/` is transparent because all paths are
relative to `__file__`. **No change.**

### `README.md` — full rewrite

The current README only describes the Hevy app. The new README should:

1. **Lead with the project's current purpose:** a personal health
   data warehouse + analysis layer, with a Hevy webhook subsystem
   feeding training data into it.
2. **Top-level layout overview** with the new structure.
3. **`health/` section** describing each domain folder, what's in it,
   and which script generates the analyses.
4. **`app/` section** preserving the Hevy webhook + chat agent docs
   from the current README (with paths updated).
5. **`tools/` section** noting the one-shot Strong/Repcount migration.
6. **Setup section** with the `pnpm install` + `.envrc` essentials.

Old README content covering the Hevy app post-workout flow, optimiser
scope, webhook setup, Gemini quota etc. is preserved verbatim but moved
under the `## App (Hevy webhook + chat agent)` section.

### Other documentation

- `README.md` links to `examples/*.json` and `apps/api/src/*` files —
  update to `app/examples/*.json` and `app/api/src/*`.
- Any markdown in `reports/` that references old paths — update.

## Implementation order

One commit on a `restructure/health-warehouse` branch:

1. Create new directory skeleton (`app/`, `health/`, `tools/`).
2. `git mv` all folders/files per the table above. Renames preserve git
   history.
3. Update `pnpm-workspace.yaml`.
4. Update all path constants in `app/api/src/` (see code-changes table).
5. Update `parent.parent.parent` chains in Python scripts.
6. Update workout-data path in `health/garmin/ingest.py`.
7. Rewrite `README.md`.
8. Validate (see Success criteria below).
9. Single commit, push to branch, open PR (or merge straight to main —
   user's call).

## Success criteria

The move is complete when all of these pass:

1. `pnpm install` runs clean (workspace resolves).
2. `pnpm typecheck` passes for `app/api`, `app/ui`, `app/shared`.
3. `pnpm api:smoke` succeeds against Hevy API.
4. `pnpm api:dump-latest` writes to `health/training/workouts/` and
   `app/examples/` correctly.
5. `pnpm api:fetch-year` succeeds and writes to `health/training/`.
6. `pnpm api:combine-year` rebuilds `health/training/workouts-2026.json`.
7. `pnpm api:trend-report` runs end-to-end.
8. `python3 health/garmin/ingest.py` runs clean against the gitignored
   `garmin_export/` and rewrites the CSVs in place.
9. `python3 health/garmin/analyse_hr.py` and `analyse_sleep.py` run
   clean.
10. `python3 health/sleep/oscar_analyse.py` and
    `oscar_details_analyse.py` run clean.
11. `git log --follow` against any moved file shows full history (i.e.
    renames were tracked correctly).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A path is missed and a script breaks silently | Run every `pnpm` script and every Python script after the move (success criteria 3–10). |
| `pnpm-workspace.yaml` update misnames a package and pnpm fails to resolve | Run `pnpm install` after editing the YAML; check the output. |
| Git rename detection fails for any file (`git log --follow` doesn't trace history) | Use `git mv` (not delete + add). Test with `git log --follow app/api/src/server.ts`. |
| Partial work leaves `main` broken | Do all work on a `restructure/health-warehouse` branch; squash-or-merge as a single atomic commit. |
| Pre-commit hooks or CI fails due to changed paths | None configured in this repo, but if any are added: review and update. |

## Out of scope (for follow-up commits)

- Rename the repo from `gym-workflow` to e.g. `health-workflow`. Separate
  decision; affects remote, clones, badges, etc.
- Move `chats/` and `reviews/` under `app/`. They're gitignored runtime
  state; the visual cost of keeping them at root is zero.
- Reorganise within `app/examples/` (currently flat; fine as-is).
- Standardise script naming conventions across `analyse_hr.py`,
  `analyse_sleep.py`, `oscar_analyse.py`, `oscar_details_analyse.py`,
  `ingest.py`, `migrate.py`.
