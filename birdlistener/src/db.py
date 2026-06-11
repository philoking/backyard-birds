"""PostgreSQL/TimescaleDB storage for bird detections."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Iterable, Mapping, Optional

import psycopg2
import psycopg2.extras


SCHEMA = """
CREATE TABLE IF NOT EXISTS detections (
    id              BIGSERIAL,
    ts              TIMESTAMPTZ      NOT NULL,
    camera          TEXT             NOT NULL,
    common_name     TEXT,
    scientific_name TEXT,
    confidence      DOUBLE PRECISION NOT NULL,
    clip_start_s    DOUBLE PRECISION,
    clip_end_s      DOUBLE PRECISION,
    false_positive  BOOLEAN          NOT NULL DEFAULT FALSE
);

-- Existing installs: add the column if the table predates it.
ALTER TABLE detections ADD COLUMN IF NOT EXISTS false_positive BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_detections_camera  ON detections(camera);
CREATE INDEX IF NOT EXISTS idx_detections_species ON detections(common_name);

-- Species the user has marked as always-bogus here (e.g. a "Wild Turkey" that's
-- really car horns). flag_count accumulates per-clip false-positive flags;
-- once it crosses the dashboard's threshold the species is fully suppressed.
CREATE TABLE IF NOT EXISTS species_suppression (
    common_name TEXT PRIMARY KEY,
    flag_count  INTEGER     NOT NULL DEFAULT 0,
    suppressed  BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Species the user has reviewed in the dashboard's eBird-driven review queue
-- and confirmed are correctly identified, so they stop being suggested.
CREATE TABLE IF NOT EXISTS review_dismissed (
    common_name TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dashboard reads detections through this view so flagged rows and
-- suppressed species drop out of every stat (reversibly — nothing is deleted).
CREATE OR REPLACE VIEW v_detections AS
SELECT d.*
FROM detections d
WHERE NOT d.false_positive
  AND NOT EXISTS (
    SELECT 1 FROM species_suppression s
    WHERE s.suppressed AND s.common_name = d.common_name
  );

-- Short audio clips of recent detections, retained as the newest N per species
-- so the dashboard can play back what was actually heard. Plain table (not a
-- hypertable): it's tiny and bounded by the per-species retention prune.
CREATE TABLE IF NOT EXISTS species_clips (
    id              BIGSERIAL PRIMARY KEY,
    ts              TIMESTAMPTZ      NOT NULL,
    camera          TEXT             NOT NULL,
    common_name     TEXT             NOT NULL,
    scientific_name TEXT,
    confidence      DOUBLE PRECISION NOT NULL,
    audio           BYTEA            NOT NULL,
    mime            TEXT             NOT NULL,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_species_clips_name ON species_clips(common_name, ts DESC);
"""


def init_db(db_dsn: str) -> None:
    """Create schema and TimescaleDB hypertable if they don't exist."""
    with _connect(db_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute(
                "SELECT create_hypertable('detections', 'ts', if_not_exists => TRUE);"
            )
        conn.commit()


@contextmanager
def _connect(db_dsn: str):
    conn = psycopg2.connect(db_dsn)
    try:
        yield conn
    finally:
        conn.close()


def insert_detections(
    db_dsn: str,
    ts: datetime,
    camera: str,
    detections: Iterable[Mapping],
) -> int:
    """Insert a batch of BirdNET detections. Returns number of rows inserted."""
    rows = [
        (
            ts,
            camera,
            d.get("common_name"),
            d.get("scientific_name"),
            float(d.get("confidence", 0.0)),
            float(d.get("start_time", 0.0)) if d.get("start_time") is not None else None,
            float(d.get("end_time", 0.0)) if d.get("end_time") is not None else None,
        )
        for d in detections
    ]
    if not rows:
        return 0
    with _connect(db_dsn) as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """INSERT INTO detections
                   (ts, camera, common_name, scientific_name, confidence,
                    clip_start_s, clip_end_s)
                   VALUES %s""",
                rows,
            )
        conn.commit()
    return len(rows)


def store_clip(
    db_dsn: str,
    ts: datetime,
    camera: str,
    common_name: str,
    scientific_name: Optional[str],
    confidence: float,
    audio: bytes,
    mime: str,
    keep: int = 5,
) -> None:
    """Insert one audio clip for a species and prune to the newest `keep`.

    Insert and prune run in the same transaction so a reader never sees more
    than `keep` clips for a species.
    """
    with _connect(db_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO species_clips
                   (ts, camera, common_name, scientific_name, confidence, audio, mime)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (
                    ts,
                    camera,
                    common_name,
                    scientific_name,
                    float(confidence),
                    psycopg2.Binary(audio),
                    mime,
                ),
            )
            cur.execute(
                """DELETE FROM species_clips
                   WHERE common_name = %s
                     AND id NOT IN (
                       SELECT id FROM species_clips
                       WHERE common_name = %s
                       ORDER BY ts DESC
                       LIMIT %s
                     )""",
                (common_name, common_name, int(keep)),
            )
        conn.commit()
