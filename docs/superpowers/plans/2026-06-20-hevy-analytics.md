# Hevy Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automated post-workout analysis pipeline — Hevy API → Parquet on Supabase Storage → DuckDB → Claude Haiku → `analyses` table in Supabase PostgreSQL, triggered by Hevy webhook via Cloudflare Worker.

**Architecture:** `fetch.py` pulls workout/routine JSON from Hevy API and writes to disk. `sync.py` reads those JSON files and writes consolidated annual Parquet to Supabase Storage (S3-compatible) via DuckDB. `analyse.py` queries the Parquet with DuckDB, builds a six-module prompt, calls Claude Haiku, and inserts the result into a Supabase PostgreSQL `analyses` table. The trigger chain is: Hevy webhook → Cloudflare Worker (auth translation) → GitHub `repository_dispatch` → GitHub Actions, with a daily cron fallback.

**Tech Stack:** Python 3.11+, DuckDB 0.10+, `supabase` Python client, `anthropic` Python SDK, `requests`, `python-dotenv`, Cloudflare Workers (JS), GitHub Actions, Terraform (infra).

## Global Constraints

- Repo: `gym-workflow` (`/Users/benjamindang/Documents/Repositories/git-benjamin/gym-workflow`)
- All scripts in `health/training/scripts/`
- All scripts idempotent — safe to re-run at any time without duplicating data
- Parquet storage: `data/workouts_{year}.parquet` and `data/routines.parquet` in Supabase Storage bucket `hevy-analytics`
- `--workout-id` arg on `fetch.py`: if provided, fetch single workout; if absent, paginate all
- Workout type classified by `routine_id` primary, title ILIKE fallback
- Python deps from `health/training/scripts/requirements.txt`
- Tests in `health/training/scripts/tests/`
- Cloudflare Worker in `cloudflare/hevy-webhook/worker.js`
- GitHub Actions workflow in `.github/workflows/hevy-sync.yml`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `infra/main.tf` | Create | Terraform providers (postgresql, cloudflare, github, null) |
| `infra/variables.tf` | Create | Input variables for all secrets |
| `infra/supabase.tf` | Create | analyses table (postgresql) + hevy-analytics bucket (null_resource/curl) |
| `infra/cloudflare.tf` | Create | Cloudflare Worker script resource |
| `infra/github.tf` | Create | GitHub Actions secrets |
| `infra/outputs.tf` | Create | Worker URL output |
| `infra/terraform.tfvars.example` | Create | Example variable values |
| `health/training/scripts/requirements.txt` | Create | Python dependencies |
| `health/training/scripts/tests/conftest.py` | Create | Shared fixtures (sample JSON, temp dirs, local DuckDB) |
| `health/training/scripts/fetch.py` | Create | Hevy API → JSON files on disk |
| `health/training/scripts/tests/test_fetch.py` | Create | Tests for fetch.py |
| `health/training/scripts/lib/__init__.py` | Create | Empty |
| `health/training/scripts/lib/storage.py` | Create | DuckDB connection factory with S3 config; shared by sync.py + analyse.py |
| `health/training/scripts/tests/test_storage.py` | Create | Tests for storage.py |
| `health/training/scripts/sync.py` | Create | JSON files → consolidated Parquet on Supabase Storage |
| `health/training/scripts/tests/test_sync.py` | Create | Tests for sync.py |
| `health/training/scripts/analyse.py` | Create | DuckDB queries → prompt → Claude Haiku → analyses table |
| `health/training/scripts/tests/test_analyse.py` | Create | Tests for analyse.py |
| `.github/workflows/hevy-sync.yml` | Create | GitHub Actions: webhook + cron triggers |
| `cloudflare/hevy-webhook/worker.js` | Create | Receive Hevy webhook, forward to GitHub repository_dispatch |

---

## Task 1: Supabase setup + Python scaffolding

**Files:**
- Create: `health/training/scripts/requirements.txt`
- Create: `health/training/scripts/tests/conftest.py`
- Create: `health/training/scripts/lib/__init__.py`

**Interfaces:**
- Produces: `requirements.txt` with pinned versions; `conftest.py` with `sample_workout_json`, `sample_routine_json`, `tmp_workout_dir`, `local_duckdb` fixtures

---

- [ ] **Step 1: Create Supabase Storage bucket**

In the Supabase dashboard → Storage → New bucket:
- Name: `hevy-analytics`
- Public: No
- File size limit: 50MB (default)

Note the bucket name — used throughout as `SUPABASE_BUCKET=hevy-analytics`.

- [ ] **Step 2: Create `analyses` table in Supabase**

In Supabase dashboard → SQL Editor, run:

```sql
CREATE TABLE IF NOT EXISTS analyses (
    id          SERIAL PRIMARY KEY,
    type        TEXT        NOT NULL,  -- 'post_workout'
    workout_id  TEXT        NOT NULL UNIQUE,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content     TEXT        NOT NULL,
    model       TEXT        NOT NULL,
    tokens_used INTEGER
);
```

- [ ] **Step 3: Get Supabase S3 credentials**

In Supabase dashboard → Storage → S3 Connection:
- Copy `Endpoint`, `Access Key ID`, `Secret Access Key`
- Region: use `ap-southeast-2` (or whatever your project region is)

Add to `.envrc`:
```bash
export SUPABASE_URL="https://{ref}.supabase.co"
export SUPABASE_KEY="your-service-role-key"
export SUPABASE_BUCKET="hevy-analytics"
export SUPABASE_S3_ENDPOINT="https://{ref}.supabase.co/storage/v1/s3"
export SUPABASE_S3_KEY="your-s3-access-key-id"
export SUPABASE_S3_SECRET="your-s3-secret"
export SUPABASE_S3_REGION="ap-southeast-2"
export ANTHROPIC_API_KEY="your-key"
export HEVY_API_KEY="existing-key"
```

- [ ] **Step 4: Create `requirements.txt`**

Create `health/training/scripts/requirements.txt`:

```
requests>=2.31.0
duckdb>=0.10.0
supabase>=2.4.0
anthropic>=0.25.0
python-dotenv>=1.0.0
pytest>=8.0.0
pytest-mock>=3.12.0
```

- [ ] **Step 5: Create `lib/__init__.py`**

Create `health/training/scripts/lib/__init__.py` (empty).

