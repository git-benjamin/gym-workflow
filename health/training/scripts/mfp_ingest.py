"""
mfp_ingest.py — Ingest weight, nutrition totals, and meal entries from MyFitnessPal.

MANUAL ONLY — must be run locally with an active MFP session (Chrome Profile 1).

Usage:
  python mfp_ingest.py                          # last 90 days
  python mfp_ingest.py --start-date 2021-07-01  # full history (data starts ~Jul 2021)
  python mfp_ingest.py --skip-weight            # skip weight (already ingested)
"""
from __future__ import annotations

import argparse
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path

import browser_cookie3
import myfitnesspal
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

BATCH_SIZE = 100
MAX_WORKERS = 8


def _i(v) -> int | None:
    return int(v) if v is not None else None


def _f(v) -> float | None:
    return float(v) if v is not None else None


def dedup(rows: list[dict], keys: list[str]) -> list[dict]:
    seen: dict[tuple, dict] = {}
    for row in rows:
        k = tuple(row.get(k) for k in keys)
        seen[k] = row
    return list(seen.values())


def date_range(start: date, end: date) -> list[date]:
    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def fetch_day(client: myfitnesspal.Client, d: date) -> tuple[date, object | None]:
    try:
        return d, client.get_date(d.year, d.month, d.day)
    except Exception as e:
        print(f"  skipping {d}: {e}")
        return d, None


def ingest_weight(client: myfitnesspal.Client, sb, start_date: date) -> int:
    measurements = client.get_measurements("Weight", lower_bound=start_date)
    if not measurements:
        print("  weight: no data returned.")
        return 0

    rows = [
        {"date": str(d), "weight_kg": round(float(v), 2)}
        for d, v in measurements.items()
        if v is not None
    ]

    for i in range(0, len(rows), BATCH_SIZE):
        sb.table("weight_logs").upsert(rows[i:i + BATCH_SIZE], on_conflict="date").execute()

    print(f"  weight: {len(rows)} rows upserted.")
    return len(rows)


def ingest_nutrition_and_meals(client: myfitnesspal.Client, sb, start_date: date) -> tuple[int, int]:
    today = date.today()
    days = date_range(start_date, today)

    print(f"  fetching {len(days)} days with {MAX_WORKERS} workers...")
    results: dict[date, object] = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_day, client, d): d for d in days}
        done = 0
        for future in as_completed(futures):
            d, day_obj = future.result()
            results[d] = day_obj
            done += 1
            if done % 50 == 0:
                print(f"    fetched {done}/{len(days)}...")

    # Build nutrition totals rows
    nutrition_rows = []
    meal_rows = []

    for d in sorted(results):
        day_obj = results[d]
        if day_obj is None:
            continue

        totals = day_obj.totals
        if totals:
            nutrition_rows.append({
                "date": str(d),
                "calories": _i(totals.get("calories")),
                "protein": _i(totals.get("protein")),
                "carbohydrates": _i(totals.get("carbohydrates")),
                "fat": _i(totals.get("fat")),
                "sugar": _i(totals.get("sugar")),
                "sodium": _i(totals.get("sodium")),
                "fiber": _i(totals.get("fiber")),
            })

        for meal in day_obj.meals:
            for entry in meal.entries:
                ni = entry.nutrition_information or {}
                meal_rows.append({
                    "date": str(d),
                    "meal": meal.name,
                    "food_name": entry.name,
                    "short_name": getattr(entry, "short_name", None),
                    "quantity": _f(getattr(entry, "quantity", None)),
                    "unit": getattr(entry, "unit", None),
                    "calories": _i(ni.get("calories")),
                    "protein": _f(ni.get("protein")),
                    "carbohydrates": _f(ni.get("carbohydrates")),
                    "fat": _f(ni.get("fat")),
                    "sugar": _f(ni.get("sugar")),
                    "sodium": _f(ni.get("sodium")),
                    "fiber": _f(ni.get("fiber")),
                })

    if not nutrition_rows:
        print("  nutrition: no data returned.")
    else:
        for i in range(0, len(nutrition_rows), BATCH_SIZE):
            sb.table("nutrition_logs").upsert(
                nutrition_rows[i:i + BATCH_SIZE], on_conflict="date"
            ).execute()
        print(f"  nutrition: {len(nutrition_rows)} rows upserted.")

    if not meal_rows:
        print("  meal_entries: no data returned.")
    else:
        meal_rows = dedup(meal_rows, ["date", "meal", "food_name", "quantity", "unit"])
        for i in range(0, len(meal_rows), BATCH_SIZE):
            sb.table("meal_entries").upsert(
                meal_rows[i:i + BATCH_SIZE],
                on_conflict="date,meal,food_name,quantity,unit",
            ).execute()
        print(f"  meal_entries: {len(meal_rows)} rows upserted.")

    return len(nutrition_rows), len(meal_rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD (default: 90 days ago)")
    parser.add_argument("--skip-weight", action="store_true", help="Skip weight ingest")
    args = parser.parse_args()

    start_date = (
        datetime.strptime(args.start_date, "%Y-%m-%d").date()
        if args.start_date
        else date.today() - timedelta(days=90)
    )

    print(f"Ingesting MFP data from {start_date} to today...")
    cookie_file = os.path.expanduser(
        "~/Library/Application Support/Google/Chrome/Profile 1/Cookies"
    )
    cookiejar = browser_cookie3.chrome(domain_name="myfitnesspal.com", cookie_file=cookie_file)
    client = myfitnesspal.Client(cookiejar=cookiejar)
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    if not args.skip_weight:
        ingest_weight(client, sb, start_date)

    ingest_nutrition_and_meals(client, sb, start_date)
    print("Done.")


if __name__ == "__main__":
    main()
