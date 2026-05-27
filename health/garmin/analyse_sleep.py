"""
Personal-tracking sleep analysis.

Mirrors analyse_hr.py — aggregates per-night Garmin sleep data across:
1. Retatrutide dosing phase
2. Workout day (training-night) vs rest-day
3. Day-of-week pattern
4. Sleep continuity (awake minutes, restless moments)

Reads:
- garmin/sleep_summary.csv
- garmin/workout_hr_aligned.csv

Writes:
- garmin/sleep_analysis.md
"""

from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parent.parent
GARMIN = ROOT / "garmin"

# Retatrutide phase windows (matches analyse_hr.py)
PHASES = [
    ("2025-09-01", "2025-12-15", "Pre-reta (Sep–14 Dec 2025)"),
    ("2025-12-15", "2026-02-02", "Init escalation (0.5 → 2 mg)"),
    ("2026-02-02", "2026-02-23", "Maintenance (2 mg, 3 weeks)"),
    ("2026-02-23", "2026-03-16", "Overseas pause"),
    ("2026-03-16", "2026-05-04", "Re-escalation (1 → 3 mg)"),
    ("2026-05-04", "2026-05-25", "Peak (4 mg, 3 weeks)"),
    ("2026-05-25", None, "Taper (3 mg ↓)"),
]


def to_float(v):
    if v in ("", None):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_int(v):
    f = to_float(v)
    return None if f is None else int(f)


def stats(vals, *, dp: int = 1):
    clean = [v for v in vals if v is not None]
    if not clean:
        return (0, None, None, None)
    return (len(clean), round(min(clean), dp), round(mean(clean), dp), round(max(clean), dp))


def fmt(v):
    return "" if v is None else str(v)


def fmt_min(m):
    if m is None:
        return ""
    m = int(round(m))
    return f"{m // 60} h {m % 60:02d}m"


def load_sleep() -> list[dict]:
    rows = list(csv.DictReader((GARMIN / "sleep_summary.csv").open()))
    out = []
    for r in rows:
        total = to_int(r.get("total_min"))
        if not total:
            continue
        awake = to_int(r.get("awake_min")) or 0
        deep = to_int(r.get("deep_min")) or 0
        rem = to_int(r.get("rem_min")) or 0
        out.append({
            "date": r["date"],
            "total_min": total,
            "deep_min": deep,
            "light_min": to_int(r.get("light_min")) or 0,
            "rem_min": rem,
            "awake_min": awake,
            "sleep_min": total - awake,
            "efficiency_pct": round((total - awake) * 100 / total, 1) if total else None,
            "deep_rem_min": deep + rem,
            "respiration": to_float(r.get("avg_respiration")),
            "stress": to_float(r.get("avg_sleep_stress")),
            "overall_score": to_int(r.get("overall_score")),
            "quality_score": to_int(r.get("quality_score")),
            "recovery_score": to_int(r.get("recovery_score")),
            "restless": to_int(r.get("restless_moments")),
        })
    return out


def load_workout_dates() -> set[str]:
    return {r["date"] for r in csv.DictReader((GARMIN / "workout_hr_aligned.csv").open())}


def section_headline(sleep: list[dict]) -> list[str]:
    pre = [r["total_min"] for r in sleep if "2025-09-01" <= r["date"] < "2025-12-15"]
    cur = [r["total_min"] for r in sleep if "2026-05-01" <= r["date"]]
    pre_score = [r["overall_score"] for r in sleep if "2025-09-01" <= r["date"] < "2025-12-15" and r["overall_score"]]
    cur_score = [r["overall_score"] for r in sleep if "2026-05-01" <= r["date"] and r["overall_score"]]

    n_pre, _, avg_pre_min, _ = stats(pre, dp=0)
    n_cur, _, avg_cur_min, _ = stats(cur, dp=0)
    _, _, avg_pre_score, _ = stats(pre_score, dp=0)
    _, _, avg_cur_score, _ = stats(cur_score, dp=0)

    delta_min = (avg_cur_min or 0) - (avg_pre_min or 0) if avg_pre_min and avg_cur_min else None
    delta_score = (avg_cur_score or 0) - (avg_pre_score or 0) if avg_pre_score and avg_cur_score else None

    return [
        "## Headline",
        "",
        f"- **Pre-reta (Sep–14 Dec 2025):** {fmt_min(avg_pre_min)} avg sleep, "
        f"score {avg_pre_score} (n={n_pre})",
        f"- **Current (May 2026):** {fmt_min(avg_cur_min)} avg sleep, "
        f"score {avg_cur_score} (n={n_cur})",
        f"- **Net change:** "
        f"{'+' if (delta_min or 0) >= 0 else ''}{int(delta_min) if delta_min else '?'} min sleep, "
        f"{'+' if (delta_score or 0) >= 0 else ''}{delta_score if delta_score else '?'} points score",
        "",
    ]


