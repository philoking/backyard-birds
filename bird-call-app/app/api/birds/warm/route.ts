import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureCached } from "@/lib/birds";

export const dynamic = "force-dynamic";

type Row = { common_name: string; scientific_name: string | null };

export async function POST() {
  const species = await sql<Row[]>`
    SELECT
      common_name,
      MAX(scientific_name) AS scientific_name
    FROM detections
    WHERE common_name IS NOT NULL
    GROUP BY common_name
    ORDER BY common_name
  `;

  const results = {
    total: species.length,
    cached: 0,
    fetched: 0,
    failed: 0,
    failures: [] as string[],
  };

  // Sequential to be polite to iNat (we're fetching from S3 too). 82 birds ≈ 30-60s.
  for (const s of species) {
    try {
      const meta = await ensureCached(s.common_name, s.scientific_name);
      if (meta) {
        // ensureCached returns the same shape whether cached or fetched; check fetch time.
        const fetchedNow = Date.now() - new Date(meta.fetched_at).getTime() < 5000;
        if (fetchedNow) results.fetched++;
        else results.cached++;
      } else {
        results.failed++;
        results.failures.push(s.common_name);
      }
    } catch (e) {
      results.failed++;
      results.failures.push(`${s.common_name} (${(e as Error).message})`);
    }
  }

  return NextResponse.json(results);
}
