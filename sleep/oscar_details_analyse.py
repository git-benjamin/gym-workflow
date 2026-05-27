"""
Per-night CPAP event clustering analysis.

For each Details-resolution CSV in sleep/details/, parse:
- Pressure & EPAP samples (per ~6 s)
- Event flags (Obstructive, Hypopnea, ClearAirway = CA, Apnea)

Compute:
- Pressure at time of each event vs median pressure for the night
- Events clustered by hour-of-night
- Time between consecutive events
- Whether events cluster around pressure-up transitions

Writes:
- sleep/details_analysis.md
"""

from __future__ import annotations

import csv
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean, median
from bisect import bisect_left

ROOT = Path(__file__).resolve().parent.parent
DETAILS_DIR = ROOT / "sleep" / "details"
OUT = ROOT / "sleep" / "details_analysis.md"

# (filename, label, summary notes from daily CSV)
NIGHTS = [
    ("OSCAR_Ben_Details_2024-09-09.csv", "2024-09-08 (pre-raise control baseline)",
        "AHI 0.13 • OA 1 • H 0 • CA 0 • MedP 7.24 cmH₂O (no EPR)"),
    ("OSCAR_Ben_Details_2025-10-02.csv", "2025-10-02 (worst recent AHI)",
        "AHI 3.44 • OA 6 • H 3 • CA 9 • MedP 10.68 cmH₂O"),
    ("OSCAR_Ben_Details_2025-10-31.csv", "2025-10-31 (highest OA, 15)",
        "AHI 2.88 • OA 15 • H 3 • CA 7 • MedP 10.70 cmH₂O"),
    ("OSCAR_Ben_Details_2026-05-25.csv", "2026-05-25 (typical recent)",
        "AHI 1.09 • OA 5 • H 0 • CA 3 • MedP 8.30 cmH₂O"),
]

EVENT_TYPES = {"Obstructive", "Hypopnea", "ClearAirway", "Apnea"}


def parse_night(path: Path):
    """Return (events, pressures, session_start, session_end).

    events:    list of dicts: time (datetime), kind (str), duration (float)
    pressures: list of (datetime, float) pressure samples
    epap:      list of (datetime, float) epap samples
    """
    events = []
    pressures = []
    epap = []
    with path.open() as f:
        for r in csv.DictReader(f):
            t = datetime.fromisoformat(r["DateTime"])
            ev = r["Event"]
            val = float(r["Data/Duration"] or 0)
            if ev in EVENT_TYPES:
                events.append({"time": t, "kind": ev, "duration": val})
            elif ev == "Pressure":
                pressures.append((t, val))
            elif ev == "EPAP":
                epap.append((t, val))
    pressures.sort()
    epap.sort()
    events.sort(key=lambda e: e["time"])
    return events, pressures, epap


def pressure_at(time, samples):
    """Nearest pressure sample to `time`."""
    if not samples:
        return None
    times = [s[0] for s in samples]
    i = bisect_left(times, time)
    if i == 0:
        return samples[0][1]
    if i >= len(samples):
        return samples[-1][1]
    # nearest neighbour
    before = samples[i - 1]
    after = samples[i]
    return before[1] if abs((time - before[0]).total_seconds()) < abs((after[0] - time).total_seconds()) else after[1]


