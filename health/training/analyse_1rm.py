"""
Lifetime e1RM per exercise across all training history.

Builds from set-level data (more accurate than the pre-aggregated monthly
CSV) and applies two corrections for credible numbers:

1. **Rep cap at 12.** Epley becomes unreliable beyond ~10-12 reps; drop
   sets and lengthened partials with 15-30 reps would otherwise inflate
   e1RM. Reps above 12 are clamped to 12 in the formula.
2. **Outlier filter.** For each exercise, the median of "top-set weight
   per session" is computed. Any session whose top weight is > 2.5× the
   median is flagged and excluded from the lifetime-best calc (likely
   data-entry error, e.g. forgetting a decimal point).

Sources:
- 2026:    health/training/workouts/*.json  (per-workout, set-level)
- Pre-2026: tools/data_migration/final/hevy_import.csv  (Strong/Repcount
            export migrated into Hevy)

Output: health/training/1rm.md
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent.parent
WORKOUTS_2026 = ROOT / "health" / "training" / "workouts" / "2026"
HEVY_IMPORT_CSV = ROOT / "tools" / "data_migration" / "final" / "hevy_import.csv"
OUT = ROOT / "health" / "training" / "1rm.md"

REP_CAP = 12
OUTLIER_MULTIPLIER = 2.5  # drop sessions whose top weight > 2.5× exercise median


def normalise(name: str) -> str:
    """Loose normalisation for matching across Strong/Hevy naming differences.

    Hevy adds parenthetical suffixes like '(Barbell)', '(Machine)', '(Dumbbell)'
    which Strong's exports often omit. We keep the user-visible name as-is in
    the report but match on the normalised form.
    """
    n = name.strip().lower()
    n = re.sub(r"\([^)]+\)", "", n)
    n = re.sub(r"[^a-z0-9]+", " ", n)
    return n.strip()


def epley(weight: float, reps: int) -> float:
    capped = min(reps, REP_CAP)
    return weight * (1 + capped / 30)


def collect_sets() -> list[dict]:
    """Return a flat list of working sets: {date, exercise, weight, reps}."""
    sets = []

    # 2026 from per-workout JSONs
    if WORKOUTS_2026.exists():
        for p in WORKOUTS_2026.glob("*.json"):
            w = json.loads(p.read_text())
            d = w["start_time"][:10]
            for ex in w.get("exercises", []):
                title = ex.get("title", "")
                for s in ex.get("sets", []):
                    if s.get("type") == "warmup":
                        continue
                    wt = s.get("weight_kg")
                    rp = s.get("reps")
                    if not wt or not rp:
                        continue
                    sets.append({"date": d, "exercise": title, "weight": float(wt), "reps": int(rp)})

    # Pre-2026 from migrated CSV
    if HEVY_IMPORT_CSV.exists():
        for r in csv.DictReader(HEVY_IMPORT_CSV.open()):
            d = r["Date"][:10]
            if d >= "2026-01-01":
                continue  # 2026 covered by JSONs
            title = r["Exercise Name"]
            try:
                wt = float(r["Weight"] or 0)
                rp = int(float(r["Reps"] or 0))
            except ValueError:
                continue
            if wt <= 0 or rp <= 0:
                continue
            sets.append({"date": d, "exercise": title, "weight": wt, "reps": rp})

    return sets


def build_report(sets: list[dict]) -> str:
    # Group by normalised name; remember the most recent display title.
    grouped: dict[str, dict] = defaultdict(lambda: {
        "display_name": "",
        "last_seen": "",
        "sets": [],
    })
    for s in sets:
        key = normalise(s["exercise"])
        g = grouped[key]
        g["sets"].append(s)
        if s["date"] >= g["last_seen"]:
            g["last_seen"] = s["date"]
            g["display_name"] = s["exercise"]

    rows = []
    for key, g in grouped.items():
        # Per-session top weight, for outlier detection
        by_session: dict[str, float] = defaultdict(float)
        for s in g["sets"]:
            if s["weight"] > by_session[s["date"]]:
                by_session[s["date"]] = s["weight"]
        if not by_session:
            continue
        med = median(by_session.values())

        # Best e1RM with outlier-suspect sessions excluded
        best = None  # (e1rm, weight, reps, date, suspect)
        suspect_best = None  # (e1rm, weight, reps, date) -- for footnote
        for s in g["sets"]:
            e1 = epley(s["weight"], s["reps"])
            session_top = by_session[s["date"]]
            is_outlier = med > 0 and session_top > OUTLIER_MULTIPLIER * med
            if is_outlier:
                if not suspect_best or e1 > suspect_best[0]:
                    suspect_best = (e1, s["weight"], s["reps"], s["date"])
                continue
            if not best or e1 > best[0]:
                best = (e1, s["weight"], s["reps"], s["date"])

        if not best:
            continue
        e1, w, r, d = best
        sessions = len(by_session)
        rows.append({
            "exercise": g["display_name"],
            "e1rm": e1,
            "set_w": w,
            "set_r": r,
            "set_date": d,
            "sessions": sessions,
            "max_weight": max(by_session.values()),
            "last_seen": g["last_seen"],
            "suspect_best": suspect_best,
        })

    rows.sort(key=lambda r: (-r["e1rm"], -r["max_weight"], r["exercise"]))

    lines = [
        "# Estimated 1RM by exercise",
        "",
        f"_Generated {date.today()} from set-level training history "
        f"(`health/training/workouts/2026/*.json` for 2026, "
        f"`tools/data_migration/final/hevy_import.csv` for 2019–2025)._",
        "",
        f"**{len(rows)} exercises** with at least one working set.",
        "",
        f"**Methodology:**",
        f"- e1RM = Epley formula, `weight × (1 + min(reps, {REP_CAP}) / 30)`.",
        f"  Reps are capped at **{REP_CAP}** because Epley becomes unreliable on "
        f"longer sets (and drop sets / lengthened partials with 15–30 reps "
        f"would otherwise inflate the estimate).",
        f"- Warmup sets are excluded (Hevy `type == \"warmup\"`).",
        f"- Outlier filter: any session whose top weight is more than "
        f"{OUTLIER_MULTIPLIER:.1f}× the exercise's per-session-top median is "
        f"flagged as a probable data-entry error and excluded from the "
        f"lifetime best. Such cases get a footnote (`†`).",
        "",
        "| Rank | Exercise | e1RM (kg) | From set | Date | Last trained | Sessions |",
        "| ---: | --- | ---: | --- | --- | --- | ---: |",
    ]
    notes: list[str] = []
    for i, r in enumerate(rows, 1):
        marker = ""
        if r["suspect_best"] and r["suspect_best"][0] > r["e1rm"]:
            marker = " †"
            sw, sr, sd = r["suspect_best"][1:4]
            notes.append(
                f"- **{r['exercise']}** †: a session on {sd} logged "
                f"{sw} kg × {sr}, which is far above the typical range for "
                f"this lift — likely a data-entry error, excluded from the "
                f"lifetime best."
            )
        lines.append(
            f"| {i} | {r['exercise']}{marker} | **{r['e1rm']:.1f}** | "
            f"{r['set_w']:.1f} kg × {r['set_r']} | {r['set_date']} | "
            f"{r['last_seen']} | {r['sessions']} |"
        )

    if notes:
        lines += ["", "### Flagged outliers", ""] + notes

    return "\n".join(lines) + "\n"


def main() -> None:
    sets = collect_sets()
    if not sets:
        raise SystemExit("no sets found")
    report = build_report(sets)
    OUT.write_text(report)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
