import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


def make_workout_response(workout_id="w001", routine_id="r001"):
    return {
        "id": workout_id,
        "title": "2026: Push [Tricep Bypass]",
        "routine_id": routine_id,
        "start_time": "2026-06-13T12:06:47+00:00",
        "end_time": "2026-06-13T13:00:00+00:00",
        "updated_at": "2026-06-13T13:00:01.000Z",
        "created_at": "2026-06-13T13:00:01.000Z",
        "exercises": []
    }


def make_page_response(workouts, page=1, page_count=1):
    return {"page": page, "page_count": page_count, "workouts": workouts}


def test_fetch_by_id_returns_workout(tmp_workout_dir):
    from fetch import fetch_by_id

    with patch("fetch.requests.get") as mock_get:
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = {"workout": make_workout_response()}
        mock_get.return_value = resp

        workout = fetch_by_id("w001", api_key="fake")

    assert workout["id"] == "w001"


def test_save_workout_writes_json(tmp_workout_dir, sample_workout_json):
    from fetch import save_workout

    path = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)

    assert path is not None
    assert path.exists()
    saved = json.loads(path.read_text())
    assert saved["id"] == sample_workout_json["id"]


def test_save_workout_skips_existing(tmp_workout_dir, sample_workout_json):
    from fetch import save_workout

    path1 = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)
    path2 = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)

    assert path1 == path2


def test_save_workout_filename_format(tmp_workout_dir, sample_workout_json):
    from fetch import save_workout

    path = save_workout(sample_workout_json, workouts_dir=tmp_workout_dir)

    assert "test-workout-001" in path.name
    assert path.suffix == ".json"


def test_fetch_all_paginates(tmp_workout_dir):
    from fetch import fetch_all_workouts

    workout = make_workout_response()
    page1 = make_page_response([workout], page=1, page_count=2)
    page2 = make_page_response([], page=2, page_count=2)

    with patch("fetch.requests.get") as mock_get:
        resp1, resp2 = MagicMock(), MagicMock()
        resp1.ok, resp2.ok = True, True
        resp1.json.return_value = page1
        resp2.json.return_value = page2
        mock_get.side_effect = [resp1, resp2]

        results = fetch_all_workouts(
            api_key="fake",
            year=2026,
            workouts_dir=tmp_workout_dir
        )

    assert len(results) == 1
    assert results[0]["id"] == "w001"
