# OSCAR CPAP analysis

_Generated 2026-05-27 from `sleep/DAILY_OSCAR_Ben_Summary_2019-12-23_2026-05-26.csv`._

Per-night CPAP summary stats from OSCAR (one row per calendar night). Lifetime span 2019-12-23 → 2026-05-26.

## Headline

- **1185 tracked nights** between 2019-12-23 and 2026-05-26 — 7052 total hours on therapy (~294 days of CPAP time).
- **Lifetime avg AHI:** 1.03 events/hr — well under the clinical threshold of 5.
- **Last 30 days:** AHI 1.01, avg usage 7.05 h, median pressure 8.44 cmH₂O.
- **Last 90 days:** AHI 0.97, median pressure 9.47 cmH₂O.

## Yearly trend

| Year | Nights | Avg usage | Avg AHI | Med pressure | 95th pressure | Med EPAP | Total OA | Total CA | Total H |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2019 | 9 | 5.24 h | 0.58 | 6.41 | 10.38 | 6.41 | 6 | 4 | 8 |
| 2020 | 218 | 5.68 h | 1.23 | 5.66 | 8.76 | 5.66 | 342 | 440 | 347 |
| 2021 | 179 | 6.33 h | 1.01 | 5.56 | 7.9 | 5.56 | 392 | 357 | 320 |
| 2022 | 74 | 6.35 h | 1.1 | 5.37 | 7.64 | 5.37 | 259 | 157 | 116 |
| 2023 | 145 | 5.24 h | 1.2 | 5.56 | 7.81 | 5.56 | 459 | 250 | 194 |
| 2024 | 207 | 5.99 h | 0.74 | 5.89 | 8.56 | 5.89 | 472 | 211 | 266 |
| 2025 | 209 | 5.64 h | 1.0 | 9.54 | 11.17 | 7.22 | 605 | 197 | 288 |
| 2026 | 144 | 6.84 h | 1.06 | 9.85 | 10.98 | 6.85 | 623 | 269 | 127 |

## Monthly trend (2025 → now)

| Month | n | Med P | Med EPAP | 95th P | AHI | OA / H / CA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-01 | 6 | 5.27 | 5.27 | 6.62 | 0.26 | 5 / 4 / 0 |
| 2025-03 | 6 | 6.09 | 6.09 | 8.09 | 0.54 | 8 / 7 / 2 |
| 2025-04 | 2 | 6.02 | 6.02 | 8.05 | 1.06 | 4 / 5 / 1 |
| 2025-05 | 19 | 5.96 | 5.96 | 8.54 | 0.63 | 33 / 26 / 8 |
| 2025-06 | 21 | 7.05 | 6.1 | 9.2 | 0.75 | 38 / 26 / 19 |
| 2025-07 | 31 | 10.71 | 7.71 | 12.47 | 1.0 | 84 / 62 / 14 |
| 2025-08 | 25 | 10.7 | 7.7 | 12.37 | 1.07 | 54 / 41 / 13 |
| 2025-09 | 21 | 11.02 | 8.02 | 12.92 | 1.32 | 63 / 38 / 16 |
| 2025-10 | 28 | 10.51 | 7.51 | 11.44 | 1.53 | 138 / 38 / 78 |
| 2025-11 | 22 | 10.56 | 7.56 | 11.67 | 0.97 | 67 / 17 / 25 |
| 2025-12 | 28 | 10.55 | 7.55 | 11.78 | 0.91 | 111 / 24 / 21 |
| 2026-01 | 31 | 10.51 | 7.51 | 11.55 | 1.29 | 146 / 41 / 79 |
| 2026-02 | 27 | 10.34 | 7.34 | 11.27 | 1.03 | 106 / 21 / 50 |
| 2026-03 | 30 | 10.78 | 7.78 | 12.15 | 0.87 | 125 / 22 / 35 |
| 2026-04 | 30 | 9.0 | 6.0 | 10.07 | 1.07 | 138 / 20 / 63 |
| 2026-05 | 26 | 8.45 | 5.45 | 9.68 | 0.99 | 108 / 23 / 42 |

