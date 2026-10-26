import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBatchPublication, publishAssignmentBatch, type BatchPublishRequest } from "@/lib/api/housekeepingSupervisor";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  classifyBatchFailure,
  matchesRequest,
  newOperationId,
  parseBatchPublication,
  readBatchCheck,
  toBatchRequest,
  type BatchConflict,
  type BatchFailure,
  type BatchPublication,
  type BatchRequestRefusal,
} from "@/lib/housekeeping/assignmentBatch";
import type { PlannedChange } from "@/lib/housekeeping/assignmentPlan";
import { clearPending, readPending, writePending } from "@/lib/housekeeping/publishJournal";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";

/* ─── Atomic publication — the state machine ────────────────────────────────
   Publishes a reviewed draft through the server's all-or-nothing endpoint and reports ONLY what the server proved.

       idle ──► publishing ──► committed          (the server confirmed; counts come from ITS answer)
                           ├─► rejected           (the server refused: NOTHING was written; the draft is kept)
                           └─► unknown            (no answer: it may or may not have committed)
       unknown ──► (read-only check) ──► committed | still unknown | "not published yet" ──► send the SAME operation again

   GUARANTEES
   - One publication at a time, enforced by a ref (two taps in one tick send one request), not just a disabled button.
   - ONE OPERATION ID PER DRAFT CONTENT. A retry of the same changes re-sends the same id (the server then answers with
     the original result instead of repeating anything); a new id is made only after the server DEFINITELY refused, or
     when the changes themselves changed. An unclear outcome is never answered by a different operation.
   - An unclear outcome is never "not published" and never "published": it is read back with a read-only request.
     `not_found` means "not committed as of this read", so the only forward step is the SAME operation again.
   - The operation id is written to the journal before the request leaves, so an app killed mid-publish can still find
     out what became of it. The journal is removed the moment the outcome is known.
   - A confirmed commit stays confirmed when the refresh that follows fails: that is reported separately.
   - Nothing is queued: offline or an unverified board means nothing is sent, and nothing is sent twice. */

export type CheckState = "unchecked" | "not_found" | "unreadable" | "failed";

export type PublicationState =
  | { kind: "idle" }
  | { kind: "publishing"; operationId: string; changeCount: number }
  | { kind: "committed"; publication: BatchPublication; refresh: "pending" | "ok" | "failed" }
  | { kind: "rejected"; failure: Extract<BatchFailure, { kind: "not_applied" }>; conflicts: BatchConflict[] }
  | { kind: "unknown"; operationId: string; changeCount: number; checking: boolean; check: CheckState; recovered: boolean };

/** Why nothing was sent. */
export type PublishRefusal = "paused" | "busy" | "unresolved" | BatchRequestRefusal;

export interface BatchPublicationController {
  state: PublicationState;
  /** A request is in flight or a read-only check is running. */
  working: boolean;
  /** Sends the reviewed changes. Resolves with why nothing was sent, or null when the attempt ran. */
  publish: (changes: readonly PlannedChange[], hotelDate: string) => Promise<PublishRefusal | null>;
  /** After "not published yet": sends the same operation again (same id, same changes). */
  sendAgain: () => Promise<PublishRefusal | null>;
  /** Read-only: asks the server what became of an unclear publication. Never writes. */
  checkResult: () => Promise<void>;
  /** Back to idle (dismisses a result). Ignored while sending or while an outcome is unclear. */
  dismiss: () => void;
  /**
   * Gives up on a publication the server has NO record of, when this device holds nothing to send again (the app
   * was restarted). Only allowed after a read-only check answered "not found"; it forgets the journal, nothing more.
   */
  abandon: () => void;
  /** The changes behind an unclear outcome are the only ones that may be sent next. */
  lockedToOperation: boolean;
}

interface Inputs {
  model: AssignmentsModel;
  gate: MutationGate;
  isOnline: boolean;
  refresh: () => Promise<void>;
  scopeKey: string | null;
  /** Called once when the server has confirmed a commit, so the draft that produced it can be cleared. */
  onCommitted?: (publication: BatchPublication) => void;
  /** Test seam: lets React commit after a refresh before the model is inspected. */
  settle?: () => Promise<void>;
}

