import { NextRequest, NextResponse } from "next/server";
import {
  readMeta,
  readImage,
  contentTypeFor,
} from "@/lib/birdStore";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sci: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { sci } = await params;
  const scientificName = decodeURIComponent(sci);

  const meta = await readMeta(scientificName);
  if (!meta) {
    return new NextResponse("Not cached. Render a page that uses this species first.", {
      status: 404,
    });
  }

  const buf = await readImage(scientificName, meta.ext);
  if (!buf) {
    return new NextResponse("Image file missing", { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(meta.ext),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(buf.length),
    },
  });
}
