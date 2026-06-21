"""
misc_health_ingest.py — Ingest CPAP, substance, and cycling data into Supabase Postgres.

MANUAL ONLY — run locally pointing at os repo files.

Usage:
  python misc_health_ingest.py --os-repo ~/Documents/Repositories/git-benjamin/os
"""
from __future__ import annotations

import argparse
import csv
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

BATCH_SIZE = 500

OS_CPAP_PATH = "health/sleep/DAILY_OSCAR_Ben_Summary_2019-12-23_2026-05-26.csv"
OS_DRUGS_PATH = "health/drugs/2026-06-14_drug_usage_export.md"
OS_CYCLING_PATH = "health/cardio/cycling_data.md"

SUBSTANCE_KEYWORDS = {
    "cannabis": ["cone", "non packed", "non-packed", "joint", "jay", "brownie", "edible", "cannabis",
                 "weed", "kief", "hash", "charlottes", "cannabutter", "bong", "pipe", "pax", "vape",
                 "spliff", "toke", "dab", "herb", "haze", "come", "strain", "og ", "kush", "green"],
    "psilocybin": ["shroom", "mushroom", "mush", "lemon tek", " tek", "psilocyb", "magic"],
    "mdma": ["mdma", "molly", "ecstasy", "rolex", "xtc", "cap", "pill", "import"],
    "ketamine": ["ketamine", "k hole", "key k", "keys k", "ket"],
    "cocaine": ["coke", "cocaine", "key c", "keys c", "bump", "rack"],
    "lsd": ["tab", "acid", "lsd"],
    "amphetamine": ["dexi", "amphet", "speed"],
    "nitrous": ["nang", "nitrous", "balloon"],
    "alcohol": ["vodka", "beer", "wine", "spirit", "bourbon", "crown", "red bull", "drinks"],
}

# Single-letter shorthands checked after keyword pass (more ambiguous)
SUBSTANCE_SHORTHANDS = {
    "k": "ketamine",
    "c": "cocaine",
    "m": "mdma",
}


def classify_substance(text: str) -> str | None:
    """Return substance name or None if unclassifiable (caller inherits previous)."""
    lower = text.lower().strip()
    for substance, keywords in SUBSTANCE_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return substance
    # Check if the entire remainder (stripped of timestamps/quantities) is a single shorthand
    # e.g. "K", "1 key K", "22:22 K", " C"
    core = re.sub(r"[\d:]+\s*", "", lower).strip().rstrip("s")  # remove numbers, times, plural s
    core = re.sub(r"\b\d+\s*(key|keys|bump|line|cap|tab)s?\b", "", core).strip()
    if core in SUBSTANCE_SHORTHANDS:
        return SUBSTANCE_SHORTHANDS[core]
    return None


# ── CPAP ──────────────────────────────────────────────────────────────────────

def parse_total_time(s: str) -> float | None:
    """HH:MM:SS → decimal hours."""
    if not s:
        return None
    parts = s.split(":")
    try:
        h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
        return round(h + m / 60 + sec / 3600, 4)
    except (ValueError, IndexError):
        return None


def parse_dt(s: str) -> str | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _f(s: str) -> float | None:
    try:
        v = float(s)
        return v if v != 0 else None
    except (ValueError, TypeError):
        return None


def _i(s: str) -> int | None:
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def parse_cpap(path: Path) -> list[dict]:
    rows = []
    with open(path) as f:
        for row in csv.DictReader(f):
            rows.append({
                "date": row["Date"],
                "session_count": _i(row.get("Session Count", "")),
                "start_time": parse_dt(row.get("Start", "")),
                "end_time": parse_dt(row.get("End", "")),
                "total_hours": parse_total_time(row.get("Total Time", "")),
                "ahi": _f(row.get("AHI", "")),
                "oa_count": _i(row.get("OA Count", "")),
                "ca_count": _i(row.get("CA Count", "")),
                "h_count": _i(row.get("H Count", "")),
                "ua_count": _i(row.get("UA Count", "")),
                "fl_count": _i(row.get("FL Count", "")),
                "median_pressure": _f(row.get("Median Pressure", "")),
                "pressure_95": _f(row.get("95% Pressure", "")),
                "pressure_995": _f(row.get("99.5% Pressure", "")),
            })
    return rows


# ── Substances ────────────────────────────────────────────────────────────────

def classify_substance(text: str) -> str:
    lower = text.lower()
    for substance, keywords in SUBSTANCE_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return substance
    return "other"


