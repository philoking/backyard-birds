"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { slugifySpecies } from "@/lib/slug";
import { formatTime } from "@/lib/format";

export type ReviewClip = { id: number; ts: string };

export type ReviewItem = {
  common_name: string;
  ebirdLabel: string;
  ebirdLocations: number;
  thumbnail: string | null;
  reference: {
    audioUrl: string;
    recordist: string | null;
    license: string | null;
    pageUrl: string | null;
  } | null;
  clips: ReviewClip[];
};

export default function ReviewCards({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function flag(id: number, name: string) {
    if (busy) return;
    if (!window.confirm(`Flag this clip of "${name}" as a false positive? It will be removed.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/clips/${id}/flag`, { method: "POST" });
      const d = await res.json();
      if (d?.suppressed) {
        window.alert(`"${d.common_name}" hidden from all stats after ${d.flag_count} flags.`);
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(name: string) {
    if (dismissing) return;
    if (!window.confirm(`Confirm "${name}" is correctly identified and stop suggesting it for review?`)) return;
    setDismissing(name);
    try {
      await fetch(`/api/species/${slugifySpecies(name)}/dismiss`, { method: "POST" });
      router.refresh();
    } finally {
      setDismissing(null);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Worth a closer look</h2>
        <p className="text-xs text-[color:var(--muted)]">
          We&apos;ve captured clips for these, but eBird shows them at{" "}
          <span className="text-red-300">few nearby locations</span> — likely misIDs, or something notable.
          Compare each clip against the reference call, and flag the bad ones.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map((s) => (
          <div key={s.common_name} className="card p-4">
            <div className="flex gap-3">
              <div className="relative w-20 h-20 shrink-0 rounded overflow-hidden bg-black/30 border border-[color:var(--border)]">
                {s.thumbnail ? (
                  <Image src={s.thumbnail} alt={s.common_name} fill sizes="80px" className="object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-2xl opacity-30">🪶</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/species/${slugifySpecies(s.common_name)}`}
                      className="font-medium hover:text-amber-400 truncate block"
                    >
                      {s.common_name}
                    </Link>
                    <div className={`text-[10px] ${s.ebirdLocations === 0 ? "text-red-300" : "text-amber-300"}`}>
                      eBird: {s.ebirdLabel}
                      {s.ebirdLocations > 0 && (
                        <span className="text-[color:var(--muted)]"> · {s.ebirdLocations} nearby</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => dismiss(s.common_name)}
                    disabled={dismissing === s.common_name}
                    title="ID looks right — stop suggesting this species"
                    className="text-[10px] text-[color:var(--muted)] hover:text-emerald-300 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {dismissing === s.common_name ? "…" : "✓ looks right"}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 mb-0.5">
                  <span className="text-[10px] text-emerald-300">★ Reference call</span>
                  {s.reference?.pageUrl && (
                    <a
                      href={s.reference.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-emerald-400 hover:underline whitespace-nowrap"
                    >
                      {s.reference.recordist ? `rec. ${s.reference.recordist} · ` : ""}xeno-canto ↗
                    </a>
                  )}
                </div>
                {s.reference ? (
                  <audio controls preload="none" className="w-full h-8" src={s.reference.audioUrl} />
                ) : (
                  <p className="text-[11px] text-[color:var(--muted)] italic">No reference recording.</p>
                )}
              </div>
            </div>

            <div className="mt-3 border-t border-[color:var(--border)] pt-3">
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)] mb-1.5">
                Captured clips — listen &amp; flag
              </div>
              <ul className="space-y-1.5">
                {s.clips.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <span className="text-[10px] text-[color:var(--muted)] w-14 shrink-0 tabular-nums">
                      {formatTime(c.ts)}
                    </span>
                    <audio controls preload="none" className="flex-1 h-8 min-w-0" src={`/api/clips/${c.id}`} />
                    <button
                      onClick={() => flag(c.id, s.common_name)}
                      disabled={busy === c.id}
                      title="Flag as false positive (removes this clip)"
                      className="text-[10px] text-[color:var(--muted)] hover:text-red-300 disabled:opacity-50 whitespace-nowrap"
                    >
                      {busy === c.id ? "…" : "✕"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
