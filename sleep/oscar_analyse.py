"""
OSCAR CPAP daily-summary analysis.

Reads:
- sleep/DAILY_OSCAR_Ben_Summary_2019-12-23_2026-05-26.csv  (OSCAR Days export)
- weight_data/Measurement-Summary-2014-12-11-to-2026-05-06.csv (for the
  pressure-vs-weight correlation)

Writes:
- sleep/oscar_analysis.md
"""

from __future__ import annotations

import csv
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parent.parent
OSCAR_CSV = ROOT / "sleep" / "DAILY_OSCAR_Ben_Summary_2019-12-23_2026-05-26.csv"
WEIGHT_CSV = ROOT / "weight_data" / "Measurement-Summary-2014-12-11-to-2026-05-06.csv"
OUT = ROOT / "sleep" / "oscar_analysis.md"


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


def parse_hms(s: str) -> float:
    """'06:47:01' → hours."""
    if not s or ":" not in s:
        return 0.0
    h, m, sec = s.split(":")
    return int(h) + int(m) / 60 + int(sec) / 3600


def avg(xs):
    xs = [x for x in xs if x is not None]
    return None if not xs else round(sum(xs) / len(xs), 2)


def fmt(v, dp=2):
    return "" if v is None else f"{v:.{dp}f}"


def load_oscar() -> list[dict]:
    rows = []
    for r in csv.DictReader(OSCAR_CSV.open()):
        d = r["Date"]
        rows.append({
            "date": d,
            "session_count": to_int(r.get("Session Count")) or 0,
            "hours": parse_hms(r.get("Total Time", "")),
            "ahi": to_float(r.get("AHI")),
            "ca": to_int(r.get("CA Count")) or 0,
            "oa": to_int(r.get("OA Count")) or 0,
            "h": to_int(r.get("H Count")) or 0,
            "ua": to_int(r.get("UA Count")) or 0,
            "re": to_int(r.get("RE Count")) or 0,
            "fl": to_int(r.get("FL Count")) or 0,
            "med_p": to_float(r.get("Median Pressure")),
            "med_epap": to_float(r.get("Median EPAP")),
            "p95": to_float(r.get("95% Pressure")),
            "epap95": to_float(r.get("95% EPAP")),
            "p99": to_float(r.get("99.5% Pressure")),
        })
    return rows


def load_weight_by_date() -> dict[str, float]:
    out = {}
    for r in csv.DictReader(WEIGHT_CSV.open()):
        d = r.get("Date", "").strip()
        w = to_float(r.get("Weight"))
        if d and w:
            out[d] = w
    return out


def closest_weight(d: str, weights: dict[str, float], max_days: int = 14) -> float | None:
    """Find the weight measurement closest to date d, within max_days."""
    if not weights:
        return None
    try:
        dd = datetime.fromisoformat(d).date()
    except ValueError:
        return None
    best = None
    for k, w in weights.items():
        try:
            kd = datetime.fromisoformat(k).date()
            delta = abs((kd - dd).days)
            if delta > max_days:
                continue
            if best is None or delta < best[1]:
                best = (w, delta)
        except ValueError:
            continue
    return best[0] if best else None


def section_headline(rows: list[dict]) -> list[str]:
    last30 = [r for r in rows if r["date"] >= "2026-04-27"]
    last90 = [r for r in rows if r["date"] >= "2026-02-26"]
    total_hours = sum(r["hours"] for r in rows)
    nights = len([r for r in rows if r["hours"] > 0])

    return [
        "## Headline",
        "",
        f"- **{nights} tracked nights** between {rows[0]['date']} and {rows[-1]['date']} — "
        f"{round(total_hours)} total hours on therapy (~{round(total_hours / 24)} days of CPAP time).",
        f"- **Lifetime avg AHI:** {avg([r['ahi'] for r in rows])} events/hr — well "
        f"under the clinical threshold of 5.",
        f"- **Last 30 days:** AHI {avg([r['ahi'] for r in last30])}, "
        f"avg usage {round(sum(r['hours'] for r in last30) / max(len(last30), 1), 2)} h, "
        f"median pressure {avg([r['med_p'] for r in last30])} cmH₂O.",
        f"- **Last 90 days:** AHI {avg([r['ahi'] for r in last90])}, "
        f"median pressure {avg([r['med_p'] for r in last90])} cmH₂O.",
        "",
    ]


