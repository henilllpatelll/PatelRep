import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchShiftHandoff, submitShiftHandoff } from "@/lib/api/housekeepingSupervisor";
import {
  HANDOFF_NOTES_MAX,
  buildHandoffPayload,
  buildHandoffReport,
  classifyHandoffFailure,
  clearHandoffDraft,
  handoffBlockers,
  loadHandoffDraft,
  materialChanges,
  newHandoffRequestId,
  saveHandoffDraft,
  type EndShiftSummaryPayload,
  type HandoffBlocker,
  type HandoffChangeKey,
  type HandoffFailure,
  type HandoffReport,
  type HandoffStep,
  type SavedHandoff,
} from "@/lib/housekeeping/supervisorHandoff";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";

/* ─── The handoff workflow ──────────────────────────────────────────────────
   Prepare → Review → Confirm → Saved, as one state machine so the sheet only draws.

   - The figures are never typed in: they are rebuilt from the shared Today snapshot on every render.
   - "I have reviewed this" is tied to the exact figures reviewed. If a refresh changes what the report says,
     the acknowledgement is dropped and the person is sent back to Review with a note of what moved.
   - One request at a time (a ref, not state, so a double tap in the same frame cannot send twice).
   - The idempotency key lives in the draft. A request whose answer never arrived is CHECKED against the server
     before anything else is offered; the same key is reused, so even a resend cannot make a second report.
   - Success is only shown for an answer that carries the saved record's id.                                  */

export type Phase = "idle" | "submitting" | "verifying";

/** What the sheet may say went wrong. `notSaved` = checked the server and it has nothing; `verifyFailed` = could not check. */
export type HandoffNotice = HandoffFailure | { kind: "notSaved" } | { kind: "verifyFailed" } | { kind: "notifyFailed" };

export interface UseShiftHandoffOptions {
  today: SupervisorToday;
  refresh: () => Promise<void>;
  /** `${tenantId}:${userId}`; scopes the kept draft to this person at this hotel. */
  scope: string | null;
  isOnline: boolean;
}

export interface ShiftHandoff {
  step: HandoffStep;
  report: HandoffReport;
  blockers: HandoffBlocker[];
  notes: string;
  setNotes: (text: string) => void;
  /** The draft has been read; the notes box is not editable before this so a restored note is never overwritten. */
  ready: boolean;
  acknowledged: boolean;
  setAcknowledged: (checked: boolean) => void;
  /** What moved since the person confirmed; non-empty only until they confirm again. */
  changes: HandoffChangeKey[];
  phase: Phase;
  notice: HandoffNotice | null;
  /** A earlier submit's outcome is unknown and could not be checked yet: Submit stays off until it is. */
  unresolved: boolean;
  saved: SavedHandoff | null;
  refreshing: boolean;
  canSubmit: boolean;
  actions: {
    refresh: () => Promise<void>;
    toReview: () => void;
    toConfirm: () => void;
    back: () => void;
    submit: () => Promise<void>;
    checkAgain: () => Promise<void>;
    notifyAgain: () => Promise<void>;
    discard: () => void;
  };
}

