"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/timeRange";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/live", label: "Live" },
  { href: "/species", label: "Species" },
  { href: "/patterns", label: "Patterns" },
  { href: "/cameras", label: "Cameras" },
];

// Pages that should never carry the range param (it's irrelevant on those).
const NO_RANGE_PATHS = new Set(["/live"]);

function todayYmd(): string {
  const d = new Date();
  // Match resolveRange's "local today" by going through Intl.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const rangeParam = params.get("range");
  const currentRange: RangeKey =
    (RANGE_KEYS as readonly string[]).includes(rangeParam ?? "") ? (rangeParam as RangeKey) : "30d";
  const startParam = params.get("start") ?? "";
  const endParam = params.get("end") ?? "";

  // Build the query suffix that nav links should carry to preserve the active range.
  const rangeQuery = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("range", currentRange);
    if (currentRange === "custom") {
      if (startParam) sp.set("start", startParam);
      if (endParam) sp.set("end", endParam);
    }
    return sp.toString();
  }, [currentRange, startParam, endParam]);

  function navHref(href: string): string {
    if (NO_RANGE_PATHS.has(href)) return href;
    return rangeQuery ? `${href}?${rangeQuery}` : href;
  }

  function updateParams(mutate: (sp: URLSearchParams) => void) {
    const sp = new URLSearchParams(params.toString());
    mutate(sp);
    const q = sp.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  }

  function onSelectRange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as RangeKey;
    updateParams((sp) => {
      sp.set("range", next);
      if (next === "custom") {
        if (!sp.get("start")) sp.set("start", todayYmd());
        if (!sp.get("end")) sp.set("end", todayYmd());
      } else {
        sp.delete("start");
        sp.delete("end");
      }
    });
  }

  function onChangeStart(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (!v) return;
    updateParams((sp) => {
      sp.set("range", "custom");
      sp.set("start", v);
      if (!sp.get("end")) sp.set("end", v);
    });
  }

  function onChangeEnd(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (!v) return;
    updateParams((sp) => {
      sp.set("range", "custom");
      sp.set("end", v);
      if (!sp.get("start")) sp.set("start", v);
    });
  }

  const hideRange = NO_RANGE_PATHS.has(pathname);

  // Subtle affordance: only surfaces when something is flagged. Refetched on
  // navigation so it stays roughly current after flagging/restoring.
  const [flaggedCount, setFlaggedCount] = useState(0);
  useEffect(() => {
    let active = true;
    fetch("/api/flagged")
      .then((r) => r.json())
      .then((d) => {
        if (active) setFlaggedCount(d?.count ?? 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname]);

  return (
    <header className="border-b border-[color:var(--border)] bg-[color:var(--panel)]/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
        <Link href={navHref("/")} className="flex items-center gap-2">
          <span className="text-xl">🪶</span>
          <span className="font-semibold tracking-tight">Backyard Birds</span>
        </Link>
        <nav className="flex gap-1 text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={navHref(n.href)}
                className={`px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors ${
                  active ? "text-white bg-white/5" : "text-[color:var(--muted)] hover:text-white"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {flaggedCount > 0 && (
            <Link
              href="/flagged"
              title={`${flaggedCount} flagged species — review false positives`}
              className={`text-xs flex items-center gap-1 transition-colors ${
                pathname.startsWith("/flagged")
                  ? "text-red-300"
                  : "text-[color:var(--muted)] hover:text-red-300"
              }`}
            >
              <span aria-hidden>⚑</span>
              <span className="tabular-nums">{flaggedCount}</span>
            </Link>
          )}
          {!hideRange && (
            <div className="flex items-center gap-2 text-xs">
              <label className="text-[color:var(--muted)]">Range:</label>
            <select
              value={currentRange}
              onChange={onSelectRange}
              className="bg-black/30 border border-[color:var(--border)] rounded px-2 py-1 text-xs text-white"
              aria-label="Time range"
            >
              {RANGE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RANGE_LABELS[k]}
                </option>
              ))}
            </select>
            {currentRange === "custom" && (
              <>
                <input
                  type="date"
                  value={startParam}
                  onChange={onChangeStart}
                  className="bg-black/30 border border-[color:var(--border)] rounded px-1.5 py-1 text-xs text-white"
                  aria-label="Start date"
                />
                <span className="text-[color:var(--muted)]">→</span>
                <input
                  type="date"
                  value={endParam}
                  onChange={onChangeEnd}
                  className="bg-black/30 border border-[color:var(--border)] rounded px-1.5 py-1 text-xs text-white"
                  aria-label="End date"
                />
              </>
            )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
