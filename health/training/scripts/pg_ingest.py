"""
pg_ingest.py — Upsert workout sets from local JSON files into Supabase Postgres.

Reads from the workouts/ JSON directory (same source as sync.py).
Skips workout_ids already present in workout_sets table.
Safe to re-run.

Usage:
  python pg_ingest.py                   # ingest current year
  python pg_ingest.py --start-year 2019 # ingest all years from 2019
"""
from __future__ import annotations
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

SCRIPTS_DIR = Path(__file__).parent
TRAINING_DIR = SCRIPTS_DIR.parent

BATCH_SIZE = 500


def build_rows(workout_file: Path) -> list[dict]:
    w = json.loads(workout_file.read_text())
    rows = []
    for ex in w.get("exercises", []):
        for s in ex.get("sets", []):
            rows.append({
                "workout_id": w["id"],
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
    return rows


def get_ingested_ids(supabase_client) -> set[str]:
    result = supabase_client.table("workout_sets").select("workout_id").execute()
    return {r["workout_id"] for r in result.data}


def ingest_year(year: int, ingested_ids: set[str], supabase_client) -> int:
    workouts_dir = TRAINING_DIR / "workouts" / str(year)
    if not workouts_dir.exists():
        return 0

    rows = []
    for f in sorted(workouts_dir.glob("*.json")):
        w = json.loads(f.read_text())
        if w["id"] in ingested_ids:
            continue
        rows.extend(build_rows(f))

    if not rows:
        print(f"  {year}: nothing new.")
        return 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        supabase_client.table("workout_sets").upsert(batch, on_conflict="workout_id,exercise_index,set_index").execute()

    print(f"  {year}: {len(rows)} rows inserted.")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=0)
    args = parser.parse_args()

    supabase_client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    ingested_ids = get_ingested_ids(supabase_client)
    print(f"Already ingested: {len(ingested_ids)} workouts.")

    current_year = datetime.now(timezone.utc).year
    years = range(args.start_year, current_year + 1) if args.start_year else [current_year]

    total = 0
    for year in years:
        total += ingest_year(year, ingested_ids, supabase_client)

    print(f"Done. {total} rows upserted.")


if __name__ == "__main__":
    main()
