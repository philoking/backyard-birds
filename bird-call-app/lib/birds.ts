import { promises as fs } from "fs";
import {
  readMeta,
  writeBird,
  metaPath,
  safeKey,
  extFromUrl,
  type StoredBird,
  type StoredExt,
} from "./birdStore";
import { deriveCategory, type BirdCategory } from "./categories";

export type BirdInfo = {
  title: string;
  scientificName: string | null;
  summary: string | null;
  thumbnail: string | null;
  image: string | null;
  attribution: string | null;
  wikiUrl: string | null;
  category: BirdCategory | null;
  family: string | null;
  order: string | null;
  conservationStatus: string | null;
  establishmentMeans: string | null;
};

type INatPhoto = {
  square_url?: string;
  small_url?: string;
  medium_url?: string;
  large_url?: string;
  original_url?: string;
  url?: string;
  attribution?: string;
  license_code?: string | null;
};

type INatTaxon = {
  id: number;
  name: string;
  preferred_common_name?: string;
  wikipedia_url?: string;
  default_photo?: INatPhoto;
};

type INatAncestor = {
  id: number;
  name: string;
  rank: string;
};

const memCache = new Map<string, { at: number; value: BirdInfo | null }>();
const inflight = new Map<string, Promise<BirdInfo | null>>();
const TTL_MS = 1000 * 60 * 60 * 24 * 7;
const NEG_TTL_MS = 1000 * 60;

const HEADERS = {
  "User-Agent": "bird-call-app (self-hosted backyard bird monitor)",
  Accept: "application/json",
};

// iNat asks for <=100 req/min. Chain a promise per call to enforce a global gap.
const INAT_MIN_GAP_MS = 700;
let iNatGate: Promise<void> = Promise.resolve();
function iNatThrottle(): Promise<void> {
  const wait = iNatGate.then(() => new Promise<void>((r) => setTimeout(r, INAT_MIN_GAP_MS)));
  iNatGate = wait;
  return wait;
}

// iNat place id for Washington state. Determines whether a species is
// considered "introduced" / "native" locally. Override with IN_AT_PLACE_ID
// if you ever move this thing.
const INAT_PLACE_ID = Number(process.env.INAT_PLACE_ID ?? 46);

type TaxonDetail = {
  ancestors: INatAncestor[] | null;
  conservationStatus: string | null;
  establishmentMeans: string | null;
};

async function fetchTaxonDetail(taxonId: number, attempt = 0): Promise<TaxonDetail> {
  await iNatThrottle();
  const url = `https://api.inaturalist.org/v1/taxa/${taxonId}?preferred_place_id=${INAT_PLACE_ID}`;
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 250));
      return fetchTaxonDetail(taxonId, attempt + 1);
    }
    if (!res.ok) return { ancestors: null, conservationStatus: null, establishmentMeans: null };
    const json = (await res.json()) as {
      results?: {
        ancestors?: INatAncestor[];
        conservation_status?: { status?: string } | null;
        establishment_means?: { establishment_means?: string } | null;
      }[];
    };
    const r = json.results?.[0];
    return {
      ancestors: r?.ancestors ?? null,
      conservationStatus: r?.conservation_status?.status ?? null,
      establishmentMeans: r?.establishment_means?.establishment_means ?? null,
    };
  } catch {
    return { ancestors: null, conservationStatus: null, establishmentMeans: null };
  }
}

function taxonomyFromAncestors(
  ancestors: INatAncestor[] | null,
): { family: string | null; order: string | null } {
  if (!ancestors) return { family: null, order: null };
  const family = ancestors.find((a) => a.rank === "family")?.name ?? null;
  const order = ancestors.find((a) => a.rank === "order")?.name ?? null;
  return { family, order };
}

async function searchTaxon(query: string, attempt = 0): Promise<INatTaxon | null> {
  await iNatThrottle();
  const url =
    `https://api.inaturalist.org/v1/taxa?` +
    `q=${encodeURIComponent(query)}&rank=species&iconic_taxa=Aves&per_page=5&is_active=true`;
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 250));
      return searchTaxon(query, attempt + 1);
    }
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: INatTaxon[] };
    const results = json.results ?? [];
    if (results.length === 0) return null;
    const q = query.toLowerCase();
    const exact = results.find(
      (r) => r.preferred_common_name?.toLowerCase() === q || r.name.toLowerCase() === q,
    );
    return exact ?? results[0];
  } catch {
    return null;
  }
}

