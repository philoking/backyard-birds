"""TimescaleDB storage for Tempest weather observations and events.

Shares the same database as birdlistener/bird-call-app so detections can be
joined to conditions by timestamp. This service owns the weather schema.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Mapping
from urllib.parse import quote_plus

import psycopg2
import psycopg2.extras


SCHEMA = """
CREATE TABLE IF NOT EXISTS weather (
    ts            TIMESTAMPTZ      NOT NULL,
    station_sn    TEXT,
    hub_sn        TEXT,
    wind_lull     DOUBLE PRECISION,
    wind_avg      DOUBLE PRECISION,
    wind_gust     DOUBLE PRECISION,
    wind_dir      INTEGER,
    pressure      DOUBLE PRECISION,
    air_temp      DOUBLE PRECISION,
    rh            DOUBLE PRECISION,
    illuminance   DOUBLE PRECISION,
    uv            DOUBLE PRECISION,
    solar_rad     DOUBLE PRECISION,
    rain_min      DOUBLE PRECISION,
    precip_type   INTEGER,
    strike_dist   DOUBLE PRECISION,
    strike_count  INTEGER,
    battery       DOUBLE PRECISION,
    PRIMARY KEY (ts)
);

CREATE TABLE IF NOT EXISTS weather_events (
    id          BIGSERIAL,
    ts          TIMESTAMPTZ NOT NULL,
    kind        TEXT        NOT NULL,
    distance_km DOUBLE PRECISION,
    energy      DOUBLE PRECISION,
    station_sn  TEXT
);
CREATE INDEX IF NOT EXISTS idx_weather_events_ts ON weather_events(ts DESC);
"""

_OBS_COLS = [
    "ts", "station_sn", "hub_sn", "wind_lull", "wind_avg", "wind_gust",
    "wind_dir", "pressure", "air_temp", "rh", "illuminance", "uv",
    "solar_rad", "rain_min", "precip_type", "strike_dist", "strike_count",
    "battery",
]


def dsn_from_env() -> str:
    """Build a DSN from DATABASE_URL or the standard PG* env vars."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    user = os.environ.get("PGUSER", "postgres")
    pw = os.environ.get("PGPASSWORD", "")
    host = os.environ.get("PGHOST", "localhost")
    port = os.environ.get("PGPORT", "5432")
    db = os.environ.get("PGDATABASE", "birdlistener")
    return f"postgresql://{quote_plus(user)}:{quote_plus(pw)}@{host}:{port}/{db}"


def init_db(dsn: str) -> None:
    with _connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute("SELECT create_hypertable('weather','ts',if_not_exists=>TRUE);")
        conn.commit()


@contextmanager
def _connect(dsn: str):
    conn = psycopg2.connect(dsn)
    try:
        yield conn
    finally:
        conn.close()


def insert_obs(dsn: str, rows: list[Mapping]) -> int:
    """Insert weather observation rows, skipping any timestamp already present."""
    if not rows:
        return 0
    values = [tuple(r.get(c) for c in _OBS_COLS) for r in rows]
    with _connect(dsn) as conn:
        with conn.cursor() as cur:
            # fetch=True aggregates RETURNING rows across all internal pages, so
            # the count is accurate (cur.rowcount only reflects the last page).
            returned = psycopg2.extras.execute_values(
                cur,
                f"INSERT INTO weather ({', '.join(_OBS_COLS)}) VALUES %s "
                f"ON CONFLICT (ts) DO NOTHING RETURNING 1",
                values,
                fetch=True,
            )
            n = len(returned)
        conn.commit()
    return n


def insert_event(dsn: str, ev: Mapping) -> None:
    with _connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO weather_events (ts, kind, distance_km, energy, station_sn)
                   VALUES (%(ts)s, %(kind)s, %(distance_km)s, %(energy)s, %(station_sn)s)""",
                ev,
            )
        conn.commit()
