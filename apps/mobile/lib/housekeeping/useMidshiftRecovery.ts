import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import type { DraftExclusion } from "@/lib/housekeeping/assignmentDraft";
import {
  availableTeamIds,
  buildDestinations,
  buildMidshiftSource,
  defaultSelection,
  diffSeen,
  draftOverlap,
  hasChanges,
  midshiftChangesIn,
  planMidshift,
  selectAllMovable,
  summarizeSelection,
  takeSeen,
  toggleRoom,
  type DestinationMode,
  type MidshiftDestination,
  type MidshiftPlan,
  type MidshiftReason,
  type MidshiftSource,
  type SeenChanges,
  type SeenSnapshot,
  type SelectionRefusal,
  type SelectionSummary,
} from "@/lib/housekeeping/assignmentMidshift";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { AssignmentDraftController } from "@/lib/housekeeping/useAssignmentDraft";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";

/* ─── Midshift recovery — the whole workflow ─────────────────────────────────
   One person's unstarted rooms move to other people:

       select rooms ──► choose who ──► REVIEW (before/after) ──► Add to draft ──► the Phase 5 draft + review + ATOMIC publish
                                              │
                                              └─ edit: move a room, take it out, go back and add another

   READ-ONLY UNTIL THE SUPERVISOR PUBLISHES. Everything before "Add to draft" is local state derived from the live model. "Add
   to draft" stages PROPOSED changes into the one shared unpublished draft (source `midshift`) and opens the existing draft
   review; only the reviewed, confirmed, atomic publication changes an assignment, through `useBatchPublication`. The
   reason the supervisor picks is a note on this plan: it never records attendance, leave or an absence.

   It reads the SAME model as Rooms and Team (no fetch or realtime channel of its own). The model moves while the sheet is open;
   `changes` says what moved since the supervisor last looked, and "Add to draft" stays off until they have reviewed it. */

export type MidshiftStep = "select" | "destination" | "preview" | "conflict";
export type MidshiftPause = "offline" | "not_live" | null;
export type DraftResolution = "replace" | "keep";
export type AddOutcome = "added" | "needs_resolution" | "blocked" | "stale" | "nothing_added";
/** How the sheet ended: the supervisor left it, their plan went into the draft, or the hotel/day/person changed under it. */
export type MidshiftClosed = "dismissed" | "added" | "reset";

/** What the draft review says about where its midshift changes came from. */
export interface MidshiftNote {
  count: number;
  sourceNames: (string | null)[];
  reason: MidshiftReason | null;
}

export interface MidshiftController {
  /** The person whose work is being moved, or null when the sheet is closed. */
  userId: string | null;
  step: MidshiftStep;
  source: MidshiftSource | null;
  selected: ReadonlySet<string>;
  summary: SelectionSummary | null;
  reason: MidshiftReason | null;
  mode: DestinationMode;
  destinationId: string | null;
  destinations: MidshiftDestination[];
  /** Who "the available team" is: verified on-shift people only. */
  teamIds: string[];
  plan: MidshiftPlan | null;
  /** Edit controls are showing in the review. */
  editing: boolean;
  /** The room whose receiver is being changed. */
  movePickerFor: string | null;
  overrides: Readonly<Record<string, string>>;
  /** What moved since the supervisor last looked. Null when nothing did. */
  changes: SeenChanges | null;
  paused: MidshiftPause;
  /** Proposed rooms the unpublished draft already holds a change for. */
  overlap: string[];
  /** Why the supervisor cannot go on from the current step, or null. */
  blocked: "paused" | "stale" | "nothing_selected" | "no_destination" | "nothing_placeable" | null;
  note: MidshiftNote | null;
  open: (userId: string) => void;
  close: () => void;
  /** Android Back: one step back, or closes from the first. */
  back: () => void;
  toggleRoom: (roomId: string) => SelectionRefusal | null;
  selectAll: () => void;
  clearSelection: () => void;
  setReason: (reason: MidshiftReason | null) => void;
  setMode: (mode: DestinationMode) => void;
  chooseDestination: (userId: string) => void;
  next: () => void;
  /** Back to the room selection (from the review) to add or remove a room. */
  editSelection: () => void;
  toggleEditing: () => void;
  openMovePicker: (roomId: string | null) => void;
  moveRoom: (roomId: string, toUserId: string) => void;
  takeOut: (roomId: string) => void;
  /** Reads the board again and shows the supervisor the up-to-date plan (nothing is published). */
  refreshPlan: () => Promise<void>;
  /** The supervisor has seen what changed: recalculate against it. */
  acceptChanges: () => void;
  addToDraft: (resolution?: DraftResolution) => AddOutcome;
  cancelConflict: () => void;
}

