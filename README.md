# bird-app

Monorepo for a backyard bird-call monitoring system. RTSP cameras with
microphones around the yard are continuously analyzed by **BirdNET**; every
detection (and short audio clips of recent ones) is written to a shared
**TimescaleDB**, and a **Next.js dashboard** turns it into species pages, activity
patterns, weather correlations, and a review queue for validating detections.

Everything runs as Docker containers on a single host.

## Requirements

**Required**

- **A host with Docker + Docker Compose.** Everything builds and runs in containers — you don't need Node or Python installed on the host.
- **A PostgreSQL database with the TimescaleDB extension.** The services share it and create their own schema (hypertables for the time-series data). It can run anywhere reachable on your network.
- **One or more RTSP cameras with microphones** on your LAN (Amcrest or any camera exposing an RTSP audio stream). BirdNET analyzes the audio — the model is bundled in the image, so there's no separate download and no GPU needed.

**Optional** — each unlocks a feature; the app degrades gracefully without it:

- **WeatherFlow Tempest weather station** → the weather ingest + weather/activity correlations. Live data is a token-free LAN broadcast; a **Tempest cloud token** ([tempestwx.com/account](https://tempestwx.com/account)) is only needed to backfill history.
- **eBird API key** ([ebird.org/api/keygen](https://ebird.org/api/keygen)) **+ your station's coordinates** → the "reported nearby" panel and the eBird-driven review queue.
- **xeno-canto API key** ([xeno-canto.org/account](https://xeno-canto.org/account)) → a reference recording on each species page.
- **iNaturalist place id** → local establishment-means (native / introduced). Bird photos and summaries (iNaturalist + Wikipedia) work without it — no key required.

Where each of these goes is covered in [Configuration & secrets](#configuration--secrets).

## Screenshots

The **Overview** — live conditions, newest arrivals, recent activity, most-heard species, and a 30-day chart:

![Overview](docs/screenshots/Backyard%20Birds%20-%20home.png)

A look at the rest (click any to enlarge):

<table>
  <tr>
    <td align="center" width="33%" valign="top">
      <a href="docs/screenshots/Backyard%20Birds%20-%20Species.png"><img src="docs/screenshots/Backyard%20Birds%20-%20Species.png" width="240" /></a><br />
      <b>Species</b><br /><sub>Searchable, filterable index</sub>
    </td>
    <td align="center" width="33%" valign="top">
      <a href="docs/screenshots/Backyard%20Birds%20-%20Species%20-%20Detail.png"><img src="docs/screenshots/Backyard%20Birds%20-%20Species%20-%20Detail.png" width="240" /></a><br />
      <b>Species detail</b><br /><sub>Photo, eBird verdict, reference call vs. clips</sub>
    </td>
    <td align="center" width="33%" valign="top">
      <a href="docs/screenshots/Backyard%20Birds%20-%20Patterns.png"><img src="docs/screenshots/Backyard%20Birds%20-%20Patterns.png" width="240" /></a><br />
      <b>Patterns</b><br /><sub>Dawn chorus, weather, heatmap</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/screenshots/Backyard%20Birds%20-%20Cameras.png"><img src="docs/screenshots/Backyard%20Birds%20-%20Cameras.png" width="240" /></a><br />
      <b>Cameras</b><br /><sub>Side-by-side comparison</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/screenshots/Backyard%20Birds%20-%20Live.png"><img src="docs/screenshots/Backyard%20Birds%20-%20Live.png" width="240" /></a><br />
      <b>Live feed</b><br /><sub>Detections as they happen, grouped</sub>
    </td>
    <td align="center" valign="top">
      <a href="docs/screenshots/Backyard%20Birds%20-%20Flagged.png"><img src="docs/screenshots/Backyard%20Birds%20-%20Flagged.png" width="240" /></a><br />
      <b>Flagged</b><br /><sub>eBird-driven review queue</sub>
    </td>
  </tr>
</table>

## Architecture

```
   Amcrest RTSP cameras (LAN)          WeatherFlow Tempest hub (LAN)
            │ audio                          │ UDP :50222 broadcasts
            ▼                                ▼
   ┌─────────────────┐              ┌──────────────────┐
   │  birdlistener   │              │  weatherlistener │
   │  ffmpeg+BirdNET │              │  UDP ingest      │
   └────────┬────────┘              └─────────┬────────┘
            │ writes                          │ writes
            ▼                                 ▼
        ┌──────────────────────────────────────────┐
        │            TimescaleDB / Postgres         │  (runs elsewhere on the LAN)
        │  detections · species_clips · weather …   │
        └───────────────────┬──────────────────────┘
                            │ reads (+ flag/dismiss writes)
                            ▼
                   ┌──────────────────┐     external APIs:
                   │  bird-call-app   │───▶ iNaturalist, Wikipedia (photos/info)
                   │  Next.js  :3009  │───▶ eBird API v3 (nearby reports)
                   └──────────────────┘───▶ xeno-canto API v3 (reference calls)
```

The three services are intentionally **separate images** (Python vs Node) but
live in one repo because they form one system and share one contract: the
database schema in [`docs/schema.md`](docs/schema.md). They communicate **only**
through the database — there are no service-to-service calls.

## Services

| Directory          | Runtime | Networking | Role |
|--------------------|---------|------------|------|
| `birdlistener/`    | Python 3.11 (ffmpeg + [birdnetlib](https://pypi.org/project/birdnetlib/)) | host | One subprocess per camera: decodes RTSP audio, runs BirdNET on 3s windows, writes `detections`, and stores padded Opus **clips** of recent detections. Owns most of the DB schema. |
| `weatherlistener/` | Python 3.11 (psycopg2, requests) | host | Listens for the WeatherFlow Tempest hub's token-free UDP broadcasts on **:50222** and writes per-minute `weather` rows + lightning/rain `weather_events`. Includes a one-off cloud **backfill** script. |
| `bird-call-app/`   | Next.js 16 / Node 22 | `:3009` | The dashboard. Reads the DB (through the `v_detections` view) and serves the UI + a few API routes (clip streaming, false-positive flag/dismiss, bird-image cache). |

### Pages (dashboard)
Overview · Live feed · Species (index + per-species detail) · Patterns
(activity, dawn chorus, weather response curves, heatmap) · Cameras (comparison)
· **Flagged** (eBird-driven review queue + false-positive management).

## Data model

TimescaleDB. `birdlistener` creates `detections`, `species_clips`,
`species_suppression`, `review_dismissed`, and the `v_detections` view.
`weatherlistener` creates `weather` + `weather_events`. The dashboard **reads
through `v_detections`** (which hides flagged rows + suppressed species) and
writes only the false-positive/dismiss tables. Full column-level contract:
[`docs/schema.md`](docs/schema.md).

## External APIs & integrations

| Source | Used for | Auth | Where |
|--------|----------|------|-------|
| **BirdNET** (birdnetlib) | Species identification | none (model bundled in image) | `birdlistener` |
| **iNaturalist** + **Wikipedia** | Bird photos, taxonomy, summaries, conservation/establishment status | none (public) | `bird-call-app` (`lib/birds.ts`), cached on disk |
| **eBird API v3** | "Reported nearby" comparison + the review queue | **API key** | `bird-call-app` (`lib/ebird.ts`) |
| **xeno-canto API v3** | Reference recording per species (what it should sound like) | **API key** | `bird-call-app` (`lib/xenocanto.ts`) |
| **WeatherFlow Tempest – local UDP** | Live per-minute conditions | none (LAN broadcast) | `weatherlistener` |
| **WeatherFlow Tempest – cloud REST** | Historical weather backfill | **personal access token** | `weatherlistener/scripts/backfill.py` |

Bird photos, eBird results, and xeno-canto references are all cached on the
`bird-cache` Docker volume so external APIs are hit sparingly. eBird and
xeno-canto features **degrade gracefully** — without a key, those panels simply
don't render.

## Configuration & secrets

Secrets are **never** in git. Each service reads host-only files that must exist
before `docker compose up`:

### `birdlistener/config.yaml`  (copy from `config.yaml.example`)
RTSP camera URLs (with credentials), the TimescaleDB connection, detection
location, and clip settings (`save_clips`, `clip_keep`,
`clip_min_interval_seconds`, `clip_pad_before/after_seconds`). The DB password
can also come from the `DB_PASSWORD` env var.

### `bird-call-app/.env`
| Var | Required? | Notes |
|-----|-----------|-------|
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | **yes** | TimescaleDB connection (needs read + write for flag/dismiss) |
| `EBIRD_API_KEY` | optional | Enables the eBird panel + review queue. Get one at <https://ebird.org/api/keygen> |
| `EBIRD_LAT` / `EBIRD_LNG` | with `EBIRD_API_KEY` | Your station's coordinates for eBird "nearby" lookups. No location is baked in — eBird features need these |
| `XENOCANTO_KEY` | optional | Enables reference recordings. From a [xeno-canto](https://xeno-canto.org/account) account |
| `INAT_PLACE_ID` | optional | iNaturalist place id for local establishment-means |

`APP_TZ`, `NODE_ENV`, `BIRD_CACHE_DIR` are set in `docker-compose.yml`.

### `weatherlistener/.env`
| Var | Required? | Notes |
|-----|-----------|-------|
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | **yes** | (or `DATABASE_URL`) |
| `TEMPEST_TOKEN` | for backfill only | Personal access token from <https://tempestwx.com/account> |
| `TEMPEST_UDP_PORT` | optional | Defaults to `50222` |

## Deploy

One repo, one command:

```bash
git pull
docker compose up -d --build
```

Target a single service to avoid rebuilding everything, e.g.
`docker compose up -d --build app`.

**Schema-change ordering:** `birdlistener` owns most of the schema and creates
new tables/columns/views on startup, so when a change touches the DB contract,
**deploy `birdlistener` first**, then the dashboard. The dashboard's queries are
written to tolerate not-yet-existing tables where practical.

### Weather backfill (one-off)
```bash
docker compose run --rm weatherlistener python -m scripts.backfill
```
Fills `weather` backward from the earliest detection using the Tempest cloud API
(requires `TEMPEST_TOKEN`); idempotent with the live UDP feed.

## Notes

- **Ports / networking:** the dashboard publishes `:3009`; `birdlistener` and
  `weatherlistener` use host networking (RTSP pulls / UDP broadcasts on the LAN).
- **Private LAN:** nothing here is internet-exposed; the database, cameras, and
  weather hub are all on the local network.
- **History:** this repo was unified from two previously separate repos
  (`birdlistener` and `bird-call-app`) via `git subtree`, so each subdirectory
  preserves its original commit history.
