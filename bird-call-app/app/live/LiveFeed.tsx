"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cameraLabel, CAMERA_COLOR, CAMERA_TEXT, formatRelative, formatTime } from "@/lib/format";
import { slugifySpecies } from "@/lib/slug";

type Row = {
  id: number;
  ts: string;
  camera: string;
  common_name: string | null;
  scientific_name: string | null;
  confidence: number;
};

const MAX_ROWS = 200;
const POLL_MS = 5000;

export default function LiveFeed({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const [, tick] = useState(0); // re-render for "Xs ago"
  const flashIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const sinceId = rows[0]?.id ?? 0;
        const res = await fetch(`/api/recent?since=${sinceId}&limit=100`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { rows: Row[] };
        if (cancelled || !data.rows?.length) return;
        for (const r of data.rows) flashIds.current.add(r.id);
        setRows((prev) => {
          const merged = [...data.rows, ...prev];
          // De-dup by id (in case poll overlaps)
          const seen = new Set<number>();
          const out: Row[] = [];
          for (const r of merged) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            out.push(r);
            if (out.length >= MAX_ROWS) break;
          }
          return out;
        });
        setNewCount((c) => c + data.rows.length);
        setTimeout(() => {
          for (const r of data.rows) flashIds.current.delete(r.id);
          tick((n) => n + 1);
        }, 1500);
      } catch {
        /* ignore transient errors */
      }
    };
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [paused, rows]);

  const cameras = Array.from(new Set(rows.map((r) => r.camera))).sort();
  const visible = filter === "all" ? rows : rows.filter((r) => r.camera === filter);

  // Collapse consecutive detections of the same species (birds call in bursts)
  // into one row with a count, so a species doesn't repeat dozens of times.
  type Group = {
    key: string;
    common_name: string | null;
    scientific_name: string | null;
    cameras: string[];
    ts: string;
    count: number;
    flash: boolean;
  };
  const groups: Group[] = [];
  for (const r of visible) {
    const last = groups[groups.length - 1];
    if (last && last.common_name === r.common_name) {
      last.count += 1;
      if (!last.cameras.includes(r.camera)) last.cameras.push(r.camera);
      if (flashIds.current.has(r.id)) last.flash = true;
    } else {
      groups.push({
        key: `${r.id}`,
        common_name: r.common_name,
        scientific_name: r.scientific_name,
        cameras: [r.camera],
        ts: r.ts, // visible is newest-first, so this is the group's latest
        count: 1,
        flash: flashIds.current.has(r.id),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setPaused((p) => !p)}
          className={`text-xs px-3 py-1.5 rounded border ${
            paused
              ? "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
              : "border-red-500/50 text-red-400 hover:bg-red-500/10"
          }`}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <span className="text-xs text-[color:var(--muted)]">
          {paused ? "Polling paused" : "Polling every 5s"} · {newCount} new since load
        </span>
        <span className="flex-1" />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-[color:var(--muted)] mr-1">Camera:</span>
          <button
            onClick={() => setFilter("all")}
            className={`px-2 py-1 rounded ${filter === "all" ? "bg-white/10" : "hover:bg-white/5"}`}
          >
            All
          </button>
          {cameras.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-2 py-1 rounded ${filter === c ? "bg-white/10" : "hover:bg-white/5"} ${
                CAMERA_TEXT[c] ?? ""
              }`}
            >
              {cameraLabel(c)}
            </button>
          ))}
        </div>
      </div>

      <ul className="card divide-y divide-[color:var(--border)]">
        {groups.map((g) => (
          <li
            key={g.key}
            className={`px-4 py-2.5 flex items-center gap-3 transition-colors ${
              g.flash ? "bg-amber-500/15" : ""
            }`}
          >
            <span className="flex shrink-0 -space-x-1">
              {g.cameras.map((c) => (
                <span
                  key={c}
                  className={`w-2 h-2 rounded-full ring-1 ring-[color:var(--panel)] ${CAMERA_COLOR[c] ?? "bg-amber-500"}`}
                />
              ))}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/species/${slugifySpecies(g.common_name ?? "unknown")}`}
                  className="font-medium truncate hover:text-amber-400"
                >
                  {g.common_name ?? "Unknown"}
                </Link>
                {g.count > 1 && (
                  <span className="text-[10px] tabular-nums text-amber-300 bg-amber-500/10 rounded px-1.5 py-0.5 shrink-0">
                    ×{g.count}
                  </span>
                )}
                {g.scientific_name && (
                  <span className="text-xs italic text-[color:var(--muted)] truncate">
                    {g.scientific_name}
                  </span>
                )}
              </div>
              <div className="text-xs text-[color:var(--muted)]">
                {g.cameras.length === 1 ? (
                  <span className={CAMERA_TEXT[g.cameras[0]] ?? ""}>{cameraLabel(g.cameras[0])}</span>
                ) : (
                  <span>{g.cameras.length} cameras</span>
                )}
                <span className="mx-1.5">·</span>
                <span>{g.count > 1 ? "latest " : ""}{formatTime(g.ts)}</span>
              </div>
            </div>
            <span className="text-[10px] text-[color:var(--muted)] tabular-nums shrink-0">
              {formatRelative(g.ts)}
            </span>
          </li>
        ))}
        {groups.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[color:var(--muted)]">
            No detections {filter !== "all" ? `from ${cameraLabel(filter)}` : ""} yet.
          </li>
        )}
      </ul>
    </div>
  );
}
