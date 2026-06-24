"""
garmin_ingest.py — Ingest Garmin Connect daily activity, steps, and heart rate into Supabase.

Local usage (requires ~/.garth/ session):
  python garmin_ingest.py                          # last 90 days
  python garmin_ingest.py --start-date 2022-08-28  # from when Apple Watch data ends
  python garmin_ingest.py --login                  # force re-auth

CI usage (GitHub Actions):
  Set GARMIN_OAUTH1_TOKEN and GARMIN_OAUTH2_TOKEN secrets (JSON strings from ~/.garth/).
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from garth.auth_tokens import OAuth1Token, OAuth2Token
from dotenv import load_dotenv
from garminconnect import Garmin
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

BATCH_SIZE = 100
GARTH_HOME = Path.home() / ".garth"


def get_client() -> Garmin:
    api = Garmin()
    if os.environ.get("GARMIN_OAUTH1_TOKEN"):
        # CI path: tokens passed as JSON env vars
        oauth1 = OAuth1Token(**json.loads(os.environ["GARMIN_OAUTH1_TOKEN"]))
        oauth2 = OAuth2Token(**json.loads(os.environ["GARMIN_OAUTH2_TOKEN"]))
        api.garth.configure(oauth1_token=oauth1, oauth2_token=oauth2, domain=oauth1.domain)
        api.display_name = api.garth.profile["displayName"]
        api.full_name = api.garth.profile["fullName"]
    elif GARTH_HOME.exists():
        api.login(GARTH_HOME)
    else:
        email = os.environ.get("GARMIN_EMAIL") or input("Garmin email: ")
        pwd = os.environ.get("GARMIN_PASSWORD") or input("Garmin password: ")
        api = Garmin(email, pwd)
        api.login()
        api.garth.dump(str(GARTH_HOME))
    return api


def date_range(start: date, end: date) -> list[date]:
    days, current = [], start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def fetch_daily(api: Garmin, sb, start: date, end: date) -> int:
    """Fetch daily step + HR stats from Garmin and upsert into daily_health."""
    rows = []
    days = date_range(start, end)
    print(f"  Fetching {len(days)} days of Garmin stats...")

    for i, d in enumerate(days):
        d_str = d.isoformat()
        try:
            stats = api.get_stats(d_str)
            step_val = int(stats["totalSteps"]) if stats.get("totalSteps") else None
            rhr_val = int(stats["restingHeartRate"]) if stats.get("restingHeartRate") else None
            active_val = float(stats["activeKilocalories"]) if stats.get("activeKilocalories") else None
            # Skip days with no data (watch not paired / not worn)
            if step_val is None and rhr_val is None and active_val is None:
                continue
            rows.append({
                "date": d_str,
                "source": "garmin",
                "steps": step_val,
                "resting_hr": rhr_val,
                "active_energy_kcal": active_val,
                "avg_hr": None,
                "min_hr": None,
                "max_hr": None,
                "walking_hr_avg": None,
                "hrv_sdnn": None,
                "respiratory_rate": None,
                "vo2max": None,
            })
        except Exception as e:
            print(f"    skipping {d_str}: {e}")

        if (i + 1) % 30 == 0:
            print(f"    {i + 1}/{len(days)}...")
            time.sleep(0.5)  # rate limit

    if not rows:
        print("  garmin daily: no data.")
        return 0

    for i in range(0, len(rows), BATCH_SIZE):
        sb.table("daily_health").upsert(rows[i:i + BATCH_SIZE], on_conflict="date,source").execute()
    print(f"  garmin daily: {len(rows)} rows upserted.")
    return len(rows)


def fetch_hrv(api: Garmin, sb, start: date, end: date) -> int:
    """Fetch HRV data and update daily_health rows."""
    rows = []
    days = date_range(start, end)

    for d in days:
        d_str = d.isoformat()
        try:
            hrv_data = api.get_hrv_data(d_str)
            if hrv_data and hrv_data.get("hrvSummary"):
                summary = hrv_data["hrvSummary"]
                last_night = summary.get("lastNight")
                if last_night:
                    rows.append({
                        "date": d_str,
                        "source": "garmin",
                        "hrv_sdnn": float(last_night),
                    })
        except Exception:
            pass

    if rows:
        for i in range(0, len(rows), BATCH_SIZE):
            sb.table("daily_health").upsert(rows[i:i + BATCH_SIZE], on_conflict="date,source").execute()
        print(f"  garmin HRV: {len(rows)} rows upserted.")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=None)
    parser.add_argument("--login", action="store_true", help="Force re-auth")
    args = parser.parse_args()

    if args.login and GARTH_HOME.exists():
        import shutil
        shutil.rmtree(GARTH_HOME)

    start = (
        datetime.strptime(args.start_date, "%Y-%m-%d").date()
        if args.start_date
        else date.today() - timedelta(days=90)
    )
    end = date.today()

    print(f"Ingesting Garmin data {start} to {end}...")
    api = get_client()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    fetch_daily(api, sb, start, end)
    try:
        fetch_hrv(api, sb, start, end)
    except Exception as e:
        print(f"  HRV fetch failed (not all accounts have this): {e}")

    print("Done.")


if __name__ == "__main__":
    main()