- [ ] **Step 6: Create `tests/conftest.py`**

Create `health/training/scripts/tests/conftest.py`:

```python
import json
import os
import pytest
import duckdb
from pathlib import Path


SAMPLE_WORKOUT = {
    "id": "test-workout-001",
    "title": "2026: Push [Tricep Bypass]",
    "routine_id": "routine-push-001",
    "start_time": "2026-06-13T12:06:47+00:00",
    "end_time": "2026-06-13T13:00:00+00:00",
    "updated_at": "2026-06-13T13:00:01.000Z",
    "created_at": "2026-06-13T13:00:01.000Z",
    "exercises": [
        {
            "index": 0,
            "title": "Chest Fly (Machine)",
            "notes": "3s eccentric",
            "exercise_template_id": "CF001",
            "superset_id": None,
            "sets": [
                {
                    "index": 0, "type": "normal", "weight_kg": 100.0,
                    "reps": 11, "rpe": 10.0,
                    "duration_seconds": None, "distance_meters": None,
                    "custom_metric": None
                },
                {
                    "index": 1, "type": "normal", "weight_kg": 100.0,
                    "reps": 9, "rpe": 10.0,
                    "duration_seconds": None, "distance_meters": None,
                    "custom_metric": None
                },
            ]
        },
        {
            "index": 1,
            "title": "Incline Chest Press (Machine)",
            "notes": "",
            "exercise_template_id": "ICP001",
            "superset_id": None,
            "sets": [
                {
                    "index": 0, "type": "normal", "weight_kg": 80.4,
                    "reps": 6, "rpe": 10.0,
                    "duration_seconds": None, "distance_meters": None,
                    "custom_metric": None
                },
            ]
        }
    ]
}

SAMPLE_ROUTINE = {
    "id": "routine-push-001",
    "title": "2026: Push",
    "folder_id": None,
    "updated_at": "2026-05-01T08:00:00.000Z",
    "created_at": "2022-08-08T13:00:00.000Z",
    "exercises": [
        {
            "index": 0,
            "title": "Chest Fly (Machine)",
            "notes": "Seat height 5. 3s eccentric.",
            "exercise_template_id": "CF001",
            "superset_id": None,
            "rest_seconds": 120,
            "sets": [
                {
                    "index": 0, "type": "failure", "weight_kg": 100.0,
                    "reps": None, "distance_meters": None,
                    "duration_seconds": None, "custom_metric": None,
                    "rep_range": {"start": 8, "end": 12}
                }
            ]
        }
    ]
}


@pytest.fixture
def sample_workout_json():
    return SAMPLE_WORKOUT.copy()


@pytest.fixture
def sample_routine_json():
    return SAMPLE_ROUTINE.copy()


@pytest.fixture
def tmp_workout_dir(tmp_path):
    year_dir = tmp_path / "workouts" / "2026"
    year_dir.mkdir(parents=True)
    return year_dir


@pytest.fixture
def tmp_routine_dir(tmp_path):
    routine_dir = tmp_path / "routines"
    routine_dir.mkdir(parents=True)
    return routine_dir


@pytest.fixture
def local_duckdb(tmp_path):
    """In-memory DuckDB with a local temp path for Parquet writes during tests."""
    conn = duckdb.connect()
    conn.execute("INSTALL parquet; LOAD parquet;")
    return conn, tmp_path
```

- [ ] **Step 7: Install dependencies and verify**

```bash
cd health/training/scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "import duckdb, supabase, anthropic; print('ok')"
```

Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add health/training/scripts/requirements.txt \
        health/training/scripts/lib/__init__.py \
        health/training/scripts/tests/conftest.py \
        .envrc
git commit -m "feat(hevy-analytics): scaffold Python dependencies and Supabase setup"
```

---

## Task 2: `fetch.py` — Hevy API to JSON

**Files:**
- Create: `health/training/scripts/fetch.py`
- Create: `health/training/scripts/tests/test_fetch.py`

**Interfaces:**
- Consumes: `HEVY_API_KEY` env var; existing JSON files in `workouts/{year}/` and `routines/`
- Produces: JSON files at `workouts/{year}/{safe_start_time}__{workout_id}.json` and `routines/{routine_id}.json`; accepts `--workout-id` CLI arg

---

- [ ] **Step 1: Write failing tests**

Create `health/training/scripts/tests/test_fetch.py`:

```python
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


def make_workout_response(workout_id="w001", routine_id="r001"):
    return {
        "id": workout_id,
        "title": "2026: Push [Tricep Bypass]",
        "routine_id": routine_id,
        "start_time": "2026-06-13T12:06:47+00:00",
        "end_time": "2026-06-13T13:00:00+00:00",
        "updated_at": "2026-06-13T13:00:01.000Z",
        "created_at": "2026-06-13T13:00:01.000Z",
        "exercises": []
    }


def make_page_response(workouts, page=1, page_count=1):
    return {"page": page, "page_count": page_count, "workouts": workouts}


def test_fetch_by_id_writes_single_file(tmp_workout_dir, tmp_routine_dir, sample_workout_json):
    from fetch import fetch_by_id, save_workout

    with patch("fetch.requests.get") as mock_get:
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = {"workout": sample_workout_json}
        mock_get.return_value = resp

        workout = fetch_by_id("test-workout-001", api_key="fake")

    assert workout["id"] == "test-workout-001"


def test_save_workout_writes_json(tmp_workout_dir, sample_workout_json):
    from fetch import save_workout

    path = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)

    assert path is not None
    assert path.exists()
    saved = json.loads(path.read_text())
    assert saved["id"] == sample_workout_json["id"]


def test_save_workout_skips_existing(tmp_workout_dir, sample_workout_json):
    from fetch import save_workout

    path1 = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)
    path2 = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)

    assert path1 == path2  # same path, not duplicated


def test_save_workout_filename_format(tmp_workout_dir, sample_workout_json):
    from fetch import save_workout

    path = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)

    # filename: {safe_start_time}__{workout_id}.json
    assert "test-workout-001" in path.name
    assert path.suffix == ".json"


