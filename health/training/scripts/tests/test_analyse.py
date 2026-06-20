import pytest
import pandas as pd
from unittest.mock import MagicMock, patch


PUSH_WORKOUT_ID = "test-workout-001"
PUSH_ROUTINE_ID = "routine-push-001"


def make_workout_row(workout_id=PUSH_WORKOUT_ID, routine_id=PUSH_ROUTINE_ID,
                     title="2026: Push [Tricep Bypass]",
                     exercise_title="Chest Fly (Machine)",
                     template_id="CF001",
                     weight_kg=100.0, reps=9, rpe=10.0, notes="3s eccentric",
                     start_time="2026-06-13T12:06:47+00:00"):
    return {
        "workout_id": workout_id,
        "workout_title": title,
        "start_time": start_time,
        "end_time": "2026-06-13T13:00:00+00:00",
        "routine_id": routine_id,
        "exercise_index": 0,
        "exercise_title": exercise_title,
        "exercise_notes": notes,
        "exercise_template_id": template_id,
        "superset_id": None,
        "set_index": 0,
        "set_type": "normal",
        "weight_kg": weight_kg,
        "reps": reps,
        "rpe": rpe,
        "duration_seconds": None,
        "distance_meters": None,
    }


def test_classify_workout_type_by_routine_id():
    from analyse import classify_workout_type

    known = {"routine-push-001": "Push", "routine-pull-001": "Pull"}
    assert classify_workout_type("2026: Push [Tricep Bypass]", "routine-push-001", known) == "Push"


def test_classify_workout_type_title_fallback():
    from analyse import classify_workout_type

    assert classify_workout_type("2026: Push [Tricep Bypass]", None, {}) == "Push"
    assert classify_workout_type("2026: Pull [Bicep Bypass]", None, {}) == "Pull"
    assert classify_workout_type("2026: Legs", None, {}) == "Legs"
    assert classify_workout_type("Late night workout", None, {}) == "Unknown"


def test_detect_plateaus_flags_stale_exercise():
    from analyse import detect_plateaus

    rows = [make_workout_row(weight_kg=100.0, reps=9) for _ in range(3)]
    df = pd.DataFrame(rows)
    flags = detect_plateaus(df, "Chest Fly (Machine)", lookback=3)

    assert "Chest Fly (Machine)" in flags


def test_detect_plateaus_no_flag_when_progressing():
    from analyse import detect_plateaus

    rows = [
        make_workout_row(weight_kg=80.0, reps=9, start_time="2026-05-01T12:00:00+00:00"),
        make_workout_row(weight_kg=90.0, reps=9, start_time="2026-05-15T12:00:00+00:00"),
        make_workout_row(weight_kg=100.0, reps=9, start_time="2026-06-01T12:00:00+00:00"),
    ]
    df = pd.DataFrame(rows)
    flags = detect_plateaus(df, "Chest Fly (Machine)", lookback=3)

    assert "Chest Fly (Machine)" not in flags


def test_extract_pain_signals_from_notes():
    from analyse import extract_pain_signals

    notes = [
        "pulsating semi sharp pain from right under hip, radiating down to right toe by rep 12",
        "3s eccentric",
        "felt glutes all reps",
    ]
    signals = extract_pain_signals(notes)

    assert len(signals) == 1
    assert "pain" in signals[0].lower() or "hip" in signals[0].lower()


def test_build_prompt_contains_six_modules():
    from analyse import build_prompt

    workout_df = pd.DataFrame([make_workout_row()])
    prior_df = pd.DataFrame([make_workout_row(start_time="2026-06-01T12:00:00+00:00")])
    routine_df = pd.DataFrame([{
        "hevy_id": PUSH_ROUTINE_ID, "title": "2026: Push",
        "updated_at": "2026-05-01T08:00:00.000Z", "synced_at": "2026-05-01T08:01:00.000Z",
        "exercise_index": 0, "exercise_title": "Chest Fly (Machine)",
        "exercise_notes": "Seat height 5.", "exercise_template_id": "CF001",
        "rest_seconds": 120, "set_index": 0, "set_type": "failure",
        "weight_kg": 100.0, "rep_range_start": 8, "rep_range_end": 12,
    }])

    prompt = build_prompt(workout_df, prior_df, routine_df)

    for module in ["PROGRESSION", "PLANNED VS ACTUAL", "STRATEGY VALIDATION",
                   "QUALITATIVE SIGNALS", "FLAGS", "ONE NEXT ACTION"]:
        assert module in prompt


def test_already_analysed_skipped():
    from analyse import get_unanalysed_workout_ids

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.execute.return_value.data = [
        {"workout_id": "test-workout-001"}
    ]

    ids = get_unanalysed_workout_ids(["test-workout-001", "test-workout-002"], mock_client)
    assert ids == ["test-workout-002"]