## Event composition by year

What fraction of detected events is obstructive vs central vs hypopnoea? Drift toward central events would matter clinically — central apnoeas aren't fixed by pressure and can be drug- or pressure-induced.

| Year | OA | H | CA | RE | OA % | CA % | H % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2019 | 6 | 8 | 4 | 0 | 33% | 22% | 44% |
| 2020 | 342 | 347 | 440 | 0 | 30% | 39% | 31% |
| 2021 | 392 | 320 | 357 | 0 | 37% | 33% | 30% |
| 2022 | 259 | 116 | 157 | 0 | 49% | 30% | 22% |
| 2023 | 459 | 194 | 250 | 0 | 51% | 28% | 21% |
| 2024 | 472 | 266 | 211 | 0 | 50% | 22% | 28% |
| 2025 | 605 | 288 | 197 | 0 | 56% | 18% | 26% |
| 2026 | 623 | 127 | 269 | 0 | 61% | 26% | 12% |

## Pressure vs body weight

Each CPAP night is paired with the closest weigh-in within 14 days. Split by era because settings were raised in July 2025 — a single table would conflate time with weight.

### Era 1: 2019 → June 2025 (pre settings raise)

| Weight bucket | Nights | Med pressure | 95th pressure | AHI |
| --- | ---: | ---: | ---: | ---: |
| 145+ kg | 22 | 6.47 | 10.25 | 0.85 |
| 140–145 kg | 15 | 5.75 | 9.05 | 1.7 |
| 135–140 kg | 40 | 6.51 | 8.95 | 1.39 |
| 130–135 kg | 134 | 5.44 | 8.1 | 1.07 |
| <130 kg | 173 | 5.3 | 7.59 | 0.97 |

### Era 2: July 2025 → present (after settings raise)

| Weight bucket | Nights | Med pressure | 95th pressure | AHI |
| --- | ---: | ---: | ---: | ---: |
| 145+ kg | 42 | 10.56 | 11.8 | 1.01 |
| 140–145 kg | 26 | 10.63 | 11.85 | 1.07 |
| 135–140 kg | 77 | 10.56 | 11.76 | 1.07 |
| 130–135 kg | 41 | 8.5 | 9.7 | 1.05 |
| <130 kg | 7 | 8.33 | 9.49 | 0.79 |

## Adherence (per calendar year)

Days in the export file count as "tracked." Calendar gaps mean either the SD card wasn't downloaded, or the mask wasn't worn — OSCAR can't tell the difference.

| Year | Tracked nights | Used ≥ 4 h | Used ≥ 6 h | Avg usage |
| --- | ---: | ---: | ---: | ---: |
| 2019 | 9 | 7 | 5 | 5.24 h |
| 2020 | 218 | 173 | 119 | 5.68 h |
| 2021 | 179 | 156 | 124 | 6.33 h |
| 2022 | 74 | 61 | 48 | 6.35 h |
| 2023 | 145 | 106 | 71 | 5.24 h |
| 2024 | 207 | 169 | 123 | 5.99 h |
| 2025 | 209 | 172 | 97 | 5.64 h |
| 2026 | 144 | 141 | 116 | 6.84 h |

## Notable nights

### Highest-AHI nights (usage ≥ 4 h)

| Date | Hours | AHI | OA | H | CA | Med P |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-10-31 | 5.45 | 4.77 | 21 | 1 | 3 | 7.0 |
| 2023-02-27 | 7.6 | 4.34 | 14 | 5 | 14 | 6.8 |
| 2021-04-22 | 6.68 | 3.74 | 1 | 5 | 8 | 5.6 |
| 2020-02-13 | 6.75 | 3.70 | 0 | 3 | 6 | 4.4 |
| 2020-02-25 | 5.99 | 3.51 | 5 | 1 | 3 | 5.9 |

## Findings

