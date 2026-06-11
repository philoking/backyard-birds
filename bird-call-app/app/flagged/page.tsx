import {
  getFlaggedSpecies,
  getClipSpeciesByDetections,
  getClipsForSpecies,
  getDismissedSpecies,
  SUPPRESS_THRESHOLD,
} from "@/lib/queries";
import { getSpeciesEbird, isUnderReportedNearby, ebirdNearbyLabel } from "@/lib/ebird";
import { getReferenceRecording } from "@/lib/xenocanto";
import { getBirdInfoBatch } from "@/lib/birds";
import FlaggedReview from "./FlaggedReview";
import ReviewCards, { type ReviewItem } from "./ReviewCards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// A "suspect" is a species we've captured clips for that eBird does NOT consider
// commonly reported nearby (see isUnderReportedNearby) — we hear it but birders
// rarely report it close by (a likely misID, or something genuinely notable).
// Distinct clip-species is small, so we check them all.
const CHECK_LIMIT = 250;
const MAX_CARDS = 12;

async function getSuspects(): Promise<ReviewItem[]> {
  const [allCandidates, dismissed] = await Promise.all([
    getClipSpeciesByDetections(1, CHECK_LIMIT),
    getDismissedSpecies(),
  ]);
  const dismissedSet = new Set(dismissed);
  const candidates = allCandidates.filter((c) => !dismissedSet.has(c.common_name));
  if (candidates.length === 0) return [];

  const ebirds = await Promise.all(
    candidates.map((c) => getSpeciesEbird(c.scientific_name, c.common_name)),
  );
  const suspects = candidates
    .map((c, i) => ({ ...c, ebird: ebirds[i] }))
    .filter((s) => isUnderReportedNearby(s.ebird))
    .sort((a, b) => b.detections - a.detections)
    .slice(0, MAX_CARDS);
  if (suspects.length === 0) return [];

  const [clipRows, infos, refs] = await Promise.all([
    getClipsForSpecies(suspects.map((s) => s.common_name)),
    getBirdInfoBatch(
      suspects.map((s) => ({ common_name: s.common_name, scientific_name: s.scientific_name })),
      8,
    ),
    Promise.all(suspects.map((s) => getReferenceRecording(s.scientific_name))),
  ]);
  const bySpecies = new Map<string, typeof clipRows>();
  for (const c of clipRows) {
    const arr = bySpecies.get(c.common_name) ?? [];
    arr.push(c);
    bySpecies.set(c.common_name, arr);
  }

  return suspects
    .map((s, i) => ({
      common_name: s.common_name,
      ebirdLabel: s.ebird ? ebirdNearbyLabel(s.ebird.locations, s.ebird.capped) : "",
      ebirdLocations: s.ebird?.locations ?? 0,
      thumbnail: infos[i]?.thumbnail ?? null,
      reference: refs[i]
        ? {
            audioUrl: refs[i]!.audioUrl,
            recordist: refs[i]!.recordist,
            license: refs[i]!.license,
            pageUrl: refs[i]!.pageUrl,
          }
        : null,
      clips: (bySpecies.get(s.common_name) ?? []).map((c) => ({
        id: c.id,
        ts: c.ts.toISOString(),
      })),
    }))
    .filter((s) => s.clips.length > 0);
}

export default async function FlaggedPage() {
  const [flagged, suspects] = await Promise.all([getFlaggedSpecies(), getSuspects()]);
  const hidden = flagged.filter((f) => f.suppressed).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Flagged</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Review likely misIDs and manage false positives. {hidden > 0 ? `${hidden} species hidden; ` : ""}
          a species is hidden automatically after {SUPPRESS_THRESHOLD} flags.
        </p>
      </header>

      <ReviewCards items={suspects} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Flagged &amp; hidden</h2>
        <FlaggedReview
          items={flagged.map((f) => ({
            common_name: f.common_name,
            flag_count: f.flag_count,
            suppressed: f.suppressed,
          }))}
          threshold={SUPPRESS_THRESHOLD}
        />
      </div>
    </div>
  );
}
