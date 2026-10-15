import { useEffect, useState } from "react";
import type { ShiftBriefing } from "@/lib/ai/briefing";
import type { Provenance } from "@/lib/ai/contract";
import { briefingCache, getPublishedBriefing, subscribeBriefing } from "@/lib/ai/shiftBriefingSource";
import { reconcileBriefing } from "@/lib/housekeeping/homeBriefing";

export interface SharedBriefingView {
  briefing: ShiftBriefing;
  /** "ai" only while a stored AI answer agreed with the authoritative order; otherwise "deterministic". */
  provenance: Extract<Provenance, "deterministic" | "ai">;
}

/**
 * The briefing to show right now for this person, read-only. The plan is always Home's own; a stored AI
 * answer can only reword it (and is dropped if it disagrees or names a room that may not be recommended).
 * Reading never starts a request, so any surface may call this as often as it likes.
 */
export function readSharedBriefing(scope: string | null): SharedBriefingView | null {
  const published = getPublishedBriefing();
  if (!scope || !published || !published.key.startsWith(`${scope}:`)) return null;
  const ai = briefingCache.get(published.key);
  const shown = ai
    ? reconcileBriefing(ai, published.local, published.knownRooms, published.restrictedRooms)
    : published.local;
  return { briefing: shown, provenance: shown.source === "ai" ? "ai" : "deterministic" };
}

export function useSharedBriefing(scope: string | null): SharedBriefingView | null {
  const [view, setView] = useState<SharedBriefingView | null>(() => readSharedBriefing(scope));
  useEffect(() => {
    setView(readSharedBriefing(scope));
    return subscribeBriefing(() => setView(readSharedBriefing(scope)));
  }, [scope]);
  return view;
}
