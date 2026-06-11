# BirdListener

Continuous bird-call identification from RTSP IP cameras (Amcrest and friends)
using BirdNET running locally. No cloud, no API keys.

- Pulls audio from each camera's RTSP stream via `ffmpeg`
- Analyzes 3-second windows with [BirdNET-Analyzer](https://github.com/kahst/BirdNET-Analyzer)
  through the [`birdnetlib`](https://github.com/joeweiss/birdnetlib) wrapper
- Logs detections (species, confidence, camera, timestamp) into a PostgreSQL/TimescaleDB
  hypertable for efficient time-series queries
- Restarts ffmpeg on network hiccups, restarts workers on crashes, clean SIGTERM
- Docker Compose deploy; CPU-only (no GPU required)

## Requirements

- Docker + Docker Compose v2
- PostgreSQL 12+ with TimescaleDB extension (can run in a container; see setup below)
- An amd64 or aarch64 Linux host (tflite-runtime wheels are published for
  x86_64/aarch64 on Python 3.11). CPU only — no GPU needed.
- An RTSP URL per camera. Amcrest's default pattern is:
  ```
  rtsp://<user>:<pass>@<camera-ip>:554/cam/realmonitor?channel=1&subtype=1
  ```
  `subtype=1` (sub-stream) is plenty for audio and uses less bandwidth.

## Setup

```bash
cp config.yaml.example config.yaml
$EDITOR config.yaml        # add your cameras + location + database credentials
docker compose up -d --build
docker compose logs -f birdlistener
```

The `docker-compose.yaml` includes a PostgreSQL service with TimescaleDB extension.
Customize the database credentials in `config.yaml` (and set `DB_PASSWORD` env var
if needed).

You should see lines like:

```
2026-04-21 10:14:02 INFO [cam-backyard] BirdNET analyzer loaded
2026-04-21 10:14:05 INFO [cam-backyard] connecting to rtsp://admin:***@192.168.1.100:554/...
2026-04-21 10:14:09 INFO [cam-backyard] American Robin (Turdus migratorius) conf=0.84
```

Detections are stored in the PostgreSQL `detections` hypertable (managed by TimescaleDB
for efficient time-series queries).

## Querying the database

The bundled helper (run on the host, requires `psycopg2`):

```bash
python scripts/query.py recent
python scripts/query.py top-species 7d
python scripts/query.py per-camera
python scripts/query.py species "Northern Cardinal"
```

Or use `psql` directly:

```bash
psql "postgresql://user:password@localhost:5432/birdlistener" \
  -c "SELECT common_name, COUNT(*) c FROM detections
      WHERE ts >= NOW() - INTERVAL '1 day'
      GROUP BY 1 ORDER BY c DESC LIMIT 10;"
```

## Tuning

Settings live in `config.yaml`:

| Setting | What it does |
|---|---|
| `min_confidence` | Drop detections below this BirdNET score. 0.7 is a reasonable starting point; lower = more hits + more noise. |
| `sensitivity` | BirdNET's own dial (0.5 – 1.5). Higher is more permissive. |
| `overlap_seconds` | Seconds of overlap between successive 3s windows. `0.0` is cheapest; `1.5` (50 %) catches calls that straddle boundaries at ~2× the CPU cost. |
| `default_location` | Lat/lon used to restrict BirdNET's candidate species list to regionally plausible birds. Strongly recommended — it noticeably reduces false positives. |

## Performance

BirdNET via `tflite-runtime` runs on the CPU and is already fast enough for
this use case: a 3-second analysis runs in a few hundred milliseconds per
core on a modern x86, so four cameras need only a small fraction of one
core.

## Architecture

```
┌─────────────────────┐   3s PCM   ┌──────────────────┐
│ ffmpeg (RTSP)       │──────────▶ │ BirdNET analyzer │
│  cam-backyard       │            │   (per worker)   │
└─────────────────────┘            └──────────┬───────┘
                                              │ detections
                                              ▼
                                  ┌──────────────────────┐
                                  │ PostgreSQL +         │
                                  │ TimescaleDB          │
                                  │ (hypertable)         │
                                  └──────────────────────┘
```

One OS process per camera, so a crashing ffmpeg or a chatty neighbor can't
stall the rest of the pipeline. The main process restarts dead workers.

## Files

- `src/main.py` — supervisor, signal handling, worker restart
- `src/rtsp_worker.py` — ffmpeg subprocess + BirdNET loop, sliding window, reconnect backoff
- `src/db.py` — PostgreSQL/TimescaleDB schema + batch insert
- `src/config.py` — typed YAML loader (pydantic)
- `scripts/query.py` — CLI reporting helper

## Limitations & next steps

- No audio-clip retention. If you want a WAV per detection, add a rolling
  buffer in `rtsp_worker.py` and write the window to disk when any detection
  clears the threshold.
- No dashboard. TimescaleDB is well-supported by Grafana, Superset, and other
  BI tools; write a quick dashboard to visualize detections over time or by species.
- No notifications. Hook `insert_detections` or add an additional sink that
  pushes to ntfy / webhook / Home Assistant if you want alerts on rare birds.