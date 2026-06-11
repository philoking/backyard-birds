import { LOCAL_TZ } from "./tz";

export const RANGE_KEYS = ["today", "yesterday", "7d", "30d", "year", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  year: "This year",
  custom: "Custom",
};

export const DEFAULT_RANGE: RangeKey = "30d";

export type TimeRange = {
  key: RangeKey;
  label: string;
  // YYYY-MM-DD, inclusive, in the app's local zone (LOCAL_TZ).
  startDate: string;
  endDate: string;
};

function todayInLocal(): { y: number; m: number; d: number } {
  // Get today's calendar date in LOCAL_TZ via Intl, robust against the server's TZ.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

// Add `days` to a YYYY-MM-DD without touching time-of-day, so we don't drift
// across DST boundaries. days can be negative.
function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // Use UTC math purely as a calendar calculator. The resulting Y/M/D is the
  // intended local calendar date; we just need correct day arithmetic.
  const t = Date.UTC(y, m - 1, d) + days * 86400_000;
  const dt = new Date(t);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Resolve a TimeRange from URL search params.
 *   ?range=today|yesterday|7d|30d|year|custom
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD   (only when range=custom; falls back to 30d if invalid)
 */
export function resolveRange(params: {
  range?: string;
  start?: string;
  end?: string;
}): TimeRange {
  const { y, m, d } = todayInLocal();
  const today = fmt(y, m, d);

  const key = (RANGE_KEYS as readonly string[]).includes(params.range ?? "")
    ? (params.range as RangeKey)
    : DEFAULT_RANGE;

  switch (key) {
    case "today":
      return { key, label: RANGE_LABELS.today, startDate: today, endDate: today };
    case "yesterday": {
      const y1 = shiftDays(today, -1);
      return { key, label: RANGE_LABELS.yesterday, startDate: y1, endDate: y1 };
    }
    case "7d":
      return { key, label: RANGE_LABELS["7d"], startDate: shiftDays(today, -6), endDate: today };
    case "30d":
      return { key, label: RANGE_LABELS["30d"], startDate: shiftDays(today, -29), endDate: today };
    case "year":
      return { key, label: RANGE_LABELS.year, startDate: `${y}-01-01`, endDate: today };
    case "custom": {
      if (!isYmd(params.start) || !isYmd(params.end)) {
        return resolveRange({ range: DEFAULT_RANGE });
      }
      const [s, e] = params.start <= params.end
        ? [params.start, params.end]
        : [params.end, params.start];
      return { key, label: `${s} → ${e}`, startDate: s, endDate: e };
    }
  }
}

// Inclusive day count.
export function rangeDays(r: TimeRange): number {
  const [sy, sm, sd] = r.startDate.split("-").map(Number);
  const [ey, em, ed] = r.endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / 86400_000) + 1;
}
