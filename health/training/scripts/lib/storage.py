from __future__ import annotations
import os
import duckdb
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent.parent.parent.parent / ".envrc", override=False)


def get_conn() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs; INSTALL parquet; LOAD parquet;")
    conn.execute(f"""
        SET s3_endpoint='{os.environ["SUPABASE_S3_ENDPOINT"]}';
        SET s3_access_key_id='{os.environ["SUPABASE_S3_KEY"]}';
        SET s3_secret_access_key='{os.environ["SUPABASE_S3_SECRET"]}';
        SET s3_region='{os.environ["SUPABASE_S3_REGION"]}';
        SET s3_url_style='path';
    """)
    return conn


def s3_path(key: str) -> str:
    bucket = os.environ["SUPABASE_BUCKET"]
    return f"s3://{bucket}/{key}"
