"""
fetch.py — Pull workouts and routines from Hevy API to JSON files.

Usage:
  python fetch.py                        # paginate all workouts for current year
  python fetch.py --workout-id <id>      # fetch single workout by ID
"""
from __future__ import annotations
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

BASE_URL = "https://api.hevyapp.com"
PAGE_SIZE = 10
MAX_RETRIES = 4

SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent.parent.parent
TRAINING_DIR = REPO_ROOT / "health" / "training"


def _get(url: str, api_key: str, **params) -> dict:
    for attempt in range(MAX_RETRIES):
        r = requests.get(
            url,
            headers={"api-key": api_key, "accept": "application/json"},
            params=params or None,
        )
        if r.ok:
            return r.json()
        if r.status_code == 429:
            time.sleep(int(r.headers.get("retry-after", 5)))
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
    path = workouts_dir / f"{safe_time}__{workout['id']}.json"
    if path.exists():
        return path
    path.write_text(json.dumps(workout, indent=2))
    return path


def save_routine(routine: dict, routines_dir: Path) -> Path | None:
    path = routines_dir / f"{routine['id']}.json"
    if path.exists():
        existing = json.loads(path.read_text())
        if existing.get("updated_at") == routine.get("updated_at"):
            return None
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
