import type { Room } from "@/stores/appStore";
import {
  getPhase,
  getProgress,
  pendingChangeCount,
  type LocalCleanSession,
} from "@/lib/housekeeping/cleanSession";
import { classifyRoom, type AttentionCode, type RoomClassification } from "@/lib/housekeeping/needsAttention";
import { buildDashboard, type SessionMap } from "@/lib/housekeeping/myRoomsDashboard";
import { isBlocked } from "@/lib/housekeeping/roomWorkflow";

/**
 * The single place that decides what Room Detail shows and which actions it offers.
 *
 * These are UI view states derived from the room's real status, its assignment
 * data and the local clean-session record. They are never written back as room
 * statuses. The screen renders whatever `resolveRoomDetailView` says and never
 * re-derives a rule of its own.
 *
 * Precedence (first match wins) — safety and server truth before convenience:
 *   1. unavailable      out of order / out of service
 *   2. inspected        server says INSPECTED
 *   3. submitted        server says CLEAN, or the server confirmed the completion
 *   4. working          a clean is underway (live session or IN_PROGRESS)
 *                         → reclean when it is a correction clean, else in_progress
 *   5. needs_attention  a hard restriction (DND, declined, come-back-later) or an
 *                       unverified-access reason; Rush never lifts either
 *   6. reclean          failed inspection, safe to enter
 *   7. ready            safe to start
 */

export type RoomDetailKind =
  | "ready"
  | "in_progress"
  | "needs_attention"
  | "reclean"
  | "submitted"
  | "inspected"
  | "unavailable";

/** How trustworthy the on-screen state is compared with the server. */
export type SyncState =
  | "synced"
  /** No connection while working: everything shown is last-known. */
  | "offline"
  /** The start is queued; the server has not created the session yet. */
  | "starting"
  /** Checklist / linen changes saved on this device only. */
  | "changes_pending"
  /** The finish was requested and the server has NOT confirmed it. */
  | "completion_pending"
  /** The server refused something; local work is kept for recovery. */
  | "conflict";

/** What "begin" means for this room. */
export type EntryMode = "none" | "start" | "protocol";

export type StartBlock = "other_room" | "restricted";

/** Reasons that mean "get in only through the knock protocol, never a bare Start". */
const SOFT_ACCESS_REASONS: ReadonlySet<AttentionCode> = new Set(["guest_inside", "access_problem", "checkout_unverified"]);
const ADVISORY_REASONS: ReadonlySet<AttentionCode> = new Set(["work_order", "high_risk", "note"]);
const RECORDABLE_REASONS: ReadonlySet<AttentionCode> = new Set(["dnd", "come_back_later"]);

export const CORRECTION_SECTION = "Corrections";

export interface CompletionState {
  done: number;
  total: number;
  requiredDone: number;
  requiredTotal: number;
  requiredRemaining: number;
  /** Every required item is ticked. */
  checklistComplete: boolean;
  /** The finish button may be pressed. */
  canSubmit: boolean;
  /** A finish request is out and unconfirmed. */
  pending: boolean;
}

export interface RoomDetailView {
  kind: RoomDetailKind;
  /**
   * The room status the screen reports. It is the list's status, except that a
   * server-confirmed completion shows as CLEAN even while the list still says
   * IN_PROGRESS — so the badge never disagrees with the body.
   */
  status: Room["status"];
  /** A clean is underway (even if the checklist has not loaded yet). */
  working: boolean;
  sync: SyncState;
  pendingChanges: number;
  classification: RoomClassification;
  entry: EntryMode;
  startBlock: StartBlock | null;
  /** IN_PROGRESS on the server but the checklist is not on this device yet. */
  awaitingChecklist: boolean;
  /** The strongest reason shown on a needs-attention room. */
  attention: AttentionCode | null;
  /** Informational reasons (work order, high risk, note): shown, never blocking. */
  advisories: AttentionCode[];
  completion: CompletionState | null;
}

