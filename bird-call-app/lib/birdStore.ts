import { promises as fs } from "fs";
import path from "path";

export const CACHE_DIR =
  process.env.BIRD_CACHE_DIR ?? path.join(process.cwd(), "data", "birds");

export type StoredExt = "jpg" | "png" | "webp" | "gif";

import type { BirdCategory } from "./categories";

export type StoredBird = {
  common_name: string;
  scientific_name: string;
  source_url: string;
  attribution: string | null;
  license_code: string | null;
  wiki_url: string | null;
  summary: string | null;
  family: string | null;
  order: string | null;
  category: BirdCategory | null;
  // IUCN code: LC, NT, VU, EN, CR, EW, EX, DD. null when iNat has no entry (usually means LC).
  conservation_status: string | null;
  // "native" | "introduced" | "endemic" | "naturalised" | etc., for the configured place.
  establishment_means: string | null;
  fetched_at: string;
  ext: StoredExt;
};

/** Filesystem-safe key derived from scientific name. */
export function safeKey(scientificName: string): string {
  return scientificName.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function imagePath(scientificName: string, ext: StoredExt): string {
  return path.join(CACHE_DIR, `${safeKey(scientificName)}.${ext}`);
}

export function metaPath(scientificName: string): string {
  return path.join(CACHE_DIR, `${safeKey(scientificName)}.json`);
}

export async function readMeta(scientificName: string): Promise<StoredBird | null> {
  try {
    const buf = await fs.readFile(metaPath(scientificName), "utf8");
    return JSON.parse(buf) as StoredBird;
  } catch {
    return null;
  }
}

export async function readImage(
  scientificName: string,
  ext: StoredExt,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(imagePath(scientificName, ext));
  } catch {
    return null;
  }
}

export async function writeBird(
  scientificName: string,
  imageBuf: Buffer,
  meta: StoredBird,
): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(imagePath(scientificName, meta.ext), imageBuf);
  await fs.writeFile(metaPath(scientificName), JSON.stringify(meta, null, 2));
}

export function contentTypeFor(ext: StoredExt): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

export function extFromUrl(url: string): StoredExt {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".png")) return "png";
  if (u.endsWith(".webp")) return "webp";
  if (u.endsWith(".gif")) return "gif";
  return "jpg";
}
