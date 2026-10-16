import type { Room } from "@/stores/appStore";
import { isDepartureClean, isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";
import { elapsedSeconds } from "@/lib/housekeeping/cleaningTimer";
import { estimateBasisOf, type EstimateBasis } from "@/lib/housekeeping/cleaningEstimate";
import { getSequenceOrder, type DashboardModel, type RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";

/**
 * "What should I do next?", answered from the same dashboard model My Rooms
 * renders — never from a second ranking. The result is structured data (codes,
 * not sentences) so the UI can say WHY in the person's language, and so AI can
 * never be the thing that decides order or access.
 */

export type RecommendationKind = "continue" | "start";

export type RecommendationReason =
  /** A cleaning session is already open on this room. */
  | "active_session"
  /** The supervisor / auto-assign visiting order puts it first. */
  | "assigned_sequence"
  /** Rush priority, with its deadline if any. */
  | "rush"
  /** An inspector asked for corrections. */
  | "reclean"
  /** A departure with a guest arriving within hours. */
  | "arrival_soon"
  /** The front desk has verified the guest left. */
  | "checkout_verified"
  /** Nothing outranks it; it comes first in the standard queue. */
  | "queue_order";

export type RecommendationPriority = "active" | "sequenced" | "rush" | "reclean" | "standard";

export interface RecommendationTiming {
  /** An estimate from the room type, never a deadline. */
  estimateMinutes: number;
  /** Whether the estimate is the hotel's room-type baseline or the app's general fallback. */
  estimateBasis: EstimateBasis;
  neededBy: string | null;
  neededByOverdue: boolean;
  /** Only the front desk's verified checkout; a scheduled time is not one. */
  checkoutVerifiedAt: string | null;
  arrivalAt: string | null;
  arrivalSoon: boolean;
  sequenceOrder: number | null;
  /** Authoritative clean-session start; null when unknown (never invented). */
  startedAt: string | null;
  startedAtVerified: boolean;
  elapsedSeconds: number | null;
}

export interface Recommendation {
  kind: RecommendationKind;
  room: Room;
  entry: RoomEntry;
  priority: RecommendationPriority;
  /** The one reason shown to the person. */
  reason: RecommendationReason;
  /** Other true facts that also apply (e.g. rush AND sequenced). */
  alsoApplies: RecommendationReason[];
  timing: RecommendationTiming;
}

export type NoRecommendationReason =
  | "board_unavailable"
  | "no_rooms"
  /** Everything workable is done; only restricted rooms remain. */
  | "only_attention"
  | "all_done";

function reasonsFor(entry: RoomEntry, now: Date): RecommendationReason[] {
  const room = entry.room;
  const found: RecommendationReason[] = [];
  if (getSequenceOrder(room) !== null) found.push("assigned_sequence");
  if (entry.rush) found.push("rush");
  if (entry.classification.reclean) found.push("reclean");
  if (isDepartureClean(room) && isArrivalSoon(room, now)) found.push("arrival_soon");
  if (isDepartureClean(room) && room.actual_checkout_at) found.push("checkout_verified");
  return found;
}

const PRIORITY: Record<RecommendationReason, RecommendationPriority> = {
  active_session: "active",
  assigned_sequence: "sequenced",
  rush: "rush",
  reclean: "reclean",
  arrival_soon: "standard",
  checkout_verified: "standard",
  queue_order: "standard",
};

function timingFor(entry: RoomEntry, now: Date): RecommendationTiming {
  const room = entry.room;
  const session = entry.session;
  const startedAt = session && session.state !== "missing" ? session.startedAt : null;
  return {
    estimateMinutes: entry.estimateMinutes,
    estimateBasis: entry.estimateBasis ?? estimateBasisOf(room),
    neededBy: entry.neededBy,
    neededByOverdue: entry.rush?.overdue ?? false,
    checkoutVerifiedAt: room.actual_checkout_at ?? null,
    arrivalAt: room.checkin_time ?? null,
    arrivalSoon: isArrivalSoon(room, now),
    sequenceOrder: getSequenceOrder(room),
    startedAt,
    // "starting" = begun on this device, not yet confirmed by the server.
    startedAtVerified: Boolean(startedAt) && session?.state !== "starting",
    elapsedSeconds: elapsedSeconds(startedAt, now.getTime()),
  };
}

/**
 * Active eligible session first; otherwise the head of the dashboard's Up Next
 * (which already excludes DND, declined service, unverified checkouts, blocked
 * rooms and anything else restricted, and orders by supervisor sequence, rush,
 * reclean, then the standard queue).
 */
export function buildRecommendation(dashboard: DashboardModel, now: Date): Recommendation | null {
  const active = dashboard.current[0];
  if (active) {
    return {
      kind: "continue",
      room: active.room,
      entry: active,
      priority: "active",
      reason: "active_session",
      alsoApplies: reasonsFor(active, now),
      timing: timingFor(active, now),
    };
  }
  const next = dashboard.upNext[0];
  if (!next) return null;
  const reasons = reasonsFor(next, now);
  const reason = reasons[0] ?? "queue_order";
  return {
    kind: "start",
    room: next.room,
    entry: next,
    priority: PRIORITY[reason],
    reason,
    alsoApplies: reasons.slice(1),
    timing: timingFor(next, now),
  };
}

/**
 * The recommendation for the room that follows the one being cleaned: the head of Up Next, ranked by the
 * same rules as everything else. Used to explain the "Up next" card while a room is open.
 */
export function recommendNext(dashboard: DashboardModel, now: Date): Recommendation | null {
  return buildRecommendation({ ...dashboard, current: [] }, now);
}

export function whyNoRecommendation(dashboard: DashboardModel, boardUsable: boolean): NoRecommendationReason {
  if (!boardUsable) return "board_unavailable";
  if (dashboard.progress.assigned === 0) return "no_rooms";
  if (dashboard.attention.length > 0) return "only_attention";
  return "all_done";
}
