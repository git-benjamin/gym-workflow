"""
mfp_ingest.py — Ingest weight, nutrition totals, and meal entries from MyFitnessPal.

Auth sources (first match wins):
  1. MFP_COOKIES_JSON env var — JSON-serialised cookies (for CI use)
  2. Local Chrome Profile 1 — uses browser_cookie3 (for local manual runs)

Usage:
  python mfp_ingest.py                          # last 90 days
  python mfp_ingest.py --start-date 2021-07-01  # full history (data starts ~Jul 2021)
  python mfp_ingest.py --skip-weight            # skip weight (already ingested)
  python mfp_ingest.py --export-cookies         # print cookies JSON for GitHub secret
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sys
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


def serialize_cookies(cookiejar) -> str:
    """Convert a CookieJar to JSON for storage in a GitHub secret."""
    out = []
    for c in cookiejar:
        out.append({
            "name": c.name,
            "value": c.value,
            "domain": c.domain,
            "path": c.path,
            "secure": bool(c.secure),
            "expires": c.expires,
        })
    return json.dumps(out)


def deserialize_cookies(json_str: str):
    jar = http.cookiejar.CookieJar()
    for c in json.loads(json_str):
        cookie = http.cookiejar.Cookie(
            version=0,
            name=c["name"],
            value=c["value"],
            port=None,
            port_specified=False,
            domain=c["domain"],
            domain_specified=bool(c["domain"]),
            domain_initial_dot=c["domain"].startswith("."),
            path=c["path"],
            path_specified=True,
            secure=bool(c.get("secure", False)),
            expires=c.get("expires"),
            discard=False,
            comment=None,
            comment_url=None,
            rest={},
        )
        jar.set_cookie(cookie)
    return jar


def load_cookiejar():
    """Prefer MFP_COOKIES_JSON env var (CI); fall back to local Chrome."""
    env_cookies = os.environ.get("MFP_COOKIES_JSON")
    if env_cookies:
        print("  auth: using MFP_COOKIES_JSON from env")
        return deserialize_cookies(env_cookies)
    cookie_file = os.path.expanduser(
        "~/Library/Application Support/Google/Chrome/Profile 1/Cookies"
    )
    print(f"  auth: reading cookies from local Chrome ({cookie_file})")
    return browser_cookie3.chrome(domain_name="myfitnesspal.com", cookie_file=cookie_file)


def write_step_summary(lines: list[str]):
    """Append markdown to GitHub Actions step summary, if running in CI."""
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_file:
        return
    with open(summary_file, "a") as f:
        f.write("\n".join(lines) + "\n")


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


def ingest_weight(client: myfitnesspal.Client, sb, start_date: date) -> tuple[int, date | None, date | None]:
    measurements = client.get_measurements("Weight", lower_bound=start_date)
    if not measurements:
        print("  weight: no data returned.")
        return 0, None, None

    rows = [
        {"date": str(d), "weight_kg": round(float(v), 2)}
        for d, v in measurements.items()
        if v is not None
    ]

    for i in range(0, len(rows), BATCH_SIZE):
        sb.table("weight_logs").upsert(rows[i:i + BATCH_SIZE], on_conflict="date").execute()

    dates = sorted(measurements.keys())
    print(f"  weight: {len(rows)} rows upserted ({dates[0]} → {dates[-1]}).")
    return len(rows), dates[0], dates[-1]


def ingest_nutrition_and_meals(client: myfitnesspal.Client, sb, start_date: date) -> tuple[int, int, int, int]:
    """Returns (nutrition_rows, meal_rows, days_with_data, days_attempted)."""
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

    days_with_data = sum(1 for d in results if results[d] is not None)
    return len(nutrition_rows), len(meal_rows), days_with_data, len(days)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD (default: 90 days ago)")
    parser.add_argument("--skip-weight", action="store_true", help="Skip weight ingest")
    parser.add_argument("--export-cookies", action="store_true",
                        help="Print local Chrome cookies as JSON (for GitHub secret)")
    args = parser.parse_args()

    if args.export_cookies:
        cookie_file = os.path.expanduser(
            "~/Library/Application Support/Google/Chrome/Profile 1/Cookies"
        )
        jar = browser_cookie3.chrome(domain_name="myfitnesspal.com", cookie_file=cookie_file)
        json_str = serialize_cookies(jar)
        print(json_str)
        print(f"\n[stderr] Exported {len(json.loads(json_str))} cookies for myfitnesspal.com",
              file=sys.stderr)
        return

    start_date = (
        datetime.strptime(args.start_date, "%Y-%m-%d").date()
        if args.start_date
        else date.today() - timedelta(days=90)
    )
    today = date.today()

    print(f"Ingesting MFP data from {start_date} to {today}...")
    start_run = datetime.now()

    cookiejar = load_cookiejar()
    client = myfitnesspal.Client(cookiejar=cookiejar)
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    weight_rows = 0
    weight_min = weight_max = None
    if not args.skip_weight:
        weight_rows, weight_min, weight_max = ingest_weight(client, sb, start_date)

    nutrition_rows, meal_rows, days_with_data, days_attempted = ingest_nutrition_and_meals(client, sb, start_date)

    duration = (datetime.now() - start_run).total_seconds()
    print(f"Done in {duration:.1f}s.")

    # GitHub Actions summary
    summary = [
        "## MFP Ingest Summary",
        "",
        f"- **Window**: {start_date} → {today} ({days_attempted} days requested)",
        f"- **Days with MFP data**: {days_with_data} / {days_attempted}",
        f"- **Runtime**: {duration:.1f}s",
        "",
        "### Tables upserted",
        "",
        "| Table | Rows | Notes |",
        "|-------|------|-------|",
    ]
    if args.skip_weight:
        summary.append("| `weight_logs` | skipped | `--skip-weight` flag set |")
    else:
        wrange = f"{weight_min} → {weight_max}" if weight_min else "no rows"
        summary.append(f"| `weight_logs` | {weight_rows} | {wrange} |")
    summary.append(f"| `nutrition_logs` | {nutrition_rows} | daily macro totals |")
    summary.append(f"| `meal_entries` | {meal_rows} | individual food items |")
    write_step_summary(summary)


if __name__ == "__main__":
    main()