def test_fetch_all_paginates(tmp_workout_dir, tmp_routine_dir):
    from fetch import fetch_all_workouts

    workout = make_workout_response()
    page1 = make_page_response([workout], page=1, page_count=2)
    page2 = make_page_response([], page=2, page_count=2)

    with patch("fetch.requests.get") as mock_get:
        resp1, resp2 = MagicMock(), MagicMock()
        resp1.ok, resp2.ok = True, True
        resp1.json.return_value = page1
        resp2.json.return_value = page2
        mock_get.side_effect = [resp1, resp2]

        results = fetch_all_workouts(
            api_key="fake",
            year=2026,
            workouts_dir=tmp_workout_dir
        )

    assert len(results) == 1
    assert results[0]["id"] == "w001"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd health/training/scripts
source .venv/bin/activate
pytest tests/test_fetch.py -v
```

Expected: ImportError — `fetch` module not found.

- [ ] **Step 3: Implement `fetch.py`**

Create `health/training/scripts/fetch.py`:

```python
"""
fetch.py — Pull workouts and routines from Hevy API to JSON files.

Usage:
  python fetch.py                        # paginate all workouts for current year
  python fetch.py --workout-id <id>      # fetch single workout by ID
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".envrc", override=False)

BASE_URL = "https://api.hevyapp.com"
PAGE_SIZE = 10
MAX_RETRIES = 4

SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent.parent.parent
TRAINING_DIR = REPO_ROOT / "health" / "training"


def _get(url: str, api_key: str, **params) -> dict:
    for attempt in range(MAX_RETRIES):
        r = requests.get(url, headers={"api-key": api_key, "accept": "application/json"}, params=params)
        if r.ok:
            return r.json()
        if r.status_code == 429:
            retry_after = int(r.headers.get("retry-after", 5))
            time.sleep(retry_after)
            continue
        if r.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
    raise RuntimeError(f"Hevy API exhausted retries for {url}")


def fetch_by_id(workout_id: str, api_key: str) -> dict:
    data = _get(f"{BASE_URL}/v1/workouts/{workout_id}", api_key)
    return data["workout"]


def save_workout(workout: dict, workouts_dir: Path) -> Path:
    safe_time = workout["start_time"].replace(":", "-")
    filename = f"{safe_time}__{workout['id']}.json"
    path = workouts_dir / filename
    if path.exists():
        return path
    path.write_text(json.dumps(workout, indent=2))
    return path


def save_routine(routine: dict, routines_dir: Path) -> Path | None:
    path = routines_dir / f"{routine['id']}.json"
    if path.exists():
        existing = json.loads(path.read_text())
        if existing.get("updated_at") == routine.get("updated_at"):
            return None  # unchanged
    path.write_text(json.dumps(routine, indent=2))
    return path


def fetch_routine(routine_id: str, api_key: str) -> dict | None:
    try:
        data = _get(f"{BASE_URL}/v1/routines/{routine_id}", api_key)
        return data.get("routine")
    except Exception:
        return None


def fetch_all_workouts(api_key: str, year: int, workouts_dir: Path) -> list[dict]:
    cutoff = f"{year}-01-01T00:00:00"
    page, page_count = 1, 1
    results = []

    while page <= page_count:
        data = _get(f"{BASE_URL}/v1/workouts", api_key, page=page, pageSize=PAGE_SIZE)
        page_count = data["page_count"]
        for w in data["workouts"]:
            if w["start_time"] < cutoff:
                continue
            results.append(w)
            save_workout(w, workouts_dir)
        page += 1

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workout-id", default="")
    args = parser.parse_args()

    api_key = os.environ["HEVY_API_KEY"]
    year = datetime.now(timezone.utc).year
    workouts_dir = TRAINING_DIR / "workouts" / str(year)
    routines_dir = TRAINING_DIR / "routines"
    workouts_dir.mkdir(parents=True, exist_ok=True)
    routines_dir.mkdir(parents=True, exist_ok=True)

    if args.workout_id:
        workout = fetch_by_id(args.workout_id, api_key)
        save_workout(workout, workouts_dir)
        workouts = [workout]
    else:
        workouts = fetch_all_workouts(api_key, year, workouts_dir)

    seen_routine_ids: set[str] = set()
    for w in workouts:
        rid = w.get("routine_id")
        if rid and rid not in seen_routine_ids:
            routine = fetch_routine(rid, api_key)
            if routine:
                save_routine(routine, routines_dir)
            seen_routine_ids.add(rid)

    print(f"done: {len(workouts)} workouts processed")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_fetch.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Smoke test against live API**

```bash
python fetch.py --workout-id 24756ad1-b127-46ab-996f-172edfdb43f1
```

Expected: file written to `workouts/2026/` (already exists, so "skipped"). No errors.

- [ ] **Step 6: Commit**

```bash
git add health/training/scripts/fetch.py health/training/scripts/tests/test_fetch.py
git commit -m "feat(hevy-analytics): add fetch.py — Hevy API to JSON files"
```

---

## Task 3: `lib/storage.py` — DuckDB S3 connection

**Files:**
- Create: `health/training/scripts/lib/storage.py`
- Create: `health/training/scripts/tests/test_storage.py`

**Interfaces:**
- Produces: `get_conn() -> duckdb.DuckDBPyConnection` — configured with S3 credentials from env; `s3_path(key: str) -> str` — returns `s3://{bucket}/{key}`

---

- [ ] **Step 1: Write failing test**

Create `health/training/scripts/tests/test_storage.py`:

```python
import os
import pytest
from unittest.mock import patch


def test_s3_path_format():
    with patch.dict(os.environ, {"SUPABASE_BUCKET": "hevy-analytics"}):
        from lib.storage import s3_path
        assert s3_path("data/workouts_2026.parquet") == "s3://hevy-analytics/data/workouts_2026.parquet"


def test_get_conn_returns_connection(monkeypatch):
    monkeypatch.setenv("SUPABASE_S3_ENDPOINT", "https://fake.supabase.co/storage/v1/s3")
    monkeypatch.setenv("SUPABASE_S3_KEY", "fake-key")
    monkeypatch.setenv("SUPABASE_S3_SECRET", "fake-secret")
    monkeypatch.setenv("SUPABASE_S3_REGION", "ap-southeast-2")
    monkeypatch.setenv("SUPABASE_BUCKET", "hevy-analytics")

    import importlib
    import lib.storage
    importlib.reload(lib.storage)
    from lib.storage import get_conn

    conn = get_conn()
    # verify it's a usable connection
    result = conn.execute("SELECT 42 AS n").fetchone()
    assert result[0] == 42
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_storage.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `lib/storage.py`**

Create `health/training/scripts/lib/storage.py`:

```python
import os
import duckdb
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)


def get_conn() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs; INSTALL parquet; LOAD parquet;")
    conn.execute(f"""
        SET s3_endpoint='{os.environ["SUPABASE_S3_ENDPOINT"]}';
        SET s3_access_key_id='{os.environ["SUPABASE_S3_KEY"]}';
        SET s3_secret_access_key='{os.environ["SUPABASE_S3_SECRET"]}';
        SET s3_region='{os.environ["SUPABASE_S3_REGION"]}';
        SET s3_url_style='path';
    """)
    return conn


def s3_path(key: str) -> str:
    bucket = os.environ["SUPABASE_BUCKET"]
    return f"s3://{bucket}/{key}"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_storage.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add health/training/scripts/lib/storage.py health/training/scripts/tests/test_storage.py
git commit -m "feat(hevy-analytics): add lib/storage.py — DuckDB S3 connection factory"
```

---

## Task 4: `sync.py` — JSON to Parquet on Supabase Storage

**Files:**
- Create: `health/training/scripts/sync.py`
- Create: `health/training/scripts/tests/test_sync.py`

**Interfaces:**
- Consumes: JSON files from `workouts/{year}/` and `routines/`; `lib/storage.get_conn()`, `lib/storage.s3_path()`
- Produces: `data/workouts_{year}.parquet` and `data/routines.parquet` in Supabase Storage

---

- [ ] **Step 1: Write failing tests**

Create `health/training/scripts/tests/test_sync.py`:

```python
import json
import pytest
import duckdb
from pathlib import Path


def write_workout_file(workout, dir_path):
    safe_time = workout["start_time"].replace(":", "-")
    path = dir_path / f"{safe_time}__{workout['id']}.json"
    path.write_text(json.dumps(workout))
    return path


def write_routine_file(routine, dir_path):
    path = dir_path / f"{routine['id']}.json"
    path.write_text(json.dumps(routine))
    return path


def test_build_workouts_df_schema(sample_workout_json, tmp_workout_dir):
    from sync import build_workouts_df

    write_workout_file(sample_workout_json, tmp_workout_dir)
    df = build_workouts_df(tmp_workout_dir)

    expected_cols = {
        "workout_id", "workout_title", "start_time", "end_time", "routine_id",
        "exercise_index", "exercise_title", "exercise_notes", "exercise_template_id",
        "superset_id", "set_index", "set_type", "weight_kg", "reps", "rpe",
        "duration_seconds", "distance_meters"
    }
    assert expected_cols.issubset(set(df.columns))


def test_build_workouts_df_row_count(sample_workout_json, tmp_workout_dir):
    from sync import build_workouts_df

    write_workout_file(sample_workout_json, tmp_workout_dir)
    df = build_workouts_df(tmp_workout_dir)

    # 2 exercises: first has 2 sets, second has 1 set = 3 rows total
    assert len(df) == 3


def test_build_workouts_df_deduplicates(sample_workout_json, tmp_workout_dir):
    from sync import build_workouts_df

    # write same workout twice (different filenames)
    write_workout_file(sample_workout_json, tmp_workout_dir)
    sample2 = sample_workout_json.copy()
    sample2["start_time"] = "2026-06-14T12:00:00+00:00"
    sample2["id"] = "test-workout-001"  # same id
    write_workout_file(sample2, tmp_workout_dir)

    df = build_workouts_df(tmp_workout_dir)
    assert df["workout_id"].nunique() == 1


def test_build_routines_df_schema(sample_routine_json, tmp_routine_dir):
    from sync import build_routines_df

    write_routine_file(sample_routine_json, tmp_routine_dir)
    df = build_routines_df(tmp_routine_dir)

    expected_cols = {
        "hevy_id", "title", "updated_at", "synced_at",
        "exercise_index", "exercise_title", "exercise_notes", "exercise_template_id",
        "rest_seconds", "set_index", "set_type", "weight_kg",
        "rep_range_start", "rep_range_end"
    }
    assert expected_cols.issubset(set(df.columns))


def test_build_routines_df_append_only(sample_routine_json, tmp_routine_dir, local_duckdb):
    from sync import build_routines_df, merge_routines_df

    conn, tmp_path = local_duckdb
    parquet_path = str(tmp_path / "routines.parquet")

    write_routine_file(sample_routine_json, tmp_routine_dir)
    df1 = build_routines_df(tmp_routine_dir)
    conn.execute(f"COPY (SELECT * FROM df1) TO '{parquet_path}' (FORMAT PARQUET)")

    # "update" routine (new updated_at)
    updated = sample_routine_json.copy()
    updated["updated_at"] = "2026-06-01T08:00:00.000Z"
    write_routine_file(updated, tmp_routine_dir)

    df2 = build_routines_df(tmp_routine_dir)
    merged = merge_routines_df(conn, parquet_path, df2)

    # both versions retained
    assert len(merged["updated_at"].unique()) == 2


def test_build_routines_df_no_duplicate_versions(sample_routine_json, tmp_routine_dir, local_duckdb):
    from sync import build_routines_df, merge_routines_df

    conn, tmp_path = local_duckdb
    parquet_path = str(tmp_path / "routines.parquet")

    write_routine_file(sample_routine_json, tmp_routine_dir)
    df1 = build_routines_df(tmp_routine_dir)
    conn.execute(f"COPY (SELECT * FROM df1) TO '{parquet_path}' (FORMAT PARQUET)")

    # same routine, same updated_at — re-run should not duplicate
    df2 = build_routines_df(tmp_routine_dir)
    merged = merge_routines_df(conn, parquet_path, df2)

    assert len(merged["updated_at"].unique()) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_sync.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `sync.py`**

Create `health/training/scripts/sync.py`:

```python
"""
sync.py — Read workout/routine JSON files and write consolidated Parquet to Supabase Storage.