export interface ResolveInput {
  room: Room;
  session?: LocalCleanSession;
  isOnline: boolean;
  /** Another assigned room is already IN_PROGRESS. */
  otherRoomInProgress: boolean;
  now?: Date;
}

/** Knock protocol required before entering a room a guest may still occupy. */
export function needsKnockProtocol(room: Room): boolean {
  if (room.status === "PICKUP") return true;
  if (room.status === "OCCUPIED") return true;
  return room.status === "DIRTY" && room.fo_status === "OCC" && !room.actual_checkout_at;
}

function isCorrectionSession(session: LocalCleanSession | undefined): boolean {
  return Boolean(session && session.checklist.some((item) => item.section === CORRECTION_SECTION));
}

function completionFor(session: LocalCleanSession | undefined): CompletionState | null {
  if (!session) return null;
  const progress = getProgress(session.checklist);
  const phase = getPhase(session);
  const checklistComplete = progress.requiredRemaining.length === 0;
  return {
    done: progress.done,
    total: progress.total,
    requiredDone: progress.requiredDone,
    requiredTotal: progress.requiredTotal,
    requiredRemaining: progress.requiredRemaining.length,
    checklistComplete,
    canSubmit: checklistComplete && (phase === "active" || phase === "starting"),
    pending: phase === "completing",
  };
}

function syncFor(session: LocalCleanSession | undefined, working: boolean, isOnline: boolean): SyncState {
  if (session && !session.completionConfirmed) {
    const phase = getPhase(session);
    if (phase === "conflict") return "conflict";
    if (phase === "completing") return "completion_pending";
    if (phase === "starting") return "starting";
    if (pendingChangeCount(session) > 0) return "changes_pending";
  }
  return working && !isOnline ? "offline" : "synced";
}

export function resolveRoomDetailView(input: ResolveInput): RoomDetailView {
  const { room, session, isOnline, otherRoomInProgress } = input;
  const now = input.now ?? new Date();
  const live = session && !session.completionConfirmed ? session : undefined;
  const confirmedDone = Boolean(session?.completionConfirmed);

  // A retained completed record only speaks for the room while it still reads
  // IN_PROGRESS (list not refreshed yet); once the room is DIRTY again (reclean)
  // the old record is stale and ignored.
  const effectiveStatus = confirmedDone && room.status === "IN_PROGRESS" ? "CLEAN" : room.status;
  const effective = effectiveStatus === room.status ? room : { ...room, status: effectiveStatus };
  const classification = classifyRoom(effective, { now, hasLiveSession: Boolean(live) });

  const base = {
    status: effective.status,
    classification,
    pendingChanges: 0,
    entry: "none" as EntryMode,
    startBlock: null as StartBlock | null,
    awaitingChecklist: false,
    attention: null as AttentionCode | null,
    advisories: [] as AttentionCode[],
    completion: null as CompletionState | null,
  };

  if (isBlocked(room)) {
    return { ...base, kind: "unavailable", working: false, sync: "synced" };
  }
  if (room.status === "INSPECTED") {
    return { ...base, kind: "inspected", working: false, sync: "synced" };
  }
  if (effective.status === "CLEAN") {
    // Server truth wins: CLEAN means submitted, whatever this device still has queued.
    return { ...base, kind: "submitted", working: false, sync: "synced" };
  }

  const working = Boolean(live) || room.status === "IN_PROGRESS";
  if (working) {
    const reclean = Boolean(room.reclean_requested_at) || isCorrectionSession(live);
    return {
      ...base,
      kind: reclean ? "reclean" : "in_progress",
      working: true,
      sync: syncFor(live, true, isOnline),
      pendingChanges: live ? pendingChangeCount(live) : 0,
      awaitingChecklist: !live,
      completion: completionFor(live),
    };
  }

  const advisories = classification.reasons.filter((code) => ADVISORY_REASONS.has(code));
  const soft = classification.reasons.find((code) => SOFT_ACCESS_REASONS.has(code)) ?? null;

  if (classification.restricted) {
    return {
      ...base,
      kind: "needs_attention",
      working: false,
      sync: "synced",
      attention: classification.primary,
      advisories,
      startBlock: "restricted",
    };
  }
  if (soft) {
    return {
      ...base,
      kind: "needs_attention",
      working: false,
      sync: "synced",
      attention: soft,
      advisories,
      entry: "protocol",
      startBlock: otherRoomInProgress ? "other_room" : null,
    };
  }

  return {
    ...base,
    kind: classification.reclean ? "reclean" : "ready",
    working: false,
    sync: "synced",
    advisories,
    entry: needsKnockProtocol(room) ? "protocol" : "start",
    startBlock: otherRoomInProgress ? "other_room" : null,
  };
}

