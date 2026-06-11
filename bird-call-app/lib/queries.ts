import { sql, LOCAL_TZ } from "./db";
import { type TimeRange } from "./timeRange";
export { slugifySpecies, unslugifySpecies } from "./slug";

export type Camera = "front_porch" | "shop_side" | "back_patio" | "garden";

export type Detection = {
  id: number;
  ts: Date;
  camera: string;
  common_name: string | null;
  scientific_name: string | null;
  confidence: number;
};

export type SpeciesClip = {
  id: number;
  ts: Date;
  camera: string;
  confidence: number;
  mime: string;
};

export type SpeciesRow = {
  common_name: string;
  scientific_name: string | null;
  detections: number;
  avg_confidence: number;
  first_seen: Date;
  last_seen: Date;
};

// Returns an inclusive WHERE fragment for the chosen calendar range,
// evaluated in the app's local zone so day boundaries line up with the UI.
function rangeWhere(range: TimeRange) {
  return sql`(ts AT TIME ZONE ${LOCAL_TZ})::date BETWEEN ${range.startDate}::date AND ${range.endDate}::date`;
}

export async function getOverviewStats(range: TimeRange) {
  const [row] = await sql<
    {
      total: number;
      species: number;
      cameras: number;
      today: number;
      today_species: number;
    }[]
  >`
    SELECT
      (SELECT COUNT(*)::int FROM v_detections WHERE ${rangeWhere(range)}) AS total,
      (SELECT COUNT(DISTINCT common_name)::int FROM v_detections
        WHERE common_name IS NOT NULL AND ${rangeWhere(range)}) AS species,
      (SELECT COUNT(DISTINCT camera)::int FROM v_detections WHERE ${rangeWhere(range)}) AS cameras,
      (SELECT COUNT(*)::int FROM v_detections
        WHERE (ts AT TIME ZONE ${LOCAL_TZ})::date = (NOW() AT TIME ZONE ${LOCAL_TZ})::date) AS today,
      (SELECT COUNT(DISTINCT common_name)::int FROM v_detections
        WHERE common_name IS NOT NULL
          AND (ts AT TIME ZONE ${LOCAL_TZ})::date = (NOW() AT TIME ZONE ${LOCAL_TZ})::date) AS today_species
  `;
  return row;
}

export async function getTopSpecies(range: TimeRange, limit = 20): Promise<SpeciesRow[]> {
  return sql<SpeciesRow[]>`
    SELECT
      common_name,
      MAX(scientific_name) AS scientific_name,
      COUNT(*)::int AS detections,
      AVG(confidence)::float AS avg_confidence,
      MIN(ts) AS first_seen,
      MAX(ts) AS last_seen
    FROM v_detections
    WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    GROUP BY common_name
    ORDER BY detections DESC
    LIMIT ${limit}
  `;
}

export async function getAllSpecies(range: TimeRange): Promise<SpeciesRow[]> {
  return sql<SpeciesRow[]>`
    SELECT
      common_name,
      MAX(scientific_name) AS scientific_name,
      COUNT(*)::int AS detections,
      AVG(confidence)::float AS avg_confidence,
      MIN(ts) AS first_seen,
      MAX(ts) AS last_seen
    FROM v_detections
    WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    GROUP BY common_name
    ORDER BY common_name ASC
  `;
}