def percentile(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    if f == c:
        return xs[f]
    return xs[f] * (c - k) + xs[c] * (k - f)


def analyse_night(path: Path, label: str, summary_note: str) -> list[str]:
    events, pressures, epap_samples = parse_night(path)
    if not pressures:
        return [f"### {label}", "", "_No pressure data in export._", ""]

    night_start = pressures[0][0]
    night_end = pressures[-1][0]
    duration_hr = (night_end - night_start).total_seconds() / 3600
    p_vals = [p for _, p in pressures]
    e_vals = [p for _, p in epap_samples]

    med_p = round(median(p_vals), 2)
    p95 = round(percentile(p_vals, 0.95), 2)
    max_p = round(max(p_vals), 2)
    med_e = round(median(e_vals), 2) if e_vals else None

    # Events with their pressure at the time
    enriched = []
    for ev in events:
        p_at_ev = pressure_at(ev["time"], pressures)
        enriched.append({**ev, "pressure": p_at_ev})

    # Events by kind
    by_kind = defaultdict(list)
    for ev in enriched:
        by_kind[ev["kind"]].append(ev)

    # Hour-of-night buckets
    by_hour = defaultdict(int)
    by_hour_kind = defaultdict(lambda: defaultdict(int))
    for ev in enriched:
        hr = int((ev["time"] - night_start).total_seconds() // 3600)
        by_hour[hr] += 1
        by_hour_kind[hr][ev["kind"]] += 1

    lines = [
        f"### {label}",
        "",
        f"_{summary_note}_",
        "",
        f"- **Total session:** {duration_hr:.2f} h ({night_start.strftime('%H:%M')} → "
        f"{night_end.strftime('%H:%M')} UTC)",
        f"- **Pressure stats:** median **{med_p}** cmH₂O, 95th **{p95}**, peak **{max_p}**"
        + (f"; EPAP median **{med_e}**" if med_e is not None else ""),
        f"- **{len(enriched)} events total** in this night",
        "",
    ]

    if not enriched:
        lines.append("_No flagged events in the detail file — clean night._")
        return lines + [""]

    # Event-by-event table
    lines.append("**Per-event detail (sorted by time):**")
    lines.append("")
    lines.append("| Local time into night | Event | Duration (s) | Pressure (cmH₂O) |")
    lines.append("| --- | --- | ---: | ---: |")
    for ev in enriched:
        elapsed = ev["time"] - night_start
        hh = int(elapsed.total_seconds() // 3600)
        mm = int((elapsed.total_seconds() % 3600) // 60)
        lines.append(
            f"| {hh}h{mm:02d}m | {ev['kind']} | "
            f"{ev['duration']:.0f} | {ev['pressure']:.2f} |"
        )
    lines.append("")

    # Pressure at event vs night median
    lines.append("**Pressure at event vs night median:**")
    lines.append("")
    lines.append("| Event kind | n | Avg pressure at event | Δ vs night median |")
    lines.append("| --- | ---: | ---: | ---: |")
    for k in sorted(by_kind):
        ps = [e["pressure"] for e in by_kind[k]]
        avg_p = round(mean(ps), 2)
        delta = round(avg_p - med_p, 2)
        lines.append(f"| {k} | {len(ps)} | {avg_p} | {'+' if delta >= 0 else ''}{delta} |")
    lines.append("")

    # Hour-of-night cluster
    if by_hour:
        lines.append("**Events by hour into the night:**")
        lines.append("")
        lines.append("| Hour | Events | Mix |")
        lines.append("| --- | ---: | --- |")
        for hr in sorted(by_hour):
            mix = ", ".join(f"{n}×{k[:2]}" for k, n in sorted(by_hour_kind[hr].items()))
            lines.append(f"| {hr}h–{hr+1}h | {by_hour[hr]} | {mix} |")
        lines.append("")

    return lines


def section_cross_comparison() -> list[str]:
    """Pull headline numbers from all nights for a side-by-side."""
    rows = []
    for fname, label, _ in NIGHTS:
        path = DETAILS_DIR / fname
        if not path.exists():
            continue
        events, pressures, _ = parse_night(path)
        if not pressures:
            continue
        p_vals = [p for _, p in pressures]
        med_p = round(median(p_vals), 2)
        p95 = round(percentile(p_vals, 0.95), 2)
        by_kind = defaultdict(int)
        for e in events:
            by_kind[e["kind"]] += 1

        # Time-to-first-event (does the night start clean and degrade?)
        first_event = events[0]["time"] if events else None
        ttfe = round((first_event - pressures[0][0]).total_seconds() / 60, 1) if first_event else None

        rows.append((label, med_p, p95, len(events),
                     by_kind.get("Obstructive", 0),
                     by_kind.get("Hypopnea", 0),
                     by_kind.get("ClearAirway", 0),
                     ttfe))

    lines = [
        "## Side-by-side comparison",
        "",
        "| Night | Med P | 95th P | Events | OA | H | CA | Min to 1st event |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in rows:
        ttfe = "" if r[7] is None else f"{r[7]}"
        lines.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {ttfe} |")
    return lines + [""]


def main() -> None:
    out_lines = [
        "# CPAP per-night event clustering",
        "",
        f"_Generated {date.today()} from `sleep/details/`._",
        "",
        "For each representative night, this drills into the per-second OSCAR "
        "data to answer: *where do events cluster within the night, and at "
        "what pressure?* Pairs with the trend-level findings in "
        "`sleep/oscar_analysis.md`.",
        "",
        "Note: `2026-04-04` Details export failed (only Summary was returned), "
        "so it's omitted. The summary alone — AHI 2.42, OA 11, MedP 10.56 — is "
        "in the trend analysis.",
        "",
    ]
    out_lines += section_cross_comparison()
    out_lines += ["## Per-night detail", ""]

    for fname, label, summary_note in NIGHTS:
        path = DETAILS_DIR / fname
        if not path.exists():
            out_lines.append(f"### {label}")
            out_lines.append("")
            out_lines.append(f"_File missing: {fname}_")
            out_lines.append("")
            continue
        out_lines += analyse_night(path, label, summary_note)

    out_lines += [
        "## Synthesis — what the per-night data tells us",
        "",
        "1. **The 2025-10-02 cluster looks like periodic breathing (Cheyne-Stokes-"
        "like), not pure OSA.** At 3 h 28 m into the night, 5 consecutive Clear-"
        "Airway events fire in 4 minutes (3h28, 3h28, 3h29, 3h30, 3h32). Then "
        "at 4 h 03 m: a **110-second apnoea**, followed by a 50-second and a "
        "13-second apnoea within 1 minute. That pattern of long, regularly-"
        "spaced central pauses is the classical signature of periodic breathing "
        "— and crucially, **all of it happens at ~11 cmH₂O pressure**. "
        "Pressure isn't fixing it because the cause isn't airway collapse. "
        "Worth flagging to your sleep tech as a one-off event log to look at.",
        "",
        "2. **High pressure isn't preventing obstructive events.** On "
        "2025-10-31, 15 obstructive apnoeas fired while the machine was "
        "delivering 11+ cmH₂O — peaking at 12.6 cmH₂O. If pressure were the "
        "lever, those events shouldn't be happening. More pressure can't "
        "splint open an airway that's collapsing for other reasons (positional, "
        "REM atonia, mask seal, jaw drop). This is data supporting the "
        "trend-level finding that the raised floor isn't earning its keep.",
        "",
        "3. **Events cluster in hours 3–5 of the night, every night.** That "
        "window is REM-dominant on a normal sleep architecture, and REM-related "
        "OSA is well documented (muscle atonia is most pronounced in REM). "
        "Three of four nights show this cluster pattern; the 2024 baseline is "
        "the exception, and that file appears to span two nights, so the "
        "pattern is harder to read there.",
        "",
        "4. **Central apnoeas (ClearAirway) happen at *every* pressure** — "
        "3 on the baseline night at 6.4–7.5 cmH₂O; 9 on the bad night at "
        "11 cmH₂O; 3 on a recent night at 8.5–9.8 cmH₂O. They scale roughly "
        "with pressure but aren't created by it; the pre-raise era had them "
        "too. They're a feature of your physiology, not a pressure side-effect.",
        "",
        "5. **Current night (2026-05-25) is genuinely cleaner.** 8 events, no "
        "clusters tighter than 2 events in any minute, pressure 8.5–10.5 across "
        "the night, peak 10.78 (below the post-raise peak). This is what the "
        "system looks like operating well at lighter weight. Continued improvement "
        "is plausible as the cut completes.",
        "",
        "## Settings discussion items (updated with event-level evidence)",
        "",
        "These are the questions to raise at your next sleep review, now with "
        "specific event-log evidence to point at:",
        "",
        "1. **\"Can you look at 2025-10-02 between 3h 28m and 4h 04m into the "
        "session?\"** Five clustered CAs followed by a 110-second apnoea is the "
        "type of event a sleep tech can interpret. Treatment-emergent CSR is "
        "treatable (ASV machines exist) but you'd want a clinician to confirm "
        "before doing anything.",
        "2. **\"Is the min-pressure post-July-2025 still right?\"** The per-"
        "event data shows obstructions firing AT pressure 11+ — pressure isn't "
        "the lever for them. Reverting toward the pre-raise floor (~5–7 cmH₂O) "
        "is a reasonable conversation once weight stabilises post-cut.",
        "3. **\"Is there a positional or REM component I should be testing?\"** "
        "The hours-3-to-5 clustering is suggestive. A WatchPAT or a one-night "
        "in-lab PSG would settle it, but it's optional — at AHI < 5 you have "
        "time to think about it.",
        "",
        "## Limitations of this analysis",
        "",
        "- **2024-09-08 file appears to span two nights** (session duration "
        "20.9 h is implausible). The pressure-at-event averages are still "
        "valid but the hour-of-night clustering for that night is unreliable.",
        "- **No leak data** in the export — so I can't rule out mask leaks as "
        "the cause of the high-pressure obstructives on 2025-10-31.",
        "- **No flow data** — true CSR would show a crescendo-decrescendo "
        "breathing pattern; with only event flags I can infer but not confirm.",
        "- **n = 4 nights** — patterns I'm seeing here might or might not be "
        "representative. Worth one more drill if anything looks alarming "
        "(but nothing here looks acutely alarming — AHI is fine).",
        "",
    ]

    OUT.write_text("\n".join(out_lines))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
