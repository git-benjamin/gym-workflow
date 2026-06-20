import json
import pytest
import duckdb
from pathlib import Path


def write_workout_file(workout, dir_path):
    safe_time = workout["start_time"].replace(":", "-")
    path = dir_path / f"{safe_time}__{workout['id']}.json"
    path.write_text(json.dumps(workout))
    return path


def write_routine_file(routine, dir_path):
    path = dir_path / f"{routine['id']}.json"
    path.write_text(json.dumps(routine))
    return path


def test_build_workouts_df_schema(sample_workout_json, tmp_workout_dir):
    from sync import build_workouts_df

    write_workout_file(sample_workout_json, tmp_workout_dir)
    df = build_workouts_df(tmp_workout_dir)

    expected_cols = {
        "workout_id", "workout_title", "start_time", "end_time", "routine_id",
        "exercise_index", "exercise_title", "exercise_notes", "exercise_template_id",
        "superset_id", "set_index", "set_type", "weight_kg", "reps", "rpe",
        "duration_seconds", "distance_meters"
    }
    assert expected_cols.issubset(set(df.columns))


def test_build_workouts_df_row_count(sample_workout_json, tmp_workout_dir):
    from sync import build_workouts_df

    write_workout_file(sample_workout_json, tmp_workout_dir)
    df = build_workouts_df(tmp_workout_dir)

    # 2 exercises: first has 2 sets, second has 1 = 3 rows
    assert len(df) == 3


def test_build_workouts_df_deduplicates(sample_workout_json, tmp_workout_dir):
    from sync import build_workouts_df

    write_workout_file(sample_workout_json, tmp_workout_dir)
    sample2 = sample_workout_json.copy()
    sample2["start_time"] = "2026-06-14T12:00:00+00:00"
    sample2["id"] = "test-workout-001"  # same id
    write_workout_file(sample2, tmp_workout_dir)

    df = build_workouts_df(tmp_workout_dir)
    assert df["workout_id"].nunique() == 1


def test_build_routines_df_schema(sample_routine_json, tmp_routine_dir):
    from sync import build_routines_df

    write_routine_file(sample_routine_json, tmp_routine_dir)
    df = build_routines_df(tmp_routine_dir)

    expected_cols = {
        "hevy_id", "title", "updated_at", "synced_at",
        "exercise_index", "exercise_title", "exercise_notes", "exercise_template_id",
        "rest_seconds", "set_index", "set_type", "weight_kg",
        "rep_range_start", "rep_range_end"
    }
    assert expected_cols.issubset(set(df.columns))


def test_build_routines_df_append_only(sample_routine_json, tmp_routine_dir, local_duckdb):
    from sync import build_routines_df, merge_routines_df

    conn, tmp_path = local_duckdb
    parquet_path = str(tmp_path / "routines.parquet")

    write_routine_file(sample_routine_json, tmp_routine_dir)
    df1 = build_routines_df(tmp_routine_dir)
    conn.execute(f"COPY (SELECT * FROM df1) TO '{parquet_path}' (FORMAT PARQUET)")

    # "update" routine (new updated_at)
    updated = dict(sample_routine_json)
    updated["updated_at"] = "2026-06-01T08:00:00.000Z"
    write_routine_file(updated, tmp_routine_dir)

    df2 = build_routines_df(tmp_routine_dir)
    merged = merge_routines_df(conn, parquet_path, df2)

    assert len(merged["updated_at"].unique()) == 2


def test_build_routines_df_no_duplicate_versions(sample_routine_json, tmp_routine_dir, local_duckdb):
    from sync import build_routines_df, merge_routines_df

    conn, tmp_path = local_duckdb
    parquet_path = str(tmp_path / "routines.parquet")

    write_routine_file(sample_routine_json, tmp_routine_dir)
    df1 = build_routines_df(tmp_routine_dir)
    conn.execute(f"COPY (SELECT * FROM df1) TO '{parquet_path}' (FORMAT PARQUET)")

    # same routine, same updated_at — re-run should not duplicate
    df2 = build_routines_df(tmp_routine_dir)
    merged = merge_routines_df(conn, parquet_path, df2)

    assert len(merged["updated_at"].unique()) == 1
