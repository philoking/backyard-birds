import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSpecies, getSpeciesWeather, getSpeciesFlagState, SUPPRESS_THRESHOLD, unslugifySpecies, type SpeciesWeather } from "@/lib/queries";
import { getSpeciesEbird, type EbirdNearby } from "@/lib/ebird";
import { getReferenceRecording } from "@/lib/xenocanto";
import FalsePositiveButton from "./FalsePositiveButton";
import { getBirdInfo } from "@/lib/birds";
import { resolveRange } from "@/lib/timeRange";
import { cameraLabel, CAMERA_COLOR, CAMERA_TEXT, formatDate, formatHour, formatNumber, formatRelative, formatTime, formatTemp, formatWind, formatMiles, cToF } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOWS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
};

export default async function SpeciesDetail({ params, searchParams }: Props) {
  const { slug } = await params;
  const range = resolveRange(await searchParams);
  const guess = unslugifySpecies(slug);
  const data = await getSpecies(guess, range);
  if (!data) return notFound();

  const { meta, inRangeCount, byDay, byCamera, heatmap, recent, clips } = data;
  const [info, weather, ebird, flagState, reference] = await Promise.all([
    getBirdInfo(meta.common_name, meta.scientific_name, { includeSummary: true }),
    getSpeciesWeather(meta.common_name),
    getSpeciesEbird(meta.scientific_name, meta.common_name),
    getSpeciesFlagState(meta.common_name),
    getReferenceRecording(meta.scientific_name),
  ]);
  const maxDay = Math.max(1, ...byDay.map((d) => d.count));
  const maxCam = Math.max(1, ...byCamera.map((c) => c.count));

  // Build 7×24 heatmap grid
  const heatGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of heatmap) heatGrid[row.day_of_week][row.hour] = row.count;
  const maxHeat = Math.max(1, ...heatmap.map((r) => r.count));

  // Where & when to find it: derive from byCamera + heatmap.
  const hourTotals = Array<number>(24).fill(0);
  const dowTotals = Array<number>(7).fill(0);
  for (const r of heatmap) {
    hourTotals[r.hour] += r.count;
    dowTotals[r.day_of_week] += r.count;
  }
  const totalCount = hourTotals.reduce((s, v) => s + v, 0);
  const bestCamera = byCamera[0] ?? null;
  let bestDow = -1;
  let bestDowCount = 0;
  for (let i = 0; i < 7; i++) {
    if (dowTotals[i] > bestDowCount) {
      bestDowCount = dowTotals[i];
      bestDow = i;
    }
  }
  // Best contiguous 3-hour window. Wraps midnight.
  let bestWindowStart = -1;
  let bestWindowSum = -1;
  if (totalCount > 0) {
    for (let h = 0; h < 24; h++) {
      const sum = hourTotals[h] + hourTotals[(h + 1) % 24] + hourTotals[(h + 2) % 24];
      if (sum > bestWindowSum) {
        bestWindowSum = sum;
        bestWindowStart = h;
      }
    }
  }
  const haveSuggestion = totalCount > 0 && bestCamera && bestDow >= 0 && bestWindowStart >= 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/species" className="text-xs text-[color:var(--muted)] hover:text-white">
          ← All species
        </Link>
      </div>

      <header className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card overflow-hidden md:col-span-1">
          <div className="relative aspect-square bg-black/30">
            {info?.image ? (
              <Image
                src={info.image}
                alt={meta.common_name}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover"
                priority
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-6xl opacity-30">🪶</div>
            )}
          </div>
          {info?.attribution && (
            <div className="px-3 py-1.5 text-[10px] text-[color:var(--muted)] truncate" title={info.attribution}>
              {info.attribution}
            </div>
          )}
        </div>
        <div className="md:col-span-2 space-y-3">
          <div>
            <h1 className="text-3xl font-semibold">{meta.common_name}</h1>
            {meta.scientific_name && (
              <p className="italic text-[color:var(--muted)]">{meta.scientific_name}</p>
            )}
            {(info?.category || info?.family || info?.order) && (
              <p className="text-xs text-[color:var(--muted)] mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {info.category && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30">
                    {info.category}
                  </span>
                )}
                {info.order && (
                  <span>
                    Order <span className="text-white italic">{info.order}</span>
                  </span>
                )}
                {info.family && (
                  <span>
                    Family <span className="text-white italic">{info.family}</span>
                  </span>
                )}
              </p>
            )}
            {(info?.conservationStatus || info?.establishmentMeans) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {info.conservationStatus && conservationLabel(info.conservationStatus) && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${conservationStyle(info.conservationStatus)}`}
                    title={`IUCN: ${conservationLabel(info.conservationStatus)}`}
                  >
                    {conservationLabel(info.conservationStatus)}
                  </span>
                )}
                {info.establishmentMeans && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${establishmentStyle(info.establishmentMeans)} capitalize`}
                    title="Local establishment status"
                  >
                    {info.establishmentMeans}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Detections"
              value={formatNumber(meta.detections)}
              sub={`${formatNumber(inRangeCount)} in ${range.label.toLowerCase()}`}
            />
            <Stat label="Avg confidence" value={`${Math.round(meta.avg_confidence * 100)}%`} />
            <Stat label="First seen" value={formatDate(meta.first_seen)} />
            <Stat label="Last heard" value={formatRelative(meta.last_seen)} />
          </div>
          {info?.summary && (
            <p className="text-sm text-[color:var(--foreground)]/90 leading-relaxed">{info.summary}</p>
          )}
          {info?.wikiUrl && (
            <a
              href={info.wikiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-amber-400 hover:underline"
            >
              Read more on Wikipedia →
            </a>
          )}
        </div>
      </header>

      {ebird && <EbirdPanel ebird={ebird} ourDetections={meta.detections} />}

      <section className="card p-5">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-lg font-semibold">Recent calls</h2>
          <span className="text-xs text-[color:var(--muted)]">
            last {clips.length === 1 ? "clip" : `${clips.length} clips`} the listener captured
          </span>
        </div>
        <p className="text-xs text-[color:var(--muted)] mb-3">
          Hear something that isn&apos;t this bird? Flag the clip.
          {flagState.flag_count > 0 && (
            <span className="text-amber-300">
              {" "}Flagged {flagState.flag_count}/{SUPPRESS_THRESHOLD} — at {SUPPRESS_THRESHOLD} this
              species is hidden from all stats.
            </span>
          )}
        </p>
        {reference && (
          <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-emerald-300">
                ★ Reference — what it should sound like
              </span>
              {reference.pageUrl && (
                <a
                  href={reference.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-emerald-400 hover:underline whitespace-nowrap"
                >
                  xeno-canto →
                </a>
              )}
            </div>
            <audio controls preload="none" className="w-full h-9" src={reference.audioUrl} />
            <div className="text-[10px] text-[color:var(--muted)] mt-1">
              {[reference.type, reference.recordist && `rec. ${reference.recordist}`, reference.country,
                reference.quality && `grade ${reference.quality}`]
                .filter(Boolean)
                .join(" · ")}
              {reference.license && (
                <>
                  {" · "}
                  <a href={reference.license} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    license
                  </a>
                </>
              )}
            </div>
          </div>
        )}
        {clips.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">
            No audio clips captured yet. New detections will appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {clips.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center gap-3 text-sm sm:w-56 sm:shrink-0">
                  <span className="tabular-nums">{formatTime(c.ts)}</span>
                  <span className="text-xs text-[color:var(--muted)]">{formatDate(c.ts)}</span>
                  <span className={`text-xs ${CAMERA_TEXT[c.camera] ?? ""}`}>
                    {cameraLabel(c.camera)}
                  </span>
                  <span className="text-xs tabular-nums text-[color:var(--muted)]">
                    {Math.round(c.confidence * 100)}%
                  </span>
                </div>
                <audio controls preload="none" className="w-full sm:flex-1 h-9">
                  <source src={`/api/clips/${c.id}`} type={c.mime} />
                </audio>
                <FalsePositiveButton clipId={c.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {(haveSuggestion || weather) && (
        <section className="card p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-lg font-semibold">Best chance to spot it</h2>
            {haveSuggestion ? (
              <span className="text-xs text-[color:var(--muted)]">
                from {formatNumber(totalCount)} detections · {range.label.toLowerCase()}
              </span>
            ) : weather ? (
              <span className="text-xs text-[color:var(--muted)]">
                from {formatNumber(weather.n)} weather-matched detections
              </span>
            ) : null}
          </div>

          {haveSuggestion && bestCamera && (
            <>
              <p className="text-sm text-[color:var(--foreground)]/90 leading-relaxed mb-4">
                Most often heard at{" "}
                <span className={`font-semibold ${CAMERA_TEXT[bestCamera.camera] ?? ""}`}>
                  {cameraLabel(bestCamera.camera)}
                </span>{" "}
                on <span className="font-semibold text-white">{DOWS_LONG[bestDow]}s</span> between{" "}
                <span className="font-semibold text-white">{formatHour(bestWindowStart)}</span> and{" "}
                <span className="font-semibold text-white">{formatHour((bestWindowStart + 3) % 24)}</span>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SuggestionTile
                  label="Where"
                  value={cameraLabel(bestCamera.camera)}
                  valueClass={CAMERA_TEXT[bestCamera.camera] ?? ""}
                  sub={`${formatNumber(bestCamera.count)} (${Math.round((bestCamera.count / totalCount) * 100)}%)`}
                />
                <SuggestionTile
                  label="What day"
                  value={DOWS_LONG[bestDow]}
                  sub={`${formatNumber(bestDowCount)} (${Math.round((bestDowCount / totalCount) * 100)}%)`}
                />
                <SuggestionTile
                  label="What time"
                  value={`${formatHour(bestWindowStart)} – ${formatHour((bestWindowStart + 3) % 24)}`}
                  sub={`${formatNumber(bestWindowSum)} (${Math.round((bestWindowSum / totalCount) * 100)}%) in the 3-hour window`}
                />
              </div>
            </>
          )}

          {weather && (
            <div className={haveSuggestion ? "mt-4 pt-4 border-t border-[color:var(--border)]" : ""}>
              <p className="text-sm text-[color:var(--foreground)]/90 leading-relaxed mb-4">
                Typically heard around{" "}
                <span className="font-semibold text-white">{formatTemp(weather.avg_temp)}</span> in{" "}
                <span className="font-semibold text-white">{formatWind(weather.avg_wind)}</span> wind,{" "}
                <span className="font-semibold text-white">{Math.round(weather.dry_pct ?? 0)}%</span> of the
                time in dry conditions.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SuggestionTile label="Temperature" value={formatTemp(weather.avg_temp)} sub={tempDeltaLabel(weather)} />
                <SuggestionTile
                  label="Wind"
                  value={formatWind(weather.avg_wind)}
                  sub={`calm ${Math.round(weather.calm_pct ?? 0)}% · max gust ${formatWind(weather.max_gust)}`}
                />
                <SuggestionTile label="Dry vs wet" value={`${Math.round(weather.dry_pct ?? 0)}% dry`} />
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Where it's heard</h2>
        <ul className="space-y-3">
          {byCamera.map((c) => (
            <li key={c.camera}>
              <div className="flex items-baseline justify-between text-sm mb-1">
                <span className={`font-medium ${CAMERA_TEXT[c.camera] ?? ""}`}>{cameraLabel(c.camera)}</span>
                <span className="text-xs tabular-nums text-[color:var(--muted)]">
                  {formatNumber(c.count)} ({Math.round((c.count / meta.detections) * 100)}%)
                </span>
              </div>
              <div className="h-2 bg-white/5 rounded overflow-hidden">
                <div
                  className={`h-full ${CAMERA_COLOR[c.camera] ?? "bg-amber-500"}`}
                  style={{ width: `${(c.count / maxCam) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Hour × day-of-week heatmap</h2>
        <p className="text-xs text-[color:var(--muted)] mb-4">
          Brighter amber = more detections of this species at that hour/day.
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
                const v = heatGrid[dow][h];
                const op = v / maxHeat;
                return (
                  <div
                    key={`${d}-${h}`}
                    className="block aspect-square rounded relative group"
                    style={{
                      backgroundColor: `rgba(251, 191, 36, ${0.05 + op * 0.95})`,
                    }}
                  >
                    <span className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] bg-black/90 border border-[color:var(--border)] rounded px-1.5 py-1 whitespace-nowrap z-10 pointer-events-none">
                      {d} {h}:00 — {formatNumber(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Daily activity</h2>
        <div className="flex items-end gap-1 h-24">
          {byDay.map((d) => (
            <div
              key={d.day}
              className="flex-1 bg-emerald-500/60 hover:bg-emerald-400 rounded-sm relative group"
              style={{ height: `${Math.max(2, (d.count / maxDay) * 100)}%` }}
            >
              <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] bg-black/90 border border-[color:var(--border)] rounded px-1.5 py-1 whitespace-nowrap z-10">
                {d.day} — {d.count}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Recent detections</h2>
        <ul className="divide-y divide-[color:var(--border)]">
          {recent.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between text-sm">
              <span className="text-[color:var(--muted)] tabular-nums">{formatTime(r.ts)}</span>
              <span className="text-xs text-[color:var(--muted)]">{formatDate(r.ts)}</span>
              <span className={`text-xs ${CAMERA_TEXT[r.camera] ?? ""}`}>{cameraLabel(r.camera)}</span>
              <span className="tabular-nums text-xs">{Math.round(r.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--muted)] tabular-nums">{sub}</div>}
    </div>
  );
}

const IUCN_LABEL: Record<string, string> = {
  NT: "Near Threatened",
  VU: "Vulnerable",
  EN: "Endangered",
  CR: "Critically Endangered",
  EW: "Extinct in Wild",
  EX: "Extinct",
  DD: "Data Deficient",
};

// iNat returns either the IUCN code ("VU") or the spelled-out name ("Vulnerable"),
// depending on the source. Collapse both to the canonical short code so styling
// and labeling are consistent. Also filters out non-IUCN authority codes
// (NatureServe S3B etc.) which we don't want to render.
function normalizeIucn(status: string): string | null {
  const s = status.trim();
  if (IUCN_LABEL[s]) return s;
  const fromName = Object.entries(IUCN_LABEL).find(([, label]) => label.toLowerCase() === s.toLowerCase());
  return fromName ? fromName[0] : null;
}

// LC is intentionally absent: showing "Least Concern" on every common backyard
// bird is just noise. We only surface badges for non-default conservation states.
function conservationLabel(status: string): string | null {
  const code = normalizeIucn(status);
  return code ? IUCN_LABEL[code] : null;
}

function conservationStyle(status: string): string {
  switch (normalizeIucn(status)) {
    case "CR":
    case "EW":
    case "EX":
      return "bg-red-500/20 text-red-200 border-red-500/40";
    case "EN":
      return "bg-orange-500/20 text-orange-200 border-orange-500/40";
    case "VU":
      return "bg-amber-500/20 text-amber-200 border-amber-500/40";
    case "NT":
      return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
    default:
      return "bg-white/5 text-[color:var(--muted)] border-[color:var(--border)]";
  }
}

function establishmentStyle(means: string): string {
  switch (means.toLowerCase()) {
    case "introduced":
    case "naturalised":
    case "naturalized":
      return "bg-rose-500/15 text-rose-200 border-rose-500/30";
    case "endemic":
      return "bg-violet-500/15 text-violet-200 border-violet-500/30";
    case "native":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
    default:
      return "bg-white/5 text-[color:var(--muted)] border-[color:var(--border)]";
  }
}

function ebirdTier(locations: number, capped: boolean) {
  if (locations === 0)
    return { bars: 0, label: "Not reported nearby", color: "#f87171", text: "text-red-300", ring: "border-red-500/40 bg-red-500/10" };
  if (locations <= 2)
    return { bars: 1, label: "Rarely reported nearby", color: "#fbbf24", text: "text-amber-300", ring: "border-amber-500/40 bg-amber-500/[0.08]" };
  if (locations <= 10)
    return { bars: 2, label: "Occasionally reported", color: "#fcd34d", text: "text-amber-200", ring: "border-amber-500/30 bg-amber-500/[0.05]" };
  if (locations <= 50)
    return { bars: 3, label: "Commonly reported nearby", color: "#34d399", text: "text-emerald-300", ring: "border-emerald-500/30 bg-emerald-500/[0.06]" };
  if (locations <= 200 && !capped)
    return { bars: 4, label: "Very common nearby", color: "#34d399", text: "text-emerald-300", ring: "border-emerald-500/30 bg-emerald-500/[0.06]" };
  return { bars: 5, label: "Ubiquitous nearby", color: "#34d399", text: "text-emerald-300", ring: "border-emerald-500/30 bg-emerald-500/[0.06]" };
}

function EbirdPanel({ ebird, ourDetections }: { ebird: EbirdNearby; ourDetections: number }) {
  const tier = ebirdTier(ebird.locations, ebird.capped);
  const locLabel = `${formatNumber(ebird.locations)}${ebird.capped ? "+" : ""}`;
  return (
    <section className={`card p-4 border ${tier.ring}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 sm:w-60 sm:shrink-0">
          <div className="flex items-end gap-0.5 h-7" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-1.5 rounded-sm"
                style={{
                  height: `${30 + i * 17.5}%`,
                  backgroundColor: i < tier.bars ? tier.color : "rgba(255,255,255,0.12)",
                }}
              />
            ))}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">eBird nearby</div>
            <div className={`font-semibold leading-tight ${tier.text}`}>{tier.label}</div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-3">
          <IconStat icon="📍" value={locLabel} label={`locations · ${ebird.backDays}d · ${formatMiles(ebird.distKm)}`} />
          <IconStat icon="📏" value={formatMiles(ebird.nearestKm)} label="nearest report" />
          <IconStat
            icon="🕑"
            value={ebird.mostRecent ? formatRelative(ebird.mostRecent) : "—"}
            label="most recent"
          />
        </div>

        <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center sm:w-28 sm:shrink-0 border-t sm:border-t-0 sm:border-l border-[color:var(--border)] pt-3 sm:pt-0 sm:pl-4">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">our yard</div>
            <div className="font-semibold tabular-nums">{formatNumber(ourDetections)}</div>
            <div className="text-[10px] text-[color:var(--muted)]">all-time</div>
          </div>
          <a
            href={ebird.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-400 hover:underline whitespace-nowrap"
          >
            eBird map →
          </a>
        </div>
      </div>
      {ebird.locations === 0 && (
        <p className="text-xs text-red-200/90 mt-3 pt-3 border-t border-red-500/20">
          Nobody nearby has reported this in {ebird.backDays} days — worth a listen on the clips below to
          confirm the ID.
        </p>
      )}
    </section>
  );
}

function IconStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-base leading-none mt-0.5" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-semibold tabular-nums truncate">{value}</div>
        <div className="text-[10px] text-[color:var(--muted)] truncate">{label}</div>
      </div>
    </div>
  );
}

function tempDeltaLabel(w: SpeciesWeather): string | undefined {
  const a = cToF(w.avg_temp);
  const b = cToF(w.ambient_temp);
  if (a == null || b == null) return undefined;
  const d = Math.round(a - b);
  if (Math.abs(d) < 1) return "about the yard average";
  return `${Math.abs(d)}° ${d > 0 ? "warmer" : "cooler"} than yard avg`;
}

function SuggestionTile({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded border border-[color:var(--border)] p-3 bg-black/20">
      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${valueClass ?? ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--muted)] tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}
