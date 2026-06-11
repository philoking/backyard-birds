import Link from "next/link";
import { slugifySpecies, type WeatherHour, type RainShift } from "@/lib/queries";
import { cToF, msToMph } from "@/lib/format";

// Weather-vs-activity visuals on the Patterns page: best/worst-conditions
// callouts and response curves (detections/daytime-hour vs each condition).
// `RainCallers` is exported separately so the page can place it after the
// hour × day-of-week heatmap.

type Bin = { label: string; avg: number; hours: number };

function bucketize(
  rows: WeatherHour[],
  val: (r: WeatherHour) => number | null,
  edges: number[],
  fmt: (n: number) => string = (n) => `${Math.round(n)}`,
): Bin[] {
  const n = edges.length;
  const acc = Array.from({ length: n + 1 }, () => ({ sum: 0, count: 0 }));
  for (const r of rows) {
    const v = val(r);
    if (v == null || Number.isNaN(v)) continue;
    let idx = edges.findIndex((e) => v < e);
    if (idx < 0) idx = n;
    acc[idx].sum += r.dets;
    acc[idx].count++;
  }
  return acc.map((b, i) => ({
    label:
      i === 0 ? `<${fmt(edges[0])}` : i === n ? `${fmt(edges[n - 1])}+` : `${fmt(edges[i - 1])}–${fmt(edges[i])}`,
    avg: b.count ? b.sum / b.count : 0,
    hours: b.count,
  }));
}

function pressureEdges(rows: WeatherHour[]): number[] {
  const ps = rows.map((r) => r.pressure).filter((x): x is number => x != null);
  if (ps.length === 0) return [1000];
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  if (hi - lo < 1) return [Math.round(lo)];
  return [1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 5);
}

function pctDrop(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.round((1 - to / from) * 100);
}

export default function WeatherActivity({
  hours,
  lightOffsetSec,
  lightDays,
}: {
  hours: WeatherHour[];
  lightOffsetSec: number | null;
  lightDays: number;
}) {
  if (hours.length === 0) return null;

  const tempBins = bucketize(hours, (r) => cToF(r.temp), [45, 52, 58, 64, 70]);
  const windBins = bucketize(hours, (r) => msToMph(r.wind), [1, 3, 6, 10]);
  windBins[0].label = "calm";
  const humBins = bucketize(hours, (r) => r.rh, [55, 65, 75, 85]);
  const presBins = bucketize(hours, (r) => r.pressure, pressureEdges(hours), (n) => n.toFixed(0));

  const bestTemp = [...tempBins].filter((b) => b.hours >= 5).sort((a, b) => b.avg - a.avg)[0] ?? null;
  const calm = windBins[0];
  const windiest = [...windBins].reverse().find((b) => b.hours >= 3) ?? null;
  const windDrop = calm && windiest ? pctDrop(calm.avg, windiest.avg) : null;
  const wet = hours.filter((r) => (r.rain ?? 0) > 0);
  const dry = hours.filter((r) => (r.rain ?? 0) === 0);
  const wetRate = wet.length ? wet.reduce((s, r) => s + r.dets, 0) / wet.length : 0;
  const dryRate = dry.length ? dry.reduce((s, r) => s + r.dets, 0) / dry.length : 0;
  const rainDrop = pctDrop(dryRate, wetRate);
  const offMin = lightOffsetSec == null ? null : Math.round(lightOffsetSec / 60);

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-semibold">Weather &amp; activity</h2>
        <span className="text-xs text-[color:var(--muted)]">avg detections / daytime hour</span>
      </div>
      <p className="text-xs text-[color:var(--muted)] mb-4">
        How the volume of calls responds to conditions, over daytime hours (5am–9pm).
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Callout label="Loudest temp" value={bestTemp ? `${bestTemp.label}°F` : "—"} sub={bestTemp ? `${bestTemp.avg.toFixed(0)}/hr` : ""} />
        <Callout label="Wind" value={windDrop != null ? `${windDrop}% quieter` : "—"} sub={windiest ? `calm → ${windiest.label} mph` : ""} />
        <Callout label="Rain" value={rainDrop != null ? `${rainDrop}% quieter` : "—"} sub={`${wet.length}h wet · ${dry.length}h dry`} />
        <Callout
          label="Dawn vs light"
          value={offMin == null ? "—" : `${Math.abs(offMin)} min ${offMin <= 0 ? "before" : "after"}`}
          sub={offMin == null ? "" : `first light · ${lightDays}d`}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <ResponseChart title="Temperature" unit="°F" bins={tempBins} color="#f59e0b" />
        <ResponseChart title="Wind" unit="mph" bins={windBins} color="#38bdf8" />
        <ResponseChart title="Humidity" unit="%" bins={humBins} color="#34d399" />
        <ResponseChart title="Pressure" unit="mb" bins={presBins} color="#a78bfa" />
      </div>
    </section>
  );
}

