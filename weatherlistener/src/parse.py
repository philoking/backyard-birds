"""Parse WeatherFlow Tempest local UDP messages (v171 field order).

The hub broadcasts JSON datagrams on UDP 50222. We care about three types:

  obs_st       once per minute — the full observation array
  evt_strike   a lightning strike (distance + energy)
  evt_precip   rain has started

rapid_wind (every ~3s), hub_status and device_status are ignored for storage.

Reference: https://weatherflow.github.io/Tempest/api/udp/v171/
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def _ts(epoch) -> datetime:
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc)


def parse_obs_st(msg: dict) -> list[dict]:
    """Return one dict per observation row in an obs_st message.

    obs array (v171): [
      0 time_epoch, 1 wind_lull, 2 wind_avg, 3 wind_gust, 4 wind_dir,
      5 wind_sample_interval, 6 station_pressure, 7 air_temp, 8 rh,
      9 illuminance, 10 uv, 11 solar_radiation, 12 rain_prev_min,
      13 precip_type, 14 strike_avg_distance, 15 strike_count,
      16 battery, 17 report_interval
    ]
    """
    station = msg.get("serial_number")
    hub = msg.get("hub_sn")
    rows: list[dict] = []
    for o in msg.get("obs") or []:
        if not o or o[0] is None:
            continue
        rows.append(
            {
                "ts": _ts(o[0]),
                "station_sn": station,
                "hub_sn": hub,
                "wind_lull": _f(o, 1),
                "wind_avg": _f(o, 2),
                "wind_gust": _f(o, 3),
                "wind_dir": _i(o, 4),
                "pressure": _f(o, 6),
                "air_temp": _f(o, 7),
                "rh": _f(o, 8),
                "illuminance": _f(o, 9),
                "uv": _f(o, 10),
                "solar_rad": _f(o, 11),
                "rain_min": _f(o, 12),
                "precip_type": _i(o, 13),
                "strike_dist": _f(o, 14),
                "strike_count": _i(o, 15),
                "battery": _f(o, 16),
            }
        )
    return rows


def parse_event(msg: dict) -> Optional[dict]:
    """Return a weather_events row for evt_strike / evt_precip, else None."""
    t = msg.get("type")
    station = msg.get("serial_number")
    if t == "evt_strike":
        e = msg.get("evt") or []
        # evt: [time_epoch, distance_km, energy]
        if not e:
            return None
        return {
            "ts": _ts(e[0]),
            "kind": "strike",
            "distance_km": _f(e, 1),
            "energy": _f(e, 2),
            "station_sn": station,
        }
    if t == "evt_precip":
        e = msg.get("evt") or []
        # evt: [time_epoch]
        if not e:
            return None
        return {
            "ts": _ts(e[0]),
            "kind": "precip_start",
            "distance_km": None,
            "energy": None,
            "station_sn": station,
        }
    return None


def _f(arr, i) -> Optional[float]:
    try:
        v = arr[i]
        return float(v) if v is not None else None
    except (IndexError, TypeError, ValueError):
        return None


def _i(arr, i) -> Optional[int]:
    try:
        v = arr[i]
        return int(v) if v is not None else None
    except (IndexError, TypeError, ValueError):
        return None
