import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { buildWorkload, estimateRoom, type LearnedLookup, type StaffWorkload } from "@/lib/housekeeping/roomAssignment";
import type { ShiftTime } from "@/lib/housekeeping/assignmentSchedule";

/* ─── Supervisor Assignments — workload, credits and capacity ───────────────
   Pure. THREE DIFFERENT MEASUREMENTS, never mixed:

     minutes     estimated cleaning time. Learned history or the room type's configured minutes, from the
                 Room Board estimate model (`estimateRoom` / `buildWorkload`). A room with no estimate adds
                 nothing and is counted in `roomsWithoutEstimate` — it is NEVER padded with a default.
     credits     the property's relative workload weight per clean type (Settings → Housekeeping → Workload,
                 default DEP 3 / FULL 2 / LIGHT 1). A room whose clean type is missing or unrecognised has NO
                 credit value (counted in `roomsWithoutCredit`), unlike the web's silent 0.
     capacity    credits measured against a daily target (the hotel default, or the person's override).
                 A percentage exists only when BOTH sides are reliable: the credits are complete and the target
                 is known.

   Totals are real sums: nothing is capped at a working day. When some rooms lack a value the total is a
   LOWER BOUND (`complete: false`). A lower bound can prove "over" (more than that is already too much) but can
   never prove "fine", so only the first is ever reported from an incomplete figure.

   Credits are not minutes: a 3-credit room is not "3× as long". Callers must not convert one into the other. */

/* ─── Settings ────────────────────────────────────────────────────────────── */

export type CleanType = "DEP" | "FULL" | "LIGHT";
const CLEAN_TYPES: readonly CleanType[] = ["DEP", "FULL", "LIGHT"];

export interface WorkloadSettings {
  /** Daily credits per attendant when no override applies. */
  targetCredits: number;
  creditWeights: Record<CleanType, number>;
  /** Per-person daily target keyed by user id. */
  capacityOverrides: Record<string, number>;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * GET /hotels/{id}/housekeeping-settings → settings. Strict: a body that is not the documented shape throws so
 * the loader reports "unavailable" — it never falls back to invented numbers. The server already substitutes
 * the legacy defaults (16 credits; 3/2/1) when a hotel configured nothing, so a missing field here is a
 * malformed response, not "use the default". Individual invalid overrides are ignored (they only ever lower
 * trust in that one person, who then falls back to the hotel target).
 */
export function parseWorkloadSettings(payload: unknown): WorkloadSettings {
  const data = (payload as { data?: Record<string, unknown> } | null | undefined)?.data;
  const target = finitePositive(data?.default_target_credits);
  const weights = data?.credit_weights as Record<string, unknown> | undefined;
  const parsedWeights = {} as Record<CleanType, number>;
  for (const type of CLEAN_TYPES) {
    const weight = weights?.[type];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) throw new Error("Malformed workload settings response");
    parsedWeights[type] = weight;
  }
  if (target === null) throw new Error("Malformed workload settings response");
  const capacityOverrides: Record<string, number> = {};
  const rawOverrides = data?.capacity_overrides;
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [userId, value] of Object.entries(rawOverrides)) {
      const parsed = finitePositive(value);
      if (parsed !== null) capacityOverrides[userId] = parsed;
    }
  }
  return { targetCredits: target, creditWeights: parsedWeights, capacityOverrides };
}

/* ─── Credits ─────────────────────────────────────────────────────────────── */

export type CreditBasis = "weighted" | "no_work" | "unknown_clean_type" | "settings_unavailable";

export interface RoomCredits {
  /** null = no honest value (see `basis`). */
  credits: number | null;
  basis: CreditBasis;
}

function isCleanType(value: string | null): value is CleanType {
  return value !== null && (CLEAN_TYPES as readonly string[]).includes(value);
}

/**
 * The workload credits one room represents. A room the guest declined service for is real, known, zero work;
 * a room whose clean type is not DEP/FULL/LIGHT has no value rather than a guessed one.
 */
export function roomCredits(room: Pick<BoardRoom, "cleanType" | "serviceDeclined">, settings: WorkloadSettings | null): RoomCredits {
  if (!settings) return { credits: null, basis: "settings_unavailable" };
  if (room.serviceDeclined.declined) return { credits: 0, basis: "no_work" };
  if (!isCleanType(room.cleanType)) return { credits: null, basis: "unknown_clean_type" };
  return { credits: settings.creditWeights[room.cleanType], basis: "weighted" };
}