export interface UseMidshiftRecoveryInput {
  model: AssignmentsModel;
  gate: MutationGate;
  isOnline: boolean;
  scopeKey: string | null;
  draft: AssignmentDraftController;
  /** Opens the existing draft review. */
  showReview: () => void;
  refresh: () => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  /** Test seam: lets React commit after a refresh before the model is inspected. */
  settle?: () => Promise<void>;
  /** Told when the sheet ends, so the screen can return to the person's drawer after a plain dismissal. */
  onClosed?: (userId: string, outcome: MidshiftClosed) => void;
}

const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const NONE: ReadonlySet<string> = new Set();

export function useMidshiftRecovery({ model, gate, isOnline, scopeKey, draft, showReview, refresh, t, toast, settle = defaultSettle, onClosed }: UseMidshiftRecoveryInput): MidshiftController {
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<MidshiftStep>("select");
  const [selected, setSelected] = useState<ReadonlySet<string>>(NONE);
  const [reason, setReasonState] = useState<MidshiftReason | null>(null);
  const [mode, setModeState] = useState<DestinationMode>("team");
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Readonly<Record<string, string>>>({});
  const [editing, setEditing] = useState(false);
  const [movePickerFor, setMovePickerFor] = useState<string | null>(null);
  const [seen, setSeen] = useState<SeenSnapshot | null>(null);
  // The plan's reason survives closing the sheet so the draft review can say where its midshift changes came from.
  const [kept, setKept] = useState<{ reason: MidshiftReason | null } | null>(null);
  const openedFor = useRef<{ scopeKey: string | null; hotelDate: string } | null>(null);
  const latest = useRef({ model, scopeKey, userId, selected, reason, mode, destinationId, overrides, seen, draft, isOnline, gate });
  latest.current = { model, scopeKey, userId, selected, reason, mode, destinationId, overrides, seen, draft, isOnline, gate };
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  const paused: MidshiftPause = !isOnline ? "offline" : !gate.allowed ? "not_live" : null;

  const reset = useCallback(() => {
    setUserId(null);
    setStep("select");
    setSelected(NONE);
    setReasonState(null);
    setModeState("team");
    setDestinationId(null);
    setOverrides({});
    setEditing(false);
    setMovePickerFor(null);
    setSeen(null);
    openedFor.current = null;
  }, []);

  const source = useMemo(() => (userId ? buildMidshiftSource(model, userId) : null), [model, userId]);
  const summary = useMemo(() => (userId ? summarizeSelection(model, userId, selected) : null), [model, userId, selected]);
  const validRooms = summary ? summary.valid : [];
  const destinations = useMemo(
    () => (userId && (step === "destination" || step === "preview") ? buildDestinations(model, userId, validRooms.map((room) => room.entry)) : []),
    [model, userId, step, validRooms],
  );
  const teamIds = useMemo(() => (userId ? availableTeamIds(model, userId) : []), [model, userId]);
  const plan = useMemo(
    () => (userId && (step === "preview" || step === "conflict" || step === "destination") && validRooms.length > 0 ? planMidshift({ model, sourceUserId: userId, rooms: validRooms, mode, destinationId, overrides, scopeKey }) : null),
    [model, userId, step, validRooms, mode, destinationId, overrides, scopeKey],
  );
  const changes = useMemo(() => {
    if (!userId || !seen) return null;
    const diff = diffSeen(model, userId, seen);
    return hasChanges(diff) ? diff : null;
  }, [model, userId, seen]);
  const overlap = useMemo(() => (plan ? draftOverlap(draft.draft, Object.keys(plan.assignments)) : []), [plan, draft.draft]);

  // The sheet belongs to the hotel, person and hotel day it was opened for. A different one closes it: nothing is carried over.
  useEffect(() => {
    const opened = openedFor.current;
    if (!userId || !opened) return;
    if (opened.scopeKey !== scopeKey || opened.hotelDate !== model.hotelDate) {
      reset();
      closedRef.current?.(userId, "reset");
      toast.info(t("assignments.v2.midshift.closedScope"));
    }
  }, [userId, scopeKey, model.hotelDate, reset, t, toast]);

  // The person left the verified board (or the board stopped being known): there is nothing honest to show.
  useEffect(() => {
    if (!userId || source) return;
    reset();
    closedRef.current?.(userId, "reset");
    toast.info(t("assignments.v2.midshift.closedGone"));
  }, [userId, source, reset, t, toast]);

  // When the draft empties (published, discarded) the reason has nothing left to describe.
  useEffect(() => {
    if (kept && midshiftChangesIn(draft.draft).count === 0) setKept(null);
  }, [kept, draft.draft]);

  const open = useCallback(
    (id: string) => {
      const { model: current, scopeKey: scope } = latest.current;
      const built = buildMidshiftSource(current, id);
      if (!built) return;
      openedFor.current = { scopeKey: scope, hotelDate: current.hotelDate };
      setUserId(id);
      setStep("select");
      setSelected(defaultSelection(built));
      setReasonState(null);
      setModeState("team");
      setDestinationId(null);
      setOverrides({});
      setEditing(false);
      setMovePickerFor(null);
      setSeen(takeSeen(current, id));
    },
    [],
  );

  const close = useCallback(() => {
    const id = latest.current.userId;
    reset();
    if (id) closedRef.current?.(id, "dismissed");
  }, [reset]);

  const blocked: MidshiftController["blocked"] = (() => {
    if (!userId) return null;
    if (paused) return "paused";
    if (changes) return "stale";
    if (step === "select") return validRooms.length === 0 ? "nothing_selected" : null;
    if (mode === "person" && !destinationId) return "no_destination";
    if (step === "destination" || step === "preview") return !plan || plan.empty ? (mode === "team" && teamIds.length === 0 ? "no_destination" : "nothing_placeable") : null;
    return null;
  })();

  const back = useCallback(() => {
    if (movePickerFor) setMovePickerFor(null);
    else if (step === "conflict") setStep("preview");
    else if (step === "preview") {
      setEditing(false);
      setStep("destination");
    } else if (step === "destination") setStep("select");
    else close();
  }, [close, movePickerFor, step]);

  const toggle = useCallback((roomId: string): SelectionRefusal | null => {
    const { model: current, userId: id, selected: held } = latest.current;
    const built = id ? buildMidshiftSource(current, id) : null;
    if (!built) return "not_owned";
    const result = toggleRoom(held, built, roomId);
    if (result.refused) return result.refused;
    setSelected(result.selected);
    setOverrides((currentOverrides) => {
      if (!(roomId in currentOverrides)) return currentOverrides;
      const rest = { ...currentOverrides };
      delete rest[roomId];
      return rest;
    });
    return null;
  }, []);
  const selectAll = useCallback(() => {
    const { model: current, userId: id } = latest.current;
    const built = id ? buildMidshiftSource(current, id) : null;
    if (built) setSelected(selectAllMovable(built));
  }, []);
  const clearSelection = useCallback(() => setSelected(NONE), []);
  const setReason = useCallback((next: MidshiftReason | null) => setReasonState(next), []);

  const setMode = useCallback((next: DestinationMode) => {
    setModeState(next);
    setOverrides({});
  }, []);
  const chooseDestination = useCallback((id: string) => {
    setDestinationId((current) => (current === id ? null : id));
    setOverrides({});
  }, []);

  const next = useCallback(() => {
    if (step === "select" && validRooms.length > 0 && !paused && !changes) setStep("destination");
    else if (step === "destination" && plan && !plan.empty && !paused && !changes) setStep("preview");
  }, [changes, paused, plan, step, validRooms.length]);

  const editSelection = useCallback(() => {
    setEditing(false);
    setMovePickerFor(null);
    setStep("select");
  }, []);

  const toggleEditing = useCallback(() => {
    setEditing((current) => !current);
    setMovePickerFor(null);
  }, []);
  const openMovePicker = useCallback((roomId: string | null) => setMovePickerFor(roomId), []);
  const moveRoom = useCallback((roomId: string, toUserId: string) => {
    setOverrides((current) => ({ ...current, [roomId]: toUserId }));
    setMovePickerFor(null);
  }, []);
  const takeOut = useCallback((roomId: string) => {
    setSelected((current) => {
      const nextSelected = new Set(current);
      nextSelected.delete(roomId);
      return nextSelected;
    });
    setOverrides((current) => {
      if (!(roomId in current)) return current;
      const rest = { ...current };
      delete rest[roomId];
      return rest;
    });
  }, []);

  // Taking the last room out of the plan returns to the selection rather than showing an empty review.
  useEffect(() => {
    if (userId && (step === "preview" || step === "destination") && validRooms.length === 0) setStep("select");
  }, [userId, step, validRooms.length]);

  const acceptChanges = useCallback(() => {
    const { model: current, userId: id } = latest.current;
    if (!id) return;
    const live = summarizeSelection(current, id, latest.current.selected);
    // A room that can no longer move leaves the selection; everything that still can stays, and the plan is recalculated.
    setSelected(new Set(live.valid.map((room) => room.roomId)));
    setOverrides((currentOverrides) => Object.fromEntries(Object.entries(currentOverrides).filter(([roomId]) => live.valid.some((room) => room.roomId === roomId))));
    setSeen(takeSeen(current, id));
    setMovePickerFor(null);
  }, []);

  const refreshPlan = useCallback(async () => {
    await refresh().catch(() => undefined);
    await settle();
    acceptChanges();
  }, [acceptChanges, refresh, settle]);

  const addToDraft = useCallback(
    (resolution?: DraftResolution): AddOutcome => {
      const current = latest.current;
      if (!current.userId || !plan || plan.empty) return "nothing_added";
      if (!current.isOnline || !current.gate.allowed) return "blocked";
      if (changes) return "stale";
      const roomIds = Object.keys(plan.assignments);
      const held = current.draft.draft;
      const overlapping = draftOverlap(held, roomIds);
      if (overlapping.length > 0 && !resolution) {
        setStep("conflict");
        return "needs_resolution";
      }
      // Keep: the supervisor's existing change stays and this plan fills only the other rooms. Replace: this plan's rooms
      // overwrite theirs - and ONLY theirs; every other change in the draft is untouched.
      const skip = resolution === "keep" ? new Set(overlapping) : new Set<string>();
      const assignments = Object.fromEntries(Object.entries(plan.assignments).filter(([roomId]) => !skip.has(roomId)));
      const existing = held ? Object.keys(held.changes) : [];
      const total = new Set([...existing, ...Object.keys(assignments)]).size;
      if (total > MAX_BATCH_CHANGES) {
        toast.error(t("assignments.v2.midshift.tooMany", { max: MAX_BATCH_CHANGES }));
        return "nothing_added";
      }
      const excluded: DraftExclusion[] = plan.leftOut.map((entry) => ({ roomId: entry.roomId, roomNumber: entry.roomNumber, reason: entry.reason }));
      const staged = Object.keys(assignments).length > 0 ? current.draft.stage(assignments, "midshift", excluded) : null;
      if (staged && staged.staged.length === 0) {
        toast.error(t("assignments.v2.midshift.nothingAdded"));
        return "nothing_added";
      }
      if (!staged) toast.info(t("assignments.v2.midshift.keptYours"));
      else toast.success(t("assignments.v2.midshift.added", { count: staged.staged.length }));
      setKept({ reason: current.reason });
      const closedFor = current.userId;
      reset();
      if (closedFor) closedRef.current?.(closedFor, "added");
      showReview();
      return "added";
    },
    [changes, plan, reset, showReview, t, toast],
  );

  const cancelConflict = useCallback(() => setStep("preview"), []);

  const note = useMemo<MidshiftNote | null>(() => {
    const found = midshiftChangesIn(draft.draft);
    if (found.count === 0) return null;
    const names = found.sourceUserIds.map((id) => (model.team ?? []).find((member) => member.userId === id)?.name ?? null);
    return { count: found.count, sourceNames: names, reason: kept?.reason ?? null };
  }, [draft.draft, model.team, kept]);

  return {
    userId,
    step,
    source,
    selected,
    summary,
    reason,
    mode,
    destinationId,
    destinations,
    teamIds,
    plan,
    editing,
    movePickerFor,
    overrides,
    changes,
    paused,
    overlap,
    blocked,
    note,
    open,
    close,
    back,
    toggleRoom: toggle,
    selectAll,
    clearSelection,
    setReason,
    setMode,
    chooseDestination,
    next,
    editSelection,
    toggleEditing,
    openMovePicker,
    moveRoom,
    takeOut,
    refreshPlan,
    acceptChanges,
    addToDraft,
    cancelConflict,
  };
}
