"""Command-line query helper for the BirdListener TimescaleDB database.

Usage:
    python scripts/query.py recent [N]
        Show the N most recent detections (default 20).

    python scripts/query.py top-species [WINDOW]
        Top species by count over the given window (e.g. 1d, 7d, 24h, 30m).
        Default window is 1d.

    python scripts/query.py per-camera [WINDOW]
        Detection counts per camera over the given window. Default 1d.

    python scripts/query.py species "<common name>" [LIMIT]
        Recent detections for one species (default LIMIT=50).

Connection is read from config.yaml (CONFIG_PATH env var) or DB_DSN env var.
"""
from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterable

import psycopg2
import psycopg2.extras


def _get_dsn() -> str:
    dsn = os.environ.get("DB_DSN")
    if dsn:
        return dsn
    config_path = os.environ.get("CONFIG_PATH", "config.yaml")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from src.config import load_config
    cfg = load_config(config_path)
    return cfg.database.dsn()


@contextmanager
def _connect():
    conn = psycopg2.connect(_get_dsn())
    try:
        yield conn
    finally:
        conn.close()


def _parse_window(s: str) -> timedelta:
    """Return a timedelta for window strings like '1d', '7d', '24h', '30m'."""
    s = s.strip().lower()
    if not s:
        raise ValueError("empty window")
    unit_char = s[-1]
    try:
        n = int(s[:-1])
    except ValueError as e:
        raise ValueError(f"bad window '{s}' - use e.g. 1d, 7d, 24h, 30m") from e
    units = {
        "d": timedelta(days=1),
        "h": timedelta(hours=1),
        "m": timedelta(minutes=1),
        "s": timedelta(seconds=1),
    }
    if unit_char not in units:
        raise ValueError(f"unknown unit '{unit_char}' - use d/h/m/s")
    return n * units[unit_char]


def _print_rows(rows: list, headers: list[str]) -> None:
    if not rows:
        print("(no rows)")
        return
    widths = [len(h) for h in headers]
    for r in rows:
        for i, h in enumerate(headers):
            widths[i] = max(widths[i], len(str(r[h])))
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*["-" * w for w in widths]))
    for r in rows:
        print(fmt.format(*[str(r[h]) for h in headers]))


def cmd_recent(args: list[str]) -> int:
    n = int(args[0]) if args else 20
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT ts, camera, common_name, scientific_name,
                          ROUND(confidence::numeric, 2) AS confidence
                   FROM detections
                   ORDER BY ts DESC
                   LIMIT %s""",
                (n,),
            )
            rows = cur.fetchall()
    _print_rows(rows, ["ts", "camera", "common_name", "scientific_name", "confidence"])
    return 0


def cmd_top_species(args: list[str]) -> int:
    since = datetime.now(timezone.utc) - _parse_window(args[0] if args else "1d")
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT common_name, COUNT(*) AS count,
                          ROUND(MAX(confidence)::numeric, 2) AS max_confidence
                   FROM detections
                   WHERE ts >= %s
                   GROUP BY common_name
                   ORDER BY count DESC, common_name ASC
                   LIMIT 25""",
                (since,),
            )
            rows = cur.fetchall()
    _print_rows(rows, ["common_name", "count", "max_confidence"])
    return 0


def cmd_per_camera(args: list[str]) -> int:
    since = datetime.now(timezone.utc) - _parse_window(args[0] if args else "1d")
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT camera, COUNT(*) AS count,
                          COUNT(DISTINCT common_name) AS species
                   FROM detections
                   WHERE ts >= %s
                   GROUP BY camera
                   ORDER BY count DESC""",
                (since,),
            )
            rows = cur.fetchall()
    _print_rows(rows, ["camera", "count", "species"])
    return 0


def cmd_species(args: list[str]) -> int:
    if not args:
        print('usage: query.py species "<common name>" [LIMIT]', file=sys.stderr)
        return 2
    name = args[0]
    limit = int(args[1]) if len(args) > 1 else 50
    with _connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT ts, camera, common_name,
                          ROUND(confidence::numeric, 2) AS confidence
                   FROM detections
                   WHERE common_name = %s
                   ORDER BY ts DESC
                   LIMIT %s""",
                (name, limit),
            )
            rows = cur.fetchall()
    _print_rows(rows, ["ts", "camera", "common_name", "confidence"])
    return 0


COMMANDS = {
    "recent": cmd_recent,
    "top-species": cmd_top_species,
    "per-camera": cmd_per_camera,
    "species": cmd_species,
}


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd = argv[1]
    if cmd not in COMMANDS:
        print(f"unknown command: {cmd}", file=sys.stderr)
        print(f"available: {', '.join(COMMANDS)}", file=sys.stderr)
        return 2
    try:
        return COMMANDS[cmd](argv[2:])
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except psycopg2.OperationalError as e:
        print(f"database connection failed: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
