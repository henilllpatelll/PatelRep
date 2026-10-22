import type { PriorityReason } from "@/lib/housekeeping/assignmentPriority";
import type { WirePreferences } from "@/lib/housekeeping/smartBalancePolicy";

/* ─── Smart Balance — the planning endpoint's wire contract ──────────────────
   POST /housekeeping/smart-balance/plan (apps/api/routers/housekeeping.py). READ-ONLY: the answer is a proposal, never
   an applied change. Pure types plus a STRICT reader: anything that is not the documented shape is `null` (the app then
   says the plan could not be verified), never a half-read plan. */

export interface WireRoom {
  room_id: string;
  room_number: string;
  floor: number | null;
  building: string | null;
  /** The owner the supervisor SAW (null = unassigned). The server refuses the room if it is not the owner now. */
  expected_owner_id: string | null;
  minutes: number | null;
  minutes_basis: "history" | "room_type" | null;
  credits: number | null;
  reasons: PriorityReason[];
  arrival_at: number | null;
}

export interface WireStaff {
  user_id: string;
  base_minutes: number;
  base_unknown_rooms: number;
  base_rooms: number;
  base_credits: number;
  credits_complete: boolean;
  credit_target: number | null;
  shift_minutes_left: number | null;
  floors: { building: string | null; floor: number }[];
  buildings: string[];
}

export interface SmartBalanceBody {
  date: string;
  scope: "unassigned" | "all_unstarted" | "selected";
  rooms: WireRoom[];
  staff: WireStaff[];
  preferences: WirePreferences;
  snapshot_verified_at: number;
}

/* ─── Answer ──────────────────────────────────────────────────────────────── */

export type PlanStatus = "optimal" | "feasible" | "fallback" | "no_safe_plan" | "nothing_to_plan" | "no_staff";
export type MoveKind = "new" | "moved" | "retained";
export type UnallocatedReason = "insufficient_capacity" | "no_eligible_staff" | "solver_no_solution";

/** A grounded explanation: structured facts the app words itself. Unknown codes are dropped, never shown as text. */
export type WireReason =
  | { code: "urgent"; reason: PriorityReason }
  | { code: "lowest_workload"; minutes: number }
  | { code: "same_floor"; floor: number }
  | { code: "same_building"; building: string }
  | { code: "moved_from_owner"; from: string }
  | { code: "keeps_current_owner" };

export interface WireAssignment {
  room_id: string;
  room_number: string;
  kind: MoveKind;
  from_user_id: string | null;
  to_user_id: string;
  tier: "critical" | "high" | "elevated" | "routine";
  reasons: WireReason[];
}

export interface WireUnallocated {
  room_id: string;
  room_number: string;
  reason: UnallocatedReason;
  tier: WireAssignment["tier"];
}

export type RejectedRoomReason = "not_found" | "not_assignable" | "room_blocked" | "owner_changed";

export interface WireRejectedRoom {
  room_id: string;
  room_number: string;
  reason: RejectedRoomReason;
  blocks?: string[];
  current_owner_id?: string | null;
}

export type WireAssumption =
  | { code: "unknown_estimate_surrogate"; rooms: number; minutes: number }
  | { code: "capacity_unknown"; staff: string[] }
  | { code: "credits_incomplete"; rooms: number; staff: string[] };

export interface WireStaffSummary {
  user_id: string;
  rooms_added: number;
  rooms_released: number;
  minutes_added_known: number;
  unknown_added: number;
  no_capacity: boolean;
}

export interface SmartBalanceResponse {
  planId: string;
  date: string;
  scope: SmartBalanceBody["scope"];
  generatedAt: string;
  snapshotVerifiedAt: number | null;
  status: PlanStatus;
  assignments: WireAssignment[];
  unallocated: WireUnallocated[];
  staff: WireStaffSummary[];
  rejectedRooms: WireRejectedRoom[];
  rejectedStaff: string[];
  assumptions: WireAssumption[];
  warnings: string[];
}

const STATUSES: readonly PlanStatus[] = ["optimal", "feasible", "fallback", "no_safe_plan", "nothing_to_plan", "no_staff"];
const KINDS: readonly MoveKind[] = ["new", "moved", "retained"];
const TIERS = ["critical", "high", "elevated", "routine"] as const;
const UNALLOCATED: readonly UnallocatedReason[] = ["insufficient_capacity", "no_eligible_staff", "solver_no_solution"];
const REJECTED: readonly RejectedRoomReason[] = ["not_found", "not_assignable", "room_blocked", "owner_changed"];
const PRIORITY_REASONS: readonly string[] = ["guest_waiting", "reclean_requested", "rush", "arrival_passed", "arrival_today", "vip", "high_risk"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);
const list = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

function parseReason(raw: unknown): WireReason | null {
  if (!isRecord(raw)) return null;
  switch (raw.code) {
    case "urgent":
      return typeof raw.reason === "string" && PRIORITY_REASONS.includes(raw.reason) ? { code: "urgent", reason: raw.reason as PriorityReason } : null;
    case "lowest_workload":
      return whole(raw.minutes) !== null ? { code: "lowest_workload", minutes: raw.minutes as number } : null;
    case "same_floor":
      return typeof raw.floor === "number" && Number.isFinite(raw.floor) ? { code: "same_floor", floor: raw.floor } : null;
    case "same_building":
      return text(raw.building) ? { code: "same_building", building: raw.building as string } : null;
    case "moved_from_owner":
      return text(raw.from) ? { code: "moved_from_owner", from: raw.from as string } : null;
    case "keeps_current_owner":
      return { code: "keeps_current_owner" };
    default:
      return null;
  }
}

