"""Backfill historical Tempest observations from the cloud REST API.

The local UDP feed only gives data from "now" forward; this fills `weather`
backward so detections that predate the listener can still be correlated with
conditions. One-minute data is available in <=5-day windows, so we chunk.

Env:
  TEMPEST_TOKEN        personal access token (required)
  TEMPEST_DEVICE_ID    Tempest (ST) device id (optional; auto-detected)
  TEMPEST_BACKFILL_START  ISO date/epoch to start from (optional; defaults to
                          the earliest detection in the DB)
  PG* / DATABASE_URL   database connection (see db.dsn_from_env)

Usage:  python -m scripts.backfill
Reference: https://apidocs.tempestwx.com/reference/getobservationsbydeviceid
"""
from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone

import psycopg2
import requests

# Allow running as a module from the image's /app dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.db import dsn_from_env, init_db, insert_obs  # noqa: E402
from src.parse import parse_obs_st  # noqa: E402

BASE = "https://swd.weatherflow.com/swd/rest"
CHUNK = 5 * 24 * 3600  # 5 days in seconds (API one-minute limit)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill")


def _token() -> str:
    tok = os.environ.get("TEMPEST_TOKEN")
    if not tok:
        log.error("TEMPEST_TOKEN is not set")
        sys.exit(2)
    return tok


def find_device_id(token: str) -> int:
    r = requests.get(f"{BASE}/stations", params={"token": token}, timeout=30)
    r.raise_for_status()
    for st in r.json().get("stations", []):
        for dev in st.get("devices", []):
            if dev.get("device_type") == "ST":
                did = dev["device_id"]
                log.info("using Tempest device_id=%s (station '%s')", did, st.get("name"))
                return did
    log.error("no Tempest (ST) device found on this account")
    sys.exit(2)


def earliest_detection(dsn: str) -> datetime:
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT MIN(ts) FROM detections")
        row = cur.fetchone()
    if not row or row[0] is None:
        log.error("no detections found to bound the backfill; set TEMPEST_BACKFILL_START")
        sys.exit(2)
    return row[0]


def _start_epoch(dsn: str) -> int:
    raw = os.environ.get("TEMPEST_BACKFILL_START")
    if raw:
        try:
            return int(raw)
        except ValueError:
            return int(datetime.fromisoformat(raw).replace(tzinfo=timezone.utc).timestamp())
    return int(earliest_detection(dsn).timestamp())


def fetch_window(token: str, device_id: int, start: int, end: int) -> list:
    r = requests.get(
        f"{BASE}/observations/device/{device_id}",
        params={"token": token, "time_start": start, "time_end": end},
        timeout=60,
    )
    if r.status_code == 429:
        log.warning("rate limited; backing off 30s")
        time.sleep(30)
        return fetch_window(token, device_id, start, end)
    r.raise_for_status()
    body = r.json()
    # Reuse the UDP parser: the ST device obs array shares obs_st field order.
    return parse_obs_st({"obs": body.get("obs") or [], "serial_number": None, "hub_sn": None})


def main() -> int:
    token = _token()
    dsn = dsn_from_env()
    init_db(dsn)

    device_id = int(os.environ.get("TEMPEST_DEVICE_ID") or find_device_id(token))
    start = _start_epoch(dsn)
    now = int(time.time())
    log.info("backfilling device %s from %s to now (%d days)",
             device_id, datetime.fromtimestamp(start, timezone.utc).date(),
             (now - start) // 86400)

    total = 0
    cur = start
    while cur < now:
        end = min(cur + CHUNK, now)
        try:
            rows = fetch_window(token, device_id, cur, end)
            n = insert_obs(dsn, rows)
            total += n
            log.info("%s .. %s  fetched=%d inserted=%d  (total=%d)",
                     datetime.fromtimestamp(cur, timezone.utc).date(),
                     datetime.fromtimestamp(end, timezone.utc).date(),
                     len(rows), n, total)
        except Exception as e:
            log.error("window %s..%s failed: %s", cur, end, e)
        cur = end
        time.sleep(1)  # be polite to the API

    log.info("backfill complete: %d new weather rows", total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
