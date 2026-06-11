"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { CATEGORIES, type BirdCategory } from "@/lib/categories";
import { formatNumber, formatRelative } from "@/lib/format";
import { slugifySpecies } from "@/lib/slug";

export type SpeciesRow = {
  common_name: string;
  scientific_name: string | null;
  detections: number;
  last_seen: string;
  thumbnail: string | null;
  category: BirdCategory | null;
};

type SortKey = "count" | "alpha" | "recent";

const SORT_LABELS: Record<SortKey, string> = {
  count: "Most detections",
  alpha: "A → Z",
  recent: "Most recent",
};

export default function SpeciesIndex({
  species,
  rangeLabel,
}: {
  species: SpeciesRow[];
  rangeLabel: string;
}) {
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<BirdCategory>>(new Set());
  const [query, setQuery] = useState("");

  const availableCategories = useMemo(() => {
    const counts = new Map<BirdCategory, number>();
    for (const s of species) {
      const c = s.category ?? "Other";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return CATEGORIES.filter((c) => counts.has(c)).map((c) => ({ category: c, count: counts.get(c)! }));
  }, [species]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = selected.size === 0
      ? species
      : species.filter((s) => selected.has(s.category ?? "Other"));
    if (q) {
      rows = rows.filter(
        (s) =>
          s.common_name.toLowerCase().includes(q) ||
          (s.scientific_name?.toLowerCase().includes(q) ?? false),
      );
    }
    const sorted = [...rows];
    if (sort === "alpha") {
      sorted.sort((a, b) => a.common_name.localeCompare(b.common_name));
    } else if (sort === "recent") {
      sorted.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
    } else {
      sorted.sort((a, b) => b.detections - a.detections);
    }
    return sorted;
  }, [species, selected, sort, query]);

  function toggle(c: BirdCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Species{" "}
          <span className="text-base font-normal text-[color:var(--muted)] tabular-nums">
            ({filtered.length}
            {filtered.length !== species.length ? ` of ${species.length}` : ""})
          </span>
          <span className="ml-2 text-xs text-[color:var(--muted)] font-normal">{rangeLabel}</span>
        </h1>
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search species…"
            aria-label="Search species"
            className="bg-black/30 border border-[color:var(--border)] rounded px-2.5 py-1 text-xs text-white placeholder:text-[color:var(--muted)] w-44 focus:outline-none focus:border-amber-500/60"
          />
          <label className="text-xs text-[color:var(--muted)] flex items-center gap-2">
            Sort:
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-black/30 border border-[color:var(--border)] rounded px-2 py-1 text-xs text-white"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSelected(new Set())}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            selected.size === 0
              ? "bg-amber-500/20 border-amber-500/60 text-amber-200"
              : "border-[color:var(--border)] text-[color:var(--muted)] hover:text-white hover:border-white/40"
          }`}
        >
          All
        </button>
        {availableCategories.map(({ category, count }) => {
          const active = selected.has(category);
          return (
            <button
              key={category}
              onClick={() => toggle(category)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-200"
                  : "border-[color:var(--border)] text-[color:var(--muted)] hover:text-white hover:border-white/40"
              }`}
            >
              {category}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filtered.map((s) => (
          <Link
            key={s.common_name}
            href={`/species/${slugifySpecies(s.common_name)}`}
            className="card overflow-hidden group hover:border-amber-500/50 transition-colors"
          >
            <div className="relative aspect-square bg-black/30">
              {s.thumbnail ? (
                <Image
                  src={s.thumbnail}
                  alt={s.common_name}
                  fill
                  sizes="(max-width: 768px) 50vw, 20vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-4xl opacity-30">🪶</div>
              )}
              <div className="absolute top-1 right-1 text-[10px] bg-black/70 rounded px-1.5 py-0.5 tabular-nums">
                {formatNumber(s.detections)}
              </div>
              {s.category && (
                <div className="absolute bottom-1 left-1 text-[10px] bg-black/70 rounded px-1.5 py-0.5">
                  {s.category}
                </div>
              )}
            </div>
            <div className="p-2">
              <div className="font-medium text-sm truncate group-hover:text-amber-400 transition-colors">
                {s.common_name}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                {s.scientific_name && (
                  <span className="text-[11px] text-[color:var(--muted)] italic truncate">
                    {s.scientific_name}
                  </span>
                )}
                <span className="text-[10px] text-[color:var(--muted)] tabular-nums shrink-0">
                  {formatRelative(s.last_seen)}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
