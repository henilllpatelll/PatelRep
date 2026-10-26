import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBoardVerified, removeAssignmentGuarded, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import {
  acksSatisfied,
  buildAssignPicker,
  buildAssignReview,
  buildRemovalReview,
  softAcksOf,
  sortAcks,
  type AssignAck,
  type AssignPicker,
  type AssignReview,
  type PickerFilter,
  type RemovalReview,
} from "@/lib/housekeeping/assignmentPicker";
import { buildConflictView, classifyWrite, detectLiveConflict, type ConflictReason, type ConflictView } from "@/lib/housekeeping/assignmentFlow";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { planChange, toSaveRequests, type PlanRejection } from "@/lib/housekeeping/assignmentPlan";
import { expectedOwnerId } from "@/lib/housekeeping/assignmentOwnership";
import { judgeOutcome, type AssignmentFailure } from "@/lib/housekeeping/roomAssignment";
import { normalizeBoardRecords, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";

/* ─── Single-room assignment controller (Assignments V2) ─────────────────────
   ONE state machine for assign, reassign and remove of ONE room, rendered by one sheet:

       picker ──► review ──► (write) ──► outcome:  applied | conflict | unknown
       remove ──────────────► (write) ──► outcome:  applied | conflict | unknown

   WHAT IT GUARANTEES
   - Choosing a person never saves. A write happens only from `confirm`, only from the review/remove step, only with
     every required acknowledgement given, and only once at a time (`writing` is a ref: a second press in the same
     tick is ignored, not just disabled).
   - The write carries the owner the supervisor SAW (`toSaveRequests` / `removeAssignmentGuarded`), so the SERVER
     refuses with 409 instead of overwriting a newer owner. This hook does not pretend a client-side read makes
     that race-free; it reads only to EXPLAIN a refusal and to settle an unclear outcome.
   - "Saved" is shown only after the server answered 2xx — or after a read-back proves it. A 4xx means nothing was
     written. A lost connection, a timeout or a 5xx may have been applied: it is NEVER retried; the room is read
     back, and if even that fails the sheet says "Checking assignment result" and offers a read-only check.
   - A confirmed write whose refresh then fails stays a confirmed write; the failed refresh is reported separately.
   - The flow follows the room by id through the LIVE verified model. A room that changed hands, started being
     cleaned, left the board or gained a new condition while the sheet was open becomes a conflict view, never a
     silent overwrite; "Refresh and review" rebuilds the review from a newly verified snapshot.
   - Another hotel, another person or the next hotel day closes the flow instead of writing into the wrong scope. */

export type FlowStep = "picker" | "review" | "remove";
export type FlowAction = "assign" | "reassign" | "remove";

/** A reason the confirm did nothing (or the write was refused for a reason other than a conflict). */
export type FlowError =
  | AssignmentFailure
  | "paused"
  | "blocked"
  | "not_ready"
  | "still_unknown"
  | "acks_missing";

export type FlowOutcome =
  | {
      kind: "applied";
      action: FlowAction;
      roomNumber: string;
      toName: string | null;
      /** Whether the shared snapshot has caught up with the write: pending, refreshed, or the refresh failed. */
      refresh: "pending" | "ok" | "failed";
    }
  | { kind: "conflict"; reason: ConflictReason }
  | { kind: "unknown"; action: FlowAction };

interface Attempt {
  action: FlowAction;
  roomNumber: string;
  toUserId: string | null;
  toName: string | null;
  /** The owner the write asserted (null = unassigned). */
  expectedOwnerId: string | null;
}

export interface AssignmentFlow {
  step: FlowStep;
  roomId: string;
  /** Hotel + person and hotel date the flow opened under; a change closes it. */
  scopeKey: string | null;
  hotelDate: string;
  query: string;
  filter: PickerFilter;
  selectedId: string | null;
  /** The owner the supervisor SAW when the review (or removal) opened. Any later difference is a conflict. */
  reviewedOwnerId: string | null;
  acks: AssignAck[];
  outcome: FlowOutcome | null;
  attempt: Attempt | null;
}

export interface AssignmentFlowController {
  flow: AssignmentFlow | null;
  /** The live room for the open flow; null when it left the board. */
  entry: AssignmentRoom | null;
  picker: AssignPicker | null;
  review: AssignReview | null;
  removal: RemovalReview | null;
  /** Set when the live room no longer matches what was reviewed, or the server refused for that reason. */
  conflict: ConflictView | null;
  busy: boolean;
  /** A read-only check of an unclear outcome is running. */
  checking: boolean;
  error: FlowError | null;
  /** The picker's Continue button. */
  canContinue: boolean;
  /** The review's / removal's Confirm button. */
  canConfirm: boolean;
  openAssign: (roomId: string, options?: { employeeId?: string }) => void;
  openRemove: (roomId: string) => void;
  setQuery: (query: string) => void;
  setFilter: (filter: PickerFilter) => void;
  select: (userId: string) => void;
  toggleAck: (ack: AssignAck) => void;
  toReview: () => void;
  /** One step back: review → picker; picker/remove/outcome → closed. Ignored while a write is in flight or an outcome is unclear. */
  back: () => void;
  close: () => void;
  confirm: () => Promise<void>;
  /** Read-only: asks the server what became of an unclear write. Never writes. */
  checkResult: () => Promise<void>;
  /** After a conflict: refresh, then rebuild the review from the newest verified snapshot. */
  reviewAgain: () => Promise<void>;
}

export interface UseAssignmentFlowInput {
  model: AssignmentsModel;
  gate: MutationGate;
  isOnline: boolean;
  refresh: () => Promise<void>;
  scopeKey: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  /** Test seam: lets React commit after a refresh before the model is inspected. */
  settle?: () => Promise<void>;
}

const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rejectionError(rejection: PlanRejection): FlowError {
  switch (rejection.reason) {
    case "room_blocked":
      return "blocked";
    case "employee_unknown":
    case "employee_unverifiable":
      return "employee_ineligible";
    default:
      return "not_ready";
  }
}

export function useAssignmentFlow({ model, gate, isOnline, refresh, scopeKey, t, toast, settle = defaultSettle }: UseAssignmentFlowInput): AssignmentFlowController {
  const [flow, setFlow] = useState<AssignmentFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<FlowError | null>(null);

  // The latest values, read at call time by the async handlers so a long write never acts on old ones.
  const latest = useRef({ model, gate, isOnline, scopeKey, flow });
  latest.current = { model, gate, isOnline, scopeKey, flow };
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const entry = useMemo(() => (flow ? ((model.rooms ?? []).find((candidate) => candidate.room.roomId === flow.roomId) ?? null) : null), [flow, model.rooms]);

  // Another hotel, another person or the next hotel day: nothing opened under the old one may be written.
  useEffect(() => {
    if (!flow) return;
    if (flow.scopeKey !== scopeKey || flow.hotelDate !== model.hotelDate) {
      setFlow(null);
      setError(null);
      toast.info(t("assignments.v2.assign.scopeChanged"));
    }
  }, [flow, scopeKey, model.hotelDate, t, toast]);

  // The room left the verified board while the flow was open.
  useEffect(() => {
    if (flow && !flow.outcome && model.rooms !== null && !entry && !busy) {
      setFlow(null);
      setError(null);
      toast.info(t("assignments.v2.assign.roomGone"));
    }
  }, [flow, model.rooms, entry, busy, t, toast]);

  const patch = useCallback((next: Partial<AssignmentFlow>) => setFlow((held) => (held ? { ...held, ...next } : held)), []);

  const openAssign = useCallback((roomId: string, options?: { employeeId?: string }) => {
    const current = latest.current;
    const live = (current.model.rooms ?? []).find((candidate) => candidate.room.roomId === roomId);
    setError(null);
    if (!live) return;
    const base: AssignmentFlow = {
      step: "picker",
      roomId,
      scopeKey: current.scopeKey,
      hotelDate: current.model.hotelDate,
      query: "",
      filter: "on_shift",
      selectedId: null,
      reviewedOwnerId: null,
      acks: [],
      outcome: null,
      attempt: null,
    };
    // Employee-first (from the Team drawer): the person is already chosen, so open straight at the review.
    const employeeId = options?.employeeId;
    if (employeeId && buildAssignReview(current.model, { roomId, toUserId: employeeId }).ok) {
      setFlow({ ...base, step: "review", selectedId: employeeId, reviewedOwnerId: live.ownership.userId });
      return;
    }
    setFlow(base);
  }, []);

  const openRemove = useCallback((roomId: string) => {
    const current = latest.current;
    const live = (current.model.rooms ?? []).find((candidate) => candidate.room.roomId === roomId);
    setError(null);
    if (!live) return;
    setFlow({
      step: "remove",
      roomId,
      scopeKey: current.scopeKey,
      hotelDate: current.model.hotelDate,
      query: "",
      filter: "on_shift",
      selectedId: null,
      reviewedOwnerId: live.ownership.userId,
      acks: [],
      outcome: null,
      attempt: null,
    });
  }, []);

  const setQuery = useCallback((query: string) => patch({ query }), [patch]);
  const setFilter = useCallback((filter: PickerFilter) => patch({ filter }), [patch]);
  // Choosing someone else clears acknowledgements: they were given for a different person.
  const select = useCallback((userId: string) => patch({ selectedId: userId, acks: [] }), [patch]);
  const toggleAck = useCallback(
    (ack: AssignAck) =>
      setFlow((held) => (held ? { ...held, acks: held.acks.includes(ack) ? held.acks.filter((x) => x !== ack) : sortAcks([...held.acks, ack]) } : held)),
    [],
  );

  const picker = useMemo<AssignPicker | null>(() => {
    if (!flow || flow.step !== "picker") return null;
    return buildAssignPicker(model, { roomId: flow.roomId, query: flow.query, filter: flow.filter });
  }, [flow, model]);

  const reviewResult = useMemo(() => {
    if (!flow || flow.step !== "review" || !flow.selectedId) return null;
    return buildAssignReview(model, { roomId: flow.roomId, toUserId: flow.selectedId });
  }, [flow, model]);
  const review = reviewResult && reviewResult.ok ? reviewResult.review : null;

  const removal = useMemo<RemovalReview | null>(() => (flow && flow.step === "remove" ? buildRemovalReview(model, flow.roomId) : null), [flow, model]);

  // A conflict is either the server's refusal (outcome) or what the live model shows against the reviewed state.
  const conflictReason = useMemo<ConflictReason | null>(() => {
    if (!flow) return null;
    if (flow.outcome?.kind === "conflict") return flow.outcome.reason;
    if (flow.outcome || flow.step === "picker") return null;
    return detectLiveConflict(model, { roomId: flow.roomId, reviewedOwnerId: flow.reviewedOwnerId, targetUserId: flow.step === "review" ? flow.selectedId : null });
  }, [flow, model]);
  const conflict = useMemo<ConflictView | null>(() => {
    if (!flow || !conflictReason) return null;
    return buildConflictView(model, {
      roomId: flow.roomId,
      roomNumber: entry?.room.roomNumber ?? "",
      reason: conflictReason,
      reviewedOwnerId: flow.reviewedOwnerId,
    });
  }, [flow, conflictReason, model, entry]);

  const ready = gate.allowed && isOnline && !busy && !checking;
  const canContinue = Boolean(
    flow && flow.step === "picker" && flow.selectedId && entry && !entry.eligibility.hardBlock && ready && picker?.candidates.some((c) => c.userId === flow.selectedId && !c.isCurrentOwner),
  );
  const canConfirm = Boolean(
    flow &&
      !flow.outcome &&
      entry &&
      ready &&
      !conflictReason &&
      (flow.step === "remove"
        ? removal !== null && removal.blocked === null
        : flow.step === "review" && review !== null && !review.alreadyOwner && review.hardBlock === null && acksSatisfied(review.requiredAcks, flow.acks)),
  );

  const toReview = useCallback(() => {
    const current = latest.current;
    const held = current.flow;
    if (!held || held.step !== "picker" || !held.selectedId || writing.current) return;
    const live = (current.model.rooms ?? []).find((candidate) => candidate.room.roomId === held.roomId);
    if (!live || !buildAssignReview(current.model, { roomId: held.roomId, toUserId: held.selectedId }).ok) return;
    setError(null);
    setFlow({ ...held, step: "review", reviewedOwnerId: live.ownership.userId, acks: [] });
  }, []);

  const close = useCallback(() => {
    if (writing.current) return;
    setFlow(null);
    setError(null);
  }, []);

  const back = useCallback(() => {
    if (writing.current) return;
    const held = latest.current.flow;
    if (!held) return;
    // An unclear outcome is the one thing a stray Back must not discard: it ends only with "Check result" or Close.
    if (held.outcome?.kind === "unknown") return;
    setError(null);
    if (held.outcome === null && held.step === "review") setFlow({ ...held, step: "picker", acks: [], reviewedOwnerId: null });
    else setFlow(null);
  }, []);

  /** One fresh read of one room: the room, null when the board has no such room, or "failed". */
  const readRoom = useCallback(async (hotelDate: string, roomId: string): Promise<BoardRoom | null | "failed"> => {
    try {
      const snapshot = normalizeBoardRecords(await fetchBoardVerified(hotelDate), hotelDate);
      return snapshot.rooms.find((candidate) => candidate.roomId === roomId) ?? null;
    } catch {
      return "failed";
    }
  }, []);

  const sameScope = useCallback((held: AssignmentFlow) => mounted.current && latest.current.scopeKey === held.scopeKey && latest.current.model.hotelDate === held.hotelDate, []);

  /** The server confirmed the write: show it, then (separately) find out whether the snapshot caught up. */
  const applied = useCallback(
    async (held: AssignmentFlow, attempt: Attempt, release: () => void) => {
      if (!sameScope(held)) return release();
      setError(null);
      setFlow((current) =>
        current && current.roomId === held.roomId
          ? { ...current, outcome: { kind: "applied", action: attempt.action, roomNumber: attempt.roomNumber, toName: attempt.toName, refresh: "pending" }, attempt: null }
          : current,
      );
      // The outcome is on screen: the write lock is no longer needed, and dismissing must not wait for the refresh.
      release();
      toast.success(
        attempt.action === "remove"
          ? t("assignments.v2.assign.success.remove", { room: attempt.roomNumber })
          : t(attempt.action === "reassign" ? "assignments.v2.assign.success.reassign" : "assignments.v2.assign.success.assign", {
              room: attempt.roomNumber,
              name: attempt.toName ?? t("assignments.v2.assign.thisPerson"),
            }),
      );
      await refresh().catch(() => undefined);
      await settle();
      if (!mounted.current) return;
      const after = latest.current.model;
      const reflected = (after.rooms ?? []).find((candidate) => candidate.room.roomId === held.roomId);
      const caughtUp = after.availability.kind === "ready" && Boolean(reflected) && reflected?.ownership.userId === attempt.toUserId;
      setFlow((current) =>
        current && current.outcome?.kind === "applied" && current.roomId === held.roomId
          ? { ...current, outcome: { ...current.outcome, refresh: caughtUp ? "ok" : "failed" } }
          : current,
      );
    },
    [refresh, sameScope, settle, t, toast],
  );

  const confirm = useCallback(async () => {
    const start = latest.current;
    const held = start.flow;
    if (!held || held.step === "picker" || held.outcome || writing.current) return;
    if (!start.gate.allowed || !start.isOnline) {
      setError("paused");
      return;
    }
    const removing = held.step === "remove";
    const live = (start.model.rooms ?? []).find((candidate) => candidate.room.roomId === held.roomId);
    if (!live) return;
    if (detectLiveConflict(start.model, { roomId: held.roomId, reviewedOwnerId: held.reviewedOwnerId, targetUserId: removing ? null : held.selectedId })) return;

    let attempt: Attempt;
    let run: () => Promise<void>;
    if (removing) {
      const owner = live.ownership.userId;
      if (!owner || !live.eligibility.canRemove) {
        setError(owner ? "blocked" : "not_ready");
        return;
      }
      attempt = { action: "remove", roomNumber: live.room.roomNumber, toUserId: null, toName: null, expectedOwnerId: owner };
      run = () => removeAssignmentGuarded(held.hotelDate, held.roomId, owner);
    } else {
      const review = held.selectedId ? buildAssignReview(start.model, { roomId: held.roomId, toUserId: held.selectedId }) : null;
      if (!review || !review.ok) {
        setError("not_ready");
        return;
      }
      if (!acksSatisfied(review.review.requiredAcks, held.acks)) {
        setError("acks_missing");
        return;
      }
      const plan = planChange(start.model, { roomId: held.roomId, toUserId: held.selectedId, acknowledged: softAcksOf(held.acks), source: "single" });
      if (!plan.ok) {
        setError(rejectionError(plan.rejection));
        return;
      }
      const requests = toSaveRequests([plan.change]);
      attempt = {
        action: plan.change.kind === "reassign" ? "reassign" : "assign",
        roomNumber: plan.change.roomNumber,
        toUserId: plan.change.toUserId,
        toName: review.review.to.name,
        expectedOwnerId: expectedOwnerId(plan.change.expected),
      };
      run = async () => {
        for (const batch of requests.assignmentBatches) await saveAssignments(held.hotelDate, batch.assignments, batch.isAiSuggested);
      };
    }

    writing.current = true;
    setBusy(true);
    setError(null);
    patch({ attempt });
    // Idempotent: the lock is held until the outcome is on screen, so a second press can never start a second write.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      writing.current = false;
      if (mounted.current) setBusy(false);
    };

    try {
      await run();
    } catch (writeError) {
      const verdict = classifyWrite(writeError);
      if (verdict.kind === "definite") {
        // The server answered "no": nothing was written.
        try {
          if (!sameScope(held)) return;
          if (verdict.conflict && verdict.failure !== "permission") {
            // Read-only refresh so the conflict view shows who has the room NOW.
            await refresh().catch(() => undefined);
            if (!mounted.current) return;
            setFlow((current) => (current ? { ...current, outcome: { kind: "conflict", reason: verdict.conflict as ConflictReason }, attempt: null } : current));
          } else {
            patch({ attempt: null });
            setError(verdict.failure);
          }
        } finally {
          release();
        }
        return;
      }
      // Unclear: the write may have been applied. Never retry — read the room back.
      try {
        const after = await readRoom(held.hotelDate, held.roomId);
        if (!sameScope(held)) return;
        const verdictOutcome =
          after === "failed"
            ? "unverifiable"
            : judgeOutcome(after, attempt.toUserId ? { kind: "assigned", userId: attempt.toUserId } : { kind: "unassigned" }, attempt.expectedOwnerId);
        if (verdictOutcome === "applied") {
          await applied(held, attempt, release);
        } else if (verdictOutcome === "not_applied") {
          patch({ attempt: null });
          setError("save_failed");
        } else {
          setFlow((current) => (current ? { ...current, outcome: { kind: "unknown", action: attempt.action } } : current));
        }
      } finally {
        release();
      }
      return;
    }
    await applied(held, attempt, release);
    release();
  }, [applied, patch, readRoom, refresh, sameScope]);

  const checkResult = useCallback(async () => {
    const start = latest.current;
    const held = start.flow;
    const attempt = held?.attempt;
    if (!held || !attempt || held.outcome?.kind !== "unknown" || writing.current) return;
    writing.current = true;
    setChecking(true);
    setError(null);
    try {
      const after = await readRoom(held.hotelDate, held.roomId);
      if (!sameScope(held)) return;
      const verdict =
        after === "failed"
          ? "unverifiable"
          : judgeOutcome(after, attempt.toUserId ? { kind: "assigned", userId: attempt.toUserId } : { kind: "unassigned" }, attempt.expectedOwnerId);
      if (verdict === "applied") {
        await applied(held, attempt, () => {
          writing.current = false;
          if (mounted.current) setChecking(false);
        });
      } else if (verdict === "not_applied") {
        // Verified: the server never applied it. Back to the review so the supervisor decides deliberately.
        setFlow((current) => (current ? { ...current, outcome: null, attempt: null } : current));
        setError("save_failed");
      } else {
        setError("still_unknown");
      }
    } finally {
      writing.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [applied, readRoom, sameScope]);

  const reviewAgain = useCallback(async () => {
    const held = latest.current.flow;
    if (!held || writing.current) return;
    setError(null);
    await refresh().catch(() => undefined);
    await settle();
    if (!mounted.current) return;
    const current = latest.current;
    const next = current.flow;
    if (!next || next.roomId !== held.roomId) return;
    const live = (current.model.rooms ?? []).find((candidate) => candidate.room.roomId === held.roomId);
    if (!live) return;
    if (next.step === "remove") {
      if (!live.ownership.userId) {
        setFlow(null);
        toast.info(t("assignments.v2.assign.alreadyUnassigned", { room: live.room.roomNumber }));
        return;
      }
      setFlow({ ...next, outcome: null, attempt: null, acks: [], reviewedOwnerId: live.ownership.userId });
      return;
    }
    // Back to the picker with the same person selected when they are still a valid choice; the review is rebuilt.
    const stillValid = next.selectedId ? buildAssignReview(current.model, { roomId: next.roomId, toUserId: next.selectedId }).ok : false;
    setFlow({ ...next, step: "picker", outcome: null, attempt: null, acks: [], reviewedOwnerId: null, selectedId: stillValid ? next.selectedId : null });
  }, [refresh, settle, t, toast]);

  return {
    flow,
    entry,
    picker,
    review,
    removal,
    conflict,
    busy,
    checking,
    error,
    canContinue,
    canConfirm,
    openAssign,
    openRemove,
    setQuery,
    setFilter,
    select,
    toggleAck,
    toReview,
    back,
    close,
    confirm,
    checkResult,
    reviewAgain,
  };
}
