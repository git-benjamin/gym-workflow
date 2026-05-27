"""
Distil the Garmin GDPR export wellness + metrics JSONs into plot-ready CSVs.

Reads from garmin_export/ (read-only). Writes:
- garmin/daily_metrics.csv  — one row per day: RHR, HRV, stress, kcal, steps,
                              intensity minutes, training load, ACWR
- garmin/sleep_summary.csv  — one row per night: duration, sleep stages,
                              respiration, sleep scores
- garmin/vo2max.csv         — one row per VO2max measurement (sparse)

Sources distilled:
- DI_CONNECT/DI-Connect-Wellness/*_sleepData.json
- DI_CONNECT/DI-Connect-Wellness/*_healthStatusData.json
- DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json
- DI_CONNECT/DI-Connect-Metrics/MetricsAcuteTrainingLoad_*.json
- DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData_*.json
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORT = ROOT / "garmin_export" / "DI_CONNECT"
OUT = ROOT / "garmin"


def load_json(path: Path):
    with path.open() as f:
        return json.load(f)


def epoch_ms_to_date(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def secs_to_min(s):
    return round((s or 0) / 60)


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        print(f"  warn: no rows for {path.name}")
        return
    cols = list(rows[0].keys())
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"  {path.name}: {len(rows)} rows")


def build_sleep() -> list[dict]:
    rows = []
    for p in sorted((EXPORT / "DI-Connect-Wellness").glob("*_sleepData.json")):
        for n in load_json(p):
            if "calendarDate" not in n:
                continue  # Garmin stub records (un-tracked nights)
            scores = n.get("sleepScores") or {}
            deep = n.get("deepSleepSeconds") or 0
            light = n.get("lightSleepSeconds") or 0
            rem = n.get("remSleepSeconds") or 0
            awake = n.get("awakeSleepSeconds") or 0
            rows.append({
                "date": n["calendarDate"],
                "start_gmt": n.get("sleepStartTimestampGMT"),
                "end_gmt": n.get("sleepEndTimestampGMT"),
                "total_min": secs_to_min(deep + light + rem + awake),
                "deep_min": secs_to_min(deep),
                "light_min": secs_to_min(light),
                "rem_min": secs_to_min(rem),
                "awake_min": secs_to_min(awake),
                "avg_respiration": n.get("averageRespiration"),
                "avg_sleep_stress": n.get("avgSleepStress"),
                "overall_score": scores.get("overallScore"),
                "quality_score": scores.get("qualityScore"),
                "recovery_score": scores.get("recoveryScore"),
                "deep_score": scores.get("deepScore"),
                "rem_score": scores.get("remScore"),
                "restless_moments": n.get("restlessMomentCount"),
            })
    rows.sort(key=lambda r: r["date"])
    return rows


def build_health_by_date() -> dict[str, dict]:
    """Per-day overnight HRV / HR / respiration baselines."""
    out: dict[str, dict] = {}
    for p in sorted((EXPORT / "DI-Connect-Wellness").glob("*_healthStatusData.json")):
        for d in load_json(p):
            row = {"hrv_ms": None, "overnight_hr_bpm": None, "respiration": None}
            for m in d.get("metrics", []):
                t, v = m.get("type"), m.get("value")
                if t == "HRV":
                    row["hrv_ms"] = v
                elif t == "HR":
                    row["overnight_hr_bpm"] = v
                elif t == "RESPIRATION":
                    row["respiration"] = v
            out[d["calendarDate"]] = row
    return out


def build_uds_by_date() -> dict[str, dict]:
    """Per-day daily summary: RHR, steps, kcal, stress, intensity mins."""
    out: dict[str, dict] = {}
    for p in sorted((EXPORT / "DI-Connect-Aggregator").glob("UDSFile_*.json")):
        for d in load_json(p):
            stress_total = None
            agg_list = ((d.get("allDayStress") or {}).get("aggregatorList")) or []
            for agg in agg_list:
                if agg.get("type") == "TOTAL":
                    stress_total = agg.get("averageStressLevel")
                    break
            out[d["calendarDate"]] = {
                "rhr_bpm": d.get("restingHeartRate"),
                "min_hr_bpm": d.get("minHeartRate"),
                "max_hr_bpm": d.get("maxHeartRate"),
                "avg_stress": stress_total,
                "steps": d.get("totalSteps"),
                "active_kcal": d.get("activeKilocalories"),
                "total_kcal": d.get("totalKilocalories"),
                "moderate_min": d.get("moderateIntensityMinutes"),
                "vigorous_min": d.get("vigorousIntensityMinutes"),
            }
    return out


def build_atl_by_date() -> dict[str, dict]:
    """Per-day training load — keep the latest record per day (end-of-day state)."""
    out: dict[str, dict] = {}
    for p in sorted((EXPORT / "DI-Connect-Metrics").glob("MetricsAcuteTrainingLoad_*.json")):
        for r in load_json(p):
            d = epoch_ms_to_date(r["calendarDate"])
            existing = out.get(d)
            if not existing or (r.get("timestamp") or 0) > (existing.get("timestamp") or 0):
                out[d] = r
    return out


def build_daily_metrics() -> list[dict]:
    uds = build_uds_by_date()
    health = build_health_by_date()
    atl = build_atl_by_date()
    all_dates = sorted(set(uds) | set(health) | set(atl))
    rows = []
    for d in all_dates:
        u, h, a = uds.get(d, {}), health.get(d, {}), atl.get(d, {})
        rows.append({
            "date": d,
            "rhr_bpm": u.get("rhr_bpm"),
            "overnight_hr_bpm": h.get("overnight_hr_bpm"),
            "hrv_ms": h.get("hrv_ms"),
            "respiration": h.get("respiration"),
            "avg_stress": u.get("avg_stress"),
            "min_hr_bpm": u.get("min_hr_bpm"),
            "max_hr_bpm": u.get("max_hr_bpm"),
            "steps": u.get("steps"),
            "active_kcal": u.get("active_kcal"),
            "total_kcal": u.get("total_kcal"),
            "moderate_min": u.get("moderate_min"),
            "vigorous_min": u.get("vigorous_min"),
            "training_load_acute": a.get("dailyTrainingLoadAcute"),
            "training_load_chronic": a.get("dailyTrainingLoadChronic"),
            "acwr": a.get("dailyAcuteChronicWorkloadRatio"),
            "acwr_status": a.get("acwrStatus"),
        })
    return rows


def build_vo2max() -> list[dict]:
    rows = []
    for p in sorted((EXPORT / "DI-Connect-Metrics").glob("MetricsMaxMetData_*.json")):
        for r in load_json(p):
            rows.append({
                "date": r["calendarDate"],
                "sport": r.get("sport"),
                "sub_sport": r.get("subSport"),
                "vo2_max": r.get("vo2MaxValue"),
                "max_met": r.get("maxMet"),
            })
    rows.sort(key=lambda r: r["date"])
    return rows


def main() -> None:
    OUT.mkdir(exist_ok=True)
    if not EXPORT.exists():
        raise SystemExit(f"missing source: {EXPORT}")

    print("building sleep_summary…")
    write_csv(OUT / "sleep_summary.csv", build_sleep())

    print("building daily_metrics…")
    write_csv(OUT / "daily_metrics.csv", build_daily_metrics())

    print("building vo2max…")
    write_csv(OUT / "vo2max.csv", build_vo2max())


if __name__ == "__main__":
    main()