Idempotent: safe to re-run. Workouts deduplicated by workout_id.
Routines append-only: new version rows added only when updated_at changes.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
from dotenv import load_dotenv

from lib.storage import get_conn, s3_path

load_dotenv(Path(__file__).parent.parent.parent / ".envrc", override=False)

SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent.parent.parent
TRAINING_DIR = REPO_ROOT / "health" / "training"


def build_workouts_df(workouts_dir: Path) -> pd.DataFrame:
    rows = []
    seen_ids: set[str] = set()

    for f in sorted(workouts_dir.glob("*.json")):
        w = json.loads(f.read_text())
        wid = w["id"]
        if wid in seen_ids:
            continue
        seen_ids.add(wid)

        for ex in w.get("exercises", []):
            for s in ex.get("sets", []):
                rows.append({
                    "workout_id": wid,
                    "workout_title": w.get("title"),
                    "start_time": w.get("start_time"),
                    "end_time": w.get("end_time"),
                    "routine_id": w.get("routine_id"),
                    "exercise_index": ex.get("index"),
                    "exercise_title": ex.get("title"),
                    "exercise_notes": ex.get("notes"),
                    "exercise_template_id": ex.get("exercise_template_id"),
                    "superset_id": ex.get("superset_id"),
                    "set_index": s.get("index"),
                    "set_type": s.get("type"),
                    "weight_kg": s.get("weight_kg"),
                    "reps": s.get("reps"),
                    "rpe": s.get("rpe"),
                    "duration_seconds": s.get("duration_seconds"),
                    "distance_meters": s.get("distance_meters"),
                })

    return pd.DataFrame(rows)


