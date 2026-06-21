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

SYSTEM_PROMPT = """
## Athlete Profile
- 188cm, male. Currently ~103kg (down ~19kg from peak via retatrutide).
- Knee hyperextension history — quad dominant, glutes chronically underactivated.
  Do NOT flag standing hip hinge under heavy load as a regression.
- Chest overdeveloped relative to shoulders and triceps.

## Training Goals (priority order)
1. Address tricep bottleneck on Push sessions.
2. Address bicep bottleneck on Pull sessions.
3. Build glutes — compensating for years of knee hyperextension and quad dominance.
4. Lateral delt width and trap/rhomboid activation for posture correction.
5. Maximise hypertrophy across all muscle groups.
6. Body recomposition — preserve muscle through continued weight loss on retatrutide.

## Session Strategies
- Push (Tricep Bypass): pec dec first to pre-exhaust chest; compound press then
  targets triceps and anterior delts as primary movers.
- Pull (Bicep Bypass): versa grips on all compound pulls to remove bicep bottleneck;
  isolate biceps fresh at end of session.
- Legs: seated leg curl first to pre-exhaust hamstrings; hip thrust targets glutes
  as primary mover.

## Training Style
RPE 10, sets to failure. 3-4s eccentrics and iso holds where noted.
Qualitative notes logged per set — treat these as primary signal over raw numbers.

## Biomechanical Frameworks (apply to every session)
1. Hypertrophy Opportunity Cost: When tempo deviation or limit-testing occurs (e.g.,
   max-weight barbell work with fast tempos), calculate approximate TUT lost and
   mechanical tension trade-off vs. strict hypertrophy protocol. State whether the
   trade-off was justified.

2. Kinetic Chain & Cross-Body Stabilization: Never analyse an exercise in isolation.
   Bilateral deficits or lower-body pain flags must be evaluated for upstream effect on
   upper-body kinetic chain stability (hip → spinal alignment → shoulder girdle).

3. Connective Tissue Lag: When instability ("shaking", "loose") or joint pain is logged,
   factor in tendon/ligament adaptation lag behind myonuclear growth. Flag as structural
   risk vs. temporary strength ceiling.

4. Cumulative Synergist Fatigue: Trace the session's exercise sequence to identify the
   true failure point. If a secondary synergist (triceps on press, biceps on pull) fails
   before the target muscle, evaluate whether order of operations was optimal.

## Communication Style
Zero fluff. Clinical, objective, mathematically grounded. Use tables for comparisons.
Bold key variables. Flag systemic deviations explicitly. No motivational language.
Lead with the most important finding. Quantify where possible.
Use Australian English spelling throughout (analyse, optimise, programme, colour, etc.).
""".strip()

