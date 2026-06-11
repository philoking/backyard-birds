"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { slugifySpecies } from "@/lib/slug";

type Item = { common_name: string; flag_count: number; suppressed: boolean };

export default function FlaggedReview({ items, threshold }: { items: Item[]; threshold: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function clear(name: string) {
    if (!window.confirm(`Restore "${name}"? This clears its flags and un-hides it everywhere.`)) return;
    setBusy(name);
    try {
      await fetch(`/api/species/${slugifySpecies(name)}/restore`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="card p-6 text-sm text-[color:var(--muted)]">
        Nothing flagged yet. On any species page, use{" "}
        <span className="text-white">&ldquo;✕ not this bird&rdquo;</span> next to a clip under{" "}
        <span className="text-white">Recent calls</span> to flag a false positive. After {threshold} flags a
        species is hidden from all stats.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.common_name} className="card p-3 flex items-center gap-3">
          <Link
            href={`/species/${slugifySpecies(s.common_name)}`}
            className="font-medium hover:text-amber-400 truncate"
          >
            {s.common_name}
          </Link>
          {s.suppressed ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-200 border border-red-500/30">
              Hidden
            </span>
          ) : (
            <span className="text-xs text-[color:var(--muted)] tabular-nums whitespace-nowrap">
              {s.flag_count}/{threshold}
            </span>
          )}
          <div className="flex-1 min-w-[3rem] max-w-[12rem]">
            <div className="h-1.5 bg-white/[0.05] rounded overflow-hidden">
              <div
                className={s.suppressed ? "h-full bg-red-400/70" : "h-full bg-amber-400/70"}
                style={{ width: `${Math.min(100, (s.flag_count / threshold) * 100)}%` }}
              />
            </div>
          </div>
          <button
            onClick={() => clear(s.common_name)}
            disabled={busy === s.common_name}
            className="text-xs text-amber-400 hover:underline disabled:opacity-50 whitespace-nowrap"
          >
            {busy === s.common_name ? "…" : s.suppressed ? "restore" : "clear flags"}
          </button>
        </li>
      ))}
    </ul>
  );
}