export interface CreditLoad {
  /** The workload settings were available; false = every credit figure below is unknown. */
  available: boolean;
  /** Sum of the known credits of remaining work. A lower bound unless `complete`. */
  remaining: number;
  /** Remaining rooms that have no credit value. */
  roomsWithoutCredit: number;
  /** Every remaining room has a value, so `remaining` is the whole figure. */
  complete: boolean;
}

const NO_CREDITS: CreditLoad = { available: false, remaining: 0, roomsWithoutCredit: 0, complete: false };

/** Work that still has to be done: to clean, or being cleaned. */
export function isRemainingWork(room: Pick<BoardRoom, "statusInfo">): boolean {
  const stage = room.statusInfo.stage;
  return stage === "to_clean" || stage === "in_progress";
}

export function sumCredits(rooms: readonly BoardRoom[], settings: WorkloadSettings | null): CreditLoad {
  if (!settings) return NO_CREDITS;
  let remaining = 0;
  let missing = 0;
  for (const room of rooms) {
    if (!isRemainingWork(room)) continue;
    const { credits } = roomCredits(room, settings);
    if (credits === null) missing += 1;
    else remaining += credits;
  }
  return { available: true, remaining, roomsWithoutCredit: missing, complete: missing === 0 };
}

/* ─── Capacity ────────────────────────────────────────────────────────────── */

/** Same bands as the web Assignment Workspace (±2 credits is "on target"). */
export type CapacityState = "under" | "on" | "at" | "over";

export function capacityState(credits: number, target: number): CapacityState {
  if (target <= 0) return credits > 0 ? "over" : "on";
  const over = credits - target;
  if (over > 2) return "over";
  if (credits >= target) return "at";
  if (over < -2) return "under";
  return "on";
}

export type TargetSource = "override" | "default" | "unknown";

export interface Capacity {
  target: number | null;
  targetSource: TargetSource;
  /** null whenever it cannot be stated truthfully (see module header). */
  state: CapacityState | null;
  /** credits ÷ target, NOT capped (1.4 = 140%). null unless credits are complete and the target is known. */
  utilization: number | null;
  /** target − remaining credits; negative when over. Only when `utilization` is reliable. */
  creditsLeft: number | null;
}

export function targetFor(userId: string, settings: WorkloadSettings | null): { target: number | null; source: TargetSource } {
  if (!settings) return { target: null, source: "unknown" };
  const override = settings.capacityOverrides[userId];
  return override !== undefined ? { target: override, source: "override" } : { target: settings.targetCredits, source: "default" };
}

export function buildCapacity(userId: string, credits: CreditLoad, settings: WorkloadSettings | null): Capacity {
  const { target, source } = targetFor(userId, settings);
  if (target === null || !credits.available) {
    return { target, targetSource: source, state: null, utilization: null, creditsLeft: null };
  }
  if (!credits.complete) {
    // A lower bound can only prove "over".
    return { target, targetSource: source, state: capacityState(credits.remaining, target) === "over" ? "over" : null, utilization: null, creditsLeft: null };
  }
  return {
    target,
    targetSource: source,
    state: capacityState(credits.remaining, target),
    utilization: credits.remaining / target,
    creditsLeft: target - credits.remaining,
  };
}

/* ─── Per-person load ─────────────────────────────────────────────────────── */

export type WorkloadWarning =
  | "over_credit_target"
  | "exceeds_shift_time"
  | "exceeds_full_day"
  | "estimates_missing"
  | "credits_missing";

export interface ShiftFit {
  /** Minutes of the scheduled shift still ahead; null when no readable schedule exists. */
  minutesLeft: number | null;
  /** Remaining estimated minutes exceed the shift time left. null = cannot say (no schedule, or an incomplete estimate that is still within it). */
  exceeds: boolean | null;
}

export interface PersonLoad {
  minutes: StaffWorkload;
  credits: CreditLoad;
  capacity: Capacity;
  shift: ShiftFit;
  warnings: WorkloadWarning[];
}

export interface LoadContext {
  settings: WorkloadSettings | null;
  learned?: LearnedLookup;
  /** This person's scheduled shift time, or null when unknown. */
  shiftTime?: ShiftTime | null;
}

