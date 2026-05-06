"""
Migrate Repcount + Strong CSV exports into a single Hevy-importable Strong-format CSV.

Reads from data_migration/source/ (read-only). Writes:
- data_migration/working/repcount_as_strong.csv  (repcount converted to Strong schema)
- data_migration/working/strong_cleansed.csv     (strong with durations > 2h capped to 2h)
- data_migration/final/hevy_import.csv           (concatenation of the above, chronological)
"""

from __future__ import annotations

import csv
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source"
WORKING = ROOT / "working"
FINAL = ROOT / "final"

REPCOUNT_IN = SRC / "repcount_export_5_May_2026.csv"
STRONG_IN = SRC / "strong_workouts.csv"
REPCOUNT_OUT = WORKING / "repcount_as_strong.csv"
STRONG_OUT = WORKING / "strong_cleansed.csv"
FINAL_OUT = FINAL / "hevy_import.csv"

STRONG_HEADER = [
    "Date", "Workout Name", "Duration", "Exercise Name", "Set Order",
    "Weight", "Reps", "Distance", "Seconds", "Notes", "Workout Notes", "RPE",
]

DURATION_CAP_MINUTES = 120  # 2 hours


def format_duration(total_minutes: int) -> str:
    """Format minutes as Strong-style 'Xh Ym' / 'Xh' / 'Ym'. Empty if 0."""
    if total_minutes <= 0:
        return ""
    h, m = divmod(total_minutes, 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


_DURATION_RE = re.compile(r"^(?:(\d+)h)?\s*(?:(\d+)m)?$")


def parse_duration(s: str) -> int:
    """Parse Strong-style duration ('1h 39m', '45m', '2h') into total minutes."""
    s = s.strip()
    if not s:
        return 0
    m = _DURATION_RE.match(s)
    if not m:
        return 0
    h = int(m.group(1) or 0)
    mins = int(m.group(2) or 0)
    return h * 60 + mins


def cap_duration(s: str) -> str:
    total = parse_duration(s)
    if total > DURATION_CAP_MINUTES:
        return format_duration(DURATION_CAP_MINUTES)
    return s


def to_float_str(v: str, default: str = "0.0") -> str:
    """Normalize numeric string to a float-formatted string ('60' -> '60.0')."""
    v = (v or "").strip()
    if v == "":
        return default
    try:
        return f"{float(v)}"
    except ValueError:
        return default


def normalize_repcount_timestamp(ts: str) -> str:
    """Repcount timestamps are 'YYYY-MM-DD HH:MM' — pad seconds for Strong format."""
    ts = ts.strip()
    if not ts:
        return ""
    try:
        dt = datetime.strptime(ts, "%Y-%m-%d %H:%M")
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        # Already has seconds, or some other format — return as-is
        return ts


def compute_repcount_duration(start: str, end: str) -> str:
    """Compute Strong-style duration string from repcount Workout Start/End."""
    start, end = start.strip(), end.strip()
    if not start or not end:
        return ""
    try:
        s = datetime.strptime(start, "%Y-%m-%d %H:%M")
        e = datetime.strptime(end, "%Y-%m-%d %H:%M")
    except ValueError:
        return ""
    total_min = max(0, int((e - s).total_seconds() // 60))
    if total_min > DURATION_CAP_MINUTES:
        total_min = DURATION_CAP_MINUTES
    return format_duration(total_min)


def convert_repcount(in_path: Path) -> list[list[str]]:
    """Read repcount CSV and return rows in Strong schema. Set Order is derived
    by counting consecutive sets per (Workout Start, Exercise) in source order."""
    out_rows: list[list[str]] = []
    set_counters: dict[tuple[str, str], int] = defaultdict(int)

    with in_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            start = row["Workout Start"]
            end = row["Workout End"]
            exercise = (row["Exercise"] or "").strip()
            workout_name = (row["Name"] or "").strip()

            key = (start, exercise)
            set_counters[key] += 1
            set_order = set_counters[key]

            date = normalize_repcount_timestamp(start)
            duration = compute_repcount_duration(start, end)

            weight = to_float_str(row.get("Weight", ""))
            reps = to_float_str(row.get("Reps", ""))
            distance = "0"
            seconds = "0.0"
            notes = (row.get("Notes") or "").strip()

            out_rows.append([
                date,
                workout_name,
                duration,
                exercise,
                str(set_order),
                weight,
                reps,
                distance,
                seconds,
                notes,
                "",  # Workout Notes (not in repcount)
                "",  # RPE (not in repcount)
            ])
    return out_rows


def cleanse_strong(in_path: Path) -> list[list[str]]:
    """Read strong CSV and cap any Duration > 2h to '2h'. Pass everything else through."""
    out_rows: list[list[str]] = []
    with in_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row["Duration"] = cap_duration(row.get("Duration", ""))
            out_rows.append([row.get(col, "") for col in STRONG_HEADER])
    return out_rows


def write_csv(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(STRONG_HEADER)
        writer.writerows(rows)


def main() -> None:
    repcount_rows = convert_repcount(REPCOUNT_IN)
    write_csv(REPCOUNT_OUT, repcount_rows)
    print(f"wrote {REPCOUNT_OUT.relative_to(ROOT)}: {len(repcount_rows)} rows")

    strong_rows = cleanse_strong(STRONG_IN)
    write_csv(STRONG_OUT, strong_rows)
    print(f"wrote {STRONG_OUT.relative_to(ROOT)}: {len(strong_rows)} rows")

    combined = sorted(repcount_rows + strong_rows, key=lambda r: r[0])
    write_csv(FINAL_OUT, combined)
    print(f"wrote {FINAL_OUT.relative_to(ROOT)}: {len(combined)} rows")


if __name__ == "__main__":
    main()
