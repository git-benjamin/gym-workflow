"""
mfp_ingest.py — Ingest weight and nutrition from MyFitnessPal into Supabase.

MANUAL ONLY — must be run locally with an active MFP session.

Auth: the myfitnesspal library reads credentials from your system keyring.
First-time setup (run once in terminal):
  python -c "import myfitnesspal; myfitnesspal.Client()"
  # follow the browser auth flow, credentials are saved to keyring

Usage:
  python mfp_ingest.py                          # last 90 days
  python mfp_ingest.py --start-date 2024-01-01  # from a specific date
  python mfp_ingest.py --start-date 2019-01-01  # full history backfill
"""
from __future__ import annotations
import argparse
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import myfitnesspal
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

BATCH_SIZE = 100


def ingest_weight(client: myfitnesspal.Client, sb, start_date: date) -> int:
    measurements = client.get_measurements("Weight", lower_bound=start_date)
    if not measurements:
        print("  weight: no data returned.")
        return 0

    rows = [
        {"date": str(d), "weight_kg": round(float(v), 2) if v else None}
        for d, v in measurements.items()
        if v is not None
    ]

    for i in range(0, len(rows), BATCH_SIZE):
        sb.table("weight_logs").upsert(rows[i:i + BATCH_SIZE], on_conflict="date").execute()

    print(f"  weight: {len(rows)} rows upserted.")
    return len(rows)


def ingest_nutrition(client: myfitnesspal.Client, sb, start_date: date) -> int:
    today = date.today()
    rows = []
    current = start_date

    while current <= today:
        try:
            day = client.get_date(current.year, current.month, current.day)
            totals = day.totals
            if totals:
                rows.append({
                    "date": str(current),
                    "calories": totals.get("calories"),
                    "protein": totals.get("protein"),
                    "carbohydrates": totals.get("carbohydrates"),
                    "fat": totals.get("fat"),
                    "sugar": totals.get("sugar"),
                    "sodium": totals.get("sodium"),
                    "fiber": totals.get("fiber"),
                })
        except Exception as e:
            print(f"  nutrition: skipping {current} ({e})")

        current += timedelta(days=1)

    if not rows:
        print("  nutrition: no data returned.")
        return 0

    for i in range(0, len(rows), BATCH_SIZE):
        sb.table("nutrition_logs").upsert(rows[i:i + BATCH_SIZE], on_conflict="date").execute()

    print(f"  nutrition: {len(rows)} rows upserted.")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD (default: 90 days ago)")
    args = parser.parse_args()

    start_date = (
        datetime.strptime(args.start_date, "%Y-%m-%d").date()
        if args.start_date
        else date.today() - timedelta(days=90)
    )

    print(f"Ingesting MFP data from {start_date} to today...")
    client = myfitnesspal.Client()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    ingest_weight(client, sb, start_date)
    ingest_nutrition(client, sb, start_date)
    print("Done.")


if __name__ == "__main__":
    main()
