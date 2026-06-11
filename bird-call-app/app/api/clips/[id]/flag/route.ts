import { NextRequest, NextResponse } from "next/server";
import { flagClipFalsePositive } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const clipId = Number(id);
  if (!Number.isInteger(clipId) || clipId <= 0) {
    return NextResponse.json({ ok: false, error: "bad clip id" }, { status: 400 });
  }
  try {
    const result = await flagClipFalsePositive(clipId);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
