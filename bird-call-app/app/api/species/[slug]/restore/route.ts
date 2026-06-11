import { NextRequest, NextResponse } from "next/server";
import { restoreSpecies, unslugifySpecies } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  try {
    await restoreSpecies(unslugifySpecies(slug));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
