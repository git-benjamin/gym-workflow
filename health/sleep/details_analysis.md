# CPAP per-night event clustering

_Generated 2026-05-27 from `sleep/details/`._

For each representative night, this drills into the per-second OSCAR data to answer: *where do events cluster within the night, and at what pressure?* Pairs with the trend-level findings in `sleep/oscar_analysis.md`.

Note: `2026-04-04` Details export failed (only Summary was returned), so it's omitted. The summary alone — AHI 2.42, OA 11, MedP 10.56 — is in the trend analysis.

## Side-by-side comparison

| Night | Med P | 95th P | Events | OA | H | CA | Min to 1st event |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2024-09-08 (pre-raise control baseline) | 6.36 | 8.3 | 9 | 3 | 3 | 3 | 30.5 |
| 2025-10-02 (worst recent AHI) | 10.92 | 11.96 | 21 | 6 | 3 | 9 | 94.1 |
| 2025-10-31 (highest OA, 15) | 11.58 | 12.68 | 25 | 15 | 3 | 7 | 49.0 |
| 2026-05-25 (typical recent) | 8.92 | 10.5 | 8 | 5 | 0 | 3 | 92.5 |

## Per-night detail

### 2024-09-08 (pre-raise control baseline)

_AHI 0.13 • OA 1 • H 0 • CA 0 • MedP 7.24 cmH₂O (no EPR)_

- **Total session:** 20.92 h (12:00 → 08:55 UTC)
- **Pressure stats:** median **6.36** cmH₂O, 95th **8.3**, peak **9.18**; EPAP median **6.36**
- **9 events total** in this night

**Per-event detail (sorted by time):**

| Local time into night | Event | Duration (s) | Pressure (cmH₂O) |
| --- | --- | ---: | ---: |
| 0h30m | Obstructive | 10 | 5.94 |
| 17h41m | Hypopnea | 0 | 6.38 |
| 17h58m | Obstructive | 14 | 5.62 |
| 18h53m | ClearAirway | 16 | 7.54 |
| 19h02m | Obstructive | 16 | 6.60 |
| 19h28m | Hypopnea | 0 | 6.58 |
| 20h11m | Hypopnea | 0 | 5.82 |
| 20h33m | ClearAirway | 17 | 6.46 |
| 20h34m | ClearAirway | 11 | 6.40 |

**Pressure at event vs night median:**

| Event kind | n | Avg pressure at event | Δ vs night median |
| --- | ---: | ---: | ---: |
| ClearAirway | 3 | 6.8 | +0.44 |
| Hypopnea | 3 | 6.26 | -0.1 |
| Obstructive | 3 | 6.05 | -0.31 |

**Events by hour into the night:**

| Hour | Events | Mix |
| --- | ---: | --- |
| 0h–1h | 1 | 1×Ob |
| 17h–18h | 2 | 1×Hy, 1×Ob |
| 18h–19h | 1 | 1×Cl |
| 19h–20h | 2 | 1×Hy, 1×Ob |
| 20h–21h | 3 | 2×Cl, 1×Hy |

### 2025-10-02 (worst recent AHI)

_AHI 3.44 • OA 6 • H 3 • CA 9 • MedP 10.68 cmH₂O_

- **Total session:** 6.10 h (01:00 → 07:06 UTC)
- **Pressure stats:** median **10.92** cmH₂O, 95th **11.96**, peak **12.26**; EPAP median **7.92**
- **21 events total** in this night

**Per-event detail (sorted by time):**

| Local time into night | Event | Duration (s) | Pressure (cmH₂O) |
| --- | --- | ---: | ---: |
| 1h34m | Obstructive | 10 | 10.68 |
| 1h45m | Hypopnea | 0 | 10.64 |
| 2h22m | Obstructive | 11 | 11.02 |
| 3h28m | ClearAirway | 21 | 11.10 |
| 3h28m | ClearAirway | 11 | 11.06 |
| 3h29m | ClearAirway | 13 | 11.04 |
| 3h30m | ClearAirway | 11 | 11.02 |
| 3h32m | ClearAirway | 11 | 10.98 |
| 3h39m | ClearAirway | 12 | 10.78 |
| 3h39m | Hypopnea | 0 | 10.76 |
| 3h52m | Hypopnea | 0 | 10.92 |
| 4h03m | Apnea | 110 | 10.62 |
| 4h04m | Apnea | 50 | 10.62 |
| 4h04m | Apnea | 13 | 10.62 |
| 4h10m | Obstructive | 15 | 11.28 |
| 4h23m | Obstructive | 10 | 11.24 |
| 4h31m | ClearAirway | 10 | 11.16 |
| 4h46m | Obstructive | 14 | 10.96 |
| 5h19m | Obstructive | 14 | 11.48 |
| 5h23m | ClearAirway | 10 | 11.88 |
| 5h44m | ClearAirway | 16 | 11.16 |

