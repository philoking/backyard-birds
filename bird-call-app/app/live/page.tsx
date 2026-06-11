import { getRecent } from "@/lib/queries";
import LiveFeed from "./LiveFeed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LivePage() {
  const initial = await getRecent(50);
  // Convert Date objects to strings for serialization to client
  const serialized = initial.map((r) => ({
    id: r.id,
    ts: r.ts.toISOString(),
    camera: r.camera,
    common_name: r.common_name,
    scientific_name: r.scientific_name,
    confidence: r.confidence,
  }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Live feed</h1>
        <p className="text-sm text-[color:var(--muted)]">
          New detections appear as BirdNET logs them. Polls every 5 seconds.
        </p>
      </header>
      <LiveFeed initial={serialized} />
    </div>
  );
}
