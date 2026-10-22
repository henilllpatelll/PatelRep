import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { proposeAllocation, type AllocationMode, type AllocationProposal } from "@/lib/housekeeping/assignmentAllocator";
import {
  allocateReadiness,
  buildAllocateCandidates,
  previewProposal,
  type AllocateCandidate,
  type AllocateReadiness,
  type ProposalPreview,
} from "@/lib/housekeeping/assignmentAllocateView";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { DraftExclusion } from "@/lib/housekeeping/assignmentDraft";
import { bulkEligibility } from "@/lib/housekeeping/assignmentBulk";
import type { BatchPublication } from "@/lib/housekeeping/assignmentBatch";
import type { LoadView } from "@/lib/housekeeping/assignmentPicker";
import { listAssignableRooms, type ChooserRoom } from "@/lib/housekeeping/assignmentPicker";
import { draftChanges } from "@/lib/housekeeping/assignmentPlan";
import { useAssignmentDraft, type AssignmentDraftController } from "@/lib/housekeeping/useAssignmentDraft";
import { useBatchPublication, type BatchPublicationController } from "@/lib/housekeeping/useBatchPublication";
import { useBulkSelection, type BulkSelectionController } from "@/lib/housekeeping/useBulkSelection";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";

/* ─── Bulk assignment — the whole workflow ───────────────────────────────────
   Composes the four independent pieces into the one thing the Assignments screen drives:

       select rooms ──► allocate (one person / the team) ──► DRAFT ──► review ──► publish (atomic) ──► result
                                     ▲                          │
                                     └──── edit allocations ◄───┘

   - `useBulkSelection`   which rooms (ids, validated against the live board)
   - `useAssignmentDraft` the one unpublished plan, bound to this hotel/person/day
   - `useBatchPublication` the all-or-nothing publication and its honest outcomes
   Nothing is written until `publishNow`, which sends only what the review has passed. The panel is ONE modal whose
   content changes (allocate → review → edit), never several stacked. */

export type BulkPanel = "allocate" | "review" | "edit" | "discard" | null;
export type AllocateIntent = "review" | "stage";

export interface AllocateState {
  mode: AllocationMode;
  employeeIds: string[];
  /** `review`: continue to the review. `stage`: add to the draft and keep selecting. */
  intent: AllocateIntent;
}

/** Why changes cannot be made right now. */
export type BulkPause = "offline" | "not_live" | null;

/** A person's published and proposed workload, for the Team tab. */
export interface ProposedLoad {
  current: LoadView;
  proposed: LoadView;
  added: number;
  released: number;
}

export interface BulkAssignmentController {
  selection: BulkSelectionController;
  draft: AssignmentDraftController;
  publication: BatchPublicationController;
  panel: BulkPanel;
  allocate: AllocateState;
  candidates: AllocateCandidate[];
  readiness: AllocateReadiness;
  proposal: AllocationProposal | null;
  preview: ProposalPreview | null;
  /** Staging found nothing it could add (every room was refused). */
  stageFailed: boolean;
  editUserId: string | null;
  /** Rooms that can be added to a person's allocation from the editor (bulk-eligible, not already in the draft). */
  addableRooms: ChooserRoom[];
  paused: BulkPause;
  /** The draft is the supervisor's work: leaving the screen would lose it (or an unclear publication). */
  dirty: boolean;
  proposedByUser: Map<string, ProposedLoad>;
  /** Everyone the verified staff list names, for choosing who a room moves to. */
  staff: { userId: string; name: string | null }[];
  nameOf: (userId: string | null) => string | null;
  /** The latest committed result, while it is on screen. */
  committed: BatchPublication | null;
  openAllocate: (intent: AllocateIntent) => void;
  closePanel: () => void;
  setMode: (mode: AllocationMode) => void;
  toggleEmployee: (userId: string) => void;
  /** Stages the proposal into the draft. `review` continues to the review; `stage` keeps selecting. Defaults to the intent the drawer opened with. */
  confirmAllocate: (intent?: AllocateIntent) => void;
  openReview: () => void;
  /** Opens the review at once, for changes staged in the same tick (Smart Balance). `openReview` waits for a render. */
  showReview: () => void;
  openEdit: (userId: string) => void;
  backToReview: () => void;
  addRoomTo: (userId: string, roomId: string) => void;
  moveRoom: (roomId: string, toUserId: string) => void;
  removeRoom: (roomId: string) => void;
  requestDiscard: () => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
  publishNow: () => Promise<void>;
  /** After a conflict: read the board again, re-plan what moved, and show the review again. */
  refreshAndReview: () => Promise<void>;
  /** Leaves the result: closes the panel, ends selection mode. */
  finish: () => void;
}

export interface UseBulkAssignmentInput {
  model: AssignmentsModel;
  gate: MutationGate;
  isOnline: boolean;
  refresh: () => Promise<void>;
  scopeKey: string | null;
  queue: readonly AssignmentRoom[];
  visible: readonly AssignmentRoom[];
  t: (key: string, options?: Record<string, unknown>) => string;
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  /** Test seam: lets React commit after a refresh before the model is inspected. */
  settle?: () => Promise<void>;
}

