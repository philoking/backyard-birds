import { NextRequest, NextResponse } from "next/server";
import { dismissSpecies, unslugifySpecies } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  try {
    await dismissSpecies(unslugifySpecies(slug));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
