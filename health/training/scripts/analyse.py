"""
analyse.py — Query Parquet context via DuckDB, call Gemini, insert into analyses table.

For each workout not yet in the `analyses` table:
  1. Load today's workout (all sets)
  2. Load ALL prior sessions of the same type across all years (workouts_*.parquet glob)
  3. Load last 10 sessions of any type for recency context
  4. Generate matplotlib charts (tonnage trend + exercise progression)
  5. Call Gemini (model fallback chain: best → fastest)
  6. Insert into analyses table
  7. Email styled HTML + charts via Resend

Model fallback order (best → fallback):
  gemini-3.5-flash → gemini-3-flash-preview → gemini-3.1-flash-lite
  → gemini-2.5-flash → gemini-2.5-flash-lite

Token budget: ~180K input tokens per call (250K TPM limit minus output headroom).
Same-type history trimmed from oldest if it would exceed budget.
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import requests
import markdown as md
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import time

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.dates as mdates
from datetime import timedelta

from google import genai
from google.genai import types
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from lib.storage import get_conn, s3_path

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

MODELS = [
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]

TOKEN_INPUT_BUDGET = 180_000
CHARS_PER_TOKEN = 4

SYSTEM_PROMPT_TEMPLATE = """
LANGUAGE DIRECTIVE: All output MUST be in English. Do not use any other language regardless of the language of input data.

## Athlete Profile
- 188cm, male, 29 years old. Vietnamese / South East Asian.
- Current weight: {weight_str}.
- Knee hyperextension history (both knees) — barbell squat, hack squat, leg press,
  and leg extension are PERMANENTLY EXCLUDED. Do NOT suggest these.
- Left glute underactivation — right-side dominant. Bilateral movements let right
  glute compensate. Single-leg work is the asymmetry-correction strategy.
- Chest and back are significantly stronger than triceps and biceps.

## Training Goals (priority order)
1. Glute hypertrophy — primary aesthetic goal; correcting years of underactivation.
2. Posterior chain development (hamstrings, back).
3. Address tricep bottleneck on Push sessions.
4. Address bicep bottleneck on Pull sessions.
5. Lateral delt width and trap/rhomboid activation for posture.
6. Body recomposition — preserve muscle through continued weight loss.

## Session Strategy: Tricep Bypass (Push)
Chest is much stronger than triceps. Goal: gas the chest deep enough via
pre-exhaust isolation (Chest Fly first, fresh, to failure) so that on
compound presses the triceps become the limiting factor — forcing
hypertrophy stimulus on the bottleneck rather than the dominant chest.
Direct tricep isolation is minimised (overhead extensions excluded);
triceps already receive heavy stimulus from compound presses with
fatigued chest.

## Session Strategy: Bicep Bypass (Pull)
Back is much stronger than biceps. Goal: gas the back deep enough via
pre-exhaust (Straight Arm Lat Pulldown first, fresh, to failure) and
versa grips on compound pulls so that lats/mid-back become the
limiting factor — not biceps. Biceps receive sufficient indirect
stimulus from compound pulls; direct bicep work is kept minimal
(behind-the-back curl + hammer curl only; barbell preacher curl
dropped). Flag any session that has >3 direct bicep exercises as a
protocol violation.

## Session Strategy: Legs
Seated leg curl first (3s eccentric retained) to pre-exhaust hamstrings.
Single-leg hip thrust at slot 2 (fresh, left-first) for asymmetry.
Heavy bilateral hip thrust at slot 3 (1-2s eccentric, NO holds, NO band).
RDL for posterior chain stretch. Back extension (glute-biased) for
stretched-position glute stimulus. Glute kickback for isolation
(light load, form priority). Hip abduction last, no isometric holds
while monitoring recent pain pattern. Hip adduction dropped.

## Training Phase (Jun 2026 onwards)
**Phase 2: Mechanical Tension Loading.** Transitioned out of 3-second
eccentrics on compounds in favour of 1-2 second controlled eccentrics
to maximise load progression. Slow tempo (3-4s eccentric / iso-hold)
retained ONLY on isolation movements where load is inherently light
(chest fly, rear delt fly, leg curl) and TUT matters more than load.
**Do NOT recommend re-adding 3-4s eccentrics to compound lifts.**

## Medication Context (Retatrutide)
Tapering off retatrutide (GLP-1/GIP/glucagon triple agonist) due to
supply chain issue. Currently at low dose. Possible Mounjaro backup if
new batch fails verification. Appetite suppression has been wearing
off; calorie intake naturally rising. Crash days in April were
drug-mediated, not poor adherence.

## Training Style
RPE 10, sets to failure. Tempos as per Phase 2 above.
Qualitative notes logged per set — treat these as primary signal over raw numbers.

## Biomechanical Frameworks (apply to every session)
1. Hypertrophy Opportunity Cost: When tempo deviation or limit-testing occurs (e.g.,
   max-weight barbell work with fast tempos), calculate approximate TUT lost and
   mechanical tension trade-off vs. strict hypertrophy protocol. State whether the
   trade-off was justified.

2. Kinetic Chain & Cross-Body Stabilization: Never analyse an exercise in isolation.
   Bilateral deficits or lower-body pain flags must be evaluated for upstream effect on
   upper-body kinetic chain stability (hip → spinal alignment → shoulder girdle).