const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function caughtUp(model: AssignmentsModel, publication: BatchPublication): boolean {
  if (model.availability.kind !== "ready" && model.availability.kind !== "verified_empty") return false;
  const byRoom = new Map((model.rooms ?? []).map((entry) => [entry.room.roomId, entry.ownership.userId] as const));
  return publication.rooms.every((room) => byRoom.has(room.roomId) && byRoom.get(room.roomId) === room.assignedTo);
}

interface Attempt {
  request: BatchPublishRequest;
  signature: string;
  changes: PlannedChange[];
}

export function useBatchPublication({ model, gate, isOnline, refresh, scopeKey, onCommitted, settle = defaultSettle }: Inputs): BatchPublicationController {
  const [state, setState] = useState<PublicationState>({ kind: "idle" });
  const latest = useRef({ model, gate, isOnline, scopeKey, state });
  latest.current = { model, gate, isOnline, scopeKey, state };
  const committedRef = useRef(onCommitted);
  committedRef.current = onCommitted;
  const working = useRef(false);
  const mounted = useRef(true);
  /** The operation id in use and the changes it was made for. Reset after a definite refusal or a commit. */
  const operation = useRef<{ id: string; signature: string } | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Another hotel or person: nothing of the previous one's publication belongs on this screen.
  const lastScope = useRef(scopeKey);
  useEffect(() => {
    if (lastScope.current === scopeKey) return;
    lastScope.current = scopeKey;
    operation.current = null;
    attempt.current = null;
    setState({ kind: "idle" });
  }, [scopeKey]);

  const begin = () => {
    working.current = true;
    setBusy(true);
  };
  const end = () => {
    working.current = false;
    if (mounted.current) setBusy(false);
  };

  /** The server confirmed a commit: show it, then (separately) learn whether the board caught up. */
  const confirmed = useCallback(
    async (publication: BatchPublication, scope: string | null) => {
      if (scope) await clearPending(scope);
      operation.current = null;
      attempt.current = null;
      if (!mounted.current || latest.current.scopeKey !== scope) return;
      setState({ kind: "committed", publication, refresh: "pending" });
      committedRef.current?.(publication);
      await refresh().catch(() => undefined);
      await settle();
      if (!mounted.current) return;
      const ok = caughtUp(latest.current.model, publication);
      setState((current) => (current.kind === "committed" && current.publication.operationId === publication.operationId ? { ...current, refresh: ok ? "ok" : "failed" } : current));
    },
    [refresh, settle],
  );

  const toUnknown = useCallback((operationId: string, changeCount: number, recovered: boolean, check: CheckState = "unchecked") => {
    setState({ kind: "unknown", operationId, changeCount, checking: false, check, recovered });
  }, []);

  const checkResult = useCallback(async () => {
    const start = latest.current;
    const current = start.state;
    if (current.kind !== "unknown" || working.current) return;
    begin();
    const scope = start.scopeKey;
    setState({ ...current, checking: true });
    try {
      let outcome: ReturnType<typeof readBatchCheck>;
      try {
        outcome = readBatchCheck(await fetchBatchPublication(current.operationId), current.operationId);
      } catch {
        if (mounted.current) setState({ ...current, checking: false, check: "failed" });
        return;
      }
      if (!mounted.current || latest.current.scopeKey !== scope) return;
      if (outcome.kind === "committed") {
        const asked = attempt.current?.changes;
        // If we still hold the changes, the committed result must be the one we asked for.
        if (asked && !matchesRequest(outcome.publication, asked)) {
          setState({ ...current, checking: false, check: "unreadable" });
          return;
        }
        await confirmed(outcome.publication, scope);
      } else if (outcome.kind === "not_found") {
        setState({ ...current, checking: false, check: "not_found" });
      } else {
        setState({ ...current, checking: false, check: "unreadable" });
      }
    } finally {
      end();
    }
  }, [confirmed]);

  /** Sends `request` once and settles the state from what comes back. */
  const send = useCallback(
    async (current: Attempt): Promise<void> => {
      const scope = latest.current.scopeKey;
      const { request } = current;
      if (scope) await writePending({ operationId: request.operation_id, scopeKey: scope, hotelDate: request.date, changeCount: request.changes.length, startedAt: Date.now() });
      if (mounted.current) setState({ kind: "publishing", operationId: request.operation_id, changeCount: request.changes.length });
      try {
        const raw = await publishAssignmentBatch(request);
        const publication = parseBatchPublication(raw, request.operation_id);
        // A 200 that is not a committed answer for exactly this request is not a confirmation: read it back instead.
        if (!publication || !matchesRequest(publication, current.changes)) {
          if (mounted.current) toUnknown(request.operation_id, request.changes.length, false);
          return;
        }
        await confirmed(publication, scope);
      } catch (error) {
        const failure = classifyBatchFailure(error);
        if (failure.kind === "unknown") {
          // It may have been applied: keep the operation id (and the journal) and let the check decide.
          if (mounted.current) toUnknown(request.operation_id, request.changes.length, false);
          return;
        }
        // The server refused: nothing was written. The id is spent; the next attempt (after the supervisor corrects
        // the draft) is a new operation.
        if (scope) await clearPending(scope);
        operation.current = null;
        if (!mounted.current || latest.current.scopeKey !== scope) return;
        setState({ kind: "rejected", failure, conflicts: failure.conflicts });
        if (failure.reason === "conflict" || failure.reason === "date_changed") await refresh().catch(() => undefined);
      }
    },
    [confirmed, refresh, toUnknown],
  );

  const publish = useCallback(
    async (changes: readonly PlannedChange[], hotelDate: string): Promise<PublishRefusal | null> => {
      const start = latest.current;
      if (working.current) return "busy";
      // An unclear earlier publication must be resolved first: this is never a way around it.
      if (start.state.kind === "unknown" || start.state.kind === "publishing") return "unresolved";
      if (!start.gate.allowed || !start.isOnline) return "paused";
      const probe = toBatchRequest("probe", hotelDate, changes);
      if (!probe.ok) return probe.refusal;
      const signature = JSON.stringify({ date: probe.request.date, changes: probe.request.changes });
      // The same changes keep the same id; different changes are a different operation.
      if (!operation.current || operation.current.signature !== signature) operation.current = { id: newOperationId(), signature };
      const built = toBatchRequest(operation.current.id, hotelDate, changes);
      if (!built.ok) return built.refusal;
      const next: Attempt = { request: built.request, signature, changes: [...changes] };
      attempt.current = next;
      begin();
      try {
        await send(next);
      } finally {
        end();
      }
      return null;
    },
    [send],
  );

  const sendAgain = useCallback(async (): Promise<PublishRefusal | null> => {
    const start = latest.current;
    const held = attempt.current;
    if (working.current) return "busy";
    if (start.state.kind !== "unknown" || !held) return "unresolved";
    if (!start.gate.allowed || !start.isOnline) return "paused";
    begin();
    try {
      await send(held); // the SAME request: the same operation id and the same changes
    } finally {
      end();
    }
    return null;
  }, [send]);

  const dismiss = useCallback(() => {
    const current = latest.current.state;
    if (working.current || current.kind === "publishing" || current.kind === "unknown") return;
    setState({ kind: "idle" });
  }, []);

  const abandon = useCallback(() => {
    const { state: current, scopeKey: scope } = latest.current;
    if (working.current || current.kind !== "unknown" || current.check !== "not_found" || attempt.current) return;
    if (scope) void clearPending(scope);
    operation.current = null;
    setState({ kind: "idle" });
  }, []);

  // Back from a restart (or a lost screen) with a publication in flight: ask the server what became of it.
  useEffect(() => {
    if (!scopeKey) return;
    let cancelled = false;
    void readPending(scopeKey).then((pending) => {
      if (cancelled || !pending || latest.current.state.kind !== "idle" || attempt.current) return;
      toUnknown(pending.operationId, pending.changeCount, true);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, toUnknown]);

  // Whenever an outcome becomes unclear, look it up once, read-only. (Retrying a failed look-up is the supervisor's tap.)
  useEffect(() => {
    if (state.kind === "unknown" && state.check === "unchecked" && !state.checking && !busy) void checkResult();
  }, [state, busy, checkResult]);

  return {
    state,
    working: busy || state.kind === "publishing" || (state.kind === "unknown" && state.checking),
    publish,
    sendAgain,
    checkResult,
    dismiss,
    abandon,
    lockedToOperation: state.kind === "unknown" || state.kind === "publishing",
  };
}