function shiftFit(minutes: StaffWorkload, shiftTime: ShiftTime | null | undefined): ShiftFit {
  if (!shiftTime) return { minutesLeft: null, exceeds: null };
  if (minutes.remainingMinutes > shiftTime.minutesLeft) return { minutesLeft: shiftTime.minutesLeft, exceeds: true };
  // Within the shift only counts as a fit when the estimate is the whole figure.
  return { minutesLeft: shiftTime.minutesLeft, exceeds: minutes.minutesComplete ? false : null };
}

/** `rooms` may be the whole board: only rooms owned by `userId` count. */
export function computePersonLoad(userId: string, rooms: readonly BoardRoom[], context: LoadContext): PersonLoad {
  const minutes = buildWorkload(userId, rooms, context.learned);
  const owned = rooms.filter((room) => room.assignment.userId === userId);
  const credits = sumCredits(owned, context.settings);
  const capacity = buildCapacity(userId, credits, context.settings);
  const shift = shiftFit(minutes, context.shiftTime);
  const warnings: WorkloadWarning[] = [];
  if (capacity.state === "over") warnings.push("over_credit_target");
  if (shift.exceeds === true) warnings.push("exceeds_shift_time");
  if (minutes.overloaded) warnings.push("exceeds_full_day");
  if (minutes.roomsWithoutEstimate > 0) warnings.push("estimates_missing");
  if (credits.available && credits.roomsWithoutCredit > 0) warnings.push("credits_missing");
  return { minutes, credits, capacity, shift, warnings };
}

/* ─── Projection ──────────────────────────────────────────────────────────── */

/** A copy of the room as if it were owned by `userId` (used to project a hypothetical assignment). */
export function withOwner(room: BoardRoom, userId: string | null): BoardRoom {
  return {
    ...room,
    assignment: { ...room.assignment, userId, source: userId ? (room.assignment.source === "none" ? "dated" : room.assignment.source) : "none" },
  };
}

export interface LoadChange {
  /** Rooms that would become this person's. */
  add?: readonly BoardRoom[];
  /** Rooms (by id) that would stop being this person's. */
  release?: readonly string[];
}

/**
 * The person's load if `change` happened. Rooms that are both released and added end up added; a room the person
 * already owns that is "added" is not counted twice.
 */
export function projectPersonLoad(userId: string, rooms: readonly BoardRoom[], change: LoadChange, context: LoadContext): PersonLoad {
  const released = new Set(change.release ?? []);
  const added = new Map((change.add ?? []).map((room) => [room.roomId, room]));
  const kept = rooms.filter((room) => !added.has(room.roomId) && !(released.has(room.roomId) && room.assignment.userId === userId));
  const next = [...kept, ...[...added.values()].map((room) => withOwner(room, userId))];
  return computePersonLoad(userId, next, context);
}

/* ─── Property totals ─────────────────────────────────────────────────────── */

export interface PropertyLoad {
  /** Remaining work, assigned or not. */
  remainingRooms: number;
  remainingMinutes: number;
  roomsWithoutEstimate: number;
  credits: CreditLoad;
  /** The same figures for remaining work nobody owns. */
  unassignedRooms: number;
  unassignedMinutes: number;
  unassignedCredits: CreditLoad;
}

export function buildPropertyLoad(rooms: readonly BoardRoom[], settings: WorkloadSettings | null, learned?: LearnedLookup): PropertyLoad {
  const remaining = rooms.filter(isRemainingWork);
  const unassigned = remaining.filter((room) => room.assignment.source === "none");
  const minutesOf = (list: readonly BoardRoom[]) => {
    let minutes = 0;
    let missing = 0;
    for (const room of list) {
      const estimate = estimateRoom(room, learned);
      if (estimate) minutes += estimate.minutes;
      else missing += 1;
    }
    return { minutes, missing };
  };
  const all = minutesOf(remaining);
  const open = minutesOf(unassigned);
  return {
    remainingRooms: remaining.length,
    remainingMinutes: all.minutes,
    roomsWithoutEstimate: all.missing,
    credits: sumCredits(remaining, settings),
    unassignedRooms: unassigned.length,
    unassignedMinutes: open.minutes,
    unassignedCredits: sumCredits(unassigned, settings),
  };
}