def build_routines_df(routines_dir: Path) -> pd.DataFrame:
    rows = []
    now = datetime.now(timezone.utc).isoformat()

    for f in sorted(routines_dir.glob("*.json")):
        r = json.loads(f.read_text())
        for ex in r.get("exercises", []):
            for s in ex.get("sets", []):
                rep_range = s.get("rep_range") or {}
                rows.append({
                    "hevy_id": r["id"],
                    "title": r.get("title"),
                    "updated_at": r.get("updated_at"),
                    "synced_at": now,
                    "exercise_index": ex.get("index"),
                    "exercise_title": ex.get("title"),
                    "exercise_notes": ex.get("notes"),
                    "exercise_template_id": ex.get("exercise_template_id"),
                    "rest_seconds": ex.get("rest_seconds"),
                    "set_index": s.get("index"),
                    "set_type": s.get("type"),
                    "weight_kg": s.get("weight_kg"),
                    "rep_range_start": rep_range.get("start"),
                    "rep_range_end": rep_range.get("end"),
                })

    return pd.DataFrame(rows)


def merge_routines_df(conn: duckdb.DuckDBPyConnection, parquet_path: str, new_df: pd.DataFrame) -> pd.DataFrame:
    """
    Merge new_df into existing Parquet. Append only new (hevy_id, updated_at) pairs.
    Returns the merged DataFrame (to be written back).
    """
    try:
        existing = conn.execute(f"SELECT * FROM read_parquet('{parquet_path}')").df()
        existing_versions = set(zip(existing["hevy_id"], existing["updated_at"]))
        new_rows = new_df[
            ~new_df.apply(lambda r: (r["hevy_id"], r["updated_at"]) in existing_versions, axis=1)
        ]
        return pd.concat([existing, new_rows], ignore_index=True)
    except Exception:
        # File doesn't exist yet (first run)
        return new_df


def sync_workouts(conn: duckdb.DuckDBPyConnection, workouts_dir: Path, year: int):
    key = f"data/workouts_{year}.parquet"
    path = s3_path(key)

    new_df = build_workouts_df(workouts_dir)
    if new_df.empty:
        print("No workout data found.")
        return

    try:
        existing = conn.execute(f"SELECT * FROM read_parquet('{path}')").df()
        new_ids = set(new_df["workout_id"]) - set(existing["workout_id"])
        if not new_ids:
            print(f"Workouts Parquet up to date ({len(existing)} rows).")
            return
        merged = pd.concat([existing, new_df[new_df["workout_id"].isin(new_ids)]], ignore_index=True)
    except Exception:
        merged = new_df

    conn.execute(f"COPY (SELECT * FROM merged) TO '{path}' (FORMAT PARQUET)")
    print(f"Workouts Parquet written: {len(merged)} rows → {path}")


def sync_routines(conn: duckdb.DuckDBPyConnection, routines_dir: Path):
    path = s3_path("data/routines.parquet")
    new_df = build_routines_df(routines_dir)
    if new_df.empty:
        print("No routine data found.")
        return
    merged = merge_routines_df(conn, path, new_df)
    conn.execute(f"COPY (SELECT * FROM merged) TO '{path}' (FORMAT PARQUET)")
    print(f"Routines Parquet written: {len(merged)} rows → {path}")


def main():
    year = 2026
    workouts_dir = TRAINING_DIR / "workouts" / str(year)
    routines_dir = TRAINING_DIR / "routines"
    conn = get_conn()
    sync_workouts(conn, workouts_dir, year)
    sync_routines(conn, routines_dir)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_sync.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Smoke test against Supabase Storage**

```bash
python sync.py
```

Expected output (first run):
```
Workouts Parquet written: N rows → s3://hevy-analytics/data/workouts_2026.parquet
Routines Parquet written: N rows → s3://hevy-analytics/data/routines.parquet
```

Re-run immediately:
```
Workouts Parquet up to date (N rows).
Routines Parquet written: N rows → ...   (routines always re-checks versions)
```

- [ ] **Step 6: Commit**

```bash
git add health/training/scripts/sync.py health/training/scripts/tests/test_sync.py
git commit -m "feat(hevy-analytics): add sync.py — JSON to consolidated Parquet on Supabase Storage"
```

---

## Task 5: `analyse.py` — DuckDB context + Claude Haiku + analyses table

**Files:**
- Create: `health/training/scripts/analyse.py`
- Create: `health/training/scripts/tests/test_analyse.py`

**Interfaces:**
- Consumes: `lib/storage.get_conn()`, `lib/storage.s3_path()`; Supabase PostgreSQL `analyses` table; `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`
- Produces: rows in `analyses` table

---

- [ ] **Step 1: Write failing tests**

Create `health/training/scripts/tests/test_analyse.py`:

