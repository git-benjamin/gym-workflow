"""
sync.py — Read workout/routine JSON files and write consolidated Parquet to Supabase Storage.

Idempotent: safe to re-run. Workouts deduplicated by workout_id.
Routines append-only: new version rows added only when updated_at changes.
"""
from __future__ import annotations
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
from dotenv import load_dotenv

from lib.storage import get_conn, s3_path

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

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
    """Append new (hevy_id, updated_at) pairs; leave existing rows untouched."""
    try:
        existing = conn.execute(f"SELECT * FROM read_parquet('{parquet_path}')").df()
        existing_versions = set(zip(existing["hevy_id"], existing["updated_at"]))
        new_rows = new_df[
            ~new_df.apply(lambda r: (r["hevy_id"], r["updated_at"]) in existing_versions, axis=1)
        ]
        return pd.concat([existing, new_rows], ignore_index=True)
    except Exception:
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
    year = datetime.now(timezone.utc).year
    workouts_dir = TRAINING_DIR / "workouts" / str(year)
    routines_dir = TRAINING_DIR / "routines"
    conn = get_conn()
    sync_workouts(conn, workouts_dir, year)
    sync_routines(conn, routines_dir)


if __name__ == "__main__":
    main()
