"""
analyse.py — Query Parquet context via DuckDB, call Gemini, insert into analyses table.

For each workout not yet in the `analyses` table:
  1. Load today's workout (all sets)
  2. Load ALL prior sessions of the same type across all years (workouts_*.parquet)
  3. Load last 10 sessions of any type for recency context
  4. Call Gemini (model fallback chain: best → fastest)
  5. Insert into analyses table
  6. Email via Resend (if RESEND_API_KEY set)

Model fallback order (best → fallback):
  gemini-3.5-flash → gemini-3-flash-preview → gemini-3.1-flash-lite
  → gemini-2.5-flash → gemini-2.5-flash-lite

Token budget: ~180K input tokens per call (250K TPM limit minus output headroom).
Same-type history is trimmed from oldest if it would exceed budget.
"""
from __future__ import annotations

import argparse
import os
import re
import requests
import markdown as md
from datetime import datetime, timezone
from pathlib import Path
import time

from google import genai
from google.genai import types
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from lib.storage import get_conn, s3_path

load_dotenv(Path(__file__).parent.parent.parent.parent / ".envrc", override=False)

# Model fallback chain — tried in order on RESOURCE_EXHAUSTED
MODELS = [
    "gemini-3.5-flash",         # best quality, 20 RPD
    "gemini-3-flash-preview",   # second tier, 20 RPD
    "gemini-3.1-flash-lite",    # 500 RPD — high volume fallback
    "gemini-2.5-flash",         # 20 RPD
    "gemini-2.5-flash-lite",    # 20 RPD — last resort
]

TOKEN_INPUT_BUDGET = 180_000  # conservative: 250K TPM minus 2K output minus buffer
CHARS_PER_TOKEN = 4            # rough estimate for English/numeric text

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
6. Body recomposition — preserve muscle through continued weight loss.

## Session Strategies
- Push (Tricep Bypass): pec dec first to pre-exhaust chest, then compound press
  targets triceps and anterior delts as primary movers.
- Pull (Bicep Bypass): versa grips on all compound pulls to remove bicep
  bottleneck; isolate biceps fresh at end of session.
- Legs: seated leg curl first to pre-exhaust hamstrings; hip thrust targets
  glutes as primary mover.

## Training Style
RPE 10, sets to failure. 3-4s eccentrics and iso holds where noted.
Qualitative notes logged per set — treat these as primary signal over raw numbers.

## Communication Style
Data-driven, evidence-based. Use tables for comparisons, bullets for lists.
Flag uncertainty and probabilistic outcomes explicitly. No motivational language.
Technical depth over reassurance. Direct and concise. Stepwise reasoning when
causal chains matter.
""".strip()

ANALYSIS_TEMPLATE = """
## Today's Workout
{workout_data}

## Full {workout_type} Session History (all time, most recent first)
{same_type_history}

## Last 10 Sessions — Any Type (most recent first)
{recent_sessions}

## Active Routine
{routine_data}

---

Analyse across these six modules:

### 1. PROGRESSION
Per exercise: weight/reps/RPE vs last session.
Label each: increased / held / regressed.
Note any multi-session trends visible in the full history (plateaus, trajectories).

### 2. PLANNED VS ACTUAL
Compare routine set targets to logged sets.
Flag deviations; include logged note reason if present.

### 3. STRATEGY VALIDATION
Did the pre-exhaust or bypass work this session?
Evidence: which muscle gave out first, qualitative note language
("felt glutes", "quads taking over", "bicep bottleneck").

### 4. QUALITATIVE SIGNALS
Extract from set notes:
- Pain: location, onset point in set, radiation pattern
- Activation quality: "can't feel" / "felt it strongly" / left vs right asymmetry
- Technique flags: compensation patterns, joint instability

### 5. FLAGS (explicit — not buried in prose)
- Plateau: same weight + reps for 3+ sessions → name the exercise
- Pain pattern: any radiating pain → flag first, before other analysis
- Eccentric overload: 4s eccentric on more than 2 exercises → flag