3. Instability Reporting: When instability ("shaking", "loose") or joint pain is logged,
   report it factually and flag as structural risk. Do NOT speculate on tendon/myonuclear
   adaptation mechanisms — stick to what was observed.

4. Cumulative Synergist Fatigue: Trace the session's exercise sequence to identify the
   true failure point. If a secondary synergist (triceps on press, biceps on pull) fails
   before the target muscle, evaluate whether order of operations was optimal.
   For Tricep Bypass / Bicep Bypass sessions: this is the INTENDED outcome — chest/back
   fatigued first so triceps/biceps become limiter on compounds. Do not flag this as a
   problem; flag it as protocol working.

## Communication Style
Zero fluff. Clinical, objective, mathematically grounded. Use tables for comparisons.
Bold key variables. Flag systemic deviations explicitly. No motivational language.
Lead with the most important finding. Quantify where possible.
Use Australian English spelling throughout (analyse, optimise, programme, colour, etc.).
""".strip()


def build_system_prompt(weight_kg: float | None) -> str:
    if weight_kg:
        weight_str = f"{weight_kg:.1f}kg"
    else:
        weight_str = "weight unavailable from weight_logs"
    return SYSTEM_PROMPT_TEMPLATE.format(weight_str=weight_str)


def get_current_weight(supabase_client) -> float | None:
    try:
        res = (
            supabase_client.table("weight_logs")
            .select("weight_kg,date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return float(res.data[0]["weight_kg"])
    except Exception as e:
        print(f"  weight lookup failed: {e}")
    return None


REQUIRED_SECTIONS = [
    "## SESSION VERDICT",
    "## KEY FINDINGS",
    "## 1. PROGRESSION",
    "## 5. FLAGS",
    "## ARCHITECTURAL GOVERNANCE",
]


def is_complete_response(content: str) -> tuple[bool, str]:
    if not content:
        return False, "empty response"
    missing = [s for s in REQUIRED_SECTIONS if s not in content]
    if missing:
        return False, f"missing sections: {', '.join(missing)}"
    return True, ""

ANALYSIS_TEMPLATE = """
Current bodyweight: {bodyweight_str}

## TODAY VS PREVIOUS (precomputed — use this as primary comparison source)
{comparison_block}

## SET-BY-SET (every working set, in order)
{set_by_set_block}

## ROUTINE ADHERENCE
{adherence_block}

## SET NOTES (primary qualitative signal — surface these prominently)
{notes_block}

---

Today's workout ({workout_type}) — raw data for reference:
{workout_data}

Full {workout_type} session history (all time, most recent first):
{same_type_history}

Last 10 sessions — any type (most recent first):
{recent_sessions}

Active routine:
{routine_data}

---

Structure your output using this exact format:

## SESSION VERDICT
One sentence. The defining mechanical characteristic of this session and its primary implication for the training goal.

## KEY FINDINGS
- [Most critical flag or risk — pain, strategy violation, structural concern]
- [Most significant positive finding or measurable progression]
- [Most actionable mechanical insight for next session]

---

## 1. PROGRESSION
Use the precomputed TODAY VS PREVIOUS table above as the source of truth — do NOT
recompute from raw data, do NOT guess. Reproduce that table here with one extra
column: "Insight" — one phrase per row explaining the meaningful change (e.g.,
"new asymmetry pattern", "load matches 2022 peak", "first time above 60kg").
Include total session tonnage row at bottom (kg×reps, warmups excluded).
For assisted/bodyweight exercises, the "net load" annotation in TODAY VS PREVIOUS
is the relevant progression metric — not raw weight_kg.
Apply Hypertrophy Opportunity Cost where tempo or load strategy deviates.

## 2. BIOMECHANICAL DEVIATIONS
Trace the exercise sequence. Apply Synergist Fatigue Protocol: identify which synergist
failed first and when. Apply Connective Tissue Lag to any instability flags.
State the biological consequence of each deviation.

## 3. PLANNED VS ACTUAL
Deviations from active routine. Include mechanical consequence of each deviation.

## 4. DIAGNOSTIC SIGNALS
- Pain: location, onset point in set, radiation pattern, kinetic chain implications
- Bilateral asymmetry: quantify deficit percentage, hypothesise root cause
- Activation quality: "felt it" / "couldn't feel" / compensation patterns

## 5. FLAGS
List only. One per line. Format: [TYPE] Exercise or issue — consequence.
Types: PLATEAU / PAIN / STRATEGY / STRUCTURAL
Flag PAIN first if present.

---