ANALYSIS_TEMPLATE = """
Today's workout ({workout_type}):
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
Table: Exercise | Today Top Set | Previous Top Set | Delta | Status | Trend (from full history)
Status labels: INCREASED / HELD / REGRESSED / BASELINE
Include total session tonnage row at bottom (kg×reps, warmups excluded).
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
One strict mechanical adjustment for the next session of this type.
Not a list. One change. State the exact implementation (exercise, order index, sets, load).
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
    if df.empty:
        return df, 0
    text = df.to_string(index=False)
    if estimate_tokens(text) <= budget_tokens:
        return df, estimate_tokens(text)
    lo, hi = 1, len(df)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if estimate_tokens(df.head(mid).to_string(index=False)) <= budget_tokens:
            lo = mid
        else:
            hi = mid - 1
    trimmed = df.head(lo)
    dropped = len(df) - lo
    print(f"  token trim: dropped {dropped} oldest rows to fit budget")
    return trimmed, estimate_tokens(trimmed.to_string(index=False))


def load_context(conn, workout_id: str):
    all_parquet = s3_path("data/workouts_*.parquet")

    workout_df = conn.execute(f"""
        SELECT * FROM read_parquet('{all_parquet}', union_by_name=true)
        WHERE workout_id = '{workout_id}'
        ORDER BY set_index
    """).df()

    if workout_df.empty:
        return None, pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), "Unknown"

    title = str(workout_df.iloc[0].get("workout_title") or "")
    routine_id = str(workout_df.iloc[0].get("routine_id") or "")
    workout_type = classify_workout_type(title)

    same_type_df = pd.DataFrame()
    if workout_type != "Unknown":
        same_type_df = conn.execute(f"""
            SELECT * FROM read_parquet('{all_parquet}', union_by_name=true)
            WHERE LOWER(workout_title) LIKE '%{workout_type.lower()}%'
              AND workout_id != '{workout_id}'
            ORDER BY start_time DESC
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
            ORDER BY start_time DESC
        """).df()

    routine_df = pd.DataFrame()
    if routine_id:
        routines_path = s3_path("data/routines.parquet")
        start_time = str(workout_df.iloc[0].get("start_time") or "")
        try:
            routine_df = conn.execute(f"""
                SELECT * FROM read_parquet('{routines_path}')
                WHERE hevy_id = '{routine_id}'
                  AND updated_at <= '{start_time}'
                ORDER BY updated_at DESC
                LIMIT 1
            """).df()
        except Exception:
            pass

    return workout_df, same_type_df, recent_df, routine_df, workout_type


def build_prompt(workout_df, same_type_df, recent_df, routine_df, workout_type):
    system_tokens = estimate_tokens(SYSTEM_PROMPT)
    template_tokens = estimate_tokens(ANALYSIS_TEMPLATE)
    workout_tokens = estimate_tokens(workout_df.to_string(index=False))
    recent_tokens = estimate_tokens(recent_df.to_string(index=False)) if not recent_df.empty else 0
    routine_tokens = estimate_tokens(routine_df.to_string(index=False)) if not routine_df.empty else 0

    fixed_tokens = system_tokens + template_tokens + workout_tokens + recent_tokens + routine_tokens
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


def generate_charts(workout_df: pd.DataFrame, same_type_df: pd.DataFrame, workout_type: str) -> list[tuple[str, str]]:
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

    # ── Chart 1: Session Tonnage Trend ──────────────────────────────────────
    session_tonnage = (
        working.groupby(["workout_id", "start_time"])["tonnage"]
        .sum().reset_index()
        .sort_values("start_time")
        .tail(20)
    )
    if len(session_tonnage) >= 2:
        fig, ax = plt.subplots(figsize=(8, 3), facecolor=BG)
        colors = [C_RED if str(wid) == today_id else C_BLUE for wid in session_tonnage["workout_id"]]
        x = list(range(len(session_tonnage)))
        ax.bar(x, session_tonnage["tonnage"], color=colors, width=0.7, zorder=2)

        # % change annotation on today's bar
        today_idx = next(
            (i for i, wid in enumerate(session_tonnage["workout_id"]) if str(wid) == today_id), None
        )
        if today_idx is not None and today_idx > 0:
            today_val = float(session_tonnage.iloc[today_idx]["tonnage"])
            prev_val = float(session_tonnage.iloc[today_idx - 1]["tonnage"])
            if prev_val > 0:
                pct = (today_val - prev_val) / prev_val * 100
                sign = "+" if pct >= 0 else ""
                ax.annotate(
                    f"{sign}{pct:.1f}%",
                    xy=(today_idx, today_val),
                    xytext=(0, 6), textcoords="offset points",
                    ha="center", color=C_GREEN if pct >= 0 else C_RED,
                    fontsize=9, fontweight="bold",
                )

        labels = [t.strftime("%b %d") for t in session_tonnage["start_time"]]
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=45, ha="right")
        ax.set_ylabel("Tonnage (kg×reps)")
        ax.legend(handles=[
            mpatches.Patch(color=C_RED, label="Today"),
            mpatches.Patch(color=C_BLUE, label="Prior"),
        ], fontsize=8, facecolor=BG, edgecolor=SPINE, labelcolor=FG)
        _dark_ax(ax, f"{workout_type} — Session Volume Trend")
        plt.tight_layout()
        charts.append(("Volume Trend", _save_chart(fig)))

    # ── Charts 2+: One chart per exercise ───────────────────────────────────
    today_exercises = workout_df["exercise_title"].unique().tolist()
    hist_exercises = set(same_type_df["exercise_title"].unique()) if not same_type_df.empty else set()
    exercises_to_plot = [e for e in today_exercises if e in hist_exercises][:6]

    for exercise in exercises_to_plot:
        ex_data = working[working["exercise_title"] == exercise].copy()
        top = (
            ex_data.groupby(["workout_id", "start_time"])["weight_kg"]
            .max().reset_index()
            .sort_values("start_time")
            .tail(14)
        )
        if len(top) < 2:
            continue

        fig, ax = plt.subplots(figsize=(8, 2.8), facecolor=BG)
        x = list(range(len(top)))
        ax.plot(x, top["weight_kg"].tolist(), color=C_BLUE, linewidth=2,
                marker="o", markersize=5, zorder=2)

        # fill area under line
        ax.fill_between(x, top["weight_kg"].tolist(), alpha=0.15, color=C_BLUE, zorder=1)

        # highlight today with weight + % change vs previous session
        today_mask = top["workout_id"].astype(str) == today_id
        if today_mask.any():
            ti = int(today_mask.values.nonzero()[0][0])
            today_w = float(top.iloc[ti]["weight_kg"])
            ax.plot(ti, today_w, "o", color=C_RED, markersize=9, zorder=3)
            ax.annotate(
                f"{today_w:.1f} kg",
                xy=(ti, today_w),
                xytext=(6, 6), textcoords="offset points",
                color=C_RED, fontsize=8, fontweight="bold",
            )
            if ti > 0:
                prev_w = float(top.iloc[ti - 1]["weight_kg"])
                if prev_w > 0:
                    pct = (today_w - prev_w) / prev_w * 100
                    sign = "+" if pct >= 0 else ""
                    pct_color = C_GREEN if pct >= 0 else C_RED
                    ax.annotate(
                        f"{sign}{pct:.1f}%",
                        xy=(ti, today_w),
                        xytext=(6, 20), textcoords="offset points",
                        color=pct_color, fontsize=8, fontweight="bold",
                    )

        labels = [t.strftime("%b %d") for t in top["start_time"]]
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=45, ha="right")
        ax.set_ylabel("kg")
        _dark_ax(ax, exercise)
        plt.tight_layout()
        charts.append((exercise, _save_chart(fig)))

    return charts


def call_gemini(gemini_client, prompt: str) -> tuple[str, str, int | None]:
    last_exc = None
    for model_name in MODELS:
        for attempt in range(3):
            try:
                response = gemini_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        max_output_tokens=8192,
                    ),
                )
                tokens = getattr(response.usage_metadata, "total_token_count", None)
                print(f"  model: {model_name} | tokens: {tokens}")
                return response.text, model_name, tokens
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

    charts = generate_charts(workout_df, same_type_df, workout_type)
    print(f"  generated {len(charts)} chart(s)")

    prompt = build_prompt(workout_df, same_type_df, recent_df, routine_df, workout_type)
    content, model_used, tokens = call_gemini(gemini_client, prompt)

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
