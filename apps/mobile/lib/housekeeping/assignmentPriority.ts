import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { compareRoomNumbers, urgentReasons } from "@/lib/housekeeping/roomBoardSelectors";

/* ─── Supervisor Assignments — operational priority ─────────────────────────
   Pure and deterministic. A room's priority is EXPLAINED by the recorded facts behind it; there is no
   score to second-guess and no inferred deadline.

     guest_waiting      a guest is waiting on this room. The board payload does not carry it, so it is an
                        injected signal: `null` means "unknown", which is not the same as "nobody waits"
                        (`PriorityContext.guestWaitingKnown`).
     reclean_requested  a reclean was requested after a failed inspection
     rush               an explicit priority set below the schedule default (5)
     arrival_passed     the recorded guest arrival is today, has passed, and the room is not ready
     arrival_today      a recorded guest arrival later today — a real deadline, ordered earliest first
     vip                a VIP room that is not guest-ready
     high_risk          the stored readiness forecast says HIGH risk. A FORECAST: it never guarantees
                        anything and ranks below every recorded fact above.

   Tiers (highest first): critical → high → elevated → routine. A room that is out of service or already
   guest-ready is always routine: nobody can act on it. */

export type PriorityReason =
  | "guest_waiting"
  | "reclean_requested"
  | "rush"
  | "arrival_passed"
  | "arrival_today"
  | "vip"
  | "high_risk";

export type PriorityTier = "critical" | "high" | "elevated" | "routine";

const REASON_TIER: Record<PriorityReason, PriorityTier> = {
  guest_waiting: "critical",
  reclean_requested: "high",
  rush: "high",
  arrival_passed: "high",
  arrival_today: "elevated",
  vip: "elevated",
  high_risk: "elevated",
};

const REASON_ORDER: readonly PriorityReason[] = [
  "guest_waiting",
  "reclean_requested",
  "rush",
  "arrival_passed",
  "arrival_today",
  "vip",
  "high_risk",
];

export const TIER_RANK: Record<PriorityTier, number> = { critical: 0, high: 1, elevated: 2, routine: 3 };

export interface PriorityContext {
  now: number;
  timeZone: string | null | undefined;
  /** Room ids with a guest waiting, or null when that is not known. */
  guestWaiting: ReadonlySet<string> | null;
}

export interface RoomPriority {
  tier: PriorityTier;
  /** Every reason that applies, in `REASON_ORDER`. */
  reasons: PriorityReason[];
  /** The recorded guest arrival today (epoch ms), or null. Used to order a deadline, never invented. */
  arrivalAt: number | null;
}

function arrivalToday(room: BoardRoom, context: PriorityContext): number | null {
  if (!room.checkinTime) return null;
  const at = Date.parse(room.checkinTime);
  if (Number.isNaN(at)) return null;
  return hotelDateKey(new Date(at), context.timeZone) === hotelDateKey(new Date(context.now), context.timeZone) ? at : null;
}

export function describePriority(room: BoardRoom, context: PriorityContext): RoomPriority {
  const stage = room.statusInfo.stage;
  if (stage === "unavailable" || stage === "guest_ready") return { tier: "routine", reasons: [], arrivalAt: null };

  const recorded = new Set(urgentReasons(room, context.now, context.timeZone));
  const arrivalAt = arrivalToday(room, context);
  const present: Record<PriorityReason, boolean> = {
    guest_waiting: context.guestWaiting?.has(room.roomId) === true,
    reclean_requested: recorded.has("reclean_requested"),
    rush: recorded.has("priority_elevated"),
    arrival_passed: recorded.has("arrival_passed"),
    arrival_today: arrivalAt !== null && arrivalAt > context.now,
    vip: recorded.has("vip_not_ready"),
    high_risk: recorded.has("high_risk"),
  };
  const reasons = REASON_ORDER.filter((reason) => present[reason]);
  const tier = reasons.reduce<PriorityTier>((best, reason) => (TIER_RANK[REASON_TIER[reason]] < TIER_RANK[best] ? REASON_TIER[reason] : best), "routine");
  return { tier, reasons, arrivalAt };
}

/**
 * Highest tier first; then the earliest recorded arrival (a room with a known arrival before one without);
 * then more reasons first; then room number and room id so the order never depends on input order.
 */
export function comparePriority(
  a: { room: BoardRoom; priority: RoomPriority },
  b: { room: BoardRoom; priority: RoomPriority },
): number {
  const tier = TIER_RANK[a.priority.tier] - TIER_RANK[b.priority.tier];
  if (tier !== 0) return tier;
  const arrivalA = a.priority.arrivalAt;
  const arrivalB = b.priority.arrivalAt;
  if (arrivalA !== arrivalB) {
    if (arrivalA === null) return 1;
    if (arrivalB === null) return -1;
    return arrivalA - arrivalB;
  }
  const reasons = b.priority.reasons.length - a.priority.reasons.length;
  if (reasons !== 0) return reasons;
  return compareRoomNumbers(a.room, b.room);
}
