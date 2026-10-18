import { useCallback, useEffect, useRef, useState } from "react";
import { requestWelfareCheck, type WelfareCheckResult } from "@/lib/api/roomPanels";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";
import { classifyWriteFailure } from "@/lib/housekeeping/roomPanelErrors";

/* ─── DND wellness-check controller ─────────────────────────────────────────
   The ONE wellness path: POST /rooms/{id}/welfare-check (never POST /tasks as well). The server requires DND to
   be on and answers a repeat request with the task that already exists, so "try again" after an unclear outcome
   cannot create a second task. This never turns DND off and never claims anyone was assigned. */

export type WellnessError = "dnd_off" | "paused" | "forbidden" | "not_found" | "uncertain" | "failed" | "scope_changed";

export interface WellnessController {
  phase: "idle" | "submitting" | "done";
  alreadyRequested: boolean;
  error: WellnessError | null;
  busy: boolean;
  /** DND is on right now according to the live board. */
  eligible: boolean;
  canSubmit: boolean;
  submit: () => Promise<void>;
  reset: () => void;
}

export interface UseRoomWellnessInput {
  room: BoardRoom | null;
  gate: MutationGate;
  scopeKey: string | null;
  refresh: () => Promise<void>;
  request?: (roomId: string) => Promise<WelfareCheckResult>;
}

export function useRoomWellness({ room, gate, scopeKey, refresh, request = requestWelfareCheck }: UseRoomWellnessInput): WellnessController {
  const [phase, setPhase] = useState<WellnessController["phase"]>("idle");
  const [alreadyRequested, setAlready] = useState(false);
  const [error, setError] = useState<WellnessError | null>(null);
  const writing = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ scopeKey, refresh });
  latest.current = { scopeKey, refresh };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const roomId = room?.roomId ?? null;
  const eligible = Boolean(room?.dnd);

  const reset = useCallback(() => {
    setPhase("idle");
    setAlready(false);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (writing.current || roomId === null || phase === "done") return;
    if (!eligible) return setError("dnd_off");
    if (!gate.allowed) return setError("paused");
    const started = scopeKey;
    if (started === null) return setError("scope_changed");
    const sameScope = () => mounted.current && latest.current.scopeKey === started;
    writing.current = true;
    setPhase("submitting");
    setError(null);
    try {
      const result = await request(roomId);
      writing.current = false;
      if (!sameScope()) return;
      setAlready(result.alreadyRequested);
      setPhase("done");
      void latest.current.refresh().catch(() => undefined);
    } catch (failure) {
      writing.current = false;
      if (!sameScope()) return;
      setPhase("idle");
      const kind = classifyWriteFailure(failure);
      if (kind === "conflict") {
        setError("dnd_off");
        void latest.current.refresh().catch(() => undefined);
      } else if (kind === "forbidden") setError("forbidden");
      else if (kind === "not_found") setError("not_found");
      else if (kind === "uncertain") setError("uncertain");
      else setError("failed");
    }
  }, [roomId, phase, eligible, gate.allowed, scopeKey, request]);

  return { phase, alreadyRequested, error, busy: phase === "submitting", eligible, canSubmit: eligible && gate.allowed && phase === "idle", submit, reset };
}
