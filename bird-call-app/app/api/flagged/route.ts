import { NextResponse } from "next/server";
import { getFlaggedCount } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const count = await getFlaggedCount();
  return NextResponse.json({ count });
}
