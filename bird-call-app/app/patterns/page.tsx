import Link from "next/link";
import {
  getHourlyHeatmap,
  getDailyBySpecies,
  getHeatmapBucket,
  getDawnChorus,
  getPatternCallouts,
  getWeatherActivity,
  getWeatherHours,
  getRainSpeciesShifts,
  getDailyWeather,
  slugifySpecies,
} from "@/lib/queries";
import WeatherActivity, { RainCallers } from "./WeatherActivity";
import { getBirdInfoBatch } from "@/lib/birds";
import { CATEGORIES, type BirdCategory } from "@/lib/categories";
import { cameraLabel, CAMERA_TEXT, formatDate, formatHour, formatNumber, formatRelative, formatWind, cToF } from "@/lib/format";
import { resolveRange } from "@/lib/timeRange";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOWS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CATEGORY_COLOR: Record<BirdCategory, string> = {
  Songbirds: "#f59e0b",
  Corvids: "#64748b",
  Hummingbirds: "#ec4899",
  Woodpeckers: "#f97316",
  Raptors: "#ef4444",
  Waterbirds: "#0ea5e9",
  Shorebirds: "#14b8a6",
  Gulls: "#a3a3a3",
  Doves: "#a78bfa",
  "Game birds": "#eab308",
  Other: "#525252",
};

const DAWN_START_HOUR = 4;
const DAWN_END_HOUR = 11; // exclusive upper bound on display