function parseAssumption(raw: unknown): WireAssumption | null {
  if (!isRecord(raw)) return null;
  const staff = list(raw.staff)?.filter((id): id is string => typeof id === "string") ?? [];
  switch (raw.code) {
    case "unknown_estimate_surrogate":
      return whole(raw.rooms) !== null && whole(raw.minutes) !== null ? { code: "unknown_estimate_surrogate", rooms: raw.rooms as number, minutes: raw.minutes as number } : null;
    case "capacity_unknown":
      return { code: "capacity_unknown", staff };
    case "credits_incomplete":
      return { code: "credits_incomplete", rooms: whole(raw.rooms) ?? 0, staff };
    default:
      return null;
  }
}

/** `null` = not the documented shape. Individual explanations / assumptions the app does not know are dropped; everything else must be exact. */
export function parseSmartBalanceResponse(raw: unknown): SmartBalanceResponse | null {
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : isRecord(raw) ? raw : null;
  if (!data || data.read_only !== true) return null;
  const planId = text(data.plan_id);
  const date = text(data.date);
  const generatedAt = text(data.generated_at);
  const status = STATUSES.find((candidate) => candidate === data.status);
  const scope = (["unassigned", "all_unstarted", "selected"] as const).find((candidate) => candidate === data.scope);
  const assignmentsRaw = list(data.assignments);
  const unallocatedRaw = list(data.unallocated);
  const staffRaw = list(data.staff);
  const rejectedRoomsRaw = list(data.rejected_rooms);
  const rejectedStaffRaw = list(data.rejected_staff);
  if (!planId || !date || !generatedAt || !status || !scope || !assignmentsRaw || !unallocatedRaw || !staffRaw || !rejectedRoomsRaw || !rejectedStaffRaw) return null;

  const seen = new Set<string>();
  const assignments: WireAssignment[] = [];
  for (const row of assignmentsRaw) {
    if (!isRecord(row)) return null;
    const roomId = text(row.room_id);
    const toUserId = text(row.to_user_id);
    const kind = KINDS.find((candidate) => candidate === row.kind);
    const tier = TIERS.find((candidate) => candidate === row.tier);
    const from = row.from_user_id === null ? null : text(row.from_user_id);
    if (!roomId || !toUserId || !kind || !tier || seen.has(roomId)) return null;
    // The kinds and the owners must agree: a "new" room had no owner, a "moved" one had a different one, a "retained" one the same.
    if (kind === "new" && from !== null) return null;
    if (kind === "moved" && (from === null || from === toUserId)) return null;
    if (kind === "retained" && (from === null || from !== toUserId)) return null;
    seen.add(roomId);
    assignments.push({
      room_id: roomId,
      room_number: text(row.room_number) ?? "",
      kind,
      from_user_id: from,
      to_user_id: toUserId,
      tier,
      reasons: (list(row.reasons) ?? []).map(parseReason).filter((reason): reason is WireReason => reason !== null),
    });
  }

  const unallocated: WireUnallocated[] = [];
  for (const row of unallocatedRaw) {
    if (!isRecord(row)) return null;
    const roomId = text(row.room_id);
    const reason = UNALLOCATED.find((candidate) => candidate === row.reason);
    const tier = TIERS.find((candidate) => candidate === row.tier);
    if (!roomId || !reason || !tier || seen.has(roomId)) return null;
    seen.add(roomId);
    unallocated.push({ room_id: roomId, room_number: text(row.room_number) ?? "", reason, tier });
  }

  const staff: WireStaffSummary[] = [];
  for (const row of staffRaw) {
    if (!isRecord(row)) return null;
    const userId = text(row.user_id);
    const added = whole(row.rooms_added);
    const released = whole(row.rooms_released);
    const minutes = whole(row.minutes_added_known);
    const unknown = whole(row.unknown_added);
    if (!userId || added === null || released === null || minutes === null || unknown === null || typeof row.no_capacity !== "boolean") return null;
    staff.push({ user_id: userId, rooms_added: added, rooms_released: released, minutes_added_known: minutes, unknown_added: unknown, no_capacity: row.no_capacity });
  }

  const rejectedRooms: WireRejectedRoom[] = [];
  for (const row of rejectedRoomsRaw) {
    if (!isRecord(row)) return null;
    const roomId = text(row.room_id);
    const reason = REJECTED.find((candidate) => candidate === row.reason);
    if (!roomId || !reason || seen.has(roomId)) return null;
    seen.add(roomId);
    rejectedRooms.push({
      room_id: roomId,
      room_number: text(row.room_number) ?? "",
      reason,
      ...(list(row.blocks) ? { blocks: (row.blocks as unknown[]).filter((block): block is string => typeof block === "string") } : {}),
      ...(row.current_owner_id === null || typeof row.current_owner_id === "string" ? { current_owner_id: row.current_owner_id as string | null } : {}),
    });
  }

  const rejectedStaff: string[] = [];
  for (const row of rejectedStaffRaw) {
    if (!isRecord(row) || !text(row.user_id)) return null;
    rejectedStaff.push(row.user_id as string);
  }

  return {
    planId,
    date,
    scope,
    generatedAt,
    snapshotVerifiedAt: whole(data.snapshot_verified_at),
    status,
    assignments,
    unallocated,
    staff,
    rejectedRooms,
    rejectedStaff,
    assumptions: (list(data.assumptions) ?? []).map(parseAssumption).filter((item): item is WireAssumption => item !== null),
    warnings: (list(data.warnings) ?? []).filter((warning): warning is string => typeof warning === "string"),
  };
}