### 6. ONE NEXT ACTION
Single clearest change for the next session of this type. Not a list. Not a paragraph.
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
    """Trim df to fit within budget_tokens (most recent rows kept). Returns trimmed df + tokens used."""
    if df.empty:
        return df, 0
    text = df.to_string(index=False)
    if estimate_tokens(text) <= budget_tokens:
        return df, estimate_tokens(text)
    # Binary search: keep most recent N rows
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

    # All same-type sessions, all time, most recent first
    same_type_df = pd.DataFrame()
    if workout_type != "Unknown":
        same_type_df = conn.execute(f"""
            SELECT * FROM read_parquet('{all_parquet}', union_by_name=true)
            WHERE LOWER(workout_title) LIKE '%{workout_type.lower()}%'
              AND workout_id != '{workout_id}'
            ORDER BY start_time DESC
        """).df()

    # Last 10 sessions of any type
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
    # Token accounting: workout + recent are fixed; trim same_type_df to remaining budget
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
          f"(same-type history: {same_type_tokens:,}, budget: {TOKEN_INPUT_BUDGET:,})")

    return ANALYSIS_TEMPLATE.format(
        workout_data=workout_df.to_string(index=False),
        workout_type=workout_type,
        same_type_history=same_type_df.to_string(index=False) if not same_type_df.empty else "No prior sessions.",
        recent_sessions=recent_df.to_string(index=False) if not recent_df.empty else "No recent sessions.",
        routine_data=routine_df.to_string(index=False) if not routine_df.empty else "No routine data.",
    )


def call_gemini(gemini_client, prompt: str) -> tuple[str, str, int | None]:
    """Try each model in MODELS order. Returns (content, model_used, tokens)."""
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
                err = str(e)
                if "RESOURCE_EXHAUSTED" in err:
                    if attempt < 2:
                        wait = 15 * (attempt + 1)
                        print(f"  {model_name}: rate limited, waiting {wait}s (attempt {attempt + 1}/3)")
                        time.sleep(wait)
                    else:
                        print(f"  {model_name}: exhausted after 3 attempts, trying next model")
                        break
                else:
                    print(f"  {model_name}: error {e}, trying next model")
                    break
    raise RuntimeError(f"All models exhausted. Last error: {last_exc}")


def format_email_html(content: str, workout_title: str, workout_date: str) -> str:
    html_body = md.markdown(content, extensions=["tables", "fenced_code", "nl2br"])
    return f"""
<html>
<head>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #fff; }}
  h2, h3 {{ margin-top: 28px; margin-bottom: 8px; }}
  h3 {{ font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 4px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }}
  th {{ background: #f5f5f5; text-align: left; padding: 7px 10px; border: 1px solid #ddd; font-weight: 600; }}
  td {{ padding: 7px 10px; border: 1px solid #ddd; vertical-align: top; }}
  tr:nth-child(even) td {{ background: #fafafa; }}
  pre {{ background: #f4f4f4; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto; }}
  code {{ font-family: 'SF Mono', Consolas, monospace; font-size: 12px; }}
  ul {{ padding-left: 20px; }}
  li {{ margin: 4px 0; }}
  hr {{ border: none; border-top: 1px solid #eee; margin: 20px 0; }}
  strong {{ color: #111; }}
  .header {{ color: #555; font-size: 13px; border-bottom: 1px solid #eee; padding-bottom: 12px; margin-bottom: 20px; }}
  .footer {{ color: #aaa; font-size: 11px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px; }}
</style>
</head>
<body>
<div class="header"><strong>{workout_title}</strong> &nbsp;·&nbsp; {workout_date}</div>
{html_body}
<div class="footer">Generated by Hevy Analysis pipeline</div>
</body>
</html>
"""


def send_email(subject: str, content: str, workout_title: str, workout_date: str):
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        print("  email: RESEND_API_KEY not set, skipping.")
        return
    to_email = os.environ.get("NOTIFY_EMAIL", "benjamin_dang@outlook.com")
    html = format_email_html(content, workout_title, workout_date)
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
