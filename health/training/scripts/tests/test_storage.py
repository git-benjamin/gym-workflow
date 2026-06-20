import os
import importlib
import pytest
from unittest.mock import patch


def test_s3_path_format():
    with patch.dict(os.environ, {"SUPABASE_BUCKET": "hevy-analytics"}):
        import lib.storage
        importlib.reload(lib.storage)
        from lib.storage import s3_path
        assert s3_path("data/workouts_2026.parquet") == "s3://hevy-analytics/data/workouts_2026.parquet"


def test_get_conn_returns_connection(monkeypatch):
    monkeypatch.setenv("SUPABASE_S3_ENDPOINT", "https://fake.supabase.co/storage/v1/s3")
    monkeypatch.setenv("SUPABASE_S3_KEY", "fake-key")
    monkeypatch.setenv("SUPABASE_S3_SECRET", "fake-secret")
    monkeypatch.setenv("SUPABASE_S3_REGION", "ap-southeast-2")
    monkeypatch.setenv("SUPABASE_BUCKET", "hevy-analytics")

    import lib.storage
    importlib.reload(lib.storage)
    from lib.storage import get_conn

    conn = get_conn()
    result = conn.execute("SELECT 42 AS n").fetchone()
    assert result[0] == 42