## ARCHITECTURAL GOVERNANCE
One adjustment for next session of this type. Must comply with:
- Phase 2 tempo (1-2s eccentric on compounds; slower OK only on isolation)
- Permanently excluded: barbell squat, hack squat, leg press, leg extension
- Bypass protocols: minimise direct arm work on Push/Pull
- Goal priority: glute hypertrophy > posterior chain > tricep/bicep bottleneck
If no compliant adjustment is warranted, write exactly: "Hold programme."
Otherwise: one change, with exact implementation (exercise, order index, sets, load).
"""

PAIN_KEYWORDS = re.compile(
    r"(pain|sharp|pulsating|radiating|twinge|ache|discomfort|pinch|cramping)",
    re.IGNORECASE
)


def classify_workout_type(title: str) -> str:
    t = title.lower()
    if "push" in t:
        return "Push"
    if "pull" in t:
        return "Pull"
    if "leg" in t:
        return "Legs"
    return "Unknown"


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def trim_to_budget(df: pd.DataFrame, budget_tokens: int) -> tuple[pd.DataFrame, int]:
    """Trim oldest rows (head) to fit budget. Assumes df is sorted ASC by time,
    so keeping the tail = keeping the most recent rows."""
    if df.empty:
        return df, 0
    text = df.to_string(index=False)
    if estimate_tokens(text) <= budget_tokens:
        return df, estimate_tokens(text)
    lo, hi = 1, len(df)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if estimate_tokens(df.tail(mid).to_string(index=False)) <= budget_tokens:
            lo = mid
        else:
            hi = mid - 1
    trimmed = df.tail(lo)
    dropped = len(df) - lo
    print(f"  token trim: dropped {dropped} oldest rows to fit budget")
    return trimmed, estimate_tokens(trimmed.to_string(index=False))


def load_context(conn, workout_id: str):
    all_parquet = s3_path("data/workouts_*.parquet")

    # Order by exercise_index THEN set_index so exercises appear in performed sequence.
    # Ordering by set_index alone scrambles exercises across exercise boundaries.
    workout_df = conn.execute(f"""
        SELECT * FROM read_parquet('{all_parquet}', union_by_name=true)
        WHERE workout_id = '{workout_id}'
        ORDER BY exercise_index, set_index
    """).df()

    if workout_df.empty:
        return None, pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), "Unknown"

    title = str(workout_df.iloc[0].get("workout_title") or "")
    routine_id = str(workout_df.iloc[0].get("routine_id") or "")
    workout_type = classify_workout_type(title)

    same_type_df = pd.DataFrame()
    if workout_type != "Unknown":
        # Sort chronologically ASC so the LLM reads progression forward in time.
        # Within each workout, preserve performed exercise/set order.
        same_type_df = conn.execute(f"""
            SELECT * FROM read_parquet('{all_parquet}', union_by_name=true)
            WHERE LOWER(workout_title) LIKE '%{workout_type.lower()}%'
              AND workout_id != '{workout_id}'
            ORDER BY start_time ASC, exercise_index, set_index
        """).df()

    recent_ids = conn.execute(f"""
        SELECT workout_id FROM read_parquet('{all_parquet}', union_by_name=true)
        WHERE workout_id != '{workout_id}'
        GROUP BY workout_id
        ORDER BY MAX(start_time) DESC
        LIMIT 10
    """).df()

    recent_df = pd.DataFrame()
    if not recent_ids.empty:
        ids = tuple(recent_ids["workout_id"].tolist())
        ids_sql = str(ids) if len(ids) > 1 else f"('{ids[0]}')"
        recent_df = conn.execute(f"""
            SELECT * FROM read_parquet('{all_parquet}', union_by_name=true)
            WHERE workout_id IN {ids_sql}
            ORDER BY start_time ASC, exercise_index, set_index
        """).df()

    routine_df = pd.DataFrame()
    if routine_id:
        routines_path = s3_path("data/routines.parquet")
        start_time = str(workout_df.iloc[0].get("start_time") or "")
        try:
            # Get ALL rows from the most recent routine snapshot at or before workout start.
            # (Previous LIMIT 1 only returned one set of one exercise — bug.)
            routine_df = conn.execute(f"""
                SELECT * FROM read_parquet('{routines_path}')
                WHERE hevy_id = '{routine_id}'
                  AND updated_at = (
                    SELECT MAX(updated_at) FROM read_parquet('{routines_path}')
                    WHERE hevy_id = '{routine_id}' AND updated_at <= '{start_time}'
                  )
                ORDER BY exercise_index, set_index
            """).df()
        except Exception as e:
            print(f"  routine lookup failed: {e}")

    return workout_df, same_type_df, recent_df, routine_df, workout_type


ASSISTED_KEYWORDS = ("assisted",)
BODYWEIGHT_EXERCISE_KEYWORDS = ("pull up", "chin up", "dip", "push up", "muscle up", "inverted row")


def is_assisted(exercise_title: str) -> bool:
    return any(k in exercise_title.lower() for k in ASSISTED_KEYWORDS)


def is_bodyweight(exercise_title: str) -> bool:
    t = exercise_title.lower()
    if "machine" in t:
        return False
    return any(k in t for k in BODYWEIGHT_EXERCISE_KEYWORDS)


def format_load(exercise_title: str, weight_kg, reps, bodyweight: float | None) -> str:
    if pd.isna(weight_kg) or weight_kg is None:
        w_s = "—"
        w_val = 0.0
    else:
        w_val = float(weight_kg)
        w_s = f"{w_val:.1f}"
    r_s = f"{int(reps)}" if not pd.isna(reps) else "—"
    base = f"{w_s}kg × {r_s}"
    if not bodyweight:
        return base
    if is_assisted(exercise_title) and w_val:
        net = bodyweight - w_val
        return f"{base} [net {net:.0f}kg = bw {bodyweight:.0f} − assist {w_val:.0f}]"
    if is_bodyweight(exercise_title) and w_val == 0:
        return f"bw {bodyweight:.0f}kg × {r_s}"
    return base


def _e1rm(weight, reps, exercise_title: str | None = None, bodyweight: float | None = None):
    """Estimated 1RM (Epley). For loaded exercises returns standard e1RM (positive kg).
    For assisted/bodyweight, returns 1RM RELATIVE TO BODYWEIGHT (signed):
      - Positive: can hang this much weight on top of bw for 1 rep
      - Negative: still needs this much assistance to do 1 strict rep
      - Zero: exactly 1 strict unweighted rep is the max
    Bodyweight is approximated from current for historical entries.
    """
    if pd.isna(weight) or pd.isna(reps) or weight is None or reps is None:
        return 0.0
    w = float(weight)
    r = float(reps)
    if exercise_title and bodyweight:
        if is_assisted(exercise_title):
            net_load = bodyweight - w
            if net_load <= 0:
                # Assistance >= bw, impossible to ever do a strict rep
                return -bodyweight
            # 1RM relative to bw: net_load * Epley factor - bw
            return net_load * (1 + r / 30) - bodyweight
        if is_bodyweight(exercise_title):
            # Pure bw (w=0) or weighted bw (vest/belt adds w)
            return (bodyweight + w) * (1 + r / 30) - bodyweight
    return w * (1 + r / 30)


def e1rm_label(exercise_title: str | None) -> str:
    """Y-axis label for charts — context-aware per exercise type."""
    if exercise_title and (is_assisted(exercise_title) or is_bodyweight(exercise_title)):
        return "1RM relative to bodyweight (kg)"
    return "Estimated 1RM (kg)"


def e1rm_unit(exercise_title: str | None) -> str:
    """Suffix for e1RM annotations."""
    if exercise_title and (is_assisted(exercise_title) or is_bodyweight(exercise_title)):
        return "kg BW-rel"
    return "kg e1RM"


def build_comparison_block(workout_df, same_type_df, bodyweight) -> str:
    if workout_df.empty:
        return "No comparison data."
    today_id = str(workout_df["workout_id"].iloc[0])
    lines = [
        "| Exercise | Today top | Previous session top | All-time peak | Status |",
        "|----------|-----------|---------------------|---------------|--------|",
    ]
    for ex in workout_df["exercise_title"].dropna().unique():
        today_sets = workout_df[
            (workout_df["exercise_title"] == ex)
            & (workout_df["set_type"].isin(["normal", "failure"]))
        ].copy()
        if today_sets.empty:
            continue
        today_sets["e1rm"] = today_sets.apply(lambda r: _e1rm(r["weight_kg"], r["reps"], ex, bodyweight), axis=1)
        today_top = today_sets.loc[today_sets["e1rm"].idxmax()]
        today_load = format_load(ex, today_top["weight_kg"], today_top["reps"], bodyweight)
        today_e = float(today_top["e1rm"])
        unit = e1rm_unit(ex)
        today_str = f"{today_load} ({today_e:+.0f} {unit})" if "BW-rel" in unit else f"{today_load} (e1RM {today_e:.0f})"

        prev_str = "—"
        all_time_str = "—"
        prev_e = None
        all_time_e = None
        hist = same_type_df[
            (same_type_df["exercise_title"] == ex)
            & (same_type_df["set_type"].isin(["normal", "failure"]))
            & (same_type_df["workout_id"].astype(str) != today_id)
        ].copy()
        if not hist.empty:
            hist["e1rm"] = hist.apply(lambda r: _e1rm(r["weight_kg"], r["reps"], ex, bodyweight), axis=1)
            hist["start_time"] = pd.to_datetime(hist["start_time"], utc=True)
            # Previous session top set
            most_recent_wid = hist.sort_values("start_time", ascending=False)["workout_id"].iloc[0]
            prev_sess = hist[hist["workout_id"] == most_recent_wid]
            prev_top = prev_sess.loc[prev_sess["e1rm"].idxmax()]
            prev_dt = prev_top["start_time"].strftime("%b %d")
            prev_load = format_load(ex, prev_top["weight_kg"], prev_top["reps"], bodyweight)
            prev_e = float(prev_top["e1rm"])
            prev_str = f"{prev_load} ({prev_e:+.0f} {unit}, {prev_dt})" if "BW-rel" in unit else f"{prev_load} (e1RM {prev_e:.0f}, {prev_dt})"
            # All-time peak e1RM
            atb = hist.loc[hist["e1rm"].idxmax()]
            atb_dt = atb["start_time"].strftime("%Y-%m-%d")
            atb_load = format_load(ex, atb["weight_kg"], atb["reps"], bodyweight)
            all_time_e = float(atb["e1rm"])
            all_time_str = f"{atb_load} ({all_time_e:+.0f} {unit}, {atb_dt})" if "BW-rel" in unit else f"{atb_load} (e1RM {all_time_e:.0f}, {atb_dt})"

        if prev_e is None:
            status = "BASELINE (first time)"
        elif today_e > prev_e * 1.02:
            status = "INCREASED"
        elif today_e < prev_e * 0.98:
            status = "REGRESSED"
        else:
            status = "HELD"
        if all_time_e and today_e >= all_time_e:
            status = "NEW ALL-TIME PEAK"

        lines.append(f"| {ex} | {today_str} | {prev_str} | {all_time_str} | {status} |")
    return "\n".join(lines)


def build_set_by_set_block(workout_df, bodyweight) -> str:
    if workout_df.empty:
        return "No set data."
    lines = []
    for ex in workout_df["exercise_title"].dropna().unique():
        ex_sets = workout_df[workout_df["exercise_title"] == ex].sort_values("set_index")
        set_strs = []
        for _, s in ex_sets.iterrows():
            w = s.get("weight_kg")
            r = s.get("reps")
            t = s.get("set_type")
            rpe = s.get("rpe")
            prefix = "W:" if t == "warmup" else ""
            if pd.isna(w) and pd.isna(r):
                set_strs.append(f"{prefix}(no log)")
                continue
            w_val = 0.0 if pd.isna(w) else float(w)
            r_val = "—" if pd.isna(r) else f"{int(r)}"
            if is_assisted(ex) and bodyweight and w_val:
                net = bodyweight - w_val
                set_strs.append(f"{prefix}{w_val:.1f}kg × {r_val} [net {net:.0f}]")
            else:
                set_strs.append(f"{prefix}{w_val:.1f}kg × {r_val}{f'@RPE{int(rpe)}' if rpe and not pd.isna(rpe) else ''}")
        lines.append(f"- **{ex}**: " + " | ".join(set_strs))
    return "\n".join(lines)


def build_adherence_block(workout_df, routine_df) -> str:
    if routine_df.empty:
        return "No active routine snapshot — adherence check skipped."
    targets = {}
    for _, r in routine_df.iterrows():
        title = r.get("exercise_title")
        if not title:
            continue
        rec = targets.setdefault(title, {
            "rep_lo": r.get("rep_range_start"),
            "rep_hi": r.get("rep_range_end"),
            "rest_s": r.get("rest_seconds"),
            "set_count": 0,
        })
        rec["set_count"] += 1
    lines = [
        "| Exercise | Target reps × sets | Actual top reps × sets | Adherence |",
        "|----------|-------------------|----------------------|-----------|",
    ]
    for ex in workout_df["exercise_title"].dropna().unique():
        actual_sets = workout_df[
            (workout_df["exercise_title"] == ex)
            & (workout_df["set_type"].isin(["normal", "failure"]))
        ]
        n_actual = len(actual_sets)
        actual_top_reps = int(actual_sets["reps"].max()) if not actual_sets.empty and not pd.isna(actual_sets["reps"].max()) else 0
        target = targets.get(ex)
        if not target:
            lines.append(f"| {ex} | not in routine | {actual_top_reps} × {n_actual} | OFF-ROUTINE |")
            continue
        lo, hi, sets_target = target["rep_lo"], target["rep_hi"], target["set_count"]
        if pd.isna(lo) or pd.isna(hi):
            target_str = "no rep target"
            adherence = "NO TARGET"
        else:
            target_str = f"{int(lo)}-{int(hi)} × {sets_target}"
            if actual_top_reps > int(hi):
                adherence = "ABOVE — increase load next session"
            elif actual_top_reps < int(lo):
                adherence = "BELOW — too heavy or under-recovered"
            else:
                adherence = "ON TARGET"
            if n_actual != sets_target:
                adherence += f" (sets: {n_actual} vs {sets_target} planned)"
        lines.append(f"| {ex} | {target_str} | {actual_top_reps} × {n_actual} | {adherence} |")
    return "\n".join(lines)


def build_notes_block(workout_df) -> str:
    if workout_df.empty:
        return "No notes logged."
    lines = []
    seen = set()
    for ex in workout_df["exercise_title"].dropna().unique():
        ex_rows = workout_df[workout_df["exercise_title"] == ex]
        notes_vals = ex_rows["exercise_notes"].dropna().unique()
        for n in notes_vals:
            s = str(n).strip()
            if not s or s.lower() == "nan":
                continue
            key = (ex, s)
            if key in seen:
                continue
            seen.add(key)
            lines.append(f"### {ex}")
            lines.append(s)
            lines.append("")
    return "\n".join(lines).strip() if lines else "No notes logged this session."


def build_prompt(workout_df, same_type_df, recent_df, routine_df, workout_type, bodyweight):
    # Precomputed analysis blocks — feed structured findings to LLM rather than
    # forcing it to derive from raw tables.
    comparison_block = build_comparison_block(workout_df, same_type_df, bodyweight)
    set_by_set_block = build_set_by_set_block(workout_df, bodyweight)
    adherence_block = build_adherence_block(workout_df, routine_df)
    notes_block = build_notes_block(workout_df)

    system_tokens = estimate_tokens(SYSTEM_PROMPT_TEMPLATE)
    template_tokens = estimate_tokens(ANALYSIS_TEMPLATE)
    workout_tokens = estimate_tokens(workout_df.to_string(index=False))
    recent_tokens = estimate_tokens(recent_df.to_string(index=False)) if not recent_df.empty else 0
    routine_tokens = estimate_tokens(routine_df.to_string(index=False)) if not routine_df.empty else 0
    blocks_tokens = sum(estimate_tokens(b) for b in [comparison_block, set_by_set_block, adherence_block, notes_block])

    fixed_tokens = system_tokens + template_tokens + workout_tokens + recent_tokens + routine_tokens + blocks_tokens
    same_type_budget = TOKEN_INPUT_BUDGET - fixed_tokens

    same_type_df, same_type_tokens = trim_to_budget(same_type_df, same_type_budget)
    total_estimated = fixed_tokens + same_type_tokens
    print(f"  estimated input tokens: {total_estimated:,} "
          f"(same-type: {same_type_tokens:,}, budget: {TOKEN_INPUT_BUDGET:,})")

    return ANALYSIS_TEMPLATE.format(
        workout_data=workout_df.to_string(index=False),
        workout_type=workout_type,
        same_type_history=same_type_df.to_string(index=False) if not same_type_df.empty else "No prior sessions.",
        recent_sessions=recent_df.to_string(index=False) if not recent_df.empty else "No recent sessions.",
        routine_data=routine_df.to_string(index=False) if not routine_df.empty else "No routine data.",
        bodyweight_str=f"{bodyweight:.1f}kg" if bodyweight else "unknown",
        comparison_block=comparison_block,
        set_by_set_block=set_by_set_block,
        adherence_block=adherence_block,
        notes_block=notes_block,
    )


BG      = "#1a1a1a"
FG      = "#e0e0e0"
GRID    = "#2e2e2e"
SPINE   = "#3a3a3a"
C_BLUE  = "#4d9fef"
C_RED   = "#ff5252"
C_GREEN = "#2ecc71"


def _dark_ax(ax, title: str):
    ax.set_facecolor(BG)
    ax.set_title(title, color=FG, fontsize=10, fontweight="bold", pad=8)
    ax.tick_params(colors=FG, labelsize=8)
    ax.yaxis.label.set_color(FG)
    ax.xaxis.label.set_color(FG)
    for spine in ax.spines.values():
        spine.set_color(SPINE)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.5, zorder=0)


def _save_chart(fig) -> str:
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=BG)
    buf.seek(0)
    plt.close(fig)
    return base64.b64encode(buf.read()).decode()


WINDOW_WEEKS = 24  # last 6 months × 4 weeks


def _apply_date_axis(ax, window_end):
    """Force a fixed 24-week date window so gaps appear as gaps."""
    window_start = window_end - timedelta(weeks=WINDOW_WEEKS)
    ax.set_xlim(window_start, window_end)
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=4))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    for label in ax.get_xticklabels():
        label.set_rotation(45)
        label.set_ha("right")


def generate_charts(workout_df: pd.DataFrame, same_type_df: pd.DataFrame, workout_type: str, bodyweight: float | None = None) -> list[tuple[str, str]]:
    """Return list of (title, base64_png) — one chart per subject."""
    charts = []
    if workout_df.empty:
        return charts

    today_id = str(workout_df["workout_id"].iloc[0])
    all_data = pd.concat([same_type_df, workout_df], ignore_index=True)
    all_data["start_time"] = pd.to_datetime(all_data["start_time"], utc=True)
    all_data["weight_kg"] = pd.to_numeric(all_data["weight_kg"], errors="coerce")
    all_data["reps"] = pd.to_numeric(all_data["reps"], errors="coerce")
    working = all_data[all_data["set_type"] != "warmup"].copy()
    working["tonnage"] = working["weight_kg"].fillna(0) * working["reps"].fillna(0)
    # e1RM per set, with net-load handling for assisted/bodyweight exercises
    working["e1rm"] = working.apply(
        lambda r: _e1rm(r["weight_kg"], r["reps"], r.get("exercise_title"), bodyweight),
        axis=1,
    )

    today_start = pd.to_datetime(workout_df["start_time"].iloc[0], utc=True)
    window_end = today_start + timedelta(days=1)
    window_start = window_end - timedelta(weeks=WINDOW_WEEKS)

    # ── Chart 1: Session Tonnage Trend ──────────────────────────────────────
    session_tonnage = (
        working.groupby(["workout_id", "start_time"])["tonnage"]
        .sum().reset_index()
        .sort_values("start_time")
    )
    session_tonnage = session_tonnage[
        (session_tonnage["start_time"] >= window_start)
        & (session_tonnage["start_time"] <= window_end)
    ]
    if len(session_tonnage) >= 2:
        fig, ax = plt.subplots(figsize=(8, 3), facecolor=BG)
        colors = [C_RED if str(wid) == today_id else C_BLUE for wid in session_tonnage["workout_id"]]
        dates = session_tonnage["start_time"]
        ax.bar(dates, session_tonnage["tonnage"], color=colors,
               width=2.5, zorder=2, align="center")

        # % change annotation on today's bar
        today_row = session_tonnage[session_tonnage["workout_id"].astype(str) == today_id]
        if not today_row.empty:
            today_dt = today_row["start_time"].iloc[0]
            today_val = float(today_row["tonnage"].iloc[0])
            prior = session_tonnage[session_tonnage["start_time"] < today_dt]
            if not prior.empty:
                prev_val = float(prior.iloc[-1]["tonnage"])
                if prev_val > 0:
                    pct = (today_val - prev_val) / prev_val * 100
                    sign = "+" if pct >= 0 else ""
                    ax.annotate(
                        f"{sign}{pct:.1f}%",
                        xy=(today_dt, today_val),
                        xytext=(0, 6), textcoords="offset points",
                        ha="center", color=C_GREEN if pct >= 0 else C_RED,
                        fontsize=9, fontweight="bold",
                    )

        ax.set_ylabel("Tonnage (kg×reps)")
        ax.legend(handles=[
            mpatches.Patch(color=C_RED, label="Today"),
            mpatches.Patch(color=C_BLUE, label="Prior"),
        ], fontsize=8, facecolor=BG, edgecolor=SPINE, labelcolor=FG)
        _dark_ax(ax, f"{workout_type} — Session Volume Trend (last {WINDOW_WEEKS} weeks)")
        _apply_date_axis(ax, window_end)
        plt.tight_layout()
        charts.append(("Volume Trend", _save_chart(fig)))

    # ── Charts 2+: One chart per exercise (estimated 1RM) ───────────────────
    today_exercises = workout_df["exercise_title"].unique().tolist()
    hist_exercises = set(same_type_df["exercise_title"].unique()) if not same_type_df.empty else set()
    exercises_to_plot = [e for e in today_exercises if e in hist_exercises][:6]

    for exercise in exercises_to_plot:
        ex_data = working[working["exercise_title"] == exercise].copy()
        # Best e1RM per session — captures progression even when reps×weight tradeoff changes
        top = (
            ex_data.groupby(["workout_id", "start_time"])["e1rm"]
            .max().reset_index()
            .sort_values("start_time")
        )
        top = top[
            (top["start_time"] >= window_start)
            & (top["start_time"] <= window_end)
        ]
        if len(top) < 2:
            continue

        fig, ax = plt.subplots(figsize=(8, 2.8), facecolor=BG)
        ax.plot(top["start_time"], top["e1rm"], color=C_BLUE, linewidth=2,
                marker="o", markersize=5, zorder=2)
        ax.fill_between(top["start_time"], top["e1rm"], alpha=0.15, color=C_BLUE, zorder=1)

        # highlight today with e1RM + % change vs previous session
        today_mask = top["workout_id"].astype(str) == today_id
        if today_mask.any():
            today_row = top[today_mask].iloc[0]
            today_dt = today_row["start_time"]
            today_e = float(today_row["e1rm"])
            ax.plot(today_dt, today_e, "o", color=C_RED, markersize=9, zorder=3)
            unit = e1rm_unit(exercise)
            today_label = f"{today_e:+.0f} {unit}" if "BW-rel" in unit else f"{today_e:.0f} {unit}"
            ax.annotate(
                today_label,
                xy=(today_dt, today_e),
                xytext=(6, 6), textcoords="offset points",
                color=C_RED, fontsize=8, fontweight="bold",
            )
            prior = top[top["start_time"] < today_dt]
            if not prior.empty:
                prev_e = float(prior.iloc[-1]["e1rm"])
                if prev_e > 0:
                    pct = (today_e - prev_e) / prev_e * 100
                    sign = "+" if pct >= 0 else ""
                    pct_color = C_GREEN if pct >= 0 else C_RED
                    ax.annotate(
                        f"{sign}{pct:.1f}%",
                        xy=(today_dt, today_e),
                        xytext=(6, 20), textcoords="offset points",
                        color=pct_color, fontsize=8, fontweight="bold",
                    )

        ax.set_ylabel(e1rm_label(exercise))
        # Add zero reference line for bw-relative exercises
        if is_assisted(exercise) or is_bodyweight(exercise):
            ax.axhline(0, color=FG, linewidth=0.6, linestyle="--", alpha=0.5, zorder=1)
        chart_title_suffix = "1RM rel. bw" if is_assisted(exercise) or is_bodyweight(exercise) else "e1RM"
        _dark_ax(ax, f"{exercise} — {chart_title_suffix} (last {WINDOW_WEEKS} weeks)")
        _apply_date_axis(ax, window_end)
        plt.tight_layout()
        charts.append((exercise, _save_chart(fig)))

    return charts


def call_gemini(gemini_client, prompt: str, system_prompt: str) -> tuple[str, str, int | None]:
    last_exc = None
    for model_name in MODELS:
        for attempt in range(3):
            try:
                response = gemini_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        max_output_tokens=8192,
                    ),
                )
                tokens = getattr(response.usage_metadata, "total_token_count", None)
                content = response.text
                complete, reason = is_complete_response(content)
                if not complete:
                    print(f"  {model_name}: incomplete response ({reason}), trying next model")
                    last_exc = RuntimeError(f"{model_name}: incomplete response — {reason}")
                    break
                print(f"  model: {model_name} | tokens: {tokens}")
                return content, model_name, tokens
            except Exception as e:
                last_exc = e
                if "RESOURCE_EXHAUSTED" in str(e) and attempt < 2:
                    wait = 15 * (attempt + 1)
                    print(f"  {model_name}: rate limited, waiting {wait}s (attempt {attempt+1}/3)")
                    time.sleep(wait)
                else:
                    print(f"  {model_name}: {type(e).__name__}, trying next model")
                    break
    raise RuntimeError(f"All models exhausted. Last error: {last_exc}")


def format_email_html(content: str, workout_title: str, workout_date: str,
                      charts: list[tuple[str, str]]) -> str:
    html_body = md.markdown(content, extensions=["tables", "fenced_code", "nl2br"])

    charts_html = ""
    for _title, b64 in charts:
        charts_html += (
            f'<div style="margin: 16px 0;">'
            f'<img src="data:image/png;base64,{b64}" '
            f'style="max-width: 100%; border-radius: 4px; border: 1px solid #eee;">'
            f'</div>'
        )

    return f"""
