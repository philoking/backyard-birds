# Database contract

The services communicate **only** through this shared TimescaleDB schema:

- `birdlistener` owns `detections` + `species_clips` + `species_suppression` + the `v_detections` view (created in `birdlistener/src/db.py: init_db`).
- `weatherlistener` owns `weather` + `weather_events` (created in `weatherlistener/src/db.py: init_db`).
- `bird-call-app` reads through `v_detections`, and writes false-positive flags (`detections.false_positive`, `species_suppression`).

Any change here touches multiple services — keep this doc in sync.

## `detections` (hypertable on `ts`)

One row per BirdNET detection above the confidence threshold.

| Column            | Type               | Notes                                  |
|-------------------|--------------------|----------------------------------------|
| `id`              | `BIGSERIAL`        | not unique across the hypertable alone |
| `ts`              | `TIMESTAMPTZ`      | detection time (hypertable time column)|
| `camera`          | `TEXT`             | camera name from config                |
| `common_name`     | `TEXT`             | nullable                               |
| `scientific_name` | `TEXT`             | nullable                               |
| `confidence`      | `DOUBLE PRECISION` |                                        |
| `clip_start_s`    | `DOUBLE PRECISION` | window offset, nullable                |
| `clip_end_s`      | `DOUBLE PRECISION` | window offset, nullable                |
| `false_positive`  | `BOOLEAN`          | user-flagged bad detection; default false |

Indexes: `(camera)`, `(common_name)`. Hypertable via
`create_hypertable('detections','ts')`.

**The dashboard reads `v_detections`, not `detections`.** That view excludes
flagged rows and suppressed species:

```sql
CREATE VIEW v_detections AS
SELECT d.* FROM detections d
WHERE NOT d.false_positive
  AND NOT EXISTS (SELECT 1 FROM species_suppression s
                  WHERE s.suppressed AND s.common_name = d.common_name);
```

## `species_suppression`

Tracks per-species false-positive flags. The dashboard flags a clip → marks the
matching detection `false_positive` and bumps `flag_count`; at 6 it sets
`suppressed`, hiding the species (past and future) via the view. Reversible.

| Column        | Type          | Notes                              |
|---------------|---------------|------------------------------------|
| `common_name` | `TEXT` PK     |                                    |
| `flag_count`  | `INTEGER`     | per-clip flags accumulated         |
| `suppressed`  | `BOOLEAN`     | true once fully hidden             |
| `updated_at`  | `TIMESTAMPTZ` |                                    |

## `species_clips` (plain table)

Short audio clips of recent detections, retained as the newest N per species so
the dashboard can play back what was heard. Pruned on write by
`birdlistener/src/db.py: store_clip`; served by the dashboard at
`/api/clips/[id]`.

| Column            | Type               | Notes                                   |
|-------------------|--------------------|-----------------------------------------|
| `id`              | `BIGSERIAL` PK     | referenced by `/api/clips/[id]`         |
| `ts`              | `TIMESTAMPTZ`      | detection time                          |
| `camera`          | `TEXT`             |                                         |
| `common_name`     | `TEXT`             | retention/prune key                     |
| `scientific_name` | `TEXT`             | nullable                                |
| `confidence`      | `DOUBLE PRECISION` |                                         |
| `audio`           | `BYTEA`            | encoded clip (~12 KB Opus)              |
| `mime`            | `TEXT`             | `audio/ogg` (Opus) or `audio/mpeg` (MP3)|
| `created_at`      | `TIMESTAMPTZ`      | default `now()`                         |

Index: `(common_name, ts DESC)`.

### Retention

`clip_keep` (default 5) clips per species; a per-species cooldown
(`clip_min_interval_seconds`, default 30) spreads retained clips over time.
These run on code defaults unless set in `birdlistener/config.yaml` — see
birdlistener issue #2.

### Notes for the reader

- Never `SELECT audio` for list views — fetch metadata only
  (`bird-call-app/lib/queries.ts: getSpeciesClips`) and stream bytes lazily.
- The dashboard tolerates `species_clips` not existing yet (the query catches
  and returns `[]`), so the two services can deploy in any order.

## `weather` (hypertable on `ts`)

One row per minute from the Tempest hub (`obs_st`). Written live by
`weatherlistener` over UDP 50222, and backfilled from the cloud REST API.
`ts` is the primary key, so inserts use `ON CONFLICT (ts) DO NOTHING` —
live and backfill are idempotent and can't duplicate a minute.

| Column         | Type               | Unit / notes                  |
|----------------|--------------------|-------------------------------|
| `ts`           | `TIMESTAMPTZ` PK   | observation minute (UTC)      |
| `station_sn`   | `TEXT`             | e.g. `ST-00093286` (null for backfill) |
| `hub_sn`       | `TEXT`             |                               |
| `wind_lull` / `wind_avg` / `wind_gust` | `DOUBLE PRECISION` | m/s         |
| `wind_dir`     | `INTEGER`          | degrees                       |
| `pressure`     | `DOUBLE PRECISION` | station pressure, mb          |
| `air_temp`     | `DOUBLE PRECISION` | °C                            |
| `rh`           | `DOUBLE PRECISION` | %                             |
| `illuminance`  | `DOUBLE PRECISION` | lux                           |
| `uv`           | `DOUBLE PRECISION` | UV index                      |
| `solar_rad`    | `DOUBLE PRECISION` | W/m²                          |
| `rain_min`     | `DOUBLE PRECISION` | mm in the previous minute     |
| `precip_type`  | `INTEGER`          | 0 none, 1 rain, 2 hail        |
| `strike_dist`  | `DOUBLE PRECISION` | km (avg over minute)          |
| `strike_count` | `INTEGER`          |                               |
| `battery`      | `DOUBLE PRECISION` | volts                         |

To correlate a detection with conditions, join on the nearest minute, e.g.
`weather` filtered to `date_trunc('minute', d.ts)`.

## `weather_events`

Real-time lightning / rain-start events (`evt_strike`, `evt_precip`). Low volume.

| Column        | Type        | Notes                          |
|---------------|-------------|--------------------------------|
| `id`          | `BIGSERIAL` |                                |
| `ts`          | `TIMESTAMPTZ` |                              |
| `kind`        | `TEXT`      | `strike` or `precip_start`     |
| `distance_km` | `DOUBLE PRECISION` | strikes only            |
| `energy`      | `DOUBLE PRECISION` | strikes only            |
| `station_sn`  | `TEXT`      |                                |
