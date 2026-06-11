import { getAllSpecies } from "@/lib/queries";
import { getBirdInfoBatch } from "@/lib/birds";
import { resolveRange } from "@/lib/timeRange";
import SpeciesIndex, { type SpeciesRow } from "./SpeciesIndex";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
};

export default async function SpeciesIndexPage({ searchParams }: Props) {
  const range = resolveRange(await searchParams);
  const all = await getAllSpecies(range);
  const infos = await getBirdInfoBatch(all, 8);

  const rows: SpeciesRow[] = all.map((s, i) => ({
    common_name: s.common_name,
    scientific_name: s.scientific_name,
    detections: s.detections,
    last_seen: typeof s.last_seen === "string" ? s.last_seen : s.last_seen.toISOString(),
    thumbnail: infos[i]?.thumbnail ?? null,
    category: infos[i]?.category ?? null,
  }));

  return <SpeciesIndex species={rows} rangeLabel={range.label} />;
}
