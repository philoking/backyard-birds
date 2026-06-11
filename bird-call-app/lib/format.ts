export const CAMERA_LABEL: Record<string, string> = {
  front_porch: "Front Porch",
  shop_side: "Shop Side",
  back_patio: "Back Patio",
  garden: "Garden",
};

export const CAMERA_COLOR: Record<string, string> = {
  front_porch: "bg-amber-500",
  shop_side: "bg-sky-500",
  back_patio: "bg-emerald-500",
  garden: "bg-rose-500",
};

export const CAMERA_TEXT: Record<string, string> = {
  front_porch: "text-amber-300",
  shop_side: "text-sky-300",
  back_patio: "text-emerald-300",
  garden: "text-rose-300",
};

export function cameraLabel(c: string): string {
  return CAMERA_LABEL[c] ?? c;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatRelative(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(date);
}

// All app data is local (Pacific) time. Always render dates in that zone
// so the date column matches formatTime() and we never show a UTC date
// next to a Pacific time (which made "11:21 PM PT on 5/23" look like
// "11:21 PM 5/24" because 06:21 UTC is on 5/24).
export function formatDate(d: Date | string): string {
  // SQL "::date::text" produces a bare YYYY-MM-DD that's already in the
  // local zone. Feeding it through `new Date()` would parse it as UTC
  // midnight and silently shift it; format the components directly.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return `${m}/${day}/${y}`;
  }
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
}

export function formatHour(h: number): string {
  if (h === 0) return "12 am";
  if (h === 12) return "12 pm";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export function formatTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

// --- Weather (Tempest stores metric; the dashboard is US-local, so show US units) ---

export function cToF(c: number | null): number | null {
  return c == null ? null : c * 9 / 5 + 32;
}

export function msToMph(ms: number | null): number | null {
  return ms == null ? null : ms * 2.236936;
}

export function mbToInHg(mb: number | null): number | null {
  return mb == null ? null : mb * 0.02953;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function degToCompass(deg: number | null): string {
  if (deg == null) return "";
  return COMPASS[Math.round(deg / 22.5) % 16];
}

export function formatTemp(c: number | null): string {
  const f = cToF(c);
  return f == null ? "—" : `${Math.round(f)}°F`;
}

export function formatWind(ms: number | null): string {
  const mph = msToMph(ms);
  if (mph == null) return "—";
  return mph < 0.5 ? "calm" : `${Math.round(mph)} mph`;
}

export function formatMiles(km: number | null): string {
  if (km == null) return "—";
  const mi = km * 0.621371;
  return mi < 1 ? "<1 mi" : `${Math.round(mi)} mi`;
}
