import Link from "next/link";
import {
  getCameraStats,
  getSpeciesByCamera,
  getHourlyByCamera,
  slugifySpecies,
} from "@/lib/queries";
import { cameraLabel, CAMERA_COLOR, CAMERA_TEXT, formatNumber } from "@/lib/format";
import { resolveRange } from "@/lib/timeRange";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
};

export default async function CamerasPage({ searchParams }: Props) {
  const range = resolveRange(await searchParams);
  const [stats, spByCam, hourlyByCam] = await Promise.all([
    getCameraStats(range),
    getSpeciesByCamera(range),
    getHourlyByCamera(range),
  ]);
  const total = stats.reduce((acc, s) => acc + s.detections, 0);

  // Camera column order: by detections (matches the stats order).
  const cams = stats.map((s) => s.camera);

  // Per-camera hourly arrays + per-hour totals for the combined rhythm chart.
  const camHours: Record<string, number[]> = {};
  for (const c of cams) camHours[c] = Array(24).fill(0);
  for (const r of hourlyByCam) (camHours[r.camera] ??= Array(24).fill(0))[r.hour] = r.count;
  const hourTotals = Array.from({ length: 24 }, (_, h) => cams.reduce((s, c) => s + (camHours[c]?.[h] ?? 0), 0));
  const maxHourTotal = Math.max(1, ...hourTotals);

  // Species × camera matrix for the top species, + uniques (one-camera species).
  const spTotals = new Map<string, number>();
  const spMatrix = new Map<string, Map<string, number>>();
  const speciesCamCount: Record<string, number> = {};
  for (const r of spByCam) {
    spTotals.set(r.common_name, (spTotals.get(r.common_name) ?? 0) + r.count);
    let m = spMatrix.get(r.common_name);
    if (!m) {
      m = new Map();
      spMatrix.set(r.common_name, m);
    }
    m.set(r.camera, r.count);
    speciesCamCount[r.common_name] = (speciesCamCount[r.common_name] ?? 0) + 1;
  }
  const topSpecies = [...spTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, t]) => ({ name, total: t }));
  const uniqueBy: Record<string, string[]> = {};
  for (const r of spByCam) {
    if (speciesCamCount[r.common_name] === 1) (uniqueBy[r.camera] ??= []).push(r.common_name);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          Cameras{" "}
          <span className="text-xs text-[color:var(--muted)] font-normal">{range.label}</span>
        </h1>
        <p className="text-sm text-[color:var(--muted)]">Compare what's happening at each yard listener</p>
      </header>

      <CameraLegend cams={cams} />

      <section className="card p-5 overflow-x-auto">
        <h2 className="text-lg font-semibold mb-3">Comparison</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[color:var(--muted)] text-xs text-left">
              <th className="font-normal pb-2">Camera</th>
              <th className="font-normal pb-2 text-right">Detections</th>
              <th className="font-normal pb-2 w-40">Share</th>
              <th className="font-normal pb-2 text-right">Species</th>
              <th className="font-normal pb-2 text-right">Avg conf</th>
              <th className="font-normal pb-2">Most heard</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.camera} className="border-t border-[color:var(--border)]">
                <td className={`py-2 font-semibold ${CAMERA_TEXT[s.camera] ?? ""}`}>{cameraLabel(s.camera)}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(s.detections)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/5 rounded overflow-hidden">
                      <div
                        className={`h-full ${CAMERA_COLOR[s.camera] ?? "bg-amber-500"}`}
                        style={{ width: `${(s.detections / total) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-[color:var(--muted)] w-8 text-right">
                      {Math.round((s.detections / total) * 100)}%
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{s.species}</td>
                <td className="py-2 text-right tabular-nums">{Math.round(s.avg_confidence * 100)}%</td>
                <td className="py-2">
                  {s.top_species && (
                    <Link href={`/species/${slugifySpecies(s.top_species)}`} className="hover:text-amber-400">
                      {s.top_species}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5 overflow-x-auto">
        <h2 className="text-lg font-semibold mb-1">Species by camera</h2>
        <p className="text-xs text-[color:var(--muted)] mb-4">
          Top {topSpecies.length} species — brighter = more detections at that camera (scaled per species).
        </p>
        <div
          className="grid gap-0.5 min-w-[32rem]"
          style={{ gridTemplateColumns: `minmax(8rem,1.4fr) repeat(${cams.length}, minmax(2.5rem,1fr))` }}
        >
          <div />
          {cams.map((c) => (
            <div key={c} className={`text-[10px] text-center pb-1 truncate ${CAMERA_TEXT[c] ?? ""}`}>
              {cameraLabel(c)}
            </div>
          ))}
          {topSpecies.map((sp) => {
            const row = spMatrix.get(sp.name)!;
            const rowMax = Math.max(1, ...cams.map((c) => row.get(c) ?? 0));
            return (
              <div key={sp.name} className="contents">
                <Link
                  href={`/species/${slugifySpecies(sp.name)}`}
                  className="text-xs pr-2 self-center truncate hover:text-amber-400"
                  title={sp.name}
                >
                  {sp.name}
                </Link>
                {cams.map((c) => {
                  const v = row.get(c) ?? 0;
                  const op = v / rowMax;
                  return (
                    <div
                      key={c}
                      className="aspect-[2/1] rounded grid place-items-center relative group"
                      style={{ backgroundColor: v === 0 ? "rgba(255,255,255,0.03)" : `rgba(251,191,36,${0.08 + op * 0.92})` }}
                    >
                      {v > 0 && (
                        <span className="text-[9px] tabular-nums text-black/70 font-medium">{formatNumber(v)}</span>
                      )}
                      <span className="opacity-0 group-hover:opacity-100 absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] bg-black/90 border border-[color:var(--border)] rounded px-1.5 py-0.5 whitespace-nowrap z-10 pointer-events-none">
                        {cameraLabel(c)} — {formatNumber(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-1">By hour, all cameras</h2>
        <p className="text-xs text-[color:var(--muted)] mb-4">
          The yard&apos;s daily rhythm, stacked by camera.
        </p>
        <div className="flex items-end gap-0.5 h-32">
          {hourTotals.map((tot, h) => (
            <div key={h} className="flex-1 h-full flex flex-col justify-end relative group">
              <div className="w-full flex flex-col-reverse" style={{ height: `${(tot / maxHourTotal) * 100}%` }}>
                {cams.map((c) => {
                  const v = camHours[c]?.[h] ?? 0;
                  if (v === 0) return null;
                  return (
                    <div key={c} className={CAMERA_COLOR[c] ?? "bg-amber-500"} style={{ height: `${(v / tot) * 100}%` }} />
                  );
                })}
              </div>
              <div className="opacity-0 group-hover:opacity-100 absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] bg-black/95 border border-[color:var(--border)] rounded px-2 py-1 whitespace-nowrap z-10 pointer-events-none">
                <div className="font-semibold mb-0.5">{h}:00 — {formatNumber(tot)}</div>
                {cams
                  .map((c) => ({ c, v: camHours[c]?.[h] ?? 0 }))
                  .filter(({ v }) => v > 0)
                  .map(({ c, v }) => (
                    <div key={c} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-sm ${CAMERA_COLOR[c] ?? "bg-amber-500"}`} />
                      <span>{cameraLabel(c)}</span>
                      <span className="tabular-nums ml-auto pl-2">{formatNumber(v)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-[color:var(--muted)]">
          <span>12a</span><span>6a</span><span>noon</span><span>6p</span><span>11p</span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-1">Camera specialties</h2>
        <p className="text-xs text-[color:var(--muted)] mb-4">
          Species heard at only one camera — possible micro-habitats.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cams.map((c) => {
            const u = uniqueBy[c] ?? [];
            return (
              <div key={c}>
                <div className={`text-sm font-semibold mb-2 ${CAMERA_TEXT[c] ?? ""}`}>
                  {cameraLabel(c)} ({u.length})
                </div>
                {u.length === 0 ? (
                  <p className="text-xs text-[color:var(--muted)] italic">No solo species.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {u.map((n) => (
                      <li key={n}>
                        <Link href={`/species/${slugifySpecies(n)}`} className="hover:text-amber-400">
                          {n}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CameraLegend({ cams }: { cams: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      {cams.map((c) => (
        <span key={c} className="flex items-center gap-1.5 text-[color:var(--muted)]">
          <span className={`w-2.5 h-2.5 rounded-sm ${CAMERA_COLOR[c] ?? "bg-amber-500"}`} />
          {cameraLabel(c)}
        </span>
      ))}
    </div>
  );
}