// ─── Sticky actions ───────────────────────────────────────────────────────────

export type StickyActionId =
  | "start"
  | "begin_entry"
  | "complete"
  | "resubmit"
  | "next_room"
  | "back_to_route"
  | "record_attempt"
  | "view_work_order"
  | "view_record";

export interface StickyAction {
  id: StickyActionId;
  labelKey: string;
  labelParams?: Record<string, unknown>;
  enabled: boolean;
  /** Always set when `enabled` is false: a disabled button must say why. */
  disabledReasonKey?: string;
  disabledParams?: Record<string, unknown>;
}

export interface StickyActions {
  primary: StickyAction | null;
  secondary: StickyAction | null;
  /** The consolidated Report / More entry point. */
  more: { labelKey: string } | null;
}

export interface ActionContext {
  hasNextRoom: boolean;
  hasWorkOrder: boolean;
  /** An action (start / finish) is already in flight: block double taps. */
  busy: boolean;
}

const A = "rooms.work.actions";
const D = "rooms.work.disabled";

function action(id: StickyActionId, labelKey: string, extra: Partial<StickyAction> = {}): StickyAction {
  return { id, labelKey, enabled: true, ...extra };
}

function disabled(id: StickyActionId, labelKey: string, reasonKey: string, extra: Partial<StickyAction> = {}): StickyAction {
  return { id, labelKey, enabled: false, disabledReasonKey: reasonKey, ...extra };
}

function beginAction(view: RoomDetailView, ctx: ActionContext, correction: boolean): StickyAction {
  const id: StickyActionId = view.entry === "protocol" ? "begin_entry" : "start";
  const labelKey = id === "begin_entry" ? `${A}.beginEntry` : correction ? `${A}.startCorrections` : `${A}.start`;
  if (view.startBlock === "other_room") return disabled(id, labelKey, `${D}.otherRoom`);
  if (ctx.busy) return disabled(id, labelKey, `${D}.busy`);
  return action(id, labelKey);
}

export function getStickyActions(view: RoomDetailView, ctx: ActionContext): StickyActions {
  switch (view.kind) {
    case "unavailable":
      return {
        primary: action("back_to_route", `${A}.backToRoute`),
        secondary: ctx.hasWorkOrder ? action("view_work_order", `${A}.viewWorkOrder`) : null,
        more: null,
      };
    case "inspected":
      return {
        primary: action("back_to_route", `${A}.backToMyRooms`),
        secondary: action("view_record", `${A}.viewRecord`),
        more: null,
      };
    case "submitted":
      return {
        primary: ctx.hasNextRoom ? action("next_room", `${A}.nextRoom`) : action("back_to_route", `${A}.backToMyRooms`),
        secondary: action("view_record", `${A}.viewRecord`),
        more: null,
      };
    case "needs_attention": {
      if (view.entry === "protocol") {
        return { primary: beginAction(view, ctx, false), secondary: null, more: { labelKey: `${A}.reportAccess` } };
      }
      const recordable = view.classification.reasons.some((code) => RECORDABLE_REASONS.has(code));
      return {
        primary: recordable ? action("record_attempt", `${A}.recordAttempt`) : action("back_to_route", `${A}.backToRoute`),
        secondary: recordable ? action("back_to_route", `${A}.backToRoute`) : null,
        more: null,
      };
    }
    case "ready":
    case "reclean":
    case "in_progress": {
      if (!view.working) {
        return {
          primary: beginAction(view, ctx, view.kind === "reclean"),
          secondary: null,
          more: { labelKey: `${A}.cantEnter` },
        };
      }
      const reclean = view.kind === "reclean";
      const id: StickyActionId = reclean ? "resubmit" : "complete";
      const readyLabel = reclean ? `${A}.resubmit` : `${A}.markClean`;
      const stepsLabel = reclean ? `${A}.completeCorrections` : `${A}.completeSteps`;
      const completion = view.completion;
      const more = { labelKey: `${A}.more` };
      if (view.awaitingChecklist || !completion) {
        return { primary: disabled(id, readyLabel, `${D}.loadingChecklist`), secondary: null, more };
      }
      const params = { done: completion.requiredDone, total: completion.requiredTotal };
      if (view.sync === "conflict") return { primary: disabled(id, readyLabel, `${D}.conflict`), secondary: null, more };
      if (view.sync === "completion_pending") {
        return { primary: disabled(id, readyLabel, `${D}.completionPending`), secondary: null, more };
      }
      if (!completion.checklistComplete) {
        return { primary: disabled(id, stepsLabel, `${D}.stepsRemaining`, { labelParams: params, disabledParams: params }), secondary: null, more };
      }
      if (ctx.busy) return { primary: disabled(id, readyLabel, `${D}.busy`), secondary: null, more };
      return { primary: action(id, readyLabel), secondary: null, more };
    }
  }
}