<html>
<head>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         max-width: 720px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #fff; }}
  h2 {{ margin-top: 28px; margin-bottom: 6px; font-size: 16px; }}
  h3 {{ margin-top: 22px; margin-bottom: 4px; font-size: 13px; text-transform: uppercase;
        letter-spacing: 0.6px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 4px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }}
  th {{ background: #f5f5f5; text-align: left; padding: 7px 10px; border: 1px solid #ddd; font-weight: 600; }}
  td {{ padding: 7px 10px; border: 1px solid #ddd; vertical-align: top; line-height: 1.4; }}
  tr:nth-child(even) td {{ background: #fafafa; }}
  pre {{ background: #f4f4f4; padding: 12px; border-radius: 4px; font-size: 12px;
         overflow-x: auto; white-space: pre-wrap; }}
  code {{ font-family: 'SF Mono', Consolas, monospace; font-size: 12px; }}
  ul, ol {{ padding-left: 20px; margin: 8px 0; }}
  li {{ margin: 4px 0; line-height: 1.5; }}
  hr {{ border: none; border-top: 1px solid #eee; margin: 20px 0; }}
  strong {{ color: #111; }}
  p {{ line-height: 1.6; margin: 8px 0; }}
  .header {{ color: #555; font-size: 13px; border-bottom: 2px solid #eee;
             padding-bottom: 12px; margin-bottom: 20px; }}
  .footer {{ color: #aaa; font-size: 11px; margin-top: 32px;
             border-top: 1px solid #eee; padding-top: 12px; }}
  .charts {{ margin: 20px 0; padding: 16px; background: #fafafa;
             border-radius: 6px; border: 1px solid #eee; }}
</style>
</head>
<body>
<div class="header">
  <strong style="font-size: 15px;">{workout_title}</strong>
  &nbsp;·&nbsp; {workout_date}
</div>
<div class="charts">{charts_html}</div>
{html_body}
<div class="footer">Generated by Hevy Analysis pipeline</div>
</body>
</html>
"""


def send_email(subject: str, content: str, workout_title: str, workout_date: str,
               charts: list[tuple[str, str]]):
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        print("  email: RESEND_API_KEY not set, skipping.")
        return
    to_email = os.environ.get("NOTIFY_EMAIL", "benjamin_dang@outlook.com")
    html = format_email_html(content, workout_title, workout_date, charts)
    resp = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "from": "onboarding@resend.dev",
            "to": [to_email],
            "subject": subject,
            "html": html,
        },
        timeout=15,
    )
    if resp.status_code in (200, 201):
        print(f"  email sent to {to_email}")
    else:
        print(f"  email failed: {resp.status_code} {resp.text}")


def analyse_workout(workout_id: str, conn, supabase_client, gemini_client):
    workout_df, same_type_df, recent_df, routine_df, workout_type = load_context(conn, workout_id)
    if workout_df is None or workout_df.empty:
        print(f"  {workout_id}: not found in Parquet — skipping.")
        return

    current_weight = get_current_weight(supabase_client)
    if current_weight:
        print(f"  current weight from Supabase: {current_weight:.1f}kg")
    system_prompt = build_system_prompt(current_weight)

    charts = generate_charts(workout_df, same_type_df, workout_type, current_weight)
    print(f"  generated {len(charts)} chart(s)")

    prompt = build_prompt(workout_df, same_type_df, recent_df, routine_df, workout_type, current_weight)
    content, model_used, tokens = call_gemini(gemini_client, prompt, system_prompt)

    workout_title = str(workout_df.iloc[0].get("workout_title") or workout_id)
    workout_date = str(workout_df.iloc[0].get("start_time") or "")[:10]

    supabase_client.table("analyses").insert({
        "type": "post_workout",
        "workout_id": workout_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "content": content,
        "model": model_used,
        "tokens_used": tokens,
    }).execute()

    send_email(
        subject=f"[Hevy] {workout_title} — {workout_date}",
        content=content,
        workout_title=workout_title,
        workout_date=workout_date,
        charts=charts,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workout-id", help="Analyse a specific workout ID (default: latest)")
    parser.add_argument("--force", action="store_true", help="Re-analyse even if already in analyses table")
    args = parser.parse_args()

    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    conn = get_conn()
    supabase_client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    if args.workout_id:
        workout_id = args.workout_id
    else:
        all_parquet = s3_path("data/workouts_*.parquet")
        latest = conn.execute(f"""
            SELECT workout_id FROM read_parquet('{all_parquet}', union_by_name=true)
            ORDER BY start_time DESC
            LIMIT 1
        """).df()
        if latest.empty:
            print("No workouts found in Parquet.")
            return
        workout_id = latest["workout_id"].iloc[0]

    if not args.force:
        existing = supabase_client.table("analyses").select("workout_id").eq("workout_id", workout_id).execute()
        if existing.data:
            print(f"{workout_id}: already analysed. Use --force to re-run.")
            return

    print(f"Analysing {workout_id}...")
    analyse_workout(workout_id, conn, supabase_client, gemini_client)
    print("Done.")


if __name__ == "__main__":
    main()