function formatClock(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

type Props = {
  searchParams: Promise<{ dow?: string; hour?: string; range?: string; start?: string; end?: string }>;
};

export default async function PatternsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const dowNum = sp.dow !== undefined ? Number(sp.dow) : NaN;
  const hourNum = sp.hour !== undefined ? Number(sp.hour) : NaN;
  const selected =
    Number.isInteger(dowNum) && dowNum >= 0 && dowNum <= 6 &&
    Number.isInteger(hourNum) && hourNum >= 0 && hourNum <= 23
      ? { dow: dowNum, hour: hourNum }
      : null;

  const [heat, dailySpecies, bucket, dawn, callouts, weatherAct, dailyWx, weatherHours, rainShifts] = await Promise.all([
    getHourlyHeatmap(range),
    getDailyBySpecies(range),
    selected ? getHeatmapBucket(selected.dow, selected.hour, range) : Promise.resolve(null),
    getDawnChorus(range, { minDays: 3, startHour: DAWN_START_HOUR, endHour: DAWN_END_HOUR - 1, limit: 30 }),
    getPatternCallouts(range),
    getWeatherActivity(range),
    getDailyWeather(range),
    getWeatherHours(range),
    getRainSpeciesShifts(range),
  ]);

  const wxByDay = new Map(dailyWx.map((w) => [w.day, w]));
  const maxRain = Math.max(0.01, ...dailyWx.map((w) => w.rain));

  // Preserve range across heatmap cell clicks and the Clear link.
  const rangeQs = new URLSearchParams();
  rangeQs.set("range", range.key);
  if (range.key === "custom") {
    rangeQs.set("start", range.startDate);
    rangeQs.set("end", range.endDate);
  }
  const baseQs = rangeQs.toString();
  const cellHref = (dow: number, h: number) => `/patterns?${baseQs}&dow=${dow}&hour=${h}#bucket`;
  const clearHref = `/patterns?${baseQs}`;

  // 7x24 heatmap grid
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of heat) grid[row.day_of_week][row.hour] = row.count;
  const maxCell = Math.max(1, ...heat.map((r) => r.count));

  // Map every species we saw in the 60-day window to its category via the bird cache.
  const uniqueSpeciesMap = new Map<string, string | null>();
  for (const r of dailySpecies) {
    if (!uniqueSpeciesMap.has(r.common_name)) {
      uniqueSpeciesMap.set(r.common_name, r.scientific_name);
    }
  }
  const uniqueSpecies = Array.from(uniqueSpeciesMap.entries()).map(([common, sci]) => ({
    common_name: common,
    scientific_name: sci,
  }));
  const infos = await getBirdInfoBatch(uniqueSpecies, 8);
  const speciesCategory = new Map<string, BirdCategory>();
  uniqueSpecies.forEach((s, i) => {
    speciesCategory.set(s.common_name, infos[i]?.category ?? "Other");
  });

  // Build day → (category → count) and the day axis.
  const dayMap = new Map<string, Map<BirdCategory, number>>();
  for (const r of dailySpecies) {
    const cat = speciesCategory.get(r.common_name) ?? "Other";
    let m = dayMap.get(r.day);
    if (!m) {
      m = new Map();
      dayMap.set(r.day, m);
    }
    m.set(cat, (m.get(cat) ?? 0) + r.count);
  }
  const days = Array.from(dayMap.keys()).sort();
  const dailyTotals = days.map((d) => {
    const m = dayMap.get(d)!;
    let total = 0;
    for (const v of m.values()) total += v;
    return { day: d, total, byCat: m };
  });
  const maxDailyTotal = Math.max(1, ...dailyTotals.map((d) => d.total));
  const presentCategories = CATEGORIES.filter((c) =>
    dailyTotals.some((d) => (d.byCat.get(c) ?? 0) > 0),
  );

  // Callouts
  const totalDetections = callouts.daily.reduce((s, d) => s + d.count, 0);
  const dayCount = callouts.daily.length;
  const avgPerDay = dayCount > 0 ? Math.round(totalDetections / dayCount) : 0;
  const dawnPeak = callouts.hourly
    .filter((h) => h.hour >= 4 && h.hour <= 9)
    .reduce<{ hour: number; count: number } | null>(
      (best, h) => (!best || h.count > best.count ? h : best),
      null,
    );
  const quietHour = callouts.hourly.reduce<{ hour: number; count: number } | null>(
    (best, h) => (!best || h.count < best.count ? h : best),
    null,
  );
  const busiestDay = callouts.daily.reduce<{ day: string; count: number } | null>(
    (best, d) => (!best || d.count > best.count ? d : best),
    null,
  );
  const peakDiversityHour = callouts.hourly.reduce<{ hour: number; species: number } | null>(
    (best, h) => (!best || h.species > best.species ? h : best),
    null,
  );

  // Dawn chorus axis
  const dawnRangeSec = (DAWN_END_HOUR - DAWN_START_HOUR) * 3600;
  const dawnTickHours = Array.from(
    { length: DAWN_END_HOUR - DAWN_START_HOUR + 1 },
    (_, i) => DAWN_START_HOUR + i,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          Patterns{" "}
          <span className="text-xs text-[color:var(--muted)] font-normal">{range.label}</span>
        </h1>
        <p className="text-sm text-[color:var(--muted)]">When the yard is loudest</p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Callout
          label="Dawn peak"
          value={dawnPeak ? formatHour(dawnPeak.hour) : "—"}
          sub={dawnPeak ? `${formatNumber(dawnPeak.count)} detections` : ""}
        />
        <Callout
          label="Peak diversity"
          value={peakDiversityHour ? formatHour(peakDiversityHour.hour) : "—"}
          sub={peakDiversityHour ? `${peakDiversityHour.species} species` : ""}
        />
        <Callout
          label="Quietest hour"
          value={quietHour ? formatHour(quietHour.hour) : "—"}
          sub={quietHour ? `${formatNumber(quietHour.count)} detections` : ""}
        />
        <Callout
          label="Busiest day"
          value={busiestDay ? formatDate(busiestDay.day) : "—"}
          sub={busiestDay ? `${formatNumber(busiestDay.count)} detections` : ""}
        />
        <Callout label="Avg / day" value={formatNumber(avgPerDay)} sub="all time" />
      </section>

      <section className="card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">{range.label}, by category</h2>
          <span className="text-xs text-[color:var(--muted)]">detections / day · rain + daily-high ribbons below</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[11px]">
          {presentCategories.map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-[color:var(--muted)]">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CATEGORY_COLOR[c] }} />
              {c}
            </span>
          ))}
        </div>
        <div className="flex items-end gap-0.5 h-40">
          {dailyTotals.map((d) => {
            const heightPct = Math.max(2, Math.round((d.total / maxDailyTotal) * 100));
            return (
              <div
                key={d.day}
                className="flex-1 flex flex-col justify-end h-full relative group"
              >
                <div className="flex flex-col-reverse w-full" style={{ height: `${heightPct}%` }}>
                  {presentCategories.map((c) => {
                    const v = d.byCat.get(c) ?? 0;
                    if (v === 0) return null;
                    const segPct = (v / d.total) * 100;
                    return (
                      <div
                        key={c}
                        style={{
                          height: `${segPct}%`,
                          backgroundColor: CATEGORY_COLOR[c],
                        }}
                      />
                    );
                  })}
                </div>
                <div className="opacity-0 group-hover:opacity-100 absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] bg-black/95 border border-[color:var(--border)] rounded px-2 py-1 whitespace-nowrap z-10 pointer-events-none">
                  <div className="font-semibold mb-0.5">{d.day}</div>
                  <div className="text-[color:var(--muted)] mb-1">{formatNumber(d.total)} total</div>
                  {presentCategories
                    .map((c) => ({ c, v: d.byCat.get(c) ?? 0 }))
                    .filter(({ v }) => v > 0)
                    .sort((a, b) => b.v - a.v)
                    .map(({ c, v }) => (
                      <div key={c} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: CATEGORY_COLOR[c] }} />
                        <span>{c}</span>
                        <span className="tabular-nums ml-auto pl-2">{formatNumber(v)}</span>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
        {dailyWx.length > 0 && (
          <>
            <div className="flex gap-0.5 mt-1.5">
              {dailyTotals.map((d) => {
                const wx = wxByDay.get(d.day);
                const rain = wx?.rain ?? 0;
                const op = rain > 0 ? 0.15 + (rain / maxRain) * 0.85 : 0;
                const f = wx ? cToF(wx.temp_high) : null;
                return (
                  <div
                    key={d.day}
                    className="flex-1 h-1.5 rounded-sm relative group"
                    style={{
                      backgroundColor: rain > 0 ? `rgba(56,189,248,${op})` : "rgba(255,255,255,0.04)",
                    }}
                  >
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] bg-black/95 border border-[color:var(--border)] rounded px-1.5 py-1 whitespace-nowrap z-10 pointer-events-none">
                      {d.day} — {rain > 0 ? `${rain.toFixed(1)} mm rain` : "dry"}
                      {wx ? ` · wind ${formatWind(wx.wind)}` : ""}
                      {f != null ? ` · high ${Math.round(f)}°F` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-0.5 mt-0.5">
              {dailyTotals.map((d) => {
                const wx = wxByDay.get(d.day);
                const f = wx ? cToF(wx.temp_high) : null;
                return (
                  <div
                    key={d.day}
                    className="flex-1 h-1.5 rounded-sm relative group"
                    style={{ backgroundColor: tempColor(f) }}
                  >
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] bg-black/95 border border-[color:var(--border)] rounded px-1.5 py-1 whitespace-nowrap z-10 pointer-events-none">
                      {d.day} — {f != null ? `high ${Math.round(f)}°F` : "no temp"}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[9px] text-[color:var(--muted)]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "rgba(56,189,248,0.8)" }} />
                rain
              </span>
              <span className="flex items-center gap-1">
                daily high
                <span className="flex">
                  {[38, 46, 54, 62, 70, 78, 84].map((t) => (
                    <span key={t} className="w-2.5 h-2.5" style={{ backgroundColor: tempColor(t) }} />
                  ))}
                </span>
                <span>cool→warm</span>
              </span>
            </div>
          </>
        )}
        <div className="flex justify-between mt-2 text-[10px] text-[color:var(--muted)]">
          <span>{dailyTotals[0]?.day ?? ""}</span>
          <span>{dailyTotals[dailyTotals.length - 1]?.day ?? ""}</span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Dawn chorus</h2>
        <p className="text-xs text-[color:var(--muted)] mb-4">
          When each species typically starts calling, between {formatHour(DAWN_START_HOUR)} and{" "}
          {formatHour(DAWN_END_HOUR)}. Dot = median first call; bar = middle 50% of days. Heard on at least 3 days.
        </p>
        <div className="flex items-center gap-3 mb-2 text-[10px] text-[color:var(--muted)]">
          <div className="w-44 shrink-0" />
          <div className="flex-1 flex justify-between">
            {dawnTickHours.map((h) => (
              <span key={h}>{formatHour(h)}</span>
            ))}
          </div>
          <div className="w-16 shrink-0" />
          <div className="w-10 shrink-0" />
        </div>
        <ul className="space-y-1">
          {dawn.map((d) => {
            const medianPct = ((d.median_sec - DAWN_START_HOUR * 3600) / dawnRangeSec) * 100;
            const p25Pct = ((d.p25_sec - DAWN_START_HOUR * 3600) / dawnRangeSec) * 100;
            const p75Pct = ((d.p75_sec - DAWN_START_HOUR * 3600) / dawnRangeSec) * 100;
            return (
              <li key={d.common_name} className="flex items-center gap-3 text-sm">
                <Link
                  href={`/species/${slugifySpecies(d.common_name)}`}
                  className="w-44 shrink-0 truncate hover:text-amber-400"
                  title={d.common_name}
                >
                  {d.common_name}
                </Link>
                <div className="flex-1 relative h-5 bg-white/[0.03] rounded">
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-2 bg-amber-500/30 rounded-full"
                    style={{
                      left: `${Math.max(0, Math.min(100, p25Pct))}%`,
                      width: `${Math.max(0, Math.min(100, p75Pct - p25Pct))}%`,
                    }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-amber-300/30"
                    style={{ left: `${Math.max(0, Math.min(100, medianPct))}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs text-[color:var(--muted)] tabular-nums">
                  {formatClock(d.median_sec)}
                </span>
                <span className="w-10 text-right text-[10px] text-[color:var(--muted)] tabular-nums">
                  {d.days_heard}d
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <WeatherActivity
        hours={weatherHours}
        lightOffsetSec={weatherAct?.lightOffsetSec ?? null}
        lightDays={weatherAct?.lightDays ?? 0}
      />


      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Hour × day-of-week heatmap</h2>
        <p className="text-xs text-[color:var(--muted)] mb-4">
          Brighter amber = more detections. Click a cell to see what was heard then.
        </p>
        <div className="grid gap-0.5 grid-cols-[2.5rem_repeat(24,minmax(0,1fr))]">
          <div />
          {HOURS.map((h) => (
            <div
              key={`hdr-${h}`}
              className="text-[9px] text-[color:var(--muted)] text-center h-4 leading-4"
            >
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
          {DOWS.map((d, dow) => (
            <div key={`row-${d}`} className="contents">
              <div className="text-[10px] text-[color:var(--muted)] pr-2 text-right self-center">
                {d}
              </div>
              {HOURS.map((h) => {
                const v = grid[dow][h];
                const op = v / maxCell;
                const isSelected = selected?.dow === dow && selected?.hour === h;
                return (
                  <Link
                    key={`${d}-${h}`}
                    href={cellHref(dow, h)}
                    scroll={false}
                    aria-label={`${DOWS_LONG[dow]} ${formatHour(h)} — ${formatNumber(v)} detections`}
                    className={`block aspect-square rounded relative group transition-shadow ${
                      isSelected ? "ring-2 ring-amber-300" : "hover:ring-1 hover:ring-amber-200/60"
                    }`}
                    style={{
                      backgroundColor: `rgba(251, 191, 36, ${0.05 + op * 0.95})`,
                    }}
                  >
                    <span className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] bg-black/90 border border-[color:var(--border)] rounded px-1.5 py-1 whitespace-nowrap z-10 pointer-events-none">
                      {d} {h}:00 — {formatNumber(v)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {selected && bucket && (
          <div id="bucket" className="mt-5 border-t border-[color:var(--border)] pt-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-base font-semibold">
                {DOWS_LONG[selected.dow]} · {formatHour(selected.hour)}
                <span className="ml-2 text-xs text-[color:var(--muted)] font-normal">
                  {formatNumber(bucket.species.reduce((s, r) => s + r.count, 0))} detections ·{" "}
                  {bucket.species.length} species
                </span>
              </h3>
              <Link href={clearHref} scroll={false} className="text-xs text-[color:var(--muted)] hover:text-white">
                Clear ✕
              </Link>
            </div>

            {bucket.species.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]">No detections in this bucket.</p>
            ) : (
              <>
                {bucket.cameras.length > 1 && (
                  <div className="flex flex-wrap gap-3 mb-3 text-xs">
                    {bucket.cameras.map((c) => (
                      <span key={c.camera}>
                        <span className={CAMERA_TEXT[c.camera] ?? ""}>{cameraLabel(c.camera)}</span>
                        <span className="text-[color:var(--muted)] ml-1 tabular-nums">{formatNumber(c.count)}</span>
                      </span>
                    ))}
                  </div>
                )}
                <ul className="divide-y divide-[color:var(--border)]">
                  {bucket.species.map((s) => (
                    <li key={s.common_name}>
                      <Link
                        href={`/species/${slugifySpecies(s.common_name)}`}
                        className="flex items-center gap-3 py-1.5 hover:bg-white/5 -mx-2 px-2 rounded transition-colors text-sm"
                      >
                        <span className="flex-1 font-medium truncate">{s.common_name}</span>
                        <span className="text-xs text-[color:var(--muted)] tabular-nums">
                          {Math.round(s.avg_confidence * 100)}%
                        </span>
                        <span className="text-xs text-[color:var(--muted)] tabular-nums w-24 text-right">
                          {formatRelative(s.last_heard)}
                        </span>
                        <span className="tabular-nums text-sm w-12 text-right">{formatNumber(s.count)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <RainCallers shifts={rainShifts} />
    </div>
  );
}

// Cold→warm color for the daily-high ribbon (input is °F).
function tempColor(f: number | null): string {
  if (f == null) return "rgba(255,255,255,0.04)";
  if (f < 40) return "#3b82f6"; // blue
  if (f < 48) return "#38bdf8"; // sky
  if (f < 56) return "#22d3ee"; // cyan
  if (f < 64) return "#34d399"; // green
  if (f < 72) return "#fbbf24"; // amber
  if (f < 80) return "#fb923c"; // orange
  return "#f87171"; // red
}

function Callout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">{label}</div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-[color:var(--muted)] mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}
