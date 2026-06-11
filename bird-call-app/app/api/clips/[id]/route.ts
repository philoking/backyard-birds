import { NextRequest, NextResponse } from "next/server";
import { getClipAudio } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const clipId = Number(id);
  if (!Number.isInteger(clipId) || clipId <= 0) {
    return new NextResponse("Bad clip id", { status: 400 });
  }

  const clip = await getClipAudio(clipId);
  if (!clip) {
    return new NextResponse("Clip not found", { status: 404 });
  }

  const bytes = new Uint8Array(clip.audio);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": clip.mime,
      // Clip bytes never change once written; the table prunes by deleting
      // whole rows, so a given id is immutable for its lifetime.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(bytes.length),
    },
  });
}