```python
import pytest
import pandas as pd
from unittest.mock import MagicMock, patch


PUSH_WORKOUT_ID = "test-workout-001"
PUSH_ROUTINE_ID = "routine-push-001"


def make_workout_row(workout_id=PUSH_WORKOUT_ID, routine_id=PUSH_ROUTINE_ID,
                     title="2026: Push [Tricep Bypass]",
                     exercise_title="Chest Fly (Machine)",
                     template_id="CF001",
                     weight_kg=100.0, reps=9, rpe=10.0, notes="3s eccentric",
                     start_time="2026-06-13T12:06:47+00:00"):
    return {
        "workout_id": workout_id,
        "workout_title": title,
        "start_time": start_time,
        "end_time": "2026-06-13T13:00:00+00:00",
        "routine_id": routine_id,
        "exercise_index": 0,
        "exercise_title": exercise_title,
        "exercise_notes": notes,
        "exercise_template_id": template_id,
        "superset_id": None,
        "set_index": 0,
        "set_type": "normal",
        "weight_kg": weight_kg,
        "reps": reps,
        "rpe": rpe,
        "duration_seconds": None,
        "distance_meters": None,
    }


def test_classify_workout_type_by_routine_id():
    from analyse import classify_workout_type

    known_routine_ids = {"routine-push-001": "Push", "routine-pull-001": "Pull"}
    assert classify_workout_type("2026: Push [Tricep Bypass]", "routine-push-001", known_routine_ids) == "Push"


def test_classify_workout_type_title_fallback():
    from analyse import classify_workout_type

    assert classify_workout_type("2026: Push [Tricep Bypass]", None, {}) == "Push"
    assert classify_workout_type("2026: Pull [Bicep Bypass]", None, {}) == "Pull"
    assert classify_workout_type("2026: Legs", None, {}) == "Legs"
    assert classify_workout_type("Late night workout", None, {}) == "Unknown"


def test_detect_plateaus_flags_stale_exercise():
    from analyse import detect_plateaus

    rows = [make_workout_row(weight_kg=100.0, reps=9) for _ in range(3)]
    df = pd.DataFrame(rows)
    flags = detect_plateaus(df, "Chest Fly (Machine)", lookback=3)

    assert "Chest Fly (Machine)" in flags


def test_detect_plateaus_no_flag_when_progressing():
    from analyse import detect_plateaus

    rows = [
        make_workout_row(weight_kg=80.0, reps=9),
        make_workout_row(weight_kg=90.0, reps=9),
        make_workout_row(weight_kg=100.0, reps=9),
    ]
    df = pd.DataFrame(rows)
    flags = detect_plateaus(df, "Chest Fly (Machine)", lookback=3)

    assert "Chest Fly (Machine)" not in flags


def test_extract_pain_signals_from_notes():
    from analyse import extract_pain_signals

    notes = [
        "pulsating semi sharp pain from right under hip, radiating down to right toe by rep 12",
        "3s eccentric",
        "felt glutes all reps",
    ]
    signals = extract_pain_signals(notes)

    assert len(signals) == 1
    assert "hip" in signals[0].lower() or "pain" in signals[0].lower()


def test_build_prompt_contains_six_modules():
    from analyse import build_prompt

    workout_df = pd.DataFrame([make_workout_row()])
    prior_df = pd.DataFrame([make_workout_row(start_time="2026-06-01T12:00:00+00:00")])
    routine_df = pd.DataFrame([{
        "hevy_id": PUSH_ROUTINE_ID, "title": "2026: Push",
        "updated_at": "2026-05-01T08:00:00.000Z", "synced_at": "2026-05-01T08:01:00.000Z",
        "exercise_index": 0, "exercise_title": "Chest Fly (Machine)",
        "exercise_notes": "Seat height 5.", "exercise_template_id": "CF001",
        "rest_seconds": 120, "set_index": 0, "set_type": "failure",
        "weight_kg": 100.0, "rep_range_start": 8, "rep_range_end": 12,
    }])

    prompt = build_prompt(workout_df, prior_df, routine_df)

    for module in ["PROGRESSION", "PLANNED VS ACTUAL", "STRATEGY VALIDATION",
                   "QUALITATIVE SIGNALS", "FLAGS", "ONE NEXT ACTION"]:
        assert module in prompt


def test_already_analysed_skipped(monkeypatch):
    from analyse import get_unanalysed_workout_ids

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.execute.return_value.data = [
        {"workout_id": "test-workout-001"}
    ]

    ids = get_unanalysed_workout_ids(["test-workout-001", "test-workout-002"], mock_client)
    assert ids == ["test-workout-002"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_analyse.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `analyse.py`**

Create `health/training/scripts/analyse.py`:

```python
"""
analyse.py — Query Parquet context via DuckDB, call Claude Haiku, insert into analyses table.

For each workout not yet in the `analyses` table:
  1. Load workout data from Parquet
  2. Load last 3 sessions of same type
  3. Load active routine version
  4. Build six-module prompt
  5. Call Claude Haiku
  6. Insert into analyses table
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from lib.storage import get_conn, s3_path

load_dotenv(Path(__file__).parent.parent.parent / ".envrc", override=False)

SYSTEM_PROMPT = """
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
""".strip()

ANALYSIS_TEMPLATE = """
Today's workout:
{workout_data}

Last 3 sessions of same type:
{prior_data}

Active routine:
{routine_data}

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
   - Plateau: same weight + reps for 3+ sessions -> name the exercise
   - Pain pattern: any radiating pain -> flag first, before other analysis
   - Eccentric overload: 4s eccentric on more than 2 exercises -> flag

6. ONE NEXT ACTION
   Single clearest change for the next session of this type. Not a list.