const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function useBulkAssignment({ model, gate, isOnline, refresh, scopeKey, queue, visible, t, toast, settle = defaultSettle }: UseBulkAssignmentInput): BulkAssignmentController {
  const selection = useBulkSelection({ model, queue, visible, scopeKey });
  const draftCtl = useAssignmentDraft({
    model,
    scopeKey,
    onDiscarded: (cause) => toast.info(t(cause === "day" ? "assignments.v2.bulk.draftDiscardedDay" : "assignments.v2.bulk.draftDiscardedScope")),
  });
  const [panel, setPanel] = useState<BulkPanel>(null);
  const [allocate, setAllocate] = useState<AllocateState>({ mode: "single", employeeIds: [], intent: "review" });
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [stageFailed, setStageFailed] = useState(false);
  const latest = useRef({ model, panel, draftCtl, selection });
  latest.current = { model, panel, draftCtl, selection };
  const returnTo = useRef<BulkPanel>("review");

  const onCommitted = useCallback((publication: BatchPublication) => {
    latest.current.draftCtl.discard();
    latest.current.selection.consume(publication.affectedRoomIds);
    setEditUserId(null);
    setPanel("review");
  }, []);
  const publication = useBatchPublication({ model, gate, isOnline, refresh, scopeKey, onCommitted, settle });

  const paused: BulkPause = !isOnline ? "offline" : !gate.allowed ? "not_live" : null;

  // Allocation drawer data, derived from the selected rooms that are still eligible.
  const validRooms = selection.summary.valid;
  const candidates = useMemo(() => (panel === "allocate" ? buildAllocateCandidates(model, validRooms) : []), [panel, model, validRooms]);
  const readiness = allocateReadiness(allocate.mode, allocate.employeeIds, validRooms.length, candidates);
  const proposal = useMemo<AllocationProposal | null>(
    () => (panel === "allocate" && readiness === "ready" ? proposeAllocation({ model, rooms: validRooms, employeeIds: allocate.employeeIds, mode: allocate.mode }) : null),
    [panel, readiness, model, validRooms, allocate.employeeIds, allocate.mode],
  );
  const preview = useMemo(() => (proposal ? previewProposal(model, validRooms, proposal) : null), [proposal, model, validRooms]);

  const openAllocate = useCallback(
    (intent: AllocateIntent) => {
      if (latest.current.selection.summary.valid.length === 0) return;
      setAllocate({ mode: "single", employeeIds: [], intent });
      setStageFailed(false);
      setPanel("allocate");
    },
    [],
  );

  const closePanel = useCallback(() => {
    // Closing while a request is in flight would hide it; every other state (including an unclear one, which the
    // draft indicator keeps visible) can be closed.
    if (publication.state.kind === "publishing") return;
    setPanel(null);
    setEditUserId(null);
  }, [publication.state.kind]);

  const setMode = useCallback((mode: AllocationMode) => {
    setAllocate((current) => ({ ...current, mode, employeeIds: mode === "single" ? current.employeeIds.slice(0, 1) : current.employeeIds }));
  }, []);
  const toggleEmployee = useCallback((userId: string) => {
    setAllocate((current) => {
      if (current.mode === "single") return { ...current, employeeIds: current.employeeIds[0] === userId ? [] : [userId] };
      return { ...current, employeeIds: current.employeeIds.includes(userId) ? current.employeeIds.filter((id) => id !== userId) : [...current.employeeIds, userId] };
    });
  }, []);

  const confirmAllocate = useCallback((intentOverride?: AllocateIntent) => {
    const current = latest.current;
    if (current.panel !== "allocate" || !proposal || paused) return;
    const excluded: DraftExclusion[] = current.selection.summary.invalid.map((entry) => ({ roomId: entry.roomId, roomNumber: entry.roomNumber, reason: "no_longer_eligible" }));
    const result = current.draftCtl.stage(proposal.assignments, "bulk", excluded);
    if (result.staged.length === 0) {
      setStageFailed(true);
      return;
    }
    current.selection.consume(result.staged);
    current.selection.removeInvalid();
    if ((intentOverride ?? allocate.intent) === "review") {
      returnTo.current = "review";
      setPanel("review");
    } else {
      setPanel(null);
      toast.success(t("assignments.v2.bulk.addedToDraft", { count: result.staged.length }));
    }
  }, [allocate.intent, paused, proposal, t, toast]);

  const openReview = useCallback(() => {
    if (!latest.current.draftCtl.draft && publication.state.kind === "idle") return;
    setPanel("review");
  }, [publication.state.kind]);
  const showReview = useCallback(() => {
    returnTo.current = "review";
    setPanel("review");
  }, []);
  const openEdit = useCallback((userId: string) => {
    if (publication.lockedToOperation) return;
    setEditUserId(userId);
    setPanel("edit");
  }, [publication.lockedToOperation]);
  const backToReview = useCallback(() => {
    setEditUserId(null);
    setPanel("review");
  }, []);

  const addRoomTo = useCallback(
    (userId: string, roomId: string) => {
      if (publication.lockedToOperation) return;
      const result = latest.current.draftCtl.stage({ [roomId]: userId }, "bulk");
      if (result.staged.length === 0) toast.error(t("assignments.v2.bulk.edit.cannotAdd"));
    },
    [publication.lockedToOperation, t, toast],
  );
  const moveRoom = useCallback(
    (roomId: string, toUserId: string) => {
      if (publication.lockedToOperation) return;
      const result = latest.current.draftCtl.move(roomId, toUserId);
      if (result.staged.length === 0) toast.error(t("assignments.v2.bulk.edit.cannotMove"));
    },
    [publication.lockedToOperation, t, toast],
  );
  const removeRoom = useCallback(
    (roomId: string) => {
      if (publication.lockedToOperation) return;
      latest.current.draftCtl.remove(roomId);
    },
    [publication.lockedToOperation],
  );

  // The editor and review need a draft: if it empties (or is discarded for a new hotel/day), they close.
  useEffect(() => {
    if (draftCtl.draft || (panel !== "review" && panel !== "edit" && panel !== "discard")) return;
    if (publication.state.kind === "idle") {
      setPanel(null);
      setEditUserId(null);
    }
  }, [draftCtl.draft, panel, publication.state.kind]);

  const requestDiscard = useCallback(() => {
    if (publication.lockedToOperation) return;
    returnTo.current = latest.current.panel === "edit" ? "edit" : "review";
    setPanel("discard");
  }, [publication.lockedToOperation]);
  const confirmDiscard = useCallback(() => {
    latest.current.draftCtl.discard();
    publication.dismiss();
    setPanel(null);
    setEditUserId(null);
  }, [publication]);
  const cancelDiscard = useCallback(() => setPanel(returnTo.current === "edit" && editUserId ? "edit" : "review"), [editUserId]);

  const publishNow = useCallback(async () => {
    const review = latest.current.draftCtl.review;
    if (!review || !review.canPublish || paused) return;
    const changes = draftChanges(latest.current.draftCtl.draft!);
    const refusal = await publication.publish(changes, latest.current.model.hotelDate);
    if (refusal === "paused") toast.error(t("assignments.v2.bulk.paused"));
  }, [paused, publication, t, toast]);

  const refreshAndReview = useCallback(async () => {
    await refresh().catch(() => undefined);
    await settle();
    publication.dismiss();
    latest.current.draftCtl.rebase();
    setPanel("review");
  }, [publication, refresh, settle]);

  const finish = useCallback(() => {
    publication.dismiss();
    setPanel(null);
    setEditUserId(null);
    latest.current.selection.stop();
  }, [publication]);

  const addableRooms = useMemo<ChooserRoom[]>(() => {
    if (panel !== "edit") return [];
    const inDraft = new Set(draftCtl.draft ? Object.keys(draftCtl.draft.changes) : []);
    const eligible = new Set((model.rooms ?? []).filter((entry) => bulkEligibility(entry).selectable).map((entry) => entry.room.roomId));
    return listAssignableRooms(model).filter((room) => eligible.has(room.roomId) && !inDraft.has(room.roomId));
  }, [panel, model, draftCtl.draft]);

  const proposedByUser = useMemo(() => {
    const map = new Map<string, ProposedLoad>();
    for (const employee of draftCtl.review?.employees ?? []) {
      map.set(employee.userId, { current: employee.current, proposed: employee.proposed, added: employee.added.length, released: employee.released.length });
    }
    return map;
  }, [draftCtl.review]);

  const staff = useMemo(() => (model.team ?? []).filter((member) => member.listed).map((member) => ({ userId: member.userId, name: member.name })), [model.team]);
  const nameOf = useCallback((userId: string | null) => (userId ? ((latest.current.model.team ?? []).find((member) => member.userId === userId)?.name ?? null) : null), []);

  return {
    selection,
    draft: draftCtl,
    publication,
    panel,
    allocate,
    candidates,
    readiness,
    proposal,
    preview,
    stageFailed,
    editUserId,
    addableRooms,
    paused,
    dirty: draftCtl.changeCount > 0 || publication.lockedToOperation,
    proposedByUser,
    staff,
    nameOf,
    committed: publication.state.kind === "committed" ? publication.state.publication : null,
    openAllocate,
    closePanel,
    setMode,
    toggleEmployee,
    confirmAllocate,
    openReview,
    showReview,
    openEdit,
    backToReview,
    addRoomTo,
    moveRoom,
    removeRoom,
    requestDiscard,
    confirmDiscard,
    cancelDiscard,
    publishNow,
    refreshAndReview,
    finish,
  };
}
