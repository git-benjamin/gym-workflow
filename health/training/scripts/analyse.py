"""
analyse.py — Query Parquet context via DuckDB, call Claude Haiku, insert into analyses table.

For each workout not yet in the `analyses` table:
  1. Load workout data from Parquet
  2. Load last 3 sessions of same type
  3. Load active routine version
  4. Build six-module prompt
  5. Call Claude Haiku
  6. Insert into analyses table
"""
from __future__ import annotations
import os
import re
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

SYSTEM_PROMPT = """
Profile: 188cm, 135kg. Knee hyperextension history — avoid flagging standing
hip hinge under heavy load as a regression. Glutes underdeveloped from years
of knee compensation. Chest overdeveloped relative to shoulders and triceps.

Current strategies:
- Push (Tricep Bypass): pec dec first to pre-exhaust chest, compound press
  then targets triceps and anterior delts.
- Pull (Bicep Bypass): versa grips on all compound pulls to remove bicep
  bottleneck, isolate biceps fresh at end of session.
- Legs: seated leg curl first to pre-exhaust hamstrings, hip thrust then
  targets glutes as primary mover.

Goals: glute hypertrophy, lateral delt width, tricep and lat development,
trap/rhomboid activation, close left-right glute asymmetry.

Training style: RPE 10 to failure. 3-4s eccentrics and iso holds. Qualitative
notes logged per set — treat these as primary signal over raw numbers.
""".strip()

ANALYSIS_TEMPLATE = """
Today's workout:
{workout_data}

Last 3 sessions of same type:
{prior_data}

Active routine:
{routine_data}

Analyse across these six modules:

1. PROGRESSION
   Per exercise: weight/reps/RPE vs last session.
   Label each: increased / held / regressed.

2. PLANNED VS ACTUAL
   Compare routine set targets to logged sets.
   Flag deviations; include note reason if logged.

3. STRATEGY VALIDATION
   Did the pre-exhaust or bypass work this session?
   Evidence: which muscle gave out first, qualitative note language
   ("felt glutes", "quads taking over", "bicep bottleneck").

4. QUALITATIVE SIGNALS
   Extract from set notes:
   - Pain: location, when in set it started, any radiation pattern
   - Activation quality: "can't feel" / "felt it strongly" / left vs right
   - Technique flags: compensation patterns, joint instability

5. FLAGS (explicit, not buried in prose)
   - Plateau: same weight + reps for 3+ sessions -> name the exercise
   - Pain pattern: any radiating pain -> flag first, before other analysis
   - Eccentric overload: 4s eccentric on more than 2 exercises -> flag

6. ONE NEXT ACTION
   Single clearest change for the next session of this type. Not a list.
"""

PAIN_KEYWORDS = re.compile(
    r"(pain|sharp|pulsating|radiating|twinge|ache|discomfort|pinch|cramping)",
    re.IGNORECASE
)


def classify_workout_type(title: str, routine_id: str | None, known_ids: dict[str, str]) -> str:
    if routine_id and routine_id in known_ids:
        return known_ids[routine_id]
    t = title.lower()
    if "push" in t:
        return "Push"
    if "pull" in t:
        return "Pull"
    if "leg" in t:
        return "Legs"
    return "Unknown"


def detect_plateaus(df: pd.DataFrame, exercise_title: str, lookback: int = 3) -> list[str]:
    ex = df[df["exercise_title"] == exercise_title].copy()
    if len(ex) < lookback:
        return []

    recent = ex.sort_values("start_time", ascending=False).head(lookback)
    weights = recent["weight_kg"].dropna().unique()
    reps = recent["reps"].dropna().unique()

    if len(weights) == 1 and len(reps) == 1:
        return [exercise_title]
    return []


def extract_pain_signals(notes: list[str]) -> list[str]:
    return [n for n in notes if n and PAIN_KEYWORDS.search(n)]


def build_prompt(workout_df: pd.DataFrame, prior_df: pd.DataFrame, routine_df: pd.DataFrame) -> str:
    return ANALYSIS_TEMPLATE.format(
        workout_data=workout_df.to_string(index=False),
        prior_data=prior_df.to_string(index=False) if not prior_df.empty else "No prior sessions.",
        routine_data=routine_df.to_string(index=False) if not routine_df.empty else "No routine data.",
    )


