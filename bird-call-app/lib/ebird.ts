// eBird API 2.0 integration: compare our detections against what birders report
// nearby. Needs a free API key (https://ebird.org/api/keygen) in EBIRD_API_KEY.
// Station location defaults to the configured lat/lon, overridable via env.
//
// Everything degrades gracefully: with no key, an unmappable species, or a
// failed/again request, the helpers return null and the UI simply hides.
import { promises as fs } from "fs";
import path from "path";
import { CACHE_DIR } from "./birdStore";

const KEY = process.env.EBIRD_API_KEY;
// Station coordinates for "nearby" lookups — provided via env; no location is
// baked into the code. Without them (or a key) the eBird features stay dark.
const LAT = process.env.EBIRD_LAT ? Number(process.env.EBIRD_LAT) : NaN;
const LNG = process.env.EBIRD_LNG ? Number(process.env.EBIRD_LNG) : NaN;
const HAS_COORDS = Number.isFinite(LAT) && Number.isFinite(LNG);
const BASE = "https://api.ebird.org/v2";

const EBIRD_DIR = path.join(CACHE_DIR, "ebird");
const TAXO_PATH = path.join(EBIRD_DIR, "taxonomy.json");
const TAXO_TTL = 30 * 24 * 3600 * 1000; // 30 days
const OBS_TTL = 12 * 3600 * 1000; // 12 hours

const BACK_DAYS = 30; // eBird max
const DIST_KM = 50; // eBird max
const MAX_RESULTS = 1000;

export const EBIRD_ENABLED = !!KEY && HAS_COORDS;

type TaxoMap = { bySci: Record<string, string>; byCom: Record<string, string> };
let taxoMem: TaxoMap | null = null;

async function ebirdFetch<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { "x-ebirdapitoken": KEY as string },
  });
  if (!res.ok) throw new Error(`eBird ${res.status} for ${pathAndQuery}`);
  return res.json() as Promise<T>;
}

async function loadTaxonomy(): Promise<TaxoMap | null> {
  if (!KEY) return null;
  if (taxoMem) return taxoMem;
  try {
    const stat = await fs.stat(TAXO_PATH);
    if (Date.now() - stat.mtimeMs < TAXO_TTL) {
      taxoMem = JSON.parse(await fs.readFile(TAXO_PATH, "utf8"));
      return taxoMem;
    }
  } catch {
    /* not cached yet */
  }
  try {
    const rows = await ebirdFetch<{ sciName: string; comName: string; speciesCode: string }[]>(
      "/ref/taxonomy/ebird?fmt=json",
    );
    const bySci: Record<string, string> = {};
    const byCom: Record<string, string> = {};
    for (const r of rows) {
      if (r.sciName) bySci[r.sciName.toLowerCase()] = r.speciesCode;
      if (r.comName) byCom[r.comName.toLowerCase()] = r.speciesCode;
    }
    taxoMem = { bySci, byCom };
    await fs.mkdir(EBIRD_DIR, { recursive: true });
    await fs.writeFile(TAXO_PATH, JSON.stringify(taxoMem));
    return taxoMem;
  } catch {
    return null;
  }
}

export async function speciesCodeFor(
  scientificName: string | null,
  commonName: string | null,
): Promise<string | null> {
  const t = await loadTaxonomy();
  if (!t) return null;
  if (scientificName && t.bySci[scientificName.toLowerCase()]) {
    return t.bySci[scientificName.toLowerCase()];
  }
  if (commonName && t.byCom[commonName.toLowerCase()]) {
    return t.byCom[commonName.toLowerCase()];
  }
  return null;
}

// The geo/recent/{speciesCode} endpoint returns the most recent observation per
// location, so the row count IS the number of nearby locations reporting the
// species in the window. `capped` is true when we hit MAX_RESULTS (so the real
// figure is "locations+").
export type EbirdNearby = {
  code: string;
  locations: number; // nearby locations reporting (capped at MAX_RESULTS)
  capped: boolean;
  mostRecent: string | null; // "YYYY-MM-DD HH:MM"
  nearestKm: number | null;
  backDays: number;
  distKm: number;
  mapUrl: string;
};

export async function getSpeciesEbird(
  scientificName: string | null,
  commonName: string | null,
): Promise<EbirdNearby | null> {
  if (!KEY || !HAS_COORDS) return null;
  const code = await speciesCodeFor(scientificName, commonName);
  if (!code) return null;

  const cacheFile = path.join(EBIRD_DIR, `${code}.json`);
  try {
    const stat = await fs.stat(cacheFile);
    if (Date.now() - stat.mtimeMs < OBS_TTL) {
      return JSON.parse(await fs.readFile(cacheFile, "utf8"));
    }
  } catch {
    /* not cached yet */
  }

  try {
    const obs = await ebirdFetch<
      { locId: string; lat: number; lng: number; obsDt: string }[]
    >(
      `/data/obs/geo/recent/${code}?lat=${LAT}&lng=${LNG}&back=${BACK_DAYS}&dist=${DIST_KM}&maxResults=${MAX_RESULTS}`,
    );
    let mostRecent: string | null = null;
    let nearestKm: number | null = null;
    for (const o of obs) {
      if (!mostRecent || o.obsDt > mostRecent) mostRecent = o.obsDt;
      const d = haversineKm(LAT, LNG, o.lat, o.lng);
      if (nearestKm == null || d < nearestKm) nearestKm = d;
    }
    const result: EbirdNearby = {
      code,
      locations: new Set(obs.map((o) => o.locId)).size,
      capped: obs.length >= MAX_RESULTS,
      mostRecent,
      nearestKm,
      backDays: BACK_DAYS,
      distKm: DIST_KM,
      mapUrl: `https://ebird.org/map/${code}`,
    };
    await fs.mkdir(EBIRD_DIR, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(result));
    return result;
  } catch {
    return null;
  }
}

// Shared classification so the species panel and the review queue agree on what
// counts as "uncommon nearby". Boundaries mirror the species page's verdict
// tiers: 0 = not reported, 1–2 rare, 3–10 occasional, 11–50 commonly reported,
// 51+ very common / ubiquitous.
export function isUnderReportedNearby(e: EbirdNearby | null): boolean {
  // Only species eBird does NOT consider commonly reported are worth reviewing.
  return e != null && e.locations <= 10;
}

// Canonical verdict string for "how well-reported nearby" — used by the species
// panel and the review cards so they always agree.
export function ebirdNearbyLabel(locations: number, capped: boolean): string {
  if (locations === 0) return "Not reported nearby";
  if (locations <= 2) return "Rarely reported nearby";
  if (locations <= 10) return "Occasionally reported nearby";
  if (locations <= 50) return "Commonly reported nearby";
  if (locations <= 200 && !capped) return "Very common nearby";
  return "Ubiquitous nearby";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