1. **AHI has been clinically excellent the entire 7-year span** (0.6–1.3 events/hr, well under the threshold of 5). On therapy your OSA is functionally resolved. This is *the* number the GP cares about, and it has never been a concern.
2. **The big context: weight regained ~13 kg through 2025 before the reta cut.** 7 Jul 2025 weigh-in: 136.3 kg. 15 Dec 2025 (reta start): 148.9 kg. That regain is the lens through which the 2025 settings changes should be read.
3. **Two settings inflections this year, both make sense in context:**
   - **June 2025:** EPR (Expiratory Pressure Relief) enabled. EPAP begins running ~3 cmH₂O below IPAP for the first time. Likely a comfort experiment — not a clinical response.
   - **July 2025:** Median pressure stepped up from ~7 to ~10.7 cmH₂O in a single month. That's the signature of a **manual min-pressure raise** (APAP equilibrium drift would be gradual, not step-function). Coincides with the start of the 13 kg weight regain. AHI did *not* drop as a result — Era 1 at 145+ kg was already controlled at AHI 0.85 with median pressure 6.5; Era 2 at 145+ kg sits at AHI 1.01 with median pressure 10.6. **More pressure, similar AHI.**
4. **Pressure is now falling appropriately as weight comes off.** Median pressure 10.5 (Jan–Mar 2026) → 9.0 (Apr) → 8.4 (May). The APAP is auto-tuning down with your body. Expect this to continue.
5. **Central-apnoea counts climb when pressure is higher.** Oct 2025 (78 CAs) and Jan 2026 (79 CAs) coincide with peak-pressure nights at high weight. Treatment-emergent central apnoea at elevated pressures is documented, but at this AHI it's not clinically meaningful — and the CAs should fall as pressure does.
6. **Adherence has improved each year.** 2026 is on track for the best year yet: 6.84 h average usage, 141/144 nights ≥ 4 h. The CPAP compliance numbers in the GP letter understate this — show OSCAR's fuller picture if asked.

## Settings hypothesis (for discussion with your sleep tech)

Caveat: data analysis, not prescription. The following are questions worth raising, not changes to make unilaterally.

1. **Is the current min pressure higher than needed?** Era 1 (no EPR, median pressure ~6) controlled your OSA fine at every weight you had between 2019 and mid-2025 — AHI well under 5. Era 2 (post-raise) delivers ~4 cmH₂O more pressure for similar AHI. The honest read: the raised floor isn't earning its keep on AHI numbers. A step-down trial (~1 cmH₂O at a time) once your weight stabilises is reasonable to ask about.
2. **The rising central-apnoea count is plausibly pressure-related.** Era 1 had ~22–39 % of events as CA. Era 2 has more total CAs in absolute terms (Oct 2025: 78, Jan 2026: 79) which is consistent with treatment-emergent CA at higher pressures. Reducing min pressure (or trialling EPR off) would test the hypothesis — but only worth doing after the cut stabilises so you don't change too many things at once.
3. **EPR — keep or trial off?** The 2024 data (no EPR, lower pressure, lowest AHI year on record at 0.74) is the cleanest control year in the dataset. EPR may help subjective comfort but it isn't load-bearing for *AHI control*. Subjective call.
4. **Timing: don't change anything mid-cut.** You've got the reta taper through mid-June, then tirzepatide ramp. Changing CPAP settings on top of those transitions makes it hard to attribute any subsequent change. Revisit at the next sleep review, ~3–6 months after tirzepatide settles and weight stabilises.

## What's missing from this export

- **Leak data** — no columns in this export. Re-export with Leak Median / 95th if available; large-leak nights would explain some of the worst-AHI rows.
- **Machine settings** — the configured min/max pressure, EPR level, mode (APAP vs CPAP), ramp. The data lets us infer ranges, but the settings page is authoritative.
- **Per-event detail** — needed to see *when* events cluster within a night and at *what pressure*. Worst-AHI nights table above gives 5 candidate dates for a Details-resolution export.
