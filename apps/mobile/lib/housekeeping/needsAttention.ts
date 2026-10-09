import type { Room } from "@/stores/appStore";
import {
  hasBlockingNote,
  hasOpenWorkOrder,
  isBlocked,
  isDepartureClean,
} from "@/lib/housekeeping/roomWorkflow";

/**
 * Centralized, pure room classification for the My Rooms workflow.
 *
 * Everything here is derived from fields the backend already persists
 * (room_status + the assignment); nothing is invented. These are APPLICATION
 * states — they are never written back as new database room statuses.
 *
 * State (one per room, so progress counts can never double-count):
 *   cleanable        safe to work now
 *   active           being cleaned (live session or IN_PROGRESS)
 *   needs_attention  entry is restricted or follow-up is needed first
 *   completed        submitted (CLEAN) or inspected
 *   unavailable      out of order / out of service
 *
 * A needs_attention room keeps EVERY reason it has (`reasons`, strongest
 * first) so a secondary condition is never discarded; `primary` is the one the
 * UI leads with. Rush is deliberately not a reason: it is retained as
 * `rush` and can never make a restricted room look ready.
 */

export type RoomWorkState = "cleanable" | "active" | "needs_attention" | "completed" | "unavailable";

export type AttentionCode =
  | "dnd"
  | "do_not_service"
  | "service_declined"
  | "guest_inside"
  | "access_problem"
  | "checkout_unverified"
  | "come_back_later"
  | "reclean"
  | "work_order"
  | "high_risk"
  | "note";

/** Strongest first. Decides `primary` and the display order of `reasons`. */
export const ATTENTION_PRECEDENCE: readonly AttentionCode[] = [
  "dnd",
  "do_not_service",
  "service_declined",
  "guest_inside",
  "access_problem",
  "checkout_unverified",
  "come_back_later",
  "reclean",
  "work_order",
  "high_risk",
  "note",
];

/** Reasons that bar ordinary Start Cleaning until the server clears them. */
const RESTRICTING: ReadonlySet<AttentionCode> = new Set(["dnd", "do_not_service", "service_declined", "come_back_later"]);

/**
 * Reasons that move a room into Needs Attention. Reclean is deliberately absent:
 * a reclean that is safe to enter stays actionable work (with its corrections
 * visible) instead of being parked as a blocked room.
 */
const ATTENTION_TRIGGERS: ReadonlySet<AttentionCode> = new Set([
  "dnd",
  "do_not_service",
  "service_declined",
  "guest_inside",
  "access_problem",
  "checkout_unverified",
  "come_back_later",
  "work_order",
  "high_risk",
  "note",
]);

export interface RushInfo {
  reason: string | null;
  neededBy: string | null;
  note: string | null;
  /** A deadline exists and has passed. */
  overdue: boolean;
}

export interface RetryInfo {
  /** Server-stored retry instant (room_status.dnd_retry_at); never invented. */
  at: string | null;
  /** The retry time exists and has arrived. */
  due: boolean;
  attempts: number;
  lastAttemptAt: string | null;
}

export interface RecleanInfo {
  requestedAt: string;
  corrections: number;
}

