# weatherlistener

Ingests WeatherFlow **Tempest** weather data into the shared TimescaleDB so bird
detections can be correlated with hyper-local conditions.

- **Live:** binds UDP **50222** (the hub broadcasts there on the LAN, no token)
  and stores per-minute `obs_st` rows into `weather`, plus lightning/rain events
  into `weather_events`. Runs with `network_mode: host` to receive broadcasts.
- **Backfill:** `scripts/backfill.py` uses the Tempest cloud REST API + a personal
  access token to fill `weather` backward over the existing detection history
  (one-minute data, fetched in 5-day chunks).

## Config (host-only `weatherlistener/.env`, gitignored)

```
PGHOST=...
PGPORT=5432
PGUSER=...
PGPASSWORD=...
PGDATABASE=...
TEMPEST_TOKEN=...     # only needed for backfill
```

## Backfill (one-off, on the server)

```bash
cd ~/bird-app
docker compose run --rm weatherlistener python -m scripts.backfill
```

Backfills from the earliest detection to now by default. Override with
`TEMPEST_BACKFILL_START` (ISO date or epoch) or `TEMPEST_DEVICE_ID`.

## Schema

`weather` (hypertable) and `weather_events` — see [`../docs/schema.md`](../docs/schema.md).