function bestPhotoUrl(p?: INatPhoto): string | null {
  if (!p) return null;
  // Prefer the largest available, but iNat's "medium" (~500px) is plenty for cards.
  return p.original_url ?? p.large_url ?? p.medium_url ?? p.small_url ?? p.url ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function wikiTitleFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/wiki\/([^#?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchWikiSummary(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { extract?: string; extract_html?: string };
    if (j.extract && j.extract.length > 30) return j.extract;
    if (j.extract_html) return stripHtml(j.extract_html);
    return null;
  } catch {
    return null;
  }
}

function metaToInfo(meta: StoredBird): BirdInfo {
  const localUrl = `/api/birds/${encodeURIComponent(safeKey(meta.scientific_name))}/image`;
  return {
    title: meta.common_name,
    scientificName: meta.scientific_name,
    summary: meta.summary,
    thumbnail: localUrl,
    image: localUrl,
    attribution: meta.attribution,
    wikiUrl: meta.wiki_url,
    category: meta.category,
    family: meta.family,
    order: meta.order,
    conservationStatus: meta.conservation_status,
    establishmentMeans: meta.establishment_means,
  };
}

/**
 * Ensure a species has a cached image + metadata on disk; download from iNat if missing.
 * Returns the metadata, or null if the species can't be resolved (e.g. no iNat photo).
 *
 * This is the only place that should write to the cache. The website reads via readMeta()
 * indirectly through getBirdInfo().
 */
export async function ensureCached(
  commonName: string,
  scientificName: string | null | undefined,
): Promise<StoredBird | null> {
  const key = scientificName ?? commonName;
  const existing = await readMeta(key);

  // Fast path: fully enriched (taxonomy was actually fetched + the
  // conservation/establishment fields exist on the cached object).
  // A null family means a prior fetch failed; keep retrying.
  // A missing key means the entry pre-dates the new fields; backfill.
  if (
    existing &&
    existing.family != null &&
    "conservation_status" in existing &&
    "establishment_means" in existing
  ) {
    return existing;
  }

  // Need iNat lookup (first-time fetch or taxonomy backfill).
  const taxon =
    (scientificName ? await searchTaxon(scientificName) : null) ??
    (await searchTaxon(commonName));
  if (!taxon) return existing ?? null;

  const detail = await fetchTaxonDetail(taxon.id);
  const { family, order } = taxonomyFromAncestors(detail.ancestors);
  const category = deriveCategory(family, order);

  // Backfill path: enrich existing entry without touching the image.
  if (existing) {
    const updated: StoredBird = {
      ...existing,
      family,
      order,
      category,
      conservation_status: detail.conservationStatus,
      establishment_means: detail.establishmentMeans,
    };
    await fs.writeFile(metaPath(existing.scientific_name), JSON.stringify(updated, null, 2));
    return updated;
  }

  // First-time path: download photo + write everything.
  const photoUrl = bestPhotoUrl(taxon.default_photo);
  if (!photoUrl) return null;

  const imgRes = await fetch(photoUrl, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (!imgRes.ok) return null;
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const ext: StoredExt = extFromUrl(photoUrl);

  let summary: string | null = null;
  const wikiTitle = wikiTitleFromUrl(taxon.wikipedia_url) ?? taxon.name;
  if (wikiTitle) summary = await fetchWikiSummary(wikiTitle);

  const meta: StoredBird = {
    common_name: taxon.preferred_common_name ?? commonName,
    scientific_name: taxon.name ?? key,
    source_url: photoUrl,
    attribution: taxon.default_photo?.attribution ?? null,
    license_code: taxon.default_photo?.license_code ?? null,
    wiki_url: taxon.wikipedia_url ?? null,
    summary,
    family,
    order,
    category,
    conservation_status: detail.conservationStatus,
    establishment_means: detail.establishmentMeans,
    fetched_at: new Date().toISOString(),
    ext,
  };
  await writeBird(meta.scientific_name, buf, meta);
  return meta;
}

export type GetBirdInfoOptions = { includeSummary?: boolean };

export async function getBirdInfo(
  commonName: string,
  scientificName?: string | null,
  // includeSummary kept for API compatibility; summary is always cached when present.
  _opts: GetBirdInfoOptions = {},
): Promise<BirdInfo | null> {
  const key = `${commonName}|${scientificName ?? ""}`;
  const cached = memCache.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? TTL_MS : NEG_TTL_MS)) {
    return cached.value;
  }
  if (inflight.has(key)) return inflight.get(key)!;

  const p = (async () => {
    const meta = await ensureCached(commonName, scientificName);
    const value = meta ? metaToInfo(meta) : null;
    memCache.set(key, { at: Date.now(), value });
    return value;
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/** Concurrency-limited batch lookup for the species index. */
export async function getBirdInfoBatch(
  birds: { common_name: string; scientific_name: string | null }[],
  concurrency = 4,
): Promise<(BirdInfo | null)[]> {
  const out: (BirdInfo | null)[] = new Array(birds.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= birds.length) return;
      out[idx] = await getBirdInfo(birds[idx].common_name, birds[idx].scientific_name).catch(
        () => null,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, birds.length) }, worker));
  return out;
}