// ─── Next room ────────────────────────────────────────────────────────────────

/**
 * The next room the housekeeper can actually work: the dashboard's own ordering
 * (sequence, Rush, queue rank), minus the room they are leaving. Rooms that are
 * restricted, submitted or unavailable never qualify.
 */
export function findNextRoom(rooms: Room[], sessions: SessionMap, currentRoomId: string, now: Date = new Date()): Room | null {
  const model = buildDashboard(rooms, sessions, now);
  const next = [...model.current, ...model.upNext].find((entry) => entry.room.id !== currentRoomId);
  return next?.room ?? null;
}

// ─── "Before you enter" checks ────────────────────────────────────────────────

export type EntryCheckTone = "ok" | "warn" | "info";

export interface EntryCheck {
  key: "checkout" | "dnd" | "service" | "instructions";
  tone: EntryCheckTone;
  /** i18n key under rooms.work.checks */
  textKey: string;
  /** Present when the text carries a clock time the caller formats. */
  time?: string | null;
}

/**
 * The short pre-entry checklist: only facts the room record actually holds. A
 * check is "ok" only when the data says so — missing data is never a green tick.
 */
export function buildEntryChecks(room: Room): EntryCheck[] {
  const checks: EntryCheck[] = [];

  if (room.actual_checkout_at) {
    checks.push({ key: "checkout", tone: "ok", textKey: "rooms.work.checks.checkoutConfirmed", time: room.actual_checkout_at });
  } else if (room.clean_type === "DEP") {
    checks.push({ key: "checkout", tone: "warn", textKey: "rooms.work.checks.checkoutNotConfirmed" });
  } else if (room.status === "PICKUP" || room.status === "OCCUPIED" || room.fo_status === "OCC") {
    checks.push({ key: "checkout", tone: "warn", textKey: "rooms.work.checks.guestMayBeInside" });
  } else {
    checks.push({ key: "checkout", tone: "ok", textKey: "rooms.work.checks.vacant" });
  }

  checks.push(
    room.dnd_flag
      ? { key: "dnd", tone: "warn", textKey: "rooms.work.checks.dndActive" }
      : { key: "dnd", tone: "ok", textKey: "rooms.work.checks.noDnd" },
  );

  if (room.do_not_service) checks.push({ key: "service", tone: "warn", textKey: "rooms.work.checks.serviceDeclined" });

  const hasInstructions = Boolean(room.latest_note?.trim() || room.priority_note?.trim() || room.open_work_order_id || room.open_work_order_title);
  if (hasInstructions) checks.push({ key: "instructions", tone: "info", textKey: "rooms.work.checks.reviewInstructions" });

  return checks;
}
