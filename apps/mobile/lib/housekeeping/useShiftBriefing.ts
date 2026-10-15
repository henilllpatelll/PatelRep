import { useCallback, useEffect, useRef, useState } from "react";
import { fetchShiftBriefing, type ShiftBriefing } from "@/lib/ai/briefing";
import { createAiCache } from "@/lib/housekeeping/aiCache";
import type { Room } from "@/stores/appStore";

/** A briefing is good for the morning's planning; it is reused, not re-bought, until it is this old. */
const BRIEFING_TTL_MS = 45 * 60_000;
const briefingCache = createAiCache<ShiftBriefing>(BRIEFING_TTL_MS);

export type AiRequestStatus = "idle" | "loading" | "offline" | "unavailable";

export interface BriefingController {
  /** The AI's answer, when there is a fresh one. The deterministic plan never depends on it. */
  ai: ShiftBriefing | null;
  status: AiRequestStatus;
  /** A deliberate request. With `force` it skips the stored answer ("New briefing"). */
  request: (options?: { force?: boolean }) => Promise<void>;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Options {
  /** `${tenantId}:${userId}`; briefings never carry across people or hotels. */
  scope: string | null;
  shiftDate: string;
  language: "en" | "es";
  rooms: Room[];
  isOnline: boolean;
  t: Translate;
}

/**
 * The optional AI shift briefing. Nothing here runs by itself: mounting,
 * refreshing and switching tabs never spend a credit. `request` is the one way in,
 * a second call while one is running shares it, and a failed or timed-out
 * request is reported as unavailable (and never stored as if it were an answer).
 */
export function useShiftBriefing({ scope, shiftDate, language, rooms, isOnline, t }: Options): BriefingController {
  const key = scope ? `${scope}:${shiftDate}:${language}` : null;
  const [ai, setAi] = useState<ShiftBriefing | null>(() => (key ? briefingCache.get(key) : null));
  const [status, setStatus] = useState<AiRequestStatus>(() => (key && briefingCache.pending(key) ? "loading" : "idle"));
  const keyRef = useRef(key);
  keyRef.current = key;
  const latest = useRef({ rooms, t, language, isOnline });
  latest.current = { rooms, t, language, isOnline };

  useEffect(() => {
    setAi(key ? briefingCache.get(key) : null);
    setStatus(key && briefingCache.pending(key) ? "loading" : "idle");
  }, [key]);

  const request = useCallback(async (options?: { force?: boolean }) => {
    const myKey = keyRef.current;
    if (!myKey) return;
    const { rooms: current, t: translate, language: lang, isOnline: online } = latest.current;
    if (!online) {
      setStatus("offline");
      return;
    }
    if (current.length === 0) return;
    setStatus("loading");
    try {
      const result = await briefingCache.run(
        myKey,
        async () => {
          const answer = await fetchShiftBriefing(current, lang, translate, true);
          // fetchShiftBriefing falls back to a local plan on any failure; that is not an AI answer.
          if (answer.source !== "ai") throw new Error("ai unavailable");
          return answer;
        },
        { force: options?.force },
      );
      if (keyRef.current !== myKey) return;
      setAi(result);
      setStatus("idle");
    } catch {
      if (keyRef.current !== myKey) return;
      setStatus("unavailable");
    }
  }, []);

  return { ai, status, request };
}

/** Test seam: forget stored briefings. */
export function resetBriefingCache(): void {
  briefingCache.clear();
}
