import { useCallback, useEffect, useRef, useState } from "react";
import { fetchShiftRecap, type ShiftRecap } from "@/lib/ai/shiftRecap";
import { createAiCache } from "@/lib/housekeeping/aiCache";
import type { AiRequestStatus } from "@/lib/housekeeping/useShiftBriefing";
import type { Room } from "@/stores/appStore";

const RECAP_TTL_MS = 12 * 60 * 60_000;
const recapCache = createAiCache<ShiftRecap>(RECAP_TTL_MS);

export interface RecapController {
  /** The AI's recap, when there is one. The shift summary stands on its own without it. */
  ai: ShiftRecap | null;
  status: AiRequestStatus;
  /** Only ever called by the person asking for it. */
  request: () => Promise<void>;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Options {
  scope: string | null;
  shiftDate: string;
  language: "en" | "es";
  rooms: Room[];
  isOnline: boolean;
  t: Translate;
}

/**
 * The optional end-of-shift AI recap. Never required for clock-out, never
 * started by opening Home or returning to an ended shift, stored per person and
 * shift date so asking twice does not buy it twice. A local-fallback answer is
 * not an AI recap, so it is reported as unavailable rather than shown as one.
 */
export function useShiftRecap({ scope, shiftDate, language, rooms, isOnline, t }: Options): RecapController {
  const key = scope ? `${scope}:${shiftDate}:${language}` : null;
  const [ai, setAi] = useState<ShiftRecap | null>(() => (key ? recapCache.get(key) : null));
  const [status, setStatus] = useState<AiRequestStatus>(() => (key && recapCache.pending(key) ? "loading" : "idle"));
  const keyRef = useRef(key);
  keyRef.current = key;
  const latest = useRef({ rooms, t, language, isOnline });
  latest.current = { rooms, t, language, isOnline };

  useEffect(() => {
    setAi(key ? recapCache.get(key) : null);
    setStatus(key && recapCache.pending(key) ? "loading" : "idle");
  }, [key]);

  const request = useCallback(async () => {
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
      const result = await recapCache.run(myKey, async () => {
        const answer = await fetchShiftRecap(current, lang, translate, true);
        if (answer.source !== "ai") throw new Error("ai unavailable");
        return answer;
      });
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

export function resetRecapCache(): void {
  recapCache.clear();
}