export async function getSpecies(commonName: string, range: TimeRange) {
  // Header stats stay all-time so "First seen" / "Last heard" are stable
  // anchors that don't disappear when the user narrows the range.
  const [meta] = await sql<SpeciesRow[]>`
    SELECT
      common_name,
      MAX(scientific_name) AS scientific_name,
      COUNT(*)::int AS detections,
      AVG(confidence)::float AS avg_confidence,
      MIN(ts) AS first_seen,
      MAX(ts) AS last_seen
    FROM v_detections
    WHERE common_name = ${commonName}
    GROUP BY common_name
  `;
  if (!meta) return null;

  // Per-range count, shown next to the all-time count on the detail page.
  const [inRange] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name = ${commonName} AND ${rangeWhere(range)}
  `;

  const byDay = await sql<{ day: string; count: number }[]>`
    SELECT
      (ts AT TIME ZONE ${LOCAL_TZ})::date::text AS day,
      COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name = ${commonName} AND ${rangeWhere(range)}
    GROUP BY 1 ORDER BY 1
  `;

  const byCamera = await sql<{ camera: string; count: number }[]>`
    SELECT camera, COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name = ${commonName} AND ${rangeWhere(range)}
    GROUP BY camera
    ORDER BY count DESC
  `;

  const heatmap = await sql<{ day_of_week: number; hour: number; count: number }[]>`
    SELECT
      EXTRACT(DOW FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS day_of_week,
      EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS hour,
      COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name = ${commonName} AND ${rangeWhere(range)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;

  const recent = await sql<Detection[]>`
    SELECT id, ts, camera, common_name, scientific_name, confidence
    FROM v_detections
    WHERE common_name = ${commonName} AND ${rangeWhere(range)}
    ORDER BY ts DESC
    LIMIT 25
  `;

  // Clips are all-time (not range-filtered): they're the newest few the
  // listener captured, independent of the chart's selected window.
  const clips = await getSpeciesClips(commonName);

  return { meta, inRangeCount: inRange.count, byDay, byCamera, heatmap, recent, clips };
}

// Metadata only — never selects the `audio` bytea, which is streamed lazily
// through /api/clips/[id]. Tolerant of the table not existing yet so the
// dashboard can deploy before birdlistener provisions it.
export async function getSpeciesClips(commonName: string): Promise<SpeciesClip[]> {
  try {
    return await sql<SpeciesClip[]>`
      SELECT id, ts, camera, confidence, mime
      FROM species_clips
      WHERE common_name = ${commonName}
      ORDER BY ts DESC
      LIMIT 5
    `;
  } catch {
    return [];
  }
}

// Fetches a single clip's bytes for the streaming route.
export async function getClipAudio(
  id: number,
): Promise<{ audio: Uint8Array; mime: string } | null> {
  const [row] = await sql<{ audio: Uint8Array; mime: string }[]>`
    SELECT audio, mime FROM species_clips WHERE id = ${id}
  `;
  return row ?? null;
}

// --- Weather (Tempest station via weatherlistener) -------------------------
// All queries tolerate the weather table not existing yet (returns null), so
// the dashboard works whether or not the weather service is deployed.

export type CurrentWeather = {
  ts: Date;
  air_temp: number | null;
  rh: number | null;
  wind_avg: number | null;
  wind_gust: number | null;
  wind_dir: number | null;
  pressure: number | null;
  solar_rad: number | null;
  uv: number | null;
  rain_min: number | null;
  precip_type: number | null;
  dp3h: number | null; // station-pressure change over ~3h (mb), for tendency
};

export async function getCurrentWeather(): Promise<CurrentWeather | null> {
  try {
    const [row] = await sql<CurrentWeather[]>`
      WITH latest AS (SELECT * FROM weather ORDER BY ts DESC LIMIT 1),
           prior  AS (
             SELECT pressure FROM weather
             WHERE ts <= NOW() - INTERVAL '3 hours'
             ORDER BY ts DESC LIMIT 1
           )
      SELECT l.ts, l.air_temp, l.rh, l.wind_avg, l.wind_gust, l.wind_dir,
             l.pressure, l.solar_rad, l.uv, l.rain_min, l.precip_type,
             (l.pressure - (SELECT pressure FROM prior)) AS dp3h
      FROM latest l
    `;
    return row ?? null;
  } catch {
    return null;
  }
}

export type SpeciesWeather = {
  n: number;
  avg_temp: number | null;
  avg_wind: number | null;
  max_gust: number | null;
  calm_pct: number | null;
  dry_pct: number | null;
  ambient_temp: number | null;
  ambient_wind: number | null;
};

// "Conditions when heard": for each detection of the species, find the nearest
// weather observation (±15 min) and aggregate. Ambient averages over all
// weather give a yard baseline to compare against.
export async function getSpeciesWeather(commonName: string): Promise<SpeciesWeather | null> {
  try {
    const [row] = await sql<SpeciesWeather[]>`
      WITH heard AS (
        SELECT w.air_temp, w.wind_avg, w.wind_gust, w.rain_min, w.precip_type
        FROM v_detections d
        CROSS JOIN LATERAL (
          SELECT air_temp, wind_avg, wind_gust, rain_min, precip_type
          FROM weather w
          WHERE w.ts BETWEEN d.ts - INTERVAL '15 minutes' AND d.ts + INTERVAL '15 minutes'
          ORDER BY abs(EXTRACT(EPOCH FROM (w.ts - d.ts)))
          LIMIT 1
        ) w
        WHERE d.common_name = ${commonName}
      )
      SELECT
        COUNT(*)::int AS n,
        AVG(air_temp)::float AS avg_temp,
        AVG(wind_avg)::float AS avg_wind,
        MAX(wind_gust)::float AS max_gust,
        (AVG((wind_avg < 0.5)::int) * 100)::float AS calm_pct,
        (AVG((COALESCE(rain_min,0) = 0 AND COALESCE(precip_type,0) = 0)::int) * 100)::float AS dry_pct,
        (SELECT AVG(air_temp)::float FROM weather) AS ambient_temp,
        (SELECT AVG(wind_avg)::float FROM weather) AS ambient_wind
      FROM heard
    `;
    if (!row || !row.n) return null;
    return row;
  } catch {
    return null;
  }
}

export async function getRecent(limit = 50): Promise<Detection[]> {
  return sql<Detection[]>`
    SELECT id, ts, camera, common_name, scientific_name, confidence
    FROM v_detections
    ORDER BY ts DESC
    LIMIT ${limit}
  `;
}

export async function getDetectionsSince(sinceId: number, limit = 200): Promise<Detection[]> {
  return sql<Detection[]>`
    SELECT id, ts, camera, common_name, scientific_name, confidence
    FROM v_detections
    WHERE id > ${sinceId}
    ORDER BY ts DESC
    LIMIT ${limit}
  `;
}

export async function getHourlyHeatmap(range: TimeRange) {
  return sql<{ day_of_week: number; hour: number; count: number }[]>`
    SELECT
      EXTRACT(DOW FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS day_of_week,
      EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS hour,
      COUNT(*)::int AS count
    FROM v_detections
    WHERE ${rangeWhere(range)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

export async function getHeatmapBucket(dow: number, hour: number, range: TimeRange) {
  const species = await sql<
    { common_name: string; count: number; avg_confidence: number; last_heard: string }[]
  >`
    SELECT
      common_name,
      COUNT(*)::int AS count,
      AVG(confidence)::float AS avg_confidence,
      MAX(ts)::text AS last_heard
    FROM v_detections
    WHERE EXTRACT(DOW FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int = ${dow}
      AND EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int = ${hour}
      AND ${rangeWhere(range)}
    GROUP BY 1
    ORDER BY count DESC
  `;
  const cameras = await sql<{ camera: string; count: number }[]>`
    SELECT camera, COUNT(*)::int AS count
    FROM v_detections
    WHERE EXTRACT(DOW FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int = ${dow}
      AND EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int = ${hour}
      AND ${rangeWhere(range)}
    GROUP BY camera
    ORDER BY count DESC
  `;
  return { species, cameras };
}

export async function getDailyActivity(range: TimeRange) {
  return sql<{ day: string; count: number; species: number }[]>`
    SELECT
      (ts AT TIME ZONE ${LOCAL_TZ})::date::text AS day,
      COUNT(*)::int AS count,
      COUNT(DISTINCT common_name)::int AS species
    FROM v_detections
    WHERE ${rangeWhere(range)}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function getDawnChorus(
  range: TimeRange,
  opts: { minDays?: number; startHour?: number; endHour?: number; limit?: number } = {},
) {
  const { minDays = 3, startHour = 4, endHour = 10, limit = 40 } = opts;
  return sql<
    {
      common_name: string;
      scientific_name: string | null;
      median_sec: number;
      p25_sec: number;
      p75_sec: number;
      days_heard: number;
    }[]
  >`
    WITH per_day AS (
      SELECT
        common_name,
        MAX(scientific_name) AS scientific_name,
        (ts AT TIME ZONE ${LOCAL_TZ})::date AS day,
        MIN(EXTRACT(EPOCH FROM (ts AT TIME ZONE ${LOCAL_TZ})::time))::float AS first_sec
      FROM v_detections
      WHERE common_name IS NOT NULL
        AND EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ})) BETWEEN ${startHour}::int AND ${endHour}::int
        AND ${rangeWhere(range)}
      GROUP BY 1, 3
    )
    SELECT
      common_name,
      MAX(scientific_name) AS scientific_name,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY first_sec)::float AS median_sec,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY first_sec)::float AS p25_sec,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY first_sec)::float AS p75_sec,
      COUNT(*)::int AS days_heard
    FROM per_day
    GROUP BY common_name
    HAVING COUNT(*) >= ${minDays}::int
    ORDER BY median_sec ASC
    LIMIT ${limit}
  `;
}

export async function getDailyBySpecies(range: TimeRange) {
  return sql<{ day: string; common_name: string; scientific_name: string | null; count: number }[]>`
    SELECT
      (ts AT TIME ZONE ${LOCAL_TZ})::date::text AS day,
      common_name,
      MAX(scientific_name) AS scientific_name,
      COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

export async function getPatternCallouts(range: TimeRange) {
  const hourly = await sql<{ hour: number; count: number; species: number }[]>`
    SELECT
      EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS hour,
      COUNT(*)::int AS count,
      COUNT(DISTINCT common_name)::int AS species
    FROM v_detections
    WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    GROUP BY 1
    ORDER BY 1
  `;
  const daily = await sql<{ day: string; count: number }[]>`
    SELECT
      (ts AT TIME ZONE ${LOCAL_TZ})::date::text AS day,
      COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    GROUP BY 1
  `;
  return { hourly, daily };
}

export async function getHourlyByCamera(range: TimeRange) {
  return sql<{ camera: string; hour: number; count: number }[]>`
    SELECT
      camera,
      EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS hour,
      COUNT(*)::int AS count
    FROM v_detections
    WHERE ${rangeWhere(range)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
}

export async function getCameraStats(range: TimeRange) {
  return sql<
    {
      camera: string;
      detections: number;
      species: number;
      avg_confidence: number;
      top_species: string;
    }[]
  >`
    WITH top AS (
      SELECT camera, common_name, COUNT(*) AS c,
        ROW_NUMBER() OVER (PARTITION BY camera ORDER BY COUNT(*) DESC) AS rn
      FROM v_detections
      WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
      GROUP BY camera, common_name
    )
    SELECT
      d.camera,
      COUNT(*)::int AS detections,
      COUNT(DISTINCT d.common_name)::int AS species,
      AVG(d.confidence)::float AS avg_confidence,
      (SELECT common_name FROM top WHERE camera = d.camera AND rn = 1) AS top_species
    FROM v_detections d
    WHERE ${rangeWhere(range)}
    GROUP BY d.camera
    ORDER BY detections DESC
  `;
}

export async function getSpeciesByCamera(range: TimeRange) {
  return sql<{ camera: string; common_name: string; count: number }[]>`
    SELECT camera, common_name, COUNT(*)::int AS count
    FROM v_detections
    WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    GROUP BY camera, common_name
    ORDER BY camera, count DESC
  `;
}

// All-time. "Newest arrivals" means yard-newcomers across the whole dataset.
export async function getFirstSightings(limit = 10) {
  return sql<{ common_name: string; scientific_name: string | null; first_seen: Date; camera: string }[]>`
    WITH firsts AS (
      SELECT DISTINCT ON (common_name)
        common_name, scientific_name, ts AS first_seen, camera
      FROM v_detections
      WHERE common_name IS NOT NULL
      ORDER BY common_name, ts ASC
    )
    SELECT * FROM firsts
    ORDER BY first_seen DESC
    LIMIT ${limit}
  `;
}

export async function getRecentUnique(range: TimeRange, limit = 15) {
  return sql<
    (Detection & { recent_count: number })[]
  >`
    WITH windowed AS (
      SELECT
        id, ts, camera, common_name, scientific_name, confidence,
        ROW_NUMBER() OVER (PARTITION BY common_name ORDER BY ts DESC) AS rn,
        COUNT(*) OVER (PARTITION BY common_name)::int AS recent_count
      FROM v_detections
      WHERE common_name IS NOT NULL AND ${rangeWhere(range)}
    )
    SELECT id, ts, camera, common_name, scientific_name, confidence, recent_count
    FROM windowed
    WHERE rn = 1
    ORDER BY ts DESC
    LIMIT ${limit}
  `;
}

// --- Weather × activity analytics ------------------------------------------
// All tolerate the weather table being absent (return null/[]).

export type WeatherBucket = { bucket: string; hours: number; avg_dets: number };

export type WeatherActivity = {
  wind: WeatherBucket[];
  precip: WeatherBucket[];
  lightOffsetSec: number | null;
  lightDays: number;
};

// Detection rate vs conditions, measured per daytime hour (05:00–20:00 local)
// so day length / nighttime silence doesn't swamp the weather signal. Hours
// with weather but no detections count as zero, so suppression shows honestly.
export async function getWeatherActivity(range: TimeRange): Promise<WeatherActivity | null> {
  try {
    const daytime = sql`EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ})) BETWEEN 5 AND 20`;
    const [wind, precip, light] = await Promise.all([
      sql<WeatherBucket[]>`
        WITH wh AS (
          SELECT date_trunc('hour', ts) AS h, AVG(wind_avg) AS wind
          FROM weather WHERE ${daytime} AND ${rangeWhere(range)} GROUP BY 1
        ),
        dh AS (
          SELECT date_trunc('hour', ts) AS h, COUNT(*) AS dets
          FROM v_detections WHERE ${rangeWhere(range)} GROUP BY 1
        )
        SELECT
          CASE WHEN wh.wind < 0.5 THEN 'Calm'
               WHEN wh.wind < 2.5 THEN 'Light'
               WHEN wh.wind < 5.5 THEN 'Breezy'
               ELSE 'Windy' END AS bucket,
          COUNT(*)::int AS hours,
          AVG(COALESCE(dh.dets, 0))::float AS avg_dets
        FROM wh LEFT JOIN dh USING (h)
        GROUP BY 1
      `,
      sql<WeatherBucket[]>`
        WITH wh AS (
          SELECT date_trunc('hour', ts) AS h, SUM(rain_min) AS rain
          FROM weather WHERE ${daytime} AND ${rangeWhere(range)} GROUP BY 1
        ),
        dh AS (
          SELECT date_trunc('hour', ts) AS h, COUNT(*) AS dets
          FROM v_detections WHERE ${rangeWhere(range)} GROUP BY 1
        )
        SELECT
          CASE WHEN wh.rain > 0 THEN 'Wet' ELSE 'Dry' END AS bucket,
          COUNT(*)::int AS hours,
          AVG(COALESCE(dh.dets, 0))::float AS avg_dets
        FROM wh LEFT JOIN dh USING (h)
        GROUP BY 1
      `,
      sql<{ median_offset_sec: number | null; days: number }[]>`
        WITH d AS (
          SELECT (ts AT TIME ZONE ${LOCAL_TZ})::date AS day,
                 MIN(EXTRACT(EPOCH FROM (ts AT TIME ZONE ${LOCAL_TZ})::time)) AS first_call
          FROM v_detections
          WHERE EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ})) BETWEEN 3 AND 9
            AND ${rangeWhere(range)}
          GROUP BY 1
        ),
        l AS (
          SELECT (ts AT TIME ZONE ${LOCAL_TZ})::date AS day,
                 MIN(EXTRACT(EPOCH FROM (ts AT TIME ZONE ${LOCAL_TZ})::time)) AS first_light
          FROM weather
          WHERE illuminance >= 50
            AND EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ})) BETWEEN 3 AND 9
            AND ${rangeWhere(range)}
          GROUP BY 1
        )
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (d.first_call - l.first_light))::float AS median_offset_sec,
          COUNT(*)::int AS days
        FROM d JOIN l USING (day)
      `,
    ]);

    const order = ["Calm", "Light", "Breezy", "Windy"];
    wind.sort((a: WeatherBucket, b: WeatherBucket) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
    precip.sort((a: WeatherBucket) => (a.bucket === "Dry" ? -1 : 1));

    if (wind.length === 0 && precip.length === 0) return null;
    return {
      wind,
      precip,
      lightOffsetSec: light[0]?.median_offset_sec ?? null,
      lightDays: light[0]?.days ?? 0,
    };
  } catch {
    return null;
  }
}

export type WeatherHour = {
  hod: number; // hour of day, local
  temp: number | null;
  wind: number | null;
  wind_dir: number | null;
  rh: number | null;
  pressure: number | null;
  rain: number | null;
  dets: number;
};

// One row per daytime hour (05:00–20:00 local) with the hour's weather averages
// and detection count. The /weather page bins this in JS for response curves,
// the temp×hour heatmap, the wind rose, and callouts — one query, many views.
export async function getWeatherHours(range: TimeRange): Promise<WeatherHour[]> {
  try {
    return await sql<WeatherHour[]>`
      WITH wh AS (
        SELECT date_trunc('hour', ts) AS h,
               EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ}))::int AS hod,
               AVG(air_temp) AS temp, AVG(wind_avg) AS wind, AVG(wind_dir) AS wind_dir,
               AVG(rh) AS rh, AVG(pressure) AS pressure, SUM(rain_min) AS rain
        FROM weather
        WHERE EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ})) BETWEEN 5 AND 20
          AND ${rangeWhere(range)}
        GROUP BY 1, 2
      ),
      dh AS (
        SELECT date_trunc('hour', ts) AS h, COUNT(*) AS dets
        FROM v_detections WHERE ${rangeWhere(range)} GROUP BY 1
      )
      SELECT wh.hod::int,
             wh.temp::float, wh.wind::float, wh.wind_dir::float,
             wh.rh::float, wh.pressure::float, wh.rain::float,
             COALESCE(dh.dets, 0)::int AS dets
      FROM wh LEFT JOIN dh USING (h)
    `;
  } catch {
    return [];
  }
}

export type RainShift = {
  common_name: string;
  wet_dets: number;
  dry_dets: number;
  wet_rate: number; // detections per wet daytime hour
  dry_rate: number; // detections per dry daytime hour
};

// Per-species detection rate in wet vs dry daytime hours. The page ranks by
// wet/dry ratio to surface "rain callers" vs "fair-weather callers".
export async function getRainSpeciesShifts(range: TimeRange): Promise<RainShift[]> {
  try {
    return await sql<RainShift[]>`
      WITH hours AS (
        SELECT date_trunc('hour', ts) AS h, (SUM(rain_min) > 0) AS wet
        FROM weather
        WHERE EXTRACT(HOUR FROM (ts AT TIME ZONE ${LOCAL_TZ})) BETWEEN 5 AND 20
          AND ${rangeWhere(range)}
        GROUP BY 1
      ),
      tot AS (
        SELECT COUNT(*) FILTER (WHERE wet) AS wet_hours,
               COUNT(*) FILTER (WHERE NOT wet) AS dry_hours
        FROM hours
      ),
      det AS (
        SELECT d.common_name,
               COUNT(*) FILTER (WHERE h.wet) AS wet_dets,
               COUNT(*) FILTER (WHERE NOT h.wet) AS dry_dets
        FROM v_detections d
        JOIN hours h ON h.h = date_trunc('hour', d.ts)
        WHERE d.common_name IS NOT NULL
        GROUP BY 1
      )
      SELECT common_name,
             wet_dets::int, dry_dets::int,
             (wet_dets::float / NULLIF((SELECT wet_hours FROM tot), 0)) AS wet_rate,
             (dry_dets::float / NULLIF((SELECT dry_hours FROM tot), 0)) AS dry_rate
      FROM det
      WHERE (wet_dets + dry_dets) >= 30
    `;
  } catch {
    return [];
  }
}

// Per-day rain total, average wind, and high temperature, for the ribbons
// under the daily chart.
export async function getDailyWeather(range: TimeRange) {
  try {
    return await sql<{ day: string; rain: number; wind: number; temp_high: number | null }[]>`
      SELECT
        (ts AT TIME ZONE ${LOCAL_TZ})::date::text AS day,
        COALESCE(SUM(rain_min), 0)::float AS rain,
        COALESCE(AVG(wind_avg), 0)::float AS wind,
        MAX(air_temp)::float AS temp_high
      FROM weather
      WHERE ${rangeWhere(range)}
      GROUP BY 1
      ORDER BY 1
    `;
  } catch {
    return [];
  }
}

// --- False-positive flagging --------------------------------------------------
// Per-clip flags accumulate per species; at SUPPRESS_THRESHOLD the whole species
// is hidden (future detections included) via the v_detections view. All
// reversible: flagged rows set false_positive, suppression is a row we can drop.

export const SUPPRESS_THRESHOLD = 6;

export type FlagResult = {
  ok: boolean;
  common_name: string | null;
  flag_count: number;
  suppressed: boolean;
};

export async function getSpeciesFlagState(
  commonName: string,
): Promise<{ flag_count: number; suppressed: boolean }> {
  try {
    const [row] = await sql<{ flag_count: number; suppressed: boolean }[]>`
      SELECT flag_count, suppressed FROM species_suppression WHERE common_name = ${commonName}
    `;
    return row ?? { flag_count: 0, suppressed: false };
  } catch {
    return { flag_count: 0, suppressed: false };
  }
}

export async function getHiddenSpecies(): Promise<
  { common_name: string; flag_count: number; updated_at: Date }[]
> {
  try {
    return await sql<{ common_name: string; flag_count: number; updated_at: Date }[]>`
      SELECT common_name, flag_count, updated_at
      FROM species_suppression
      WHERE suppressed
      ORDER BY updated_at DESC
    `;
  } catch {
    return [];
  }
}

// Flag a single clip as a false positive: mark its matching detection(s)
// (same ts/camera/species), delete the clip, bump the species flag count, and
// auto-suppress the whole species once it crosses the threshold.
export async function flagClipFalsePositive(clipId: number): Promise<FlagResult> {
  const [clip] = await sql<{ common_name: string }[]>`
    SELECT common_name FROM species_clips WHERE id = ${clipId}
  `;
  if (!clip) return { ok: false, common_name: null, flag_count: 0, suppressed: false };

  // Match the detection in SQL (clip.ts == detection.ts at full µs precision);
  // pulling ts through JS would truncate to ms and miss.
  await sql`
    UPDATE detections d SET false_positive = TRUE
    FROM species_clips c
    WHERE c.id = ${clipId}
      AND d.ts = c.ts AND d.camera = c.camera AND d.common_name = c.common_name
  `;
  await sql`DELETE FROM species_clips WHERE id = ${clipId}`;

  const [row] = await sql<{ flag_count: number; suppressed: boolean }[]>`
    INSERT INTO species_suppression (common_name, flag_count, updated_at)
    VALUES (${clip.common_name}, 1, now())
    ON CONFLICT (common_name) DO UPDATE
      SET flag_count = species_suppression.flag_count + 1, updated_at = now()
    RETURNING flag_count, suppressed
  `;

  let suppressed = row.suppressed;
  if (!suppressed && row.flag_count >= SUPPRESS_THRESHOLD) {
    await sql`
      UPDATE species_suppression SET suppressed = TRUE, updated_at = now()
      WHERE common_name = ${clip.common_name}
    `;
    // Drop the species' remaining clips; the view already hides its detections.
    await sql`DELETE FROM species_clips WHERE common_name = ${clip.common_name}`;
    suppressed = true;
  }

  return { ok: true, common_name: clip.common_name, flag_count: row.flag_count, suppressed };
}

export type FlaggedSpecies = {
  common_name: string;
  flag_count: number;
  suppressed: boolean;
  updated_at: Date;
};

// Every species with at least one false-positive flag (in-progress and hidden),
// for the review page.
export async function getFlaggedSpecies(): Promise<FlaggedSpecies[]> {
  try {
    return await sql<FlaggedSpecies[]>`
      SELECT common_name, flag_count, suppressed, updated_at
      FROM species_suppression
      WHERE flag_count > 0
      ORDER BY suppressed DESC, flag_count DESC, updated_at DESC
    `;
  } catch {
    return [];
  }
}

// Lightweight count for the header affordance.
export async function getFlaggedCount(): Promise<number> {
  try {
    const [row] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM species_suppression WHERE flag_count > 0
    `;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// --- Review queue (Flagged page) ---------------------------------------------
// Candidate species to check against eBird: those with captured clips (so we can
// play them) that are still visible (not suppressed), ordered by detections.

export type ReviewSpecies = { common_name: string; scientific_name: string | null; detections: number };

export async function getClipSpeciesByDetections(
  minDetections = 5,
  limit = 60,
): Promise<ReviewSpecies[]> {
  try {
    return await sql<ReviewSpecies[]>`
      WITH sc AS (
        SELECT common_name, MAX(scientific_name) AS scientific_name
        FROM species_clips GROUP BY 1
      ),
      det AS (
        SELECT common_name, COUNT(*)::int AS detections
        FROM v_detections WHERE common_name IS NOT NULL GROUP BY 1
      )
      SELECT sc.common_name, sc.scientific_name, det.detections
      FROM sc JOIN det USING (common_name)
      WHERE det.detections >= ${minDetections}
      ORDER BY det.detections DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
}

// Species the user reviewed and confirmed correct — excluded from the queue.
export async function getDismissedSpecies(): Promise<string[]> {
  try {
    const rows = await sql<{ common_name: string }[]>`SELECT common_name FROM review_dismissed`;
    return rows.map((r) => r.common_name);
  } catch {
    return [];
  }
}

export async function dismissSpecies(commonName: string): Promise<{ ok: boolean }> {
  await sql`
    INSERT INTO review_dismissed (common_name) VALUES (${commonName})
    ON CONFLICT (common_name) DO NOTHING
  `;
  return { ok: true };
}

export type ReviewClip = {
  id: number;
  common_name: string;
  ts: Date;
  camera: string;
  confidence: number;
  mime: string;
};

export async function getClipsForSpecies(names: string[]): Promise<ReviewClip[]> {
  if (names.length === 0) return [];
  try {
    return await sql<ReviewClip[]>`
      SELECT id, common_name, ts, camera, confidence, mime
      FROM species_clips
      WHERE common_name = ANY(${names})
      ORDER BY ts DESC
    `;
  } catch {
    return [];
  }
}

// Restore a suppressed species: un-flag its detections and drop the suppression.
export async function restoreSpecies(commonName: string): Promise<{ ok: boolean }> {
  await sql`UPDATE detections SET false_positive = FALSE WHERE common_name = ${commonName}`;
  await sql`DELETE FROM species_suppression WHERE common_name = ${commonName}`;
  return { ok: true };
}
