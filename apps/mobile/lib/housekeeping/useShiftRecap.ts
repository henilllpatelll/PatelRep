import { useCallback, useEffect, useRef, useState } from "react";
import { toCopilotFailure } from "@/lib/ai/contract";
import { fetchShiftRecap, type ShiftRecap } from "@/lib/ai/shiftRecap";
import { createAiCache } from "@/lib/housekeeping/aiCache";
import type { AiRequestStatus } from "@/lib/housekeeping/useShiftBriefing";

const RECAP_TTL_MS = 12 * 60 * 60_000;
const recapCache = createAiCache<ShiftRecap>(RECAP_TTL_MS);

export interface RecapController {
  /** The AI's recap, when there is one. The shift summary stands on its own without it. */
  ai: ShiftRecap | null;
  status: AiRequestStatus;
  /** Only ever called by the person asking for it. */
  request: () => Promise<void>;
}

interface Options {
  /** `${tenantId}:${userId}`: a recap never carries across people or hotels. */
  scope: string | null;
  shiftDate: string;
  language: "en" | "es";
  /** What the finished shift looks like now (see summaryFingerprint); a change drops the stored recap. */
  fingerprint: string;
  isOnline: boolean;
}

function statusFor(error: unknown): AiRequestStatus {
  const failure = toCopilotFailure(error);
  if (failure.kind === "credit_limit" || failure.kind === "rate_limited") return "credits";
  if (failure.kind === "offline") return "offline";
  // The server found no completed work on record to write about; that is not an outage.
  if (failure.kind === "invalid_request" && failure.status === 409) return "insufficient";
  return "unavailable";
}

/**
 * The optional end-of-shift AI recap. Never required for clock-out, never
 * started by opening Home or returning to an ended shift, stored per person,
 * shift date, language and shift fingerprint so asking twice does not buy it
 * twice and a materially changed shift does not show an old recap. The server
 * reads the facts itself, so nothing about the rooms is sent from here.
 */
export function useShiftRecap({ scope, shiftDate, language, fingerprint, isOnline }: Options): RecapController {
  const key = scope ? `${scope}:${shiftDate}:${language}:${fingerprint}` : null;
  const [ai, setAi] = useState<ShiftRecap | null>(() => (key ? recapCache.get(key) : null));
  const [status, setStatus] = useState<AiRequestStatus>(() => (key && recapCache.pending(key) ? "loading" : "idle"));
  const keyRef = useRef(key);
  keyRef.current = key;
  const latest = useRef({ shiftDate, language, isOnline });
  latest.current = { shiftDate, language, isOnline };

  useEffect(() => {
    setAi(key ? recapCache.get(key) : null);
    setStatus(key && recapCache.pending(key) ? "loading" : "idle");
  }, [key]);

  const request = useCallback(async () => {
    const myKey = keyRef.current;
    if (!myKey) return;
    const current = latest.current;
    if (!current.isOnline) {
      setStatus("offline");
      return;
    }
    setStatus("loading");
    try {
      const result = await recapCache.run(myKey, () => fetchShiftRecap({ shiftDate: current.shiftDate, language: current.language }));
      if (keyRef.current !== myKey) return;
      setAi(result);
      setStatus("idle");
    } catch (error) {
      if (keyRef.current !== myKey) return;
      setStatus(statusFor(error));
    }
  }, []);

  return { ai, status, request };
}

export function resetRecapCache(): void {
  recapCache.clear();
}
