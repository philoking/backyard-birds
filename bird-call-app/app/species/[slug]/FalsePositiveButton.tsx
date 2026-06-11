"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FalsePositiveButton({ clipId }: { clipId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function flag() {
    if (busy) return;
    if (!window.confirm("Mark this clip as a false positive? It will be removed.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clips/${clipId}/flag`, { method: "POST" });
      const data = await res.json();
      if (data?.suppressed) {
        window.alert(
          `Flagged ${data.flag_count}× — "${data.common_name}" is now hidden from all stats. ` +
            `You can restore it from the Species page.`,
        );
      }
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={flag}
      disabled={busy}
      title="Mark as false positive (removes this clip)"
      className="text-[10px] text-[color:var(--muted)] hover:text-red-300 disabled:opacity-50 whitespace-nowrap"
    >
      {busy ? "…" : "✕ not this bird"}
    </button>
  );
}