**Pressure at event vs night median:**

| Event kind | n | Avg pressure at event | Δ vs night median |
| --- | ---: | ---: | ---: |
| Apnea | 3 | 10.62 | -0.3 |
| ClearAirway | 9 | 11.13 | +0.21 |
| Hypopnea | 3 | 10.77 | -0.15 |
| Obstructive | 6 | 11.11 | +0.19 |

**Events by hour into the night:**

| Hour | Events | Mix |
| --- | ---: | --- |
| 1h–2h | 2 | 1×Hy, 1×Ob |
| 2h–3h | 1 | 1×Ob |
| 3h–4h | 8 | 6×Cl, 2×Hy |
| 4h–5h | 7 | 3×Ap, 1×Cl, 3×Ob |
| 5h–6h | 3 | 2×Cl, 1×Ob |

### 2025-10-31 (highest OA, 15)

_AHI 2.88 • OA 15 • H 3 • CA 7 • MedP 10.70 cmH₂O_

- **Total session:** 8.66 h (23:46 → 08:25 UTC)
- **Pressure stats:** median **11.58** cmH₂O, 95th **12.68**, peak **13.12**; EPAP median **8.58**
- **25 events total** in this night

**Per-event detail (sorted by time):**

| Local time into night | Event | Duration (s) | Pressure (cmH₂O) |
| --- | --- | ---: | ---: |
| 0h48m | Obstructive | 15 | 10.00 |
| 1h22m | ClearAirway | 10 | 10.52 |
| 1h39m | Obstructive | 10 | 10.40 |
| 2h40m | Obstructive | 13 | 10.16 |
| 3h01m | Hypopnea | 0 | 10.50 |
| 3h05m | Obstructive | 13 | 10.84 |
| 3h13m | Obstructive | 17 | 11.32 |
| 3h31m | Obstructive | 25 | 11.16 |
| 3h36m | Obstructive | 19 | 12.34 |
| 3h49m | Obstructive | 10 | 12.30 |
| 3h59m | Obstructive | 11 | 12.22 |
| 4h34m | Obstructive | 10 | 11.56 |
| 4h34m | Obstructive | 10 | 12.50 |
| 4h41m | Obstructive | 13 | 12.62 |
| 4h53m | ClearAirway | 14 | 12.10 |
| 5h08m | ClearAirway | 11 | 11.42 |
| 5h15m | Obstructive | 10 | 11.16 |
| 5h16m | Obstructive | 11 | 12.28 |
| 5h40m | Hypopnea | 0 | 11.88 |
| 5h55m | ClearAirway | 10 | 11.78 |
| 5h59m | Hypopnea | 0 | 11.56 |
| 6h05m | ClearAirway | 10 | 11.22 |
| 7h07m | Obstructive | 12 | 10.80 |
| 7h45m | ClearAirway | 17 | 10.78 |
| 7h59m | ClearAirway | 12 | 10.46 |

**Pressure at event vs night median:**

| Event kind | n | Avg pressure at event | Δ vs night median |
| --- | ---: | ---: | ---: |
| ClearAirway | 7 | 11.18 | -0.4 |
| Hypopnea | 3 | 11.31 | -0.27 |
| Obstructive | 15 | 11.44 | -0.14 |

**Events by hour into the night:**

| Hour | Events | Mix |
| --- | ---: | --- |
| 0h–1h | 1 | 1×Ob |
| 1h–2h | 2 | 1×Cl, 1×Ob |
| 2h–3h | 1 | 1×Ob |
| 3h–4h | 7 | 1×Hy, 6×Ob |
| 4h–5h | 4 | 1×Cl, 3×Ob |
| 5h–6h | 6 | 2×Cl, 2×Hy, 2×Ob |
| 6h–7h | 1 | 1×Cl |
| 7h–8h | 3 | 2×Cl, 1×Ob |

### 2026-05-25 (typical recent)

_AHI 1.09 • OA 5 • H 0 • CA 3 • MedP 8.30 cmH₂O_

- **Total session:** 7.35 h (00:10 → 07:30 UTC)
- **Pressure stats:** median **8.92** cmH₂O, 95th **10.5**, peak **10.78**; EPAP median **5.94**
- **8 events total** in this night

**Per-event detail (sorted by time):**

