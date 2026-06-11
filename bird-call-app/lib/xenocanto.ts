// xeno-canto API v3 (https://xeno-canto.org/api/3/recordings) — fetch a known
// reference recording for a species so you know what you're listening for when
// validating captured clips. Needs a key (XENOCANTO_KEY) from a registered
// xeno-canto account. Degrades to null without a key / on error.
import { promises as fs } from "fs";
import path from "path";
import { CACHE_DIR } from "./birdStore";

const KEY = process.env.XENOCANTO_KEY;
const BASE = "https://xeno-canto.org/api/3/recordings";
const DIR = path.join(CACHE_DIR, "xenocanto");
const TTL = 30 * 24 * 3600 * 1000; // 30 days

export const XC_ENABLED = !!KEY;

export type RefRecording = {
  audioUrl: string;
  recordist: string | null;
  license: string | null; // license URL
  pageUrl: string | null;
  type: string | null; // "song" | "call" | ...
  country: string | null;
  quality: string | null; // "A".."E"
  englishName: string | null;
  xcId: string | null;
};

function safeKey(sci: string): string {
  return sci.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function abs(u: string | undefined | null): string | null {
  if (!u) return null;
  return u.startsWith("//") ? `https:${u}` : u;
}

export async function getReferenceRecording(
  scientificName: string | null,
): Promise<RefRecording | null> {
  if (!KEY || !scientificName) return null;
  const parts = scientificName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const [genus, species] = parts;

  const cacheFile = path.join(DIR, `${safeKey(scientificName)}.json`);
  try {
    const stat = await fs.stat(cacheFile);
    if (Date.now() - stat.mtimeMs < TTL) {
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
      return cached?.miss ? null : (cached as RefRecording);
    }
  } catch {
    /* not cached yet */
  }

  try {
    // Grade-A bird recordings for the species; prefer song, then call.
    const q = `gen:"${genus}" sp:"${species}" grp:birds q:A`;
    const url = `${BASE}?query=${encodeURIComponent(q)}&per_page=30&key=${encodeURIComponent(KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`xeno-canto ${res.status}`);
    const body = await res.json();
    const recs: Record<string, unknown>[] = Array.isArray(body?.recordings) ? body.recordings : [];

    const typeStr = (r: Record<string, unknown>) => String(r.type ?? "").toLowerCase();
    const pick =
      recs.find((r) => typeStr(r).includes("song")) ??
      recs.find((r) => typeStr(r).includes("call")) ??
      recs[0];

    if (!pick) {
      await writeCache(cacheFile, { miss: true });
      return null;
    }

    const audioUrl = abs((pick.file as string) ?? (pick["file-name"] as string));
    if (!audioUrl) {
      await writeCache(cacheFile, { miss: true });
      return null;
    }
    const result: RefRecording = {
      audioUrl,
      recordist: (pick.rec as string) ?? null,
      license: abs(pick.lic as string),
      pageUrl: abs(pick.url as string),
      type: (pick.type as string) ?? null,
      country: (pick.cnt as string) ?? null,
      quality: (pick.q as string) ?? null,
      englishName: (pick.en as string) ?? null,
      xcId: pick.id != null ? String(pick.id) : null,
    };
    await writeCache(cacheFile, result);
    return result;
  } catch {
    return null;
  }
}

async function writeCache(file: string, data: unknown): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
  } catch {
    /* cache is best-effort */
  }
}