export function useShiftHandoff({ today, refresh, scope, isOnline }: UseShiftHandoffOptions): ShiftHandoff {
  const [step, setStep] = useState<HandoffStep>("prepare");
  const [notes, setNotesState] = useState("");
  const [ready, setReady] = useState(false);
  const [requestId, setRequestId] = useState(newHandoffRequestId);
  const [attempted, setAttempted] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [ackReport, setAckReport] = useState<HandoffReport | null>(null);
  const [changes, setChanges] = useState<HandoffChangeKey[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<HandoffNotice | null>(null);
  const [saved, setSaved] = useState<SavedHandoff | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const busy = useRef(false);
  const mounted = useRef(true);
  const lastPayload = useRef<EndShiftSummaryPayload | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // The latest values for async continuations that outlive a render.
  const live = useRef({ notes, requestId, attempted, scope, notificationPending: false });
  live.current = { ...live.current, notes, requestId, attempted, scope };

  const report = useMemo(() => buildHandoffReport(today), [today]);
  const blockers = useMemo(() => handoffBlockers(report), [report]);
  const complete = blockers.length === 0;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const persist = useCallback(async (patch: Partial<{
    notes: string;
    attempted: boolean;
    notificationPending: boolean;
    recoveryPayload: EndShiftSummaryPayload;
  }> = {}) => {
    const { notes: n, requestId: id, attempted: a, scope: s, notificationPending } = live.current;
    if (!s) return;
    const next = {
      notes: patch.notes ?? n,
      requestId: id,
      attempted: patch.attempted ?? a,
      notificationPending: patch.notificationPending ?? notificationPending,
      recoveryPayload: patch.recoveryPayload ?? lastPayload.current ?? undefined,
      savedAt: Date.now(),
    };
    live.current = { ...live.current, notes: next.notes, attempted: next.attempted, notificationPending: next.notificationPending };
    await saveHandoffDraft(s, next);
  }, []);

  /** Ask the server whether this key was saved. Found → show it; not found → say so; no answer → stay unresolved. */
  const verify = useCallback(async (id: string, options: { announce: boolean }) => {
    setPhase("verifying");
    setNotice(null);
    try {
      const found = await fetchShiftHandoff(id);
      if (!mounted.current) return;
      if (found) {
        const notificationPending = found.managers === "failed" || found.managers === "unknown";
        if (notificationPending) {
          const recoveryPayload = lastPayload.current ?? buildHandoffPayload(report, live.current.notes, id);
          if (recoveryPayload) lastPayload.current = recoveryPayload;
          await persist({ attempted: false, notificationPending: true, ...(recoveryPayload ? { recoveryPayload } : {}) });
        } else if (live.current.scope) {
          await clearHandoffDraft(live.current.scope);
        }
        setSaved({ ...found, replay: true });
        setAttempted(false);
        setUnresolved(false);
        setStep("saved");
      } else {
        setAttempted(false);
        setUnresolved(false);
        await persist({ attempted: false });
        if (options.announce) setNotice({ kind: "notSaved" });
      }
    } catch {
      if (!mounted.current) return;
      setUnresolved(true);
      setNotice({ kind: "verifyFailed" });
    } finally {
      if (mounted.current) setPhase("idle");
    }
  }, [persist, report]);

  // Open: restore the kept draft (note + key), settle any unknown earlier submit, and ask for fresh figures.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = scope ? await loadHandoffDraft(scope) : null;
      if (cancelled) return;
      if (draft) {
        setNotesState(draft.notes);
        setRequestId(draft.requestId);
        setAttempted(draft.attempted);
        lastPayload.current = draft.recoveryPayload ?? null;
        live.current = {
          ...live.current,
          notes: draft.notes,
          requestId: draft.requestId,
          attempted: draft.attempted,
          notificationPending: draft.notificationPending,
        };
      }
      setReady(true);
      if (draft?.attempted && isOnline) await verify(draft.requestId, { announce: false });
      else if (draft?.attempted) setUnresolved(true);
      else if (draft?.notificationPending && isOnline) await verify(draft.requestId, { announce: false });
    })();
    return () => {
      cancelled = true;
    };
    // Once per open (the sheet only mounts while open); `isOnline` at open time is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (isOnline) void refreshRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the note on this phone while it is being written (a call, an app switch, a crash).
  useEffect(() => {
    if (!ready || step === "saved") return;
    const timer = setTimeout(() => void persist(), 300);
    return () => clearTimeout(timer);
  }, [ready, step, notes, persist]);

  const setNotes = useCallback((text: string) => setNotesState(text.slice(0, HANDOFF_NOTES_MAX)), []);

  const acknowledged = ackReport !== null;

  // Figures moved after the person confirmed: drop the confirmation and say what changed. Only judged against
  // a COMPLETE report, so a flicker in connectivity (sources briefly unverified) reads as "blocked", not "changed".
  useEffect(() => {
    if (!ackReport || !complete || (step !== "review" && step !== "confirm")) return;
    const moved = materialChanges(ackReport, report);
    if (moved.length === 0) return;
    setAckReport(null);
    setChanges(moved);
    setStep("review");
  }, [ackReport, report, complete, step]);

  const setAcknowledged = useCallback(
    (checked: boolean) => {
      setChanges([]);
      setAckReport(checked && complete ? report : null);
    },
    [complete, report],
  );

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshRef.current();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  const toReview = useCallback(() => {
    if (!complete || unresolved) return;
    setNotice(null);
    setChanges([]);
    setAckReport(null);
    setStep("review");
    if (isOnline) void refreshRef.current();
  }, [complete, unresolved, isOnline]);

  const toConfirm = useCallback(() => {
    if (!acknowledged || !complete) return;
    setNotice(null);
    setStep("confirm");
  }, [acknowledged, complete]);

  const back = useCallback(() => {
    setNotice(null);
    setStep((current) => (current === "confirm" ? "review" : current === "review" ? "prepare" : current));
  }, []);

  const submit = useCallback(async () => {
    if (busy.current || !isOnline || unresolved || !acknowledged || !complete) return;
    const payload = buildHandoffPayload(report, live.current.notes, live.current.requestId);
    if (!payload) return;
    busy.current = true;
    setPhase("submitting");
    setNotice(null);
    lastPayload.current = payload;
    try {
      // Written BEFORE sending: if the app dies mid-request the next open knows to check the server first.
      setAttempted(true);
      await persist({ attempted: true, notificationPending: false, recoveryPayload: payload });
      const result = await submitShiftHandoff(payload);
      const notificationPending = result.managers === "failed" || result.managers === "unknown";
      if (notificationPending) await persist({ attempted: false, notificationPending: true, recoveryPayload: payload });
      else if (live.current.scope) await clearHandoffDraft(live.current.scope);
      if (!mounted.current) return;
      setAttempted(false);
      setSaved(result);
      setStep("saved");
    } catch (error) {
      if (!mounted.current) return;
      const failure = classifyHandoffFailure(error);
      if (failure.kind === "unconfirmed") {
        setNotice(failure);
        await verify(live.current.requestId, { announce: true });
      } else {
        // The server answered no: nothing was stored, so nothing is waiting to be checked.
        setAttempted(false);
        await persist({ attempted: false });
        setNotice(failure);
        if (failure.kind === "countsChanged") {
          setAckReport(null);
          setStep("review");
          void refreshRef.current();
        }
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPhase((current) => (current === "submitting" ? "idle" : current));
    }
  }, [isOnline, unresolved, acknowledged, complete, report, persist, verify]);

  const checkAgain = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await verify(live.current.requestId, { announce: true });
    } finally {
      busy.current = false;
    }
  }, [verify]);

  /** The report is saved but the managers were not told: re-send the SAME request, which only finishes the notices. */
  const notifyAgain = useCallback(async () => {
    const payload = lastPayload.current;
    if (busy.current || !payload || !isOnline) return;
    busy.current = true;
    setPhase("submitting");
    setNotice(null);
    try {
      const result = await submitShiftHandoff(payload);
      const notificationPending = result.managers === "failed" || result.managers === "unknown";
      if (notificationPending) await persist({ attempted: false, notificationPending: true, recoveryPayload: payload });
      else if (live.current.scope) await clearHandoffDraft(live.current.scope);
      if (mounted.current) {
        setSaved(result);
        if (result.managers === "failed") setNotice({ kind: "notifyFailed" });
      }
    } catch {
      if (mounted.current) setNotice({ kind: "notifyFailed" });
    } finally {
      busy.current = false;
      if (mounted.current) setPhase("idle");
    }
  }, [isOnline, persist]);

  /** Drop the note. A submit whose outcome is still unknown keeps its marker so it is checked next time. */
  const discard = useCallback(() => {
    const { attempted: a, scope: s, requestId: id } = live.current;
    if (!s) return;
    if (a) void saveHandoffDraft(s, { notes: "", requestId: id, attempted: true, notificationPending: false, savedAt: Date.now() });
    else void clearHandoffDraft(s);
  }, []);

  return {
    step,
    report,
    blockers,
    notes,
    setNotes,
    ready,
    acknowledged,
    setAcknowledged,
    changes,
    phase,
    notice,
    unresolved,
    saved,
    refreshing,
    canSubmit: isOnline && !unresolved && acknowledged && complete && phase === "idle",
    actions: { refresh: doRefresh, toReview, toConfirm, back, submit, checkAgain, notifyAgain, discard },
  };
}
