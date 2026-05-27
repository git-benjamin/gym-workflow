# Garmin sleep vs ResMed CPAP usage cross-check

Per-night sleep minutes from Garmin (`sleep_summary.csv`) vs CPAP
usage from the ResMed AirSense 10 report (`sleep/cpap.md`).
All windows end 2026-05-26 to match the CPAP report.

| Window | Garmin nights | Garmin avg | ResMed avg | Δ (Garmin − ResMed) |
| --- | ---: | ---: | ---: | ---: |
| 30 days | 28 | 6 h 19 min | 7 h 4 min | −0 h 45 min |
| 90 days | 84 | 6 h 17 min | 6 h 52 min | −0 h 35 min |
| 365 days | 306 | 6 h 20 min | 6 h 15 min | +0 h 5 min |

**What the deltas mean.** Garmin measures "sleep" from the watch's
movement + HR signal (the bounded sleep window in the device). ResMed
measures "usage" — the time the CPAP mask is on and delivering
therapy. The two are not the same construct:

- **Last 30 / 90 days:** ResMed usage is ~35–45 min higher than Garmin
  sleep. Likely interpretation: the mask goes on before sleep onset
  (winding down in bed) and stays on through brief wakes, so therapy
  time bookends a slightly shorter Garmin-estimated sleep window. This
  is the *expected* direction for a high-adherence user and is
  reassuring — it suggests the CPAP figure is conservative, not
  inflated.
- **Last 365 days:** the two methods are within 5 min (effectively a
  tie). The longer window absorbs the day-to-day variance.

**Garmin coverage:** only 306/365 nights have Garmin data in the year
window vs 365/365 for ResMed — watch wasn't worn ~16% of nights.