def get_unanalysed_workout_ids(all_ids: list[str], supabase_client) -> list[str]:
    result = supabase_client.table("analyses").select("workout_id").execute()
    analysed = {r["workout_id"] for r in result.data}
    return [wid for wid in all_ids if wid not in analysed]


def load_context(conn, workout_id: str, year: int):
    workouts_path = s3_path(f"data/workouts_{year}.parquet")
    routines_path = s3_path("data/routines.parquet")

    workout_df = conn.execute(f"""
        SELECT * FROM read_parquet('{workouts_path}')
        WHERE workout_id = '{workout_id}'
    """).df()

    if workout_df.empty:
        return None, pd.DataFrame(), pd.DataFrame()

    row = workout_df.iloc[0]
    title = str(row.get("workout_title") or "")
    routine_id = str(row.get("routine_id") or "")

    type_filter = ""
    if "push" in title.lower():
        type_filter = "ILIKE '%Push%'"
    elif "pull" in title.lower():
        type_filter = "ILIKE '%Pull%'"
    elif "leg" in title.lower():
        type_filter = "ILIKE '%Leg%'"

    prior_sets_df = pd.DataFrame()
    if type_filter:
        prior_ids_df = conn.execute(f"""
            SELECT workout_id FROM read_parquet('{workouts_path}')
            WHERE workout_title {type_filter}
              AND workout_id != '{workout_id}'
            GROUP BY workout_id
            ORDER BY MAX(start_time) DESC
            LIMIT 3
        """).df()

        if not prior_ids_df.empty:
            ids = tuple(prior_ids_df["workout_id"].tolist())
            ids_sql = str(ids) if len(ids) > 1 else f"('{ids[0]}')"
            prior_sets_df = conn.execute(f"""
                SELECT * FROM read_parquet('{workouts_path}')
                WHERE workout_id IN {ids_sql}
            """).df()

    routine_df = pd.DataFrame()
    if routine_id:
        start_time = str(row.get("start_time") or "")
        routine_df = conn.execute(f"""
            SELECT * FROM read_parquet('{routines_path}')
            WHERE hevy_id = '{routine_id}'
              AND updated_at <= '{start_time}'
            ORDER BY updated_at DESC
            LIMIT 1
        """).df()

    return workout_df, prior_sets_df, routine_df


def analyse_workout(workout_id: str, conn, supabase_client, gemini_client, year: int):
    workout_df, prior_df, routine_df = load_context(conn, workout_id, year)
    if workout_df is None or workout_df.empty:
        print(f"  {workout_id}: not found in Parquet — skipping.")
        return

    prompt = build_prompt(workout_df, prior_df, routine_df)
    model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")

    for attempt in range(5):
        try:
            response = gemini_client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    max_output_tokens=2048,
                ),
            )
            break
        except Exception as e:
            if "RESOURCE_EXHAUSTED" in str(e) and attempt < 4:
                wait = 60 * (attempt + 1)
                print(f"  {workout_id}: rate limited, waiting {wait}s (attempt {attempt + 1}/5)")
                time.sleep(wait)
            else:
                raise

    content = response.text
    tokens = getattr(response.usage_metadata, "total_token_count", None)

    supabase_client.table("analyses").insert({
        "type": "post_workout",
        "workout_id": workout_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "content": content,
        "model": model_name,
        "tokens_used": tokens,
    }).execute()

    print(f"  {workout_id}: {tokens} tokens")


def main():
    year = datetime.now(timezone.utc).year
    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    conn = get_conn()
    supabase_client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    workouts_path = s3_path(f"data/workouts_{year}.parquet")
    all_ids = conn.execute(f"""
        SELECT DISTINCT workout_id FROM read_parquet('{workouts_path}')
    """).df()["workout_id"].tolist()

    to_analyse = get_unanalysed_workout_ids(all_ids, supabase_client)
    print(f"Found {len(to_analyse)} workouts to analyse.")

    for wid in to_analyse:
        analyse_workout(wid, conn, supabase_client, gemini_client, year)


if __name__ == "__main__":
    main()