"""

PAIN_KEYWORDS = re.compile(
    r"(pain|sharp|pulsating|radiating|twinge|ache|discomfort|pinch|cramping)",
    re.IGNORECASE
)


def classify_workout_type(title: str, routine_id: str | None, known_ids: dict[str, str]) -> str:
    if routine_id and routine_id in known_ids:
        return known_ids[routine_id]
    t = title.lower()
    if "push" in t:
        return "Push"
    if "pull" in t:
        return "Pull"
    if "leg" in t:
        return "Legs"
    return "Unknown"


def detect_plateaus(df: pd.DataFrame, exercise_title: str, lookback: int = 3) -> list[str]:
    """Return list of exercise names that have same weight+reps for `lookback` consecutive sessions."""
    ex = df[df["exercise_title"] == exercise_title].copy()
    if len(ex) < lookback:
        return []

    recent = ex.sort_values("start_time", ascending=False).head(lookback)
    weights = recent["weight_kg"].dropna().unique()
    reps = recent["reps"].dropna().unique()

    if len(weights) == 1 and len(reps) == 1:
        return [exercise_title]
    return []


def extract_pain_signals(notes: list[str]) -> list[str]:
    return [n for n in notes if n and PAIN_KEYWORDS.search(n)]


def build_prompt(workout_df: pd.DataFrame, prior_df: pd.DataFrame, routine_df: pd.DataFrame) -> str:
    return ANALYSIS_TEMPLATE.format(
        workout_data=workout_df.to_string(index=False),
        prior_data=prior_df.to_string(index=False) if not prior_df.empty else "No prior sessions.",
        routine_data=routine_df.to_string(index=False) if not routine_df.empty else "No routine data.",
    )


def get_unanalysed_workout_ids(all_ids: list[str], supabase_client) -> list[str]:
    result = supabase_client.table("analyses").select("workout_id").execute()
    analysed = {r["workout_id"] for r in result.data}
    return [wid for wid in all_ids if wid not in analysed]


def load_context(conn, workout_id: str, year: int):
    workouts_path = s3_path(f"data/workouts_{year}.parquet")
    routines_path = s3_path("data/routines.parquet")

    workout_df = conn.execute(f"""
        SELECT * FROM read_parquet('{workouts_path}')
        WHERE workout_id = '{workout_id}'
    """).df()

    if workout_df.empty:
        return None, pd.DataFrame(), pd.DataFrame()

    row = workout_df.iloc[0]
    routine_id = row.get("routine_id") or ""
    title = row.get("workout_title") or ""

    type_filter = ""
    if "push" in title.lower():
        type_filter = "ILIKE '%Push%'"
    elif "pull" in title.lower():
        type_filter = "ILIKE '%Pull%'"
    elif "leg" in title.lower():
        type_filter = "ILIKE '%Leg%'"

    if type_filter:
        prior_df = conn.execute(f"""
            SELECT DISTINCT workout_id, workout_title, start_time FROM read_parquet('{workouts_path}')
            WHERE workout_title {type_filter}
              AND workout_id != '{workout_id}'
            ORDER BY start_time DESC
            LIMIT 3
        """).df()
    else:
        prior_df = pd.DataFrame()

    prior_sets_df = pd.DataFrame()
    if not prior_df.empty:
        ids = tuple(prior_df["workout_id"].tolist())
        ids_sql = str(ids) if len(ids) > 1 else f"('{ids[0]}')"
        prior_sets_df = conn.execute(f"""
            SELECT * FROM read_parquet('{workouts_path}')
            WHERE workout_id IN {ids_sql}
        """).df()

    routine_df = pd.DataFrame()
    if routine_id:
        routine_df = conn.execute(f"""
            SELECT * FROM read_parquet('{routines_path}')
            WHERE hevy_id = '{routine_id}'
              AND updated_at <= '{row["start_time"]}'
            ORDER BY updated_at DESC
            LIMIT 1
        """).df()

    return workout_df, prior_sets_df, routine_df


def analyse_workout(workout_id: str, conn, supabase_client, anthropic_client, year: int):
    workout_df, prior_df, routine_df = load_context(conn, workout_id, year)
    if workout_df is None or workout_df.empty:
        print(f"  Workout {workout_id} not found in Parquet — skipping.")
        return

    prompt = build_prompt(workout_df, prior_df, routine_df)

    response = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    content = response.content[0].text
    tokens = response.usage.input_tokens + response.usage.output_tokens

    supabase_client.table("analyses").insert({
        "type": "post_workout",
        "workout_id": workout_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "content": content,
        "model": "claude-haiku-4-5-20251001",
        "tokens_used": tokens,
    }).execute()

    print(f"  Analysed {workout_id} ({tokens} tokens)")


def main():
    year = 2026
    conn = get_conn()
    supabase_client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    workouts_path = s3_path(f"data/workouts_{year}.parquet")
    all_ids = conn.execute(f"""
        SELECT DISTINCT workout_id FROM read_parquet('{workouts_path}')
    """).df()["workout_id"].tolist()

    to_analyse = get_unanalysed_workout_ids(all_ids, supabase_client)
    print(f"Found {len(to_analyse)} workouts to analyse.")

    for wid in to_analyse:
        analyse_workout(wid, conn, supabase_client, anthropic_client, year)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_analyse.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Smoke test — analyse one real workout**

First, add today's workout to the analyses table exclusion list by temporarily commenting out the `get_unanalysed_workout_ids` filter and running against a single known ID:

```bash
python -c "
import os; from dotenv import load_dotenv; from pathlib import Path
load_dotenv(Path('../../..') / '.envrc', override=False)
import anthropic, duckdb
from lib.storage import get_conn, s3_path
from supabase import create_client
from analyse import analyse_workout

conn = get_conn()
sc = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
ac = anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
analyse_workout('24756ad1-b127-46ab-996f-172edfdb43f1', conn, sc, ac, 2026)
"
```

Expected: row inserted into `analyses` table. Verify in Supabase dashboard → Table Editor → `analyses`.

- [ ] **Step 6: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add health/training/scripts/analyse.py health/training/scripts/tests/test_analyse.py
git commit -m "feat(hevy-analytics): add analyse.py — DuckDB context queries, Claude Haiku, analyses table"
```

---

## Task 6: Trigger infrastructure — Cloudflare Worker + GitHub Actions

**Files:**
- Create: `cloudflare/hevy-webhook/worker.js`
- Create: `.github/workflows/hevy-sync.yml`

**Interfaces:**
- Consumes: Hevy webhook `POST {"workoutId": "..."}` with `Authorization` header
- Produces: GitHub `repository_dispatch` event type `hevy_workout_created` with `client_payload.workoutId`

---

- [ ] **Step 1: Create Cloudflare Worker**

Create `cloudflare/hevy-webhook/worker.js`:

```javascript
/**
 * Receives Hevy webhook, validates auth, forwards to GitHub repository_dispatch.
 *
 * Env vars (set in Cloudflare dashboard):
 *   HEVY_WEBHOOK_AUTH  — the authorization header value Hevy sends
 *   GH_PAT             — GitHub personal access token (repo scope)
 *   GH_REPO            — "owner/repo-name"
 */
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const auth = request.headers.get("Authorization") || "";
    if (auth !== env.HEVY_WEBHOOK_AUTH) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const workoutId = body.workoutId;
    if (!workoutId) {
      return new Response("Missing workoutId", { status: 400 });
    }

    const ghResp = await fetch(
      `https://api.github.com/repos/${env.GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GH_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "hevy-webhook-worker",
        },
        body: JSON.stringify({
          event_type: "hevy_workout_created",
          client_payload: { workoutId },
        }),
      }
    );

    if (!ghResp.ok) {
      const text = await ghResp.text();
      return new Response(`GitHub dispatch failed: ${text}`, { status: 502 });
    }

    return new Response("OK", { status: 200 });
  },
};
```

- [ ] **Step 2: Deploy Cloudflare Worker**

In Cloudflare dashboard → Workers & Pages → Create Worker:
1. Paste the contents of `worker.js`
2. Save and deploy
3. Note the Worker URL: `https://hevy-webhook.{subdomain}.workers.dev`

Set environment variables in Worker Settings → Variables:
- `HEVY_WEBHOOK_AUTH`: the Authorization header value you'll configure in Hevy
- `GH_PAT`: a GitHub PAT with `repo` scope (Settings → Developer settings → Personal access tokens)
- `GH_REPO`: `benjamindang/os` (or the actual repo name)

- [ ] **Step 3: Configure Hevy webhook**

In Hevy app → Settings → Webhooks:
- URL: `https://hevy-webhook.{subdomain}.workers.dev`
- Authorization header: same value as `HEVY_WEBHOOK_AUTH`

- [ ] **Step 4: Create GitHub Actions workflow**

Create `.github/workflows/hevy-sync.yml`:

```yaml
name: Hevy Sync

on:
  repository_dispatch:
    types: [hevy_workout_created]
  schedule:
    - cron: '0 10 * * *'   # 6pm AWST = 10:00 UTC, daily fallback
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: health/training/scripts

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: health/training/scripts/requirements.txt

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Fetch workouts from Hevy
        env:
          HEVY_API_KEY: ${{ secrets.HEVY_API_KEY }}
        run: |
          WORKOUT_ID="${{ github.event.client_payload.workoutId }}"
          if [ -n "$WORKOUT_ID" ]; then
            python fetch.py --workout-id "$WORKOUT_ID"
          else
            python fetch.py
          fi

      - name: Sync JSON to Parquet on Supabase Storage
        env:
          SUPABASE_BUCKET: ${{ secrets.SUPABASE_BUCKET }}
          SUPABASE_S3_ENDPOINT: ${{ secrets.SUPABASE_S3_ENDPOINT }}
          SUPABASE_S3_KEY: ${{ secrets.SUPABASE_S3_KEY }}
          SUPABASE_S3_SECRET: ${{ secrets.SUPABASE_S3_SECRET }}
          SUPABASE_S3_REGION: ${{ secrets.SUPABASE_S3_REGION }}
        run: python sync.py

      - name: Analyse new workouts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          SUPABASE_BUCKET: ${{ secrets.SUPABASE_BUCKET }}
          SUPABASE_S3_ENDPOINT: ${{ secrets.SUPABASE_S3_ENDPOINT }}
          SUPABASE_S3_KEY: ${{ secrets.SUPABASE_S3_KEY }}
          SUPABASE_S3_SECRET: ${{ secrets.SUPABASE_S3_SECRET }}
          SUPABASE_S3_REGION: ${{ secrets.SUPABASE_S3_REGION }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: python analyse.py
```

- [ ] **Step 5: Add GitHub Actions secrets**

In repo Settings → Secrets and variables → Actions → New repository secret, add:
- `HEVY_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_BUCKET`
- `SUPABASE_S3_ENDPOINT`
- `SUPABASE_S3_KEY`
- `SUPABASE_S3_SECRET`
- `SUPABASE_S3_REGION`
- `ANTHROPIC_API_KEY`

- [ ] **Step 6: Test the workflow manually**

In GitHub → Actions → Hevy Sync → Run workflow. Verify all three steps complete with green ticks and output matches local smoke test results.

- [ ] **Step 7: Test the full webhook chain**

Log a test workout in Hevy (or save an existing one). Verify:
1. Cloudflare Worker receives POST and returns 200
2. GitHub Actions is triggered (check Actions tab — should appear within 30 seconds)
3. Workflow runs successfully
4. New row in Supabase `analyses` table

Check Worker logs in Cloudflare dashboard → Workers → hevy-webhook → Logs.

- [ ] **Step 8: Commit**

```bash
git add cloudflare/hevy-webhook/worker.js .github/workflows/hevy-sync.yml
git commit -m "feat(hevy-analytics): add Cloudflare Worker webhook receiver and GitHub Actions workflow"
```

---

## Self-Review

**Spec coverage:**
- [x] Hevy API → JSON: Task 2 `fetch.py`
- [x] `--workout-id` arg: Task 2
- [x] JSON → Parquet on Supabase Storage: Task 4 `sync.py`
- [x] Consolidated annual Parquet: Task 4
- [x] Routine versioning (append-only): Task 4 `merge_routines_df`
- [x] DuckDB S3 connection: Task 3 `lib/storage.py`
- [x] Six-module LLM prompt: Task 5 `build_prompt()`
- [x] Plateau detection: Task 5 `detect_plateaus()`
- [x] Pain signal extraction: Task 5 `extract_pain_signals()`
- [x] Workout type classification: Task 5 `classify_workout_type()`
- [x] `analyses` table + insert: Task 5
- [x] Cloudflare Worker: Task 6
- [x] GitHub Actions (webhook + cron): Task 6
- [x] Idempotency throughout: enforced in `fetch.py` (skip existing files), `sync.py` (dedup by workout_id / routine version), `analyse.py` (`get_unanalysed_workout_ids`)

**Gaps found and fixed:**
- Routine JSON schema uses `rep_range: {start, end}` and `rest_seconds` at exercise level (not set level) — reflected in `conftest.py` fixtures, `sync.py` `build_routines_df`, and `test_sync.py`
- `workout_id UNIQUE` constraint on `analyses` table ensures re-runs don't duplicate rows
- `classify_workout_type` function defined and tested but note it is currently not wired into `load_context` — `load_context` uses inline `ILIKE` based on title. These are consistent: same heuristic, two implementations. Acceptable for now; wire `classify_workout_type` in if the heuristic needs extending.
