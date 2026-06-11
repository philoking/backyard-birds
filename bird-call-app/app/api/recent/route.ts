import { NextRequest, NextResponse } from "next/server";
import { getRecent, getDetectionsSince } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);

  const rows = since
    ? await getDetectionsSince(Number(since), limit)
    : await getRecent(limit);

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      camera: r.camera,
      common_name: r.common_name,
      scientific_name: r.scientific_name,
      confidence: r.confidence,
    })),
  });
}
