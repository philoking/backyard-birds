"""WeatherListener: ingest Tempest local UDP broadcasts into TimescaleDB.

Binds UDP 50222 (the hub broadcasts there, no auth) and stores per-minute
`obs_st` observations plus lightning/rain events. Resilient to transient DB
errors; exits cleanly on SIGINT/SIGTERM.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import socket
import sys
import time

from .db import dsn_from_env, init_db, insert_event, insert_obs
from .parse import parse_event, parse_obs_st

UDP_PORT = int(os.environ.get("TEMPEST_UDP_PORT", "50222"))

log = logging.getLogger("weatherlistener")


def _setup_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )


class _Shutdown:
    def __init__(self) -> None:
        self.flag = False
        signal.signal(signal.SIGINT, self._set)
        signal.signal(signal.SIGTERM, self._set)

    def _set(self, *_):
        log.info("shutdown signal received")
        self.flag = True


def main() -> int:
    _setup_logging()
    dsn = dsn_from_env()

    # Wait for the DB to be reachable, then create the schema.
    while True:
        try:
            init_db(dsn)
            break
        except Exception as e:
            log.warning("DB not ready (%s); retrying in 5s", e)
            time.sleep(5)
    log.info("weather schema ready; listening on UDP %s", UDP_PORT)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", UDP_PORT))
    sock.settimeout(1.0)

    shutdown = _Shutdown()
    obs_count = 0
    last_log = time.monotonic()

    while not shutdown.flag:
        try:
            data, _addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        except OSError as e:
            log.error("socket error: %s", e)
            time.sleep(1)
            continue

        try:
            msg = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            continue

        mtype = msg.get("type")
        try:
            if mtype == "obs_st":
                rows = parse_obs_st(msg)
                n = insert_obs(dsn, rows)
                obs_count += n
                if rows:
                    r = rows[-1]
                    log.info(
                        "obs %s  %.1f°C  RH %.0f%%  wind %.1f/%.1f m/s @%s°  %.0f mb  %s lux  strikes=%s",
                        r["ts"].isoformat(timespec="seconds"),
                        _n(r["air_temp"]), _n(r["rh"]),
                        _n(r["wind_avg"]), _n(r["wind_gust"]), r["wind_dir"],
                        _n(r["pressure"]), r["illuminance"], r["strike_count"],
                    )
            elif mtype in ("evt_strike", "evt_precip"):
                ev = parse_event(msg)
                if ev:
                    insert_event(dsn, ev)
                    log.info("event %s @ %s (%s km)", ev["kind"], ev["ts"].isoformat(timespec="seconds"), ev["distance_km"])
        except Exception as e:
            log.error("failed to store %s: %s", mtype, e)

        now = time.monotonic()
        if now - last_log > 300:
            log.info("heartbeat: %s obs stored since start", obs_count)
            last_log = now

    sock.close()
    log.info("stopped")
    return 0


def _n(v):
    return v if v is not None else float("nan")


if __name__ == "__main__":
    sys.exit(main())