def parse_date_from_line(line: str, current_year: int) -> tuple[str | None, str | None, str]:
    """Return (date_str, timestamp_str, remainder)."""
    line = line.strip()

    # Compact timestamp: YYYYMMDDhhmm e.g. 202101010215
    m = re.match(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\s+(.*)", line)
    if m:
        yr, mo, dy, hh, mm, rest = m.groups()
        d = f"{yr}-{mo}-{dy}"
        try:
            datetime.strptime(d, "%Y-%m-%d")
        except ValueError:
            return None, None, rest  # invalid date (e.g. typo like day=37)
        ts = f"{d}T{hh}:{mm}:00+08:00"
        return d, ts, rest

    # Full ISO datetime: 2020-04-26 0415
    m = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(\d{4})\s+(.*)", line)
    if m:
        d, t, rest = m.group(1), m.group(2), m.group(3)
        ts = f"{d}T{t[:2]}:{t[2:]}:00+08:00"
        return d, ts, rest

    # Full ISO date: 2020-04-26 or 2020-04-26 20:15
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*(.*)", line)
    if m:
        d, t, rest = m.group(1), m.group(2), m.group(3)
        ts = f"{d}T{t}:00+08:00" if t else None
        return d, ts, rest

    # DD/MM or D/M (infer year from context)
    m = re.match(r"^(\d{1,2})/(\d{1,2})\s*(.*)", line)
    if m:
        day, month, rest = int(m.group(1)), int(m.group(2)), m.group(3)
        try:
            d = f"{current_year}-{month:02d}-{day:02d}"
            datetime.strptime(d, "%Y-%m-%d")
            return d, None, rest
        except ValueError:
            pass

    # Time-only line (HH:MM): continuation of previous date
    m = re.match(r"^(\d{1,2}:\d{2})\s+(.*)", line)
    if m:
        return None, None, line  # no date parsed, keep full line as note

    return None, None, line


def parse_substances(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    rows = []
    current_year = 2018
    current_date = None
    last_substance = None

    for line in lines:
        line = line.strip()
        if not line or line in ("Record",):
            continue

        # Update year context from any full ISO date
        m = re.match(r"^(\d{4})-\d{2}-\d{2}", line)
        if m:
            current_year = int(m.group(1))

        date_str, ts_str, remainder = parse_date_from_line(line, current_year)

        if date_str:
            current_date = date_str
        elif not remainder:
            continue

        if not remainder.strip():
            continue

        substance = classify_substance(remainder or line)
        if substance is None:
            # Inherit the most recent classified substance
            substance = last_substance or "other"
        else:
            last_substance = substance

        rows.append({
            "date": current_date,
            "timestamp": ts_str,
            "substance": substance,
            "amount_raw": (remainder or line).strip()[:200],
            "notes": None,
            "raw_line": line[:500],
        })

    return rows


# ── Cycling ───────────────────────────────────────────────────────────────────

def parse_duration_seconds(s: str) -> int | None:
    """'2:28:26' or '43:04' → seconds."""
    s = s.strip()
    parts = s.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        pass
    return None


def parse_ride_date(s: str) -> str | None:
    """'Sun, 4/28/2024' → '2024-04-28'"""
    s = s.strip()
    m = re.match(r"\w+,\s+(\d+)/(\d+)/(\d+)", s)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{year}-{month:02d}-{day:02d}"
    return None


def parse_cycling(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line.startswith("Ride"):
            continue
        parts = re.split(r"\t+", line)
        # Format: Ride \t Date \t Name \t Duration \t Distance \t Elevation
        if len(parts) < 6:
            continue
        date_str = parse_ride_date(parts[1])
        if not date_str:
            continue
        dist_raw = parts[4].replace(" km", "").replace(",", ".").strip()
        elev_raw = parts[5].replace(" m", "").replace(",", "").strip()
        try:
            dist = float(dist_raw) if dist_raw else None
        except ValueError:
            dist = None
        try:
            elev = int(float(elev_raw)) if elev_raw else None
        except ValueError:
            elev = None
        rows.append({
            "date": date_str,
            "name": parts[2].strip() or None,
            "duration_seconds": parse_duration_seconds(parts[3]),
            "distance_km": dist,
            "elevation_m": elev,
        })
    return rows


# ── Upsert ────────────────────────────────────────────────────────────────────

def upsert_batches(sb, table: str, rows: list[dict], conflict: str | None) -> int:
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        if conflict:
            sb.table(table).upsert(batch, on_conflict=conflict).execute()
        else:
            sb.table(table).insert(batch).execute()
    return len(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--os-repo", required=True, help="Path to the os repo root")
    parser.add_argument("--only", choices=["cpap", "substances", "cycling"], help="Run only one section")
    args = parser.parse_args()

    os_root = Path(args.os_repo).expanduser()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    if not args.only or args.only == "cpap":
        rows = parse_cpap(os_root / OS_CPAP_PATH)
        print(f"  cpap_daily: parsed {len(rows)} rows")
        n = upsert_batches(sb, "cpap_daily", rows, "date")
        print(f"  cpap_daily: {n} rows upserted.")

    if not args.only or args.only == "substances":
        rows = parse_substances(os_root / OS_DRUGS_PATH)
        print(f"  substance_logs: parsed {len(rows)} rows")
        # insert-only (bigserial pk, no natural dedup key)
        n = upsert_batches(sb, "substance_logs", rows, None)
        print(f"  substance_logs: {n} rows inserted.")

    if not args.only or args.only == "cycling":
        rows = parse_cycling(os_root / OS_CYCLING_PATH)
        print(f"  cycling_logs: parsed {len(rows)} rows")
        n = upsert_batches(sb, "cycling_logs", rows, "date,name,duration_seconds")
        print(f"  cycling_logs: {n} rows upserted.")

    print("Done.")


if __name__ == "__main__":
    main()
