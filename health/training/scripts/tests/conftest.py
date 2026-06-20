import json
import os
import pytest
import duckdb
from pathlib import Path


SAMPLE_WORKOUT = {
    "id": "test-workout-001",
    "title": "2026: Push [Tricep Bypass]",
    "routine_id": "routine-push-001",
    "start_time": "2026-06-13T12:06:47+00:00",
    "end_time": "2026-06-13T13:00:00+00:00",
    "updated_at": "2026-06-13T13:00:01.000Z",
    "created_at": "2026-06-13T13:00:01.000Z",
    "exercises": [
        {
            "index": 0,
            "title": "Chest Fly (Machine)",
            "notes": "3s eccentric",
            "exercise_template_id": "CF001",
            "superset_id": None,
            "sets": [
                {
                    "index": 0, "type": "normal", "weight_kg": 100.0,
                    "reps": 11, "rpe": 10.0,
                    "duration_seconds": None, "distance_meters": None,
                    "custom_metric": None
                },
                {
                    "index": 1, "type": "normal", "weight_kg": 100.0,
                    "reps": 9, "rpe": 10.0,
                    "duration_seconds": None, "distance_meters": None,
                    "custom_metric": None
                },
            ]
        },
        {
            "index": 1,
            "title": "Incline Chest Press (Machine)",
            "notes": "",
            "exercise_template_id": "ICP001",
            "superset_id": None,
            "sets": [
                {
                    "index": 0, "type": "normal", "weight_kg": 80.4,
                    "reps": 6, "rpe": 10.0,
                    "duration_seconds": None, "distance_meters": None,
                    "custom_metric": None
                },
            ]
        }
    ]
}

SAMPLE_ROUTINE = {
    "id": "routine-push-001",
    "title": "2026: Push",
    "folder_id": None,
    "updated_at": "2026-05-01T08:00:00.000Z",
    "created_at": "2022-08-08T13:00:00.000Z",
    "exercises": [
        {
            "index": 0,
            "title": "Chest Fly (Machine)",
            "notes": "Seat height 5. 3s eccentric.",
            "exercise_template_id": "CF001",
            "superset_id": None,
            "rest_seconds": 120,
            "sets": [
                {
                    "index": 0, "type": "failure", "weight_kg": 100.0,
                    "reps": None, "distance_meters": None,
                    "duration_seconds": None, "custom_metric": None,
                    "rep_range": {"start": 8, "end": 12}
                }
            ]
        }
    ]
}


@pytest.fixture
def sample_workout_json():
    return SAMPLE_WORKOUT.copy()


@pytest.fixture
def sample_routine_json():
    return SAMPLE_ROUTINE.copy()


@pytest.fixture
def tmp_workout_dir(tmp_path):
    year_dir = tmp_path / "workouts" / "2026"
    year_dir.mkdir(parents=True)
    return year_dir


@pytest.fixture
def tmp_routine_dir(tmp_path):
    routine_dir = tmp_path / "routines"
    routine_dir.mkdir(parents=True)
    return routine_dir


@pytest.fixture
def local_duckdb(tmp_path):
    """In-memory DuckDB with a local temp path for Parquet writes during tests."""
    conn = duckdb.connect()
    conn.execute("INSTALL parquet; LOAD parquet;")
    return conn, tmp_path