export function RainCallers({ shifts }: { shifts: RainShift[] }) {
  const calc = shifts.map((s) => ({
    ...s,
    affinity: s.dry_rate > 0 ? s.wet_rate / s.dry_rate : s.wet_rate > 0 ? 99 : 1,
  }));
  const rainCallers = calc.filter((s) => s.wet_dets >= 8 && s.affinity > 1.15).sort((a, b) => b.affinity - a.affinity).slice(0, 6);
  const fairWeather = calc.filter((s) => s.dry_dets >= 20 && s.affinity < 0.85).sort((a, b) => a.affinity - b.affinity).slice(0, 6);
  if (rainCallers.length === 0 && fairWeather.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold mb-1">Who calls in the rain</h2>
      <p className="text-xs text-[color:var(--muted)] mb-4">Species ranked by how their call rate shifts in wet vs dry daytime hours.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
        <ShiftList title="More vocal in rain" accent="text-sky-300" items={rainCallers} mode="rain" />
        <ShiftList title="Fair-weather callers" accent="text-amber-300" items={fairWeather} mode="dry" />
      </div>
    </section>
  );
}

function Callout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[color:var(--border)] p-3 bg-black/20">
      <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">{label}</div>
      <div className="text-base font-semibold mt-1">{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--muted)] mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

function ResponseChart({ title, unit, bins, color }: { title: string; unit: string; bins: Bin[]; color: string }) {
  const max = Math.max(1, ...bins.map((b) => b.avg));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[10px] text-[color:var(--muted)]">{unit}</span>
      </div>
      <div className="flex items-end gap-1 h-28">
        {bins.map((b, i) => (
          <div key={i} className="flex-1 h-full flex items-end relative group">
            <div className="w-full rounded-t" style={{ height: `${Math.max(2, (b.avg / max) * 100)}%`, backgroundColor: color }} />
            <div className="opacity-0 group-hover:opacity-100 absolute -top-9 left-1/2 -translate-x-1/2 text-[10px] bg-black/90 border border-[color:var(--border)] rounded px-1.5 py-1 whitespace-nowrap z-10 pointer-events-none">
              {b.label} {unit} — {b.avg.toFixed(1)}/hr · {b.hours}h
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {bins.map((b, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-[color:var(--muted)] leading-tight">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftList({
  title,
  accent,
  items,
  mode,
}: {
  title: string;
  accent: string;
  items: (RainShift & { affinity: number })[];
  mode: "rain" | "dry";
}) {
  if (items.length === 0) {
    return (
      <div>
        <h3 className={`text-sm font-semibold mb-2 ${accent}`}>{title}</h3>
        <p className="text-xs text-[color:var(--muted)]">Not enough data yet.</p>
      </div>
    );
  }
  const maxMag = Math.max(...items.map((s) => (mode === "rain" ? s.affinity : 1 / s.affinity)));
  return (
    <div>
      <h3 className={`text-sm font-semibold mb-2 ${accent}`}>{title}</h3>
      <ul className="space-y-1.5">
        {items.map((s) => {
          const mag = mode === "rain" ? s.affinity : 1 / s.affinity;
          return (
            <li key={s.common_name} className="flex items-center gap-2 text-sm">
              <Link href={`/species/${slugifySpecies(s.common_name)}`} className="w-40 shrink-0 truncate hover:text-amber-400" title={s.common_name}>
                {s.common_name}
              </Link>
              <div className="flex-1 h-2.5 bg-white/[0.04] rounded overflow-hidden">
                <div className={mode === "rain" ? "h-full bg-sky-400/70" : "h-full bg-amber-400/70"} style={{ width: `${Math.min(100, (mag / maxMag) * 100)}%` }} />
              </div>
              <span className="w-12 text-right text-xs tabular-nums text-[color:var(--muted)]">{mag.toFixed(1)}×</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
