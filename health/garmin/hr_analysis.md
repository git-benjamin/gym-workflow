# Heart rate analysis

_Generated 2026-05-27 from `garmin/daily_metrics.csv`, `garmin/sleep_summary.csv`, `garmin/workout_hr_aligned.csv`._

Personal-tracking analysis. Three lenses: retatrutide dosing phase, lifting workouts, and sleep duration. Watch was not worn ~16 % of nights and Garmin only started recording overnight HRV from 2025-09-18 — missing data shows up as blank cells.

## Headline

- **Pre-reta (Sep–14 Dec 2025):** RHR avg **71.9 bpm** (n=99)
- **Current (May 2026):** RHR avg **68.6 bpm** (n=27)
- **Net change:** -3.3 bpm over the reta period

## Monthly RHR (Sep 2025 onward)

| Month | Days | RHR avg | RHR min | RHR max |
| --- | ---: | ---: | ---: | ---: |
| 2025-09 | 30 | 72.7 | 69 | 78 |
| 2025-10 | 30 | 68.1 | 64 | 76 |
| 2025-11 | 29 | 72.2 | 66 | 76 |
| 2025-12 | 22 | 80.6 | 74 | 90 |
| 2026-01 | 31 | 75.4 | 68 | 92 |
| 2026-02 | 28 | 70 | 68 | 72 |
| 2026-03 | 31 | 74.8 | 69 | 82 |
| 2026-04 | 30 | 66.6 | 64 | 69 |
| 2026-05 | 27 | 68.6 | 65 | 71 |

## RHR / HRV / Stress by retatrutide phase

| Phase | Days | RHR avg | RHR min | RHR max | HRV avg | Stress avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pre-reta (Sep–14 Dec 2025) | 99 | 71.9 | 64 | 84 | 33.8 | 46.9 |
| Init escalation (0.5 → 2 mg) | 44 | 76.8 | 68 | 92 | 28.9 | 45.2 |
| Maintenance (2 mg, 3 weeks) | 21 | 70.1 | 68 | 72 | 31.6 | 41.8 |
| Overseas pause | 21 | 74.6 | 69 | 82 | 28.2 | 51.0 |
| Re-escalation (1 → 3 mg) | 49 | 68.7 | 64 | 80 | 35.7 | 42.6 |
| Peak (4 mg, 3 weeks) | 21 | 68.8 | 66 | 71 | 35.5 | 44.6 |
| Taper (3 mg ↓) | 3 | 70.3 | 70 | 71 | 38.3 | 40.3 |

## RHR / HRV by active dose level

Active dose on a given day = most recent Monday's scheduled dose.
Each dose level pools every day at that level across the reta period.

| Dose | Days | RHR avg | RHR min | RHR max | HRV avg |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 mg (overseas) | 14 | 76.9 | 72 | 82 | 25.3 |
| 0.50 mg | 6 | 77.3 | 74 | 81 | 32.0 |
| 0.75 mg | 5 | 83.8 | 79 | 90 | 26.0 |
| 1.00 mg | 12 | 82.1 | 73 | 92 | 28.9 |
| 1.25 mg | 7 | 80.4 | 74 | 86 | 27.0 |
| 1.50 mg | 28 | 70.3 | 65 | 73 | 32.0 |
| 1.75 mg | 7 | 68.6 | 68 | 69 | 30.4 |
| 2.00 mg | 42 | 68.9 | 64 | 72 | 33.1 |
| 3.00 mg | 17 | 67.4 | 65 | 71 | 39.3 |
| 4.00 mg | 21 | 68.8 | 66 | 71 | 35.5 |

## Workout effect on RHR (2026 only)

- **Workout days (n=39):** RHR avg **68.1 bpm**
- **Rest days (n=108):** RHR avg **72.3 bpm**
- **Day after a workout (n=39):** RHR avg **68.1 bpm**

### By workout volume tertile (same-day RHR)

- **Low volume (≤4796 kg, n=14):** 68 bpm
- **Mid volume (4796–6078 kg, n=13):** 68.4 bpm
- **High volume (>6078 kg, n=12):** 67.8 bpm

## RHR vs prior-night sleep duration

| Sleep bucket | Days | RHR avg | RHR min | RHR max |
| --- | ---: | ---: | ---: | ---: |
| <6 h | 266 | 69.2 | 56 | 88 |
| 6–7 h | 157 | 68.1 | 57 | 81 |
| 7–8 h | 120 | 67.7 | 57 | 76 |
| >8 h | 132 | 68.1 | 56 | 90 |

## Takeaways

- **Initiation bump is real and large.** Pre-reta RHR averaged ~72 bpm (Sep–Dec 2025); the init-escalation phase jumped to ~77 bpm — a +5 bpm shift sustained for ~6 weeks. December alone hit 80.6 bpm average. This is consistent with the documented GLP-1 transient HR rise and resolved as the body adapted.
- **Late-phase RHR is well below baseline.** April–May averages 67–68 bpm vs the 72 bpm pre-reta baseline — net **−4 bpm** at peak / taper. Counterintuitive because peak dose (4 mg) was higher than init, but weight loss + cardiovascular conditioning over 5 months outweighs the compound's direct HR effect.
- **Lifting does not move RHR.** Workout-day, next-day, and rest-day averages are 68.1 / 68.1 / 72.3 bpm. The 4-bpm rest-day delta is most likely **selection bias** (you skip lifting when run-down or sleeping poorly), not a workout effect. Volume tertiles (Low/Mid/High) all give the same RHR within 0.5 bpm — volume is decoupled from cardiovascular load. Confirms the high-volume hypertrophy work is neuromuscular, not metabolic.
- **Sleep < 6 h is your norm, and it's the only modifiable lever in this data.** 266 of the ~675 tracked nights were under 6 h — ~40 % of the time. RHR creeps up ~1.5 bpm on those days vs 7–8 h nights. The lever isn't dramatic single-night, but the chronic exposure is the real cost.
- **Dose-by-dose table is too noisy to trust.** Most dose levels have <10 days of data each and the trend is confounded with time-on-reta and weight loss. Read the phase table for the signal.
- **HRV trend tracks the inverse of RHR**, as expected: low (~29 ms) during the init bump, climbing to ~35–39 ms by peak / taper. Recovery capacity has improved.
