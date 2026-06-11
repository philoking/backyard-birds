import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  getOverviewStats,
  getTopSpecies,
  getRecentUnique,
  getDailyActivity,
  getFirstSightings,
  getCurrentWeather,
  slugifySpecies,
  type CurrentWeather,
} from "@/lib/queries";
import { getBirdInfoBatch } from "@/lib/birds";
import {
  cameraLabel, CAMERA_TEXT, formatDate, formatNumber, formatRelative, formatTime,
  formatTemp, formatWind, degToCompass, mbToInHg,
} from "@/lib/format";
import { resolveRange } from "@/lib/timeRange";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
};

export default async function Home({ searchParams }: Props) {
  const range = resolveRange(await searchParams);

  const [stats, topSpeciesAll, recentAll, daily, firsts, weather] = await Promise.all([
    getOverviewStats(range),
    getTopSpecies(range, 15),
    getRecentUnique(range, 15),
    getDailyActivity(range),
    getFirstSightings(6),
    getCurrentWeather(),
  ]);

  // Keep the two side-by-side lists the same length so the cards stay aligned.
  const sideLen = Math.min(topSpeciesAll.length, recentAll.length);
  const topSpecies = topSpeciesAll.slice(0, sideLen);
  const recent = recentAll.slice(0, sideLen);

  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  const [topInfos, recentInfos, firstInfos] = await Promise.all([
    getBirdInfoBatch(
      topSpecies.map((s) => ({ common_name: s.common_name, scientific_name: s.scientific_name })),
      8,
    ),
    getBirdInfoBatch(
      recent.map((r) => ({ common_name: r.common_name ?? "", scientific_name: r.scientific_name ?? null })),
      8,
    ),
    getBirdInfoBatch(
      firsts.map((f) => ({ common_name: f.common_name, scientific_name: f.scientific_name ?? null })),
      8,
    ),
  ]);

  const heroFirst = firsts[0];
  const heroInfo = firstInfos[0];
  const restFirsts = firsts.slice(1);
  const restInfos = firstInfos.slice(1);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label={`Detections (${range.label})`} value={formatNumber(stats.total)} />
        <StatCard label={`Species (${range.label})`} value={formatNumber(stats.species)} />
        <StatCard label="Today" value={formatNumber(stats.today)} sub={`${stats.today_species} species`} />
      </section>

      {weather && <WeatherStrip w={weather} />}

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Newest arrivals</h2>
          <span className="text-xs text-[color:var(--muted)]">Yard newcomers, most recent firsts</span>
        </div>

        {heroFirst && (
          <Link
            href={`/species/${slugifySpecies(heroFirst.common_name)}`}
            className="card overflow-hidden flex flex-col md:flex-row group hover:border-amber-500/50 transition-colors mb-3"
          >
            <div className="relative md:w-2/5 aspect-[16/10] md:aspect-auto md:min-h-[280px] bg-black/30 shrink-0">
              {heroInfo?.image ? (
                <Image
                  src={heroInfo.image}
                  alt={heroFirst.common_name}
                  fill
                  sizes="(max-width: 768px) 100vw, 40vw"
                  className="object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  priority
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-6xl opacity-30">🪶</div>
              )}
              <span className="absolute top-2 left-2 text-[10px] bg-amber-500/90 text-black font-semibold rounded px-2 py-0.5 uppercase tracking-wide">
                Newest
              </span>
            </div>
            <div className="p-5 md:p-6 flex flex-col gap-2 min-w-0">
              <div>
                <div className="text-2xl font-semibold group-hover:text-amber-400 transition-colors">
                  {heroFirst.common_name}
                </div>
                {heroFirst.scientific_name && (
                  <div className="italic text-sm text-[color:var(--muted)]">{heroFirst.scientific_name}</div>
                )}
                {heroInfo?.category && (
                  <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30">
                    {heroInfo.category}
                  </span>
                )}
              </div>
              <div className="text-xs text-[color:var(--muted)]">
                First heard <span className="text-white">{formatDate(heroFirst.first_seen)}</span>
                <span className="mx-1.5">·</span>
                <span className={CAMERA_TEXT[heroFirst.camera] ?? ""}>{cameraLabel(heroFirst.camera)}</span>
                <span className="mx-1.5">·</span>
                <span>{formatRelative(heroFirst.first_seen)}</span>
              </div>
              {heroInfo?.summary && (
                <p className="text-sm text-[color:var(--foreground)]/85 leading-relaxed line-clamp-4 mt-1">
                  {heroInfo.summary}
                </p>
              )}
            </div>
          </Link>
        )}

        {restFirsts.length > 0 && (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {restFirsts.map((f, i) => {
              const info = restInfos[i];
              return (
                <li key={f.common_name}>
                  <Link
                    href={`/species/${slugifySpecies(f.common_name)}`}
                    className="card overflow-hidden group hover:border-amber-500/50 transition-colors block h-full"
                  >
                    <div className="relative aspect-square bg-black/30">
                      {info?.thumbnail ? (
                        <Image
                          src={info.thumbnail}
                          alt={f.common_name}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-4xl opacity-30">🪶</div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="font-medium text-sm truncate group-hover:text-amber-400 transition-colors">
                        {f.common_name}
                      </div>
                      <div className="text-[11px] text-[color:var(--muted)] truncate">
                        {formatDate(f.first_seen)} ·{" "}
                        <span className={CAMERA_TEXT[f.camera] ?? ""}>{cameraLabel(f.camera)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent</h2>
            <Link href="/live" className="text-xs text-amber-400 hover:underline">Live →</Link>
          </div>
          <p className="text-xs text-[color:var(--muted)] mb-3">
            Distinct species in {range.label.toLowerCase()}, most recent first.
          </p>
          {recent.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">No detections in this range.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {recent.map((d, i) => {
                const thumb = recentInfos[i]?.thumbnail ?? null;
                const name = d.common_name ?? "Unknown";
                return (
                  <li key={d.id}>
                    <Link
                      href={`/species/${slugifySpecies(name)}`}
                      className="flex items-center gap-3 py-2 hover:bg-white/5 -mx-2 px-2 rounded transition-colors"
                    >
                      <Thumb src={thumb} alt={name} size={36} />
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{name}</span>
                        {d.recent_count > 1 && (
                          <span className="ml-2 text-xs text-[color:var(--muted)] tabular-nums">
                            ×{formatNumber(d.recent_count)}
                          </span>
                        )}
                        <div className="text-xs text-[color:var(--muted)] truncate">
                          <span className={CAMERA_TEXT[d.camera] ?? ""}>{cameraLabel(d.camera)}</span>
                          <span className="mx-1.5">·</span>
                          <span>{formatTime(d.ts)}</span>
                          <span className="mx-1.5">·</span>
                          <span>{Math.round(d.confidence * 100)}%</span>
                        </div>
                      </span>
                      <span className="text-[10px] text-[color:var(--muted)] tabular-nums shrink-0">
                        {formatRelative(d.ts)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Most heard</h2>
            <Link href="/species" className="text-xs text-amber-400 hover:underline">All species →</Link>
          </div>
          <ul className="divide-y divide-[color:var(--border)]">
            {topSpecies.map((s, i) => {
              const thumb = topInfos[i]?.thumbnail ?? null;
              return (
                <li key={s.common_name}>
                  <Link
                    href={`/species/${slugifySpecies(s.common_name)}`}
                    className="flex items-center gap-3 py-2 hover:bg-white/5 -mx-2 px-2 rounded transition-colors"
                  >
                    <span className="text-[color:var(--muted)] tabular-nums w-6 text-right text-xs">{i + 1}</span>
                    <Thumb src={thumb} alt={s.common_name} size={36} />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{s.common_name}</span>
                      {s.scientific_name && (
                        <span className="ml-2 text-xs text-[color:var(--muted)] italic">{s.scientific_name}</span>
                      )}
                    </span>
                    <span className="tabular-nums text-sm text-[color:var(--muted)]">{formatNumber(s.detections)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-semibold">{range.label}</h2>
          <span className="text-xs text-[color:var(--muted)]">detections / day</span>
        </div>
        {daily.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">No detections in this range.</p>
        ) : (
          <>
            <div className="flex items-end gap-1 h-32">
              {daily.map((d) => {
                const h = Math.max(2, Math.round((d.count / maxDaily) * 100));
                return (
                  <div
                    key={d.day}
                    className="flex-1 bg-amber-500/70 hover:bg-amber-400 rounded-sm relative group transition-colors"
                    style={{ height: `${h}%` }}
                  >
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-9 left-1/2 -translate-x-1/2 text-[10px] bg-black/90 border border-[color:var(--border)] rounded px-2 py-1 whitespace-nowrap z-10">
                      <div className="font-semibold">{d.day}</div>
                      <div>{formatNumber(d.count)} · {d.species} sp.</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-[color:var(--muted)]">
              <span>{daily[0]?.day ?? ""}</span>
              <span>{daily[daily.length - 1]?.day ?? ""}</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function WeatherStrip({ w }: { w: CurrentWeather }) {
  const stale = Date.now() - new Date(w.ts).getTime() > 15 * 60 * 1000;
  const raining = (w.rain_min ?? 0) > 0 || (w.precip_type ?? 0) > 0;
  const tendency =
    w.dp3h == null ? null : w.dp3h > 0.5 ? "rising" : w.dp3h < -0.5 ? "falling" : "steady";
  const arrow = tendency === "rising" ? "↑" : tendency === "falling" ? "↓" : "→";
  const inHg = mbToInHg(w.pressure);

  return (
    <section className={`card p-4 ${stale ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-5 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{formatTemp(w.air_temp)}</span>
          {raining && <span className="text-sky-300 text-sm">🌧 rain</span>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Metric label="Wind">
            {formatWind(w.wind_avg)}
            {w.wind_avg != null && w.wind_avg >= 0.5 && (
              <span className="text-[color:var(--muted)]"> {degToCompass(w.wind_dir)} · gust {formatWind(w.wind_gust)}</span>
            )}
          </Metric>
          <Metric label="Humidity">{w.rh == null ? "—" : `${Math.round(w.rh)}%`}</Metric>
          <Metric label="Pressure">
            {inHg == null ? "—" : `${inHg.toFixed(2)} in`}
            {tendency && <span className="text-[color:var(--muted)]"> {arrow} {tendency}</span>}
          </Metric>
          {w.uv != null && w.uv >= 1 && <Metric label="UV">{Math.round(w.uv)}</Metric>}
        </div>
        <span className="text-[10px] text-[color:var(--muted)] ml-auto">
          {stale ? "stale · " : ""}as of {formatRelative(w.ts)}
        </span>
      </div>
    </section>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span>
      <span className="text-[10px] uppercase tracking-wide text-[color:var(--muted)] mr-1.5">{label}</span>
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[color:var(--muted)]">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[color:var(--muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

function Thumb({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  return (
    <div
      className="relative shrink-0 rounded overflow-hidden bg-black/30 border border-[color:var(--border)]"
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-base opacity-30">🪶</div>
      )}
    </div>
  );
}