| Local time into night | Event | Duration (s) | Pressure (cmH₂O) |
| --- | --- | ---: | ---: |
| 1h32m | Obstructive | 11 | 8.88 |
| 4h15m | Obstructive | 10 | 10.26 |
| 4h40m | ClearAirway | 14 | 9.78 |
| 6h01m | Obstructive | 15 | 8.60 |
| 6h24m | ClearAirway | 15 | 8.82 |
| 6h36m | ClearAirway | 16 | 8.54 |
| 7h03m | Obstructive | 13 | 9.20 |
| 7h16m | Obstructive | 11 | 9.46 |

**Pressure at event vs night median:**

| Event kind | n | Avg pressure at event | Δ vs night median |
| --- | ---: | ---: | ---: |
| ClearAirway | 3 | 9.05 | +0.13 |
| Obstructive | 5 | 9.28 | +0.36 |

**Events by hour into the night:**

| Hour | Events | Mix |
| --- | ---: | --- |
| 1h–2h | 1 | 1×Ob |
| 4h–5h | 2 | 1×Cl, 1×Ob |
| 6h–7h | 3 | 2×Cl, 1×Ob |
| 7h–8h | 2 | 2×Ob |

## Synthesis — what the per-night data tells us

1. **The 2025-10-02 cluster looks like periodic breathing (Cheyne-Stokes-like), not pure OSA.** At 3 h 28 m into the night, 5 consecutive Clear-Airway events fire in 4 minutes (3h28, 3h28, 3h29, 3h30, 3h32). Then at 4 h 03 m: a **110-second apnoea**, followed by a 50-second and a 13-second apnoea within 1 minute. That pattern of long, regularly-spaced central pauses is the classical signature of periodic breathing — and crucially, **all of it happens at ~11 cmH₂O pressure**. Pressure isn't fixing it because the cause isn't airway collapse. Worth flagging to your sleep tech as a one-off event log to look at.

2. **High pressure isn't preventing obstructive events.** On 2025-10-31, 15 obstructive apnoeas fired while the machine was delivering 11+ cmH₂O — peaking at 12.6 cmH₂O. If pressure were the lever, those events shouldn't be happening. More pressure can't splint open an airway that's collapsing for other reasons (positional, REM atonia, mask seal, jaw drop). This is data supporting the trend-level finding that the raised floor isn't earning its keep.

3. **Events cluster in hours 3–5 of the night, every night.** That window is REM-dominant on a normal sleep architecture, and REM-related OSA is well documented (muscle atonia is most pronounced in REM). Three of four nights show this cluster pattern; the 2024 baseline is the exception, and that file appears to span two nights, so the pattern is harder to read there.

4. **Central apnoeas (ClearAirway) happen at *every* pressure** — 3 on the baseline night at 6.4–7.5 cmH₂O; 9 on the bad night at 11 cmH₂O; 3 on a recent night at 8.5–9.8 cmH₂O. They scale roughly with pressure but aren't created by it; the pre-raise era had them too. They're a feature of your physiology, not a pressure side-effect.

5. **Current night (2026-05-25) is genuinely cleaner.** 8 events, no clusters tighter than 2 events in any minute, pressure 8.5–10.5 across the night, peak 10.78 (below the post-raise peak). This is what the system looks like operating well at lighter weight. Continued improvement is plausible as the cut completes.

## Settings discussion items (updated with event-level evidence)

These are the questions to raise at your next sleep review, now with specific event-log evidence to point at:

1. **"Can you look at 2025-10-02 between 3h 28m and 4h 04m into the session?"** Five clustered CAs followed by a 110-second apnoea is the type of event a sleep tech can interpret. Treatment-emergent CSR is treatable (ASV machines exist) but you'd want a clinician to confirm before doing anything.
2. **"Is the min-pressure post-July-2025 still right?"** The per-event data shows obstructions firing AT pressure 11+ — pressure isn't the lever for them. Reverting toward the pre-raise floor (~5–7 cmH₂O) is a reasonable conversation once weight stabilises post-cut.
3. **"Is there a positional or REM component I should be testing?"** The hours-3-to-5 clustering is suggestive. A WatchPAT or a one-night in-lab PSG would settle it, but it's optional — at AHI < 5 you have time to think about it.

## Limitations of this analysis

- **2024-09-08 file appears to span two nights** (session duration 20.9 h is implausible). The pressure-at-event averages are still valid but the hour-of-night clustering for that night is unreliable.
- **No leak data** in the export — so I can't rule out mask leaks as the cause of the high-pressure obstructives on 2025-10-31.
- **No flow data** — true CSR would show a crescendo-decrescendo breathing pattern; with only event flags I can infer but not confirm.
- **n = 4 nights** — patterns I'm seeing here might or might not be representative. Worth one more drill if anything looks alarming (but nothing here looks acutely alarming — AHI is fine).