export interface RoomClassification {
  state: RoomWorkState;
  primary: AttentionCode | null;
  reasons: AttentionCode[];
  /** Ordinary Start Cleaning must be refused. */
  restricted: boolean;
  rush: RushInfo | null;
  retry: RetryInfo | null;
  reclean: RecleanInfo | null;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Rush = backend priority 1–2 (the same rule the housekeeping board uses). */
export function isRushPriority(room: Pick<Room, "priority">): boolean {
  return typeof room.priority === "number" && room.priority <= 2;
}

export function getRushInfo(room: Room, now: Date): RushInfo | null {
  if (!isRushPriority(room)) return null;
  const due = parseMs(room.priority_needed_by);
  return {
    reason: room.priority_reason ?? null,
    neededBy: room.priority_needed_by ?? null,
    note: room.priority_note?.trim() || null,
    overdue: due !== null && due < now.getTime(),
  };
}

type NoteSignal = "guest_inside" | "access_problem" | null;

/**
 * The attendant's own BLOCKER notes. DND, come-back-later and declined service
 * used to be note-only; they are now authoritative columns (dnd_flag,
 * dnd_retry_at, do_not_service), so those notes are ignored here — a note must
 * never resurrect a restriction the server has since cleared.
 */
function blockerNoteSignal(note: string | null | undefined): NoteSignal {
  const text = note?.trim();
  if (!text?.startsWith("BLOCKER: ")) return null;
  const body = text.slice("BLOCKER: ".length).toLowerCase();
  if (/dnd on door|come back later|declined service/.test(body)) return null;
  if (/guest inside|late checkout/.test(body)) return "guest_inside";
  return "access_problem";
}

function correctionCount(room: Room): number {
  return room.reclean_details?.items?.length ?? room.reclean_corrections?.length ?? 0;
}

export function classifyRoom(
  room: Room,
  opts: { now?: Date; hasLiveSession?: boolean } = {},
): RoomClassification {
  const now = opts.now ?? new Date();
  const base = { primary: null, reasons: [], restricted: false, rush: null, retry: null, reclean: null } as const;

  if (isBlocked(room)) return { ...base, reasons: [], state: "unavailable" };
  if (room.status === "CLEAN" || room.status === "INSPECTED") return { ...base, reasons: [], state: "completed" };

  const rush = getRushInfo(room, now);
  const attempts = room.dnd_attempt_count ?? 0;
  const retryAt = parseMs(room.dnd_retry_at);
  const retry: RetryInfo | null =
    room.dnd_flag || retryAt !== null || attempts > 0
      ? {
          at: room.dnd_retry_at ?? null,
          due: retryAt !== null && retryAt <= now.getTime(),
          attempts,
          lastAttemptAt: room.dnd_last_attempt_at ?? null,
        }
      : null;
  const reclean: RecleanInfo | null = room.reclean_requested_at
    ? { requestedAt: room.reclean_requested_at, corrections: correctionCount(room) }
    : null;

  if (opts.hasLiveSession || room.status === "IN_PROGRESS") {
    return { state: "active", primary: null, reasons: [], restricted: false, rush, retry, reclean };
  }

  const found = new Set<AttentionCode>();
  const vacantDeparture = isDepartureClean(room) && Boolean(room.actual_checkout_at);

  if (room.dnd_flag) found.add("dnd");
  // A decline only holds while the stay does; a verified checkout ends it.
  if (room.do_not_service && !room.actual_checkout_at) {
    found.add(room.service_declined_at || room.service_declined_reason ? "service_declined" : "do_not_service");
  }
  const noteSignal = blockerNoteSignal(room.latest_note);
  if (noteSignal) found.add(noteSignal);
  if (isDepartureClean(room) && !room.actual_checkout_at) found.add("checkout_unverified");
  if (!room.dnd_flag && retryAt !== null && retryAt > now.getTime()) found.add("come_back_later");
  if (reclean) found.add("reclean");
  if (!vacantDeparture && hasOpenWorkOrder(room)) found.add("work_order");
  if (room.risk_level === "HIGH") found.add("high_risk");
  if (!vacantDeparture && !room.latest_note?.trim().startsWith("BLOCKER: ") && hasBlockingNote(room)) found.add("note");

  const reasons = ATTENTION_PRECEDENCE.filter((code) => found.has(code));
  const needsAttention = reasons.some((code) => ATTENTION_TRIGGERS.has(code));
  return {
    state: needsAttention ? "needs_attention" : "cleanable",
    primary: needsAttention ? (reasons[0] ?? null) : null,
    reasons,
    restricted: reasons.some((code) => RESTRICTING.has(code)),
    rush,
    retry,
    reclean,
  };
}

/** True when ordinary Start Cleaning must be refused for this room right now. */
export function isEntryRestricted(room: Room, now: Date = new Date()): boolean {
  return classifyRoom(room, { now }).restricted;
}
