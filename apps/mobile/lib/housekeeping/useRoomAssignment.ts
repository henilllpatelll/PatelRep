import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBoardVerified, removeAssignmentByPlan, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import { lookupLearned } from "@/lib/housekeeping/estimateTable";
import {
  assignmentBlock,
  buildPicker,
  buildReview,
  classifyFailure,
  detectConflict,
  intentFor,
  judgeOutcome,
  removalBlock,
  type AssignmentBlock,
  type AssignmentFailure,
  type AssignmentIntent,
  type AssignmentReview,
  type ConflictKind,
  type LearnedLookup,
  type PickerFilter,
  type PickerModel,
} from "@/lib/housekeeping/roomAssignment";
import { normalizeBoardRecords, planAssignmentRemoval, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { MutationGate, RoomBoardModel } from "@/lib/housekeeping/roomBoardState";

/* ─── Room assignment controller ────────────────────────────────────────────
   ONE authoritative state for the assign / reassign / remove workflow of the Room Board. It owns the active
   step, the in-flight guard and the last error; the drawer only renders it.

   WHAT IT PROTECTS
   - It follows the room by id through the LIVE verified board (never the snapshot from when the drawer opened):
     a room that started being cleaned, was inspected, left the board or changed hands while the supervisor was
     choosing disables the confirm and says why.
   - Before every write it re-reads the room from the server and compares it with what the supervisor reviewed
     (`detectConflict`). That narrows the race with another supervisor; it cannot close it, because the server
     upserts without an expected-assignee condition — so nothing here claims it can.
   - A write that answered 4xx did not happen. A network failure, a timeout or a 5xx may have happened, so it is
     NEVER retried blindly: the room is read back and judged (`judgeOutcome`); if even that fails the flow stays
     open on "check again", which only reads.
   - "Saved" is shown only after the server confirmed. A failed refresh afterwards is reported as its own thing.
   - Another hotel, another person or another hotel day closes the flow instead of writing into the wrong one. */

export type AssignmentErrorKind =
  | AssignmentFailure
  | ConflictKind
  | AssignmentBlock
  | "nothing_to_remove"
  | "revalidate_failed"
  | "paused"
  | "scope_changed";

export type AssignmentStep = "picker" | "review" | "remove";

export interface AssignmentFlow {
  step: AssignmentStep;
  roomId: string;
  /** Hotel + person and hotel date the flow opened under; a change closes it. */
  scopeKey: string | null;
  hotelDate: string;
  query: string;
  filter: PickerFilter;
  selectedId: string | null;
  /** Set when the supervisor moves to review/removal: the assignee they SAW. A later difference is a conflict. */
  reviewedAssigneeId: string | null;
  ack: boolean;
  /** An unclear outcome is waiting to be checked; the next press only reads. */
  needsCheck: boolean;
}

export interface AssignmentController {
  flow: AssignmentFlow | null;
  /** The live room for the open flow, or null when it left the board. */
  room: BoardRoom | null;
  intent: AssignmentIntent | null;
  /** Why the live room can no longer be (re)assigned / unassigned; null = fine. */
  block: AssignmentBlock | "nothing_to_remove" | null;
  /** The room's assignee differs from the one the supervisor reviewed. */
  changedSinceReview: boolean;
  picker: PickerModel | null;
  review: AssignmentReview | null;
  /** Removal wording: who the room is assigned to now (null name = unknown). */
  removal: { roomNumber: string; assigneeId: string | null; assigneeName: string | null } | null;
  busy: boolean;
  error: AssignmentErrorKind | null;
  /** True while the write may proceed (gate open, live room fine, ack satisfied, nothing in flight). */
  canConfirm: boolean;
  openAssign: (roomId: string) => void;
  openRemove: (roomId: string) => void;
  setQuery: (query: string) => void;
  setFilter: (filter: PickerFilter) => void;
  select: (userId: string) => void;
  setAck: (ack: boolean) => void;
  toReview: () => void;
  /** One step back: review → picker; picker/remove → closed. Ignored while a write is in flight. */
  back: () => void;
  close: () => void;
  confirm: () => Promise<void>;
}

export interface UseRoomAssignmentInput {
  model: RoomBoardModel;
  gate: MutationGate;
  isOnline: boolean;
  refresh: () => Promise<void>;
  scopeKey: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  /** Test seam: a learned-estimate lookup. Defaults to this phone's cached table. */
  learned?: LearnedLookup;
  /** Test seam: lets React commit after a refresh before the board is inspected. */
  settle?: () => Promise<void>;
}

const defaultLearned: LearnedLookup = (code, cleanType) => lookupLearned(code, cleanType);
const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function nameOf(model: RoomBoardModel, userId: string | null): string | null {
  if (!userId) return null;
  const name = model.staff.find((member) => member.userId === userId)?.name?.trim();
  return name && name !== "—" ? name : null;
}

export function useRoomAssignment({
  model,
  gate,
  isOnline,
  refresh,
  scopeKey,
  t,
  toast,
  learned = defaultLearned,
  settle = defaultSettle,
}: UseRoomAssignmentInput): AssignmentController {
  const [flow, setFlow] = useState<AssignmentFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AssignmentErrorKind | null>(null);

  // The latest values, read at call time by the async confirm so a long write never acts on old ones.
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

  const rooms = useMemo(() => (model.rooms ?? []).map((view) => view.room), [model.rooms]);
  const room = useMemo(() => (flow ? (rooms.find((candidate) => candidate.roomId === flow.roomId) ?? null) : null), [flow, rooms]);

  // Another hotel, another person or the next hotel day: nothing opened under the old one may be written.
  useEffect(() => {
    if (!flow) return;
    if (flow.scopeKey !== scopeKey || flow.hotelDate !== model.hotelDate) {
      setFlow(null);
      setError(null);
      toast.info(t("roomBoard.assign.scopeChanged"));
    }
  }, [flow, scopeKey, model.hotelDate, t, toast]);

  // The room left the verified board while the flow was open.
  useEffect(() => {
    if (flow && model.rooms !== null && !room && !busy) {
      setFlow(null);
      setError(null);
      toast.info(t("roomBoard.assign.roomGone"));
    }
  }, [flow, model.rooms, room, busy, t, toast]);

  const start = useCallback(
    (roomId: string, step: AssignmentStep) => {
      if (writing.current) return;
      const current = latest.current;
      const target = (current.model.rooms ?? []).find((view) => view.room.roomId === roomId)?.room;
      setError(null);
      if (!target) return;
      setFlow({
        step,
        roomId,
        scopeKey: current.scopeKey,
        hotelDate: current.model.hotelDate,
        query: "",
        filter: "on_shift",
        selectedId: null,
        reviewedAssigneeId: step === "remove" ? target.assignment.userId : null,
        ack: false,
        needsCheck: false,
      });
    },
    [],
  );
  const openAssign = useCallback((roomId: string) => start(roomId, "picker"), [start]);
  const openRemove = useCallback((roomId: string) => start(roomId, "remove"), [start]);

  const patch = useCallback((next: Partial<AssignmentFlow>) => setFlow((held) => (held ? { ...held, ...next } : held)), []);
  const setQuery = useCallback((query: string) => patch({ query }), [patch]);
  const setFilter = useCallback((filter: PickerFilter) => patch({ filter }), [patch]);
  const select = useCallback((userId: string) => patch({ selectedId: userId, ack: false }), [patch]);
  const setAck = useCallback((ack: boolean) => patch({ ack }), [patch]);

  const picker = useMemo<PickerModel | null>(() => {
    if (!flow || !room || flow.step === "remove") return null;
    return buildPicker({
      staff: model.staff,
      rosterTrust: model.rosterTrust,
      rooms,
      room,
      query: flow.query,
      filter: flow.filter,
      learned,
    });
  }, [flow, room, model.staff, model.rosterTrust, rooms, learned]);

  // The review is built from the UNFILTERED candidate list, so a search term cannot hide the chosen person.
  const review = useMemo<AssignmentReview | null>(() => {
    if (!flow || flow.step !== "review" || !room || !flow.selectedId) return null;
    const everyone = buildPicker({ staff: model.staff, rosterTrust: model.rosterTrust, rooms, room, query: "", filter: "all", learned });
    const candidate = everyone.candidates.find((entry) => entry.userId === flow.selectedId);
    if (!candidate) return null;
    return buildReview({ room, candidate, previousName: nameOf(model, room.assignment.userId), learned });
  }, [flow, room, model, rooms, learned]);

  const removal = useMemo(() => {
    if (!flow || flow.step !== "remove" || !room) return null;
    return { roomNumber: room.roomNumber, assigneeId: room.assignment.userId, assigneeName: nameOf(model, room.assignment.userId) };
  }, [flow, room, model]);

  const block = useMemo<AssignmentController["block"]>(() => {
    if (!flow || !room) return null;
    return flow.step === "remove" ? removalBlock(room) : assignmentBlock(room);
  }, [flow, room]);

  const changedSinceReview = Boolean(
    flow && room && (flow.step === "remove" || flow.step === "review") && room.assignment.userId !== flow.reviewedAssigneeId,
  );

  const toReview = useCallback(() => {
    const current = latest.current;
    const held = current.flow;
    if (!held || held.step !== "picker" || !held.selectedId || writing.current) return;
    const live = (current.model.rooms ?? []).find((view) => view.room.roomId === held.roomId)?.room;
    if (!live) return;
    setError(null);
    setFlow({ ...held, step: "review", reviewedAssigneeId: live.assignment.userId, ack: false, needsCheck: false });
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
    setError(null);
    if (held.step === "review") setFlow({ ...held, step: "picker", ack: false, needsCheck: false });
    else setFlow(null);
  }, []);

  const needsAck = flow?.step === "review" && review?.ack != null;
  // After an unclear outcome the room has (maybe) already changed, so the usual checks are moot: the button only reads.
  const canConfirm = flow?.needsCheck
    ? isOnline && !busy
    : Boolean(flow && room) &&
      gate.allowed &&
      isOnline &&
      !busy &&
      block === null &&
      !changedSinceReview &&
      (flow?.step === "remove" || review !== null) &&
      (!needsAck || Boolean(flow?.ack));

  /** One fresh server read of one room: the room, null when the board has no such room, or "failed". */
  const readRoom = useCallback(async (hotelDate: string, roomId: string): Promise<BoardRoom | null | "failed"> => {
    try {
      const snapshot = normalizeBoardRecords(await fetchBoardVerified(hotelDate), hotelDate);
      return snapshot.rooms.find((candidate) => candidate.roomId === roomId) ?? null;
    } catch {
      return "failed";
    }
  }, []);

  const confirm = useCallback(async () => {
    const start0 = latest.current;
    const held = start0.flow;
    if (!held || held.step === "picker" || writing.current) return;
    if (!start0.gate.allowed || !start0.isOnline) {
      setError("paused");
      return;
    }
    const liveRoom = (start0.model.rooms ?? []).find((view) => view.room.roomId === held.roomId)?.room;
    if (!liveRoom) return;
    const removing = held.step === "remove";
    const blocked = removing ? removalBlock(liveRoom) : assignmentBlock(liveRoom);
    if (blocked) {
      setError(blocked);
      return;
    }
    if (liveRoom.assignment.userId !== held.reviewedAssigneeId) {
      setError("assignee_changed");
      return;
    }

    const targetId = removing ? null : held.selectedId;
    if (!removing && !targetId) return;
    const roomNumber = liveRoom.roomNumber;
    const targetName = removing ? null : nameOf(start0.model, targetId);
    const previousId = held.reviewedAssigneeId;
    const intent = intentFor(liveRoom);
    const sameScope = () => mounted.current && latest.current.scopeKey === held.scopeKey && latest.current.model.hotelDate === held.hotelDate;

    writing.current = true;
    setBusy(true);
    setError(null);
    // Idempotent per call: a late `finally` can never release the guard of a write started after this one.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      writing.current = false;
      if (mounted.current) setBusy(false);
    };
    const succeed = async (message: string) => {
      finish();
      if (!sameScope()) return;
      setFlow(null);
      toast.success(message);
      await refresh().catch(() => undefined);
      await settle();
      // The write is confirmed; whether the board caught up is a separate question and is reported as one.
      const after = latest.current.model;
      const reflected = (after.rooms ?? []).find((view) => view.room.roomId === held.roomId)?.room;
      const caughtUp =
        after.availability.kind === "ready" && Boolean(reflected) && reflected?.assignment.userId === (removing ? null : targetId);
      if (mounted.current && !caughtUp) toast.info(t("roomBoard.assign.refreshFailed"));
    };
    const fail = (kind: AssignmentErrorKind) => {
      finish();
      if (sameScope()) setError(kind);
    };

    try {
      // 1. Re-read the room from the server and compare it with what the supervisor reviewed.
      const fresh = await readRoom(held.hotelDate, held.roomId);
      if (fresh === "failed") return fail("revalidate_failed");
      if (removing) {
        if (fresh && planAssignmentRemoval(fresh).kind === "none") {
          // Someone already removed it: nothing to undo.
          void refresh().catch(() => undefined);
          finish();
          if (sameScope()) {
            setFlow(null);
            toast.info(t("roomBoard.assign.alreadyUnassigned", { room: roomNumber }));
          }
          return;
        }
        if (!fresh || assignmentBlock(fresh) !== null) {
          void refresh().catch(() => undefined);
          return fail(!fresh ? "room_missing" : "not_assignable");
        }
        if (fresh.assignment.userId !== previousId) {
          void refresh().catch(() => undefined);
          return fail("assignee_changed");
        }
      } else {
        const conflict = detectConflict(fresh, previousId, { targetId: targetId as string });
        if (conflict === "already_assigned") {
          void refresh().catch(() => undefined);
          finish();
          if (sameScope()) {
            setFlow(null);
            toast.info(t("roomBoard.assign.alreadyAssigned", { room: roomNumber, name: targetName ?? t("roomBoard.assign.thisPerson") }));
          }
          return;
        }
        if (conflict) {
          void refresh().catch(() => undefined);
          return fail(conflict);
        }
      }

      // 2. The write. Removal follows the plan of the FRESH room, so a stale assignment id is never deleted.
      let outcome: "ok" | { error: unknown };
      try {
        if (removing) {
          await removeAssignmentByPlan(planAssignmentRemoval(fresh as BoardRoom));
        } else {
          await saveAssignments(held.hotelDate, [{ room_id: held.roomId, housekeeper_id: targetId as string }]);
        }
        outcome = "ok";
      } catch (writeError) {
        outcome = { error: writeError };
      }

      if (outcome === "ok") {
        const message = removing
          ? t("roomBoard.assign.success.remove", { room: roomNumber })
          : intent === "reassign"
            ? t("roomBoard.assign.success.reassign", { room: roomNumber, name: targetName ?? t("roomBoard.assign.thisPerson") })
            : t("roomBoard.assign.success.assign", { room: roomNumber, name: targetName ?? t("roomBoard.assign.thisPerson") });
        return await succeed(message);
      }

      // 3. A failed write. 4xx = the server said no and did nothing. Anything else may have happened: read it back.
      const { failure, definite } = classifyFailure(outcome.error, latest.current.isOnline);
      if (definite) {
        if (failure === "conflict" || failure === "room_unavailable") void refresh().catch(() => undefined);
        return fail(failure);
      }
      const after = await readRoom(held.hotelDate, held.roomId);
      const verdict = after === "failed" ? "unverifiable" : judgeOutcome(after, removing ? { kind: "unassigned" } : { kind: "assigned", userId: targetId as string }, previousId);
      if (verdict === "applied") {
        const message = removing
          ? t("roomBoard.assign.success.remove", { room: roomNumber })
          : intent === "reassign"
            ? t("roomBoard.assign.success.reassign", { room: roomNumber, name: targetName ?? t("roomBoard.assign.thisPerson") })
            : t("roomBoard.assign.success.assign", { room: roomNumber, name: targetName ?? t("roomBoard.assign.thisPerson") });
        return await succeed(message);
      }
      if (verdict === "not_applied") return fail("save_failed");
      if (mounted.current) patch({ needsCheck: true });
      return fail("unknown_outcome");
    } catch {
      return fail("save_failed");
    } finally {
      finish();
    }
  }, [readRoom, refresh, settle, t, toast, patch]);

  /** After an unclear outcome the button only READS the room: it never writes a second time. */
  const check = useCallback(async () => {
    const start0 = latest.current;
    const held = start0.flow;
    if (!held || writing.current) return;
    writing.current = true;
    setBusy(true);
    const removing = held.step === "remove";
    const targetId = held.selectedId;
    try {
      const after = await readRoom(held.hotelDate, held.roomId);
      const verdict =
        after === "failed"
          ? "unverifiable"
          : judgeOutcome(after, removing ? { kind: "unassigned" } : { kind: "assigned", userId: targetId as string }, held.reviewedAssigneeId);
      if (!mounted.current) return;
      if (verdict === "applied") {
        const roomNumber = (start0.model.rooms ?? []).find((view) => view.room.roomId === held.roomId)?.room.roomNumber ?? "";
        const name = nameOf(start0.model, targetId) ?? t("roomBoard.assign.thisPerson");
        setFlow(null);
        setError(null);
        toast.success(removing ? t("roomBoard.assign.success.remove", { room: roomNumber }) : t("roomBoard.assign.success.assign", { room: roomNumber, name }));
        void refresh().catch(() => undefined);
      } else if (verdict === "not_applied") {
        patch({ needsCheck: false });
        setError("save_failed");
      } else {
        setError("unknown_outcome");
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [readRoom, refresh, t, toast, patch]);

  const run = useCallback(async () => {
    if (latest.current.flow?.needsCheck) await check();
    else await confirm();
  }, [check, confirm]);

  return {
    flow,
    room,
    intent: room ? intentFor(room) : null,
    block,
    changedSinceReview,
    picker,
    review,
    removal,
    busy,
    error,
    canConfirm,
    openAssign,
    openRemove,
    setQuery,
    setFilter,
    select,
    setAck,
    toReview,
    back,
    close,
    confirm: run,
  };
}