def section_yearly(rows: list[dict]) -> list[str]:
    by_year = defaultdict(list)
    for r in rows:
        by_year[r["date"][:4]].append(r)

    lines = [
        "## Yearly trend",
        "",
        "| Year | Nights | Avg usage | Avg AHI | Med pressure | 95th pressure | Med EPAP | Total OA | Total CA | Total H |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for y in sorted(by_year):
        rs = by_year[y]
        n = len(rs)
        used = [r for r in rs if r["hours"] > 0]
        avg_use = round(sum(r["hours"] for r in used) / max(len(used), 1), 2) if used else 0
        lines.append(
            f"| {y} | {n} | {avg_use} h | {avg([r['ahi'] for r in rs])} | "
            f"{avg([r['med_p'] for r in rs])} | {avg([r['p95'] for r in rs])} | "
            f"{avg([r['med_epap'] for r in rs])} | "
            f"{sum(r['oa'] for r in rs)} | {sum(r['ca'] for r in rs)} | "
            f"{sum(r['h'] for r in rs)} |"
        )
    return lines + [""]


def section_monthly_recent(rows: list[dict]) -> list[str]:
    by_month = defaultdict(list)
    for r in rows:
        if r["date"] >= "2025-01":
            by_month[r["date"][:7]].append(r)

    lines = [
        "## Monthly trend (2025 → now)",
        "",
        "| Month | n | Med P | Med EPAP | 95th P | AHI | OA / H / CA |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for m in sorted(by_month):
        rs = by_month[m]
        lines.append(
            f"| {m} | {len(rs)} | {avg([r['med_p'] for r in rs])} | "
            f"{avg([r['med_epap'] for r in rs])} | {avg([r['p95'] for r in rs])} | "
            f"{avg([r['ahi'] for r in rs])} | "
            f"{sum(r['oa'] for r in rs)} / {sum(r['h'] for r in rs)} / "
            f"{sum(r['ca'] for r in rs)} |"
        )
    return lines + [""]


def section_event_composition(rows: list[dict]) -> list[str]:
    by_year = defaultdict(list)
    for r in rows:
        by_year[r["date"][:4]].append(r)

    lines = [
        "## Event composition by year",
        "",
        "What fraction of detected events is obstructive vs central vs hypopnoea? "
        "Drift toward central events would matter clinically — central apnoeas "
        "aren't fixed by pressure and can be drug- or pressure-induced.",
        "",
        "| Year | OA | H | CA | RE | OA % | CA % | H % |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for y in sorted(by_year):
        rs = by_year[y]
        oa = sum(r["oa"] for r in rs)
        h = sum(r["h"] for r in rs)
        ca = sum(r["ca"] for r in rs)
        re = sum(r["re"] for r in rs)
        events = oa + h + ca
        if events == 0:
            lines.append(f"| {y} | {oa} | {h} | {ca} | {re} | — | — | — |")
            continue
        lines.append(
            f"| {y} | {oa} | {h} | {ca} | {re} | "
            f"{round(100 * oa / events)}% | "
            f"{round(100 * ca / events)}% | "
            f"{round(100 * h / events)}% |"
        )
    return lines + [""]


def section_pressure_weight(rows: list[dict], weights: dict[str, float]) -> list[str]:
    """Bucket nights by weight. Split by era because settings changed in
    mid-2025 — a single table conflates time with weight."""
    paired = []
    for r in rows:
        if r["med_p"] is None or r["med_p"] == 0:
            continue
        w = closest_weight(r["date"], weights, max_days=14)
        if w is None:
            continue
        paired.append((w, r))

    if not paired:
        return []

    def bucket(w):
        if w < 130: return "<130 kg"
        if w < 135: return "130–135 kg"
        if w < 140: return "135–140 kg"
        if w < 145: return "140–145 kg"
        return "145+ kg"

    def build_table(label: str, filter_fn) -> list[str]:
        subset = [(w, r) for w, r in paired if filter_fn(r["date"])]
        buckets = {b: [] for b in ["145+ kg", "140–145 kg", "135–140 kg", "130–135 kg", "<130 kg"]}
        for w, r in subset:
            buckets[bucket(w)].append(r)
        out = [
            f"### {label}",
            "",
            "| Weight bucket | Nights | Med pressure | 95th pressure | AHI |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
        for b in ["145+ kg", "140–145 kg", "135–140 kg", "130–135 kg", "<130 kg"]:
            rs = buckets[b]
            if not rs:
                out.append(f"| {b} | 0 | — | — | — |")
                continue
            out.append(
                f"| {b} | {len(rs)} | {avg([r['med_p'] for r in rs])} | "
                f"{avg([r['p95'] for r in rs])} | {avg([r['ahi'] for r in rs])} |"
            )
        return out + [""]

    return [
        "## Pressure vs body weight",
        "",
        "Each CPAP night is paired with the closest weigh-in within 14 days. "
        "Split by era because settings were raised in July 2025 — a single "
        "table would conflate time with weight.",
        "",
    ] + build_table("Era 1: 2019 → June 2025 (pre settings raise)", lambda d: d < "2025-07-01") + \
        build_table("Era 2: July 2025 → present (after settings raise)", lambda d: d >= "2025-07-01")


def section_adherence(rows: list[dict]) -> list[str]:
    by_year = defaultdict(list)
    for r in rows:
        by_year[r["date"][:4]].append(r)

    lines = [
        "## Adherence (per calendar year)",
        "",
        "Days in the export file count as \"tracked.\" Calendar gaps mean either "
        "the SD card wasn't downloaded, or the mask wasn't worn — OSCAR can't "
        "tell the difference.",
        "",
        "| Year | Tracked nights | Used ≥ 4 h | Used ≥ 6 h | Avg usage |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for y in sorted(by_year):
        rs = by_year[y]
        n4 = sum(1 for r in rs if r["hours"] >= 4)
        n6 = sum(1 for r in rs if r["hours"] >= 6)
        used = [r for r in rs if r["hours"] > 0]
        avg_h = round(sum(r["hours"] for r in used) / max(len(used), 1), 2) if used else 0
        lines.append(f"| {y} | {len(rs)} | {n4} | {n6} | {avg_h} h |")
    return lines + [""]


def section_notable(rows: list[dict]) -> list[str]:
    scored = [r for r in rows if r["ahi"] is not None and r["hours"] >= 4]
    worst = sorted(scored, key=lambda r: -r["ahi"])[:5]
    lines = [
        "## Notable nights",
        "",
        "### Highest-AHI nights (usage ≥ 4 h)",
        "",
        "| Date | Hours | AHI | OA | H | CA | Med P |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in worst:
        lines.append(
            f"| {r['date']} | {round(r['hours'], 2)} | {r['ahi']:.2f} | "
            f"{r['oa']} | {r['h']} | {r['ca']} | {fmt(r['med_p'], 1)} |"
        )
    return lines + [""]


def main() -> None:
    rows = sorted(load_oscar(), key=lambda r: r["date"])
    weights = load_weight_by_date()

    out_lines = [
        "# OSCAR CPAP analysis",
        "",
        f"_Generated {date.today()} from "
        f"`sleep/DAILY_OSCAR_Ben_Summary_2019-12-23_2026-05-26.csv`._",
        "",
        "Per-night CPAP summary stats from OSCAR (one row per calendar night). "
        "Lifetime span 2019-12-23 → 2026-05-26.",
        "",
    ]

    out_lines += section_headline(rows)
    out_lines += section_yearly(rows)
    out_lines += section_monthly_recent(rows)
    out_lines += section_event_composition(rows)
    out_lines += section_pressure_weight(rows, weights)
    out_lines += section_adherence(rows)
    out_lines += section_notable(rows)

    out_lines += [
        "## Findings",
        "",
        "1. **AHI has been clinically excellent the entire 7-year span** "
        "(0.6–1.3 events/hr, well under the threshold of 5). On therapy your "
        "OSA is functionally resolved. This is *the* number the GP cares "
        "about, and it has never been a concern.",
        "2. **The big context: weight regained ~13 kg through 2025 before the "
        "reta cut.** 7 Jul 2025 weigh-in: 136.3 kg. 15 Dec 2025 (reta start): "
        "148.9 kg. That regain is the lens through which the 2025 settings "
        "changes should be read.",
        "3. **Two settings inflections this year, both make sense in context:**",
        "   - **June 2025:** EPR (Expiratory Pressure Relief) enabled. EPAP "
        "begins running ~3 cmH₂O below IPAP for the first time. Likely a "
        "comfort experiment — not a clinical response.",
        "   - **July 2025:** Median pressure stepped up from ~7 to ~10.7 cmH₂O "
        "in a single month. That's the signature of a **manual min-pressure "
        "raise** (APAP equilibrium drift would be gradual, not step-function). "
        "Coincides with the start of the 13 kg weight regain. AHI did *not* "
        "drop as a result — Era 1 at 145+ kg was already controlled at "
        "AHI 0.85 with median pressure 6.5; Era 2 at 145+ kg sits at "
        "AHI 1.01 with median pressure 10.6. **More pressure, similar AHI.**",
        "4. **Pressure is now falling appropriately as weight comes off.** "
        "Median pressure 10.5 (Jan–Mar 2026) → 9.0 (Apr) → 8.4 (May). The "
        "APAP is auto-tuning down with your body. Expect this to continue.",
        "5. **Central-apnoea counts climb when pressure is higher.** Oct 2025 "
        "(78 CAs) and Jan 2026 (79 CAs) coincide with peak-pressure nights at "
        "high weight. Treatment-emergent central apnoea at elevated pressures "
        "is documented, but at this AHI it's not clinically meaningful — and "
        "the CAs should fall as pressure does.",
        "6. **Adherence has improved each year.** 2026 is on track for the "
        "best year yet: 6.84 h average usage, 141/144 nights ≥ 4 h. The CPAP "
        "compliance numbers in the GP letter understate this — show OSCAR's "
        "fuller picture if asked.",
        "",
        "## Settings hypothesis (for discussion with your sleep tech)",
        "",
        "Caveat: data analysis, not prescription. The following are questions "
        "worth raising, not changes to make unilaterally.",
        "",
        "1. **Is the current min pressure higher than needed?** Era 1 (no EPR, "
        "median pressure ~6) controlled your OSA fine at every weight you had "
        "between 2019 and mid-2025 — AHI well under 5. Era 2 (post-raise) "
        "delivers ~4 cmH₂O more pressure for similar AHI. The honest read: "
        "the raised floor isn't earning its keep on AHI numbers. A step-down "
        "trial (~1 cmH₂O at a time) once your weight stabilises is reasonable "
        "to ask about.",
        "2. **The rising central-apnoea count is plausibly pressure-related.** "
        "Era 1 had ~22–39 % of events as CA. Era 2 has more total CAs in "
        "absolute terms (Oct 2025: 78, Jan 2026: 79) which is consistent with "
        "treatment-emergent CA at higher pressures. Reducing min pressure (or "
        "trialling EPR off) would test the hypothesis — but only worth doing "
        "after the cut stabilises so you don't change too many things at once.",
        "3. **EPR — keep or trial off?** The 2024 data (no EPR, lower pressure, "
        "lowest AHI year on record at 0.74) is the cleanest control year in the "
        "dataset. EPR may help subjective comfort but it isn't load-bearing for "
        "*AHI control*. Subjective call.",
        "4. **Timing: don't change anything mid-cut.** You've got the reta "
        "taper through mid-June, then tirzepatide ramp. Changing CPAP settings "
        "on top of those transitions makes it hard to attribute any subsequent "
        "change. Revisit at the next sleep review, ~3–6 months after tirzepatide "
        "settles and weight stabilises.",
        "",
        "## What's missing from this export",
        "",
        "- **Leak data** — no columns in this export. Re-export with "
        "Leak Median / 95th if available; large-leak nights would explain "
        "some of the worst-AHI rows.",
        "- **Machine settings** — the configured min/max pressure, EPR level, "
        "mode (APAP vs CPAP), ramp. The data lets us infer ranges, but the "
        "settings page is authoritative.",
        "- **Per-event detail** — needed to see *when* events cluster within "
        "a night and at *what pressure*. Worst-AHI nights table above gives "
        "5 candidate dates for a Details-resolution export.",
        "",
    ]

    OUT.write_text("\n".join(out_lines))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