def section_monthly(sleep: list[dict]) -> list[str]:
    by_month: dict[str, list[dict]] = {}
    for r in sleep:
        if r["date"] < "2025-09-01":
            continue
        by_month.setdefault(r["date"][:7], []).append(r)
    lines = [
        "## Monthly trend (Sep 2025 onward)",
        "",
        "| Month | Nights | Total avg | Deep+REM avg | Awake avg | Efficiency | Score |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for m in sorted(by_month):
        recs = by_month[m]
        _, _, total_avg, _ = stats([r["total_min"] for r in recs], dp=0)
        _, _, dr_avg, _ = stats([r["deep_rem_min"] for r in recs], dp=0)
        _, _, awake_avg, _ = stats([r["awake_min"] for r in recs], dp=0)
        _, _, eff_avg, _ = stats([r["efficiency_pct"] for r in recs if r["efficiency_pct"]], dp=1)
        _, _, score_avg, _ = stats([r["overall_score"] for r in recs if r["overall_score"]], dp=0)
        lines.append(
            f"| {m} | {len(recs)} | {fmt_min(total_avg)} | {fmt_min(dr_avg)} | "
            f"{fmt_min(awake_avg)} | {eff_avg}% | {score_avg} |"
        )
    return lines + [""]


def section_by_phase(sleep: list[dict]) -> list[str]:
    lines = [
        "## By retatrutide phase",
        "",
        "| Phase | Nights | Total avg | Deep+REM avg | Respiration avg | Efficiency | Score |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for start, end, label in PHASES:
        recs = [
            r for r in sleep
            if (start is None or r["date"] >= start) and (end is None or r["date"] < end)
        ]
        if not recs:
            lines.append(f"| {label} | 0 | | | | | |")
            continue
        _, _, t_avg, _ = stats([r["total_min"] for r in recs], dp=0)
        _, _, dr_avg, _ = stats([r["deep_rem_min"] for r in recs], dp=0)
        _, _, resp_avg, _ = stats([r["respiration"] for r in recs if r["respiration"]], dp=1)
        _, _, eff_avg, _ = stats([r["efficiency_pct"] for r in recs if r["efficiency_pct"]], dp=1)
        _, _, score_avg, _ = stats([r["overall_score"] for r in recs if r["overall_score"]], dp=0)
        lines.append(
            f"| {label} | {len(recs)} | {fmt_min(t_avg)} | {fmt_min(dr_avg)} | "
            f"{fmt(resp_avg)} | {fmt(eff_avg)}% | {fmt(score_avg)} |"
        )
    return lines + [""]


def section_workout_effect(sleep: list[dict]) -> list[str]:
    workout_dates = load_workout_dates()
    in_2026 = [r for r in sleep if r["date"] >= "2026-01-01"]

    # Sleep row dated D corresponds to the night that ended on the morning of D.
    # Trained on date X (late evening) → impacted sleep is sleep row D = X+1
    # (the night starting evening of X). Compute by shifting.
    from datetime import timedelta
    workout_nights = set()
    for d in workout_dates:
        try:
            nxt = (datetime.fromisoformat(d) + timedelta(days=1)).strftime("%Y-%m-%d")
            workout_nights.add(nxt)
        except ValueError:
            pass

    train_nights = [r for r in in_2026 if r["date"] in workout_nights]
    rest_nights = [r for r in in_2026 if r["date"] not in workout_nights]

    def summarise(label: str, recs: list[dict]) -> str:
        if not recs:
            return f"- **{label}:** no data"
        _, _, total_avg, _ = stats([r["total_min"] for r in recs], dp=0)
        _, _, dr_avg, _ = stats([r["deep_rem_min"] for r in recs], dp=0)
        _, _, awake_avg, _ = stats([r["awake_min"] for r in recs], dp=0)
        _, _, score_avg, _ = stats([r["overall_score"] for r in recs if r["overall_score"]], dp=0)
        return (
            f"- **{label} (n={len(recs)}):** {fmt_min(total_avg)} total, "
            f"{fmt_min(dr_avg)} deep+REM, {fmt_min(awake_avg)} awake, score {score_avg}"
        )

    return [
        "## Workout effect on sleep (2026 only)",
        "",
        "Workouts in this dataset are nearly all late-evening training (per the "
        "profile, 9–10 pm local). \"Training night\" = the sleep window that "
        "starts the evening of the workout.",
        "",
        summarise("Training nights", train_nights),
        summarise("Non-training nights", rest_nights),
        "",
    ]


def section_by_dow(sleep: list[dict]) -> list[str]:
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    by_dow: dict[int, list[dict]] = {i: [] for i in range(7)}
    for r in sleep:
        if r["date"] < "2025-09-01":
            continue
        try:
            dow = datetime.fromisoformat(r["date"]).weekday()
            by_dow[dow].append(r)
        except ValueError:
            continue
    lines = [
        "## By day of week (Sep 2025 onward)",
        "",
        "Sleep row dated D = the night that ENDED on the morning of D, so the "
        "Mon row is Sunday-night sleep, the Sat row is Friday-night sleep, etc.",
        "",
        "| Day | Nights | Total avg | Deep+REM avg | Awake avg | Score |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for i in range(7):
        recs = by_dow[i]
        if not recs:
            lines.append(f"| {days[i]} | 0 | | | | |")
            continue
        _, _, t_avg, _ = stats([r["total_min"] for r in recs], dp=0)
        _, _, dr_avg, _ = stats([r["deep_rem_min"] for r in recs], dp=0)
        _, _, a_avg, _ = stats([r["awake_min"] for r in recs], dp=0)
        _, _, s_avg, _ = stats([r["overall_score"] for r in recs if r["overall_score"]], dp=0)
        lines.append(
            f"| {days[i]} | {len(recs)} | {fmt_min(t_avg)} | {fmt_min(dr_avg)} | "
            f"{fmt_min(a_avg)} | {fmt(s_avg)} |"
        )
    return lines + [""]


def section_continuity(sleep: list[dict]) -> list[str]:
    recent = [r for r in sleep if r["date"] >= "2025-09-01"]
    n_short = sum(1 for r in recent if r["total_min"] < 360)
    n_mid = sum(1 for r in recent if 360 <= r["total_min"] < 420)
    n_seven = sum(1 for r in recent if 420 <= r["total_min"] < 480)
    n_eight = sum(1 for r in recent if r["total_min"] >= 480)
    total = len(recent)
    _, _, awake_avg, _ = stats([r["awake_min"] for r in recent], dp=0)
    _, _, restless_avg, _ = stats([r["restless"] for r in recent if r["restless"]], dp=0)

    return [
        "## Sleep continuity & distribution (Sep 2025 onward)",
        "",
        f"- **Nights tracked:** {total}",
        f"- **Under 6 h:** {n_short} ({round(100*n_short/total)}%)",
        f"- **6–7 h:** {n_mid} ({round(100*n_mid/total)}%)",
        f"- **7–8 h:** {n_seven} ({round(100*n_seven/total)}%)",
        f"- **8 h or more:** {n_eight} ({round(100*n_eight/total)}%)",
        f"- **Average awake-during-night minutes:** {awake_avg} min",
        f"- **Average restless moments per night:** {restless_avg}",
        "",
    ]


def section_notable_nights(sleep: list[dict]) -> list[str]:
    recent = [r for r in sleep if r["date"] >= "2025-09-01"]
    recent_scored = [r for r in recent if r["overall_score"] is not None]
    worst = sorted(recent_scored, key=lambda r: r["overall_score"])[:5]
    best = sorted(recent_scored, key=lambda r: -r["overall_score"])[:5]
    short = sorted(recent, key=lambda r: r["total_min"])[:5]

    def render(label, rows, key):
        out = [f"### {label}", "", "| Date | Total | Deep+REM | Awake | Score |",
               "| --- | ---: | ---: | ---: | ---: |"]
        for r in rows:
            out.append(
                f"| {r['date']} | {fmt_min(r['total_min'])} | "
                f"{fmt_min(r['deep_rem_min'])} | {fmt_min(r['awake_min'])} | "
                f"{fmt(r['overall_score'])} |"
            )
        return out + [""]

    return ["## Notable nights"] + [""] + render("Lowest 5 sleep scores", worst, "overall_score") + \
        render("Highest 5 sleep scores", best, "overall_score") + \
        render("Shortest 5 nights", short, "total_min")


def main() -> None:
    sleep = load_sleep()

    out_lines = [
        "# Sleep analysis",
        "",
        f"_Generated {date.today()} from `garmin/sleep_summary.csv` and "
        f"`garmin/workout_hr_aligned.csv`._",
        "",
        "Personal-tracking analysis. Sleep stage and respiration data are "
        "Garmin-derived (movement + HR + occasional SpO₂) — directionally "
        "useful but not PSG-accurate. ResMed CPAP usage runs ~35–45 min higher "
        "than Garmin in recent windows (mask on before sleep onset); see "
        "`sleep_cpap_compare.md`.",
        "",
    ]
    out_lines += section_headline(sleep)
    out_lines += section_monthly(sleep)
    out_lines += section_by_phase(sleep)
    out_lines += section_workout_effect(sleep)
    out_lines += section_by_dow(sleep)
    out_lines += section_continuity(sleep)
    out_lines += section_notable_nights(sleep)

    out_lines += [
        "## Takeaways",
        "",
        "- **Sleep duration is structurally short and hasn't really moved.** "
        "Pre-reta averaged 6 h 03 min; the current month is 6 h 16 min. The "
        "+13 min headline shift is noise. 43 % of all tracked nights since "
        "Sep 2025 are under 6 h, 74 % under 7 h. This is a schedule problem, "
        "not a physiology problem — reta hasn't changed it and won't.",
        "- **Sleep quality has improved meaningfully.** Garmin's overall score "
        "moved pre-reta 57 → recent 66 (+9 points). Even though duration is "
        "flat, the time you do spend asleep is scoring better. Plausible "
        "drivers: weight loss easing OSA burden, more deep+REM minutes "
        "(1 h 44 m → 2 h 12 m), tighter sleep efficiency (94.8 % → 96.5 %).",
        "- **Average overnight respiration is dropping with reta dose.** "
        "18.6 → 18.5 → 18.0 → 17.6 → 17.1 → 16.1 across the phases (pre to "
        "taper). That's a 2.5 breaths/min drop — a real signal, and consistent "
        "with the documented GLP-1 effect of lowering metabolic rate. Worth "
        "tracking whether respiration rebounds as you taper off.",
        "- **Late training costs ~26 min of sleep per session, not quality.** "
        "Training nights average 6 h 00 m vs 6 h 26 m on non-training nights. "
        "Same deep+REM, same score, less *awake* time — you sleep more "
        "efficiently when you do sleep, but you fall asleep later. At 4–5 "
        "training nights/week that's 100–130 min/week of total sleep traded "
        "for the late session.",
        "- **Tue–Thu nights are the bottleneck.** Tue 5 h 43 m, Wed 5 h 56 m, "
        "Thu 5 h 44 m — all noticeably below the Fri/Sat/Sun average of "
        "6 h 36 m. The mid-week dip lines up with the high-frequency training "
        "block you flagged in the profile (April 10-day streak). Sat night "
        "(6 h 46 m) is the only night that meaningfully recovers.",
        "- **Overseas pause was the worst sleep window in the dataset** "
        "(5 h 20 m avg, score 46, efficiency dropped to 89 %). Multiple "
        "confounds — travel, jet lag, different bed/CPAP setup, dietary "
        "shifts, no reta — so don't read it as a reta-effect.",
        "- **Tracking artefacts to ignore.** Several 0 h 17 m / 0 h 34 m "
        "\"sleep\" entries (lowest-score table) with 0 min awake are Garmin "
        "logging a brief horizontal period as a sleep session — not real "
        "nights. The script keeps them because the alternative is "
        "hand-curation, but treat anything under 2 h as suspect data.",
        "",
    ]

    (GARMIN / "sleep_analysis.md").write_text("\n".join(out_lines))
    print(f"wrote {GARMIN / 'sleep_analysis.md'}")


if __name__ == "__main__":
    main()
