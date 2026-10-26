import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { contextFor } from "@/lib/housekeeping/assignmentPicker";
import { projectPersonLoad } from "@/lib/housekeeping/assignmentWorkload";
import { buildPool, buildReceivers, smartReadiness, type ExcludedRoom, type ExcludedStaff, type Receiver, type SmartPool, type SmartScope, type SmartUnavailable } from "@/lib/housekeeping/smartBalancePool";
import {
  staffPolicyFrom,
  toWirePreferences,
  type PropertyAssignmentPreferences,
  type SmartToggles,
  type WirePreferences,
} from "@/lib/housekeeping/smartBalancePolicy";
import type { SmartBalanceBody, WireRoom, WireStaff } from "@/lib/housekeeping/smartBalanceWire";

/* ─── Smart Balance — from the verified Assignments model to a planning request ───
   Pure. Everything the planner is told comes from the SAME model Rooms and Team read (no second snapshot, no fetch of
   its own), and nothing in it is a safety decision the server cannot re-check: the server re-verifies the tenant, every
   room's stage / soft blocks / current owner and every person's role before it plans anything.

   WORKLOAD IS COUNTED, NOT GUESSED
     Each receiver's `base_*` figures are the work they ALREADY have that this plan will not touch: their remaining and
     in-progress rooms minus the pool rooms they currently own (those are decided by the plan and added back from the
     pool). Unknown estimates stay unknown (`base_unknown_rooms`); an unknown credit makes `credits_complete` false. */

export interface SmartInput {
  body: SmartBalanceBody;
  scope: SmartScope;
  toggles: SmartToggles;
  wirePreferences: WirePreferences;
  pool: SmartPool;
  receivers: Receiver[];
  excludedStaff: ExcludedStaff[];
  hotelDate: string;
  snapshotVerifiedAt: number;
}

export interface BuildArgs {
  model: AssignmentsModel;
  gateAllowed: boolean;
  isOnline: boolean;
  scope: SmartScope;
  selectedIds: ReadonlySet<string>;
  toggles: SmartToggles;
  property: PropertyAssignmentPreferences;
}

export type BuildOutcome =
  | { ok: true; input: SmartInput }
  /** Not generated. The pool/receivers are still returned so the screen can explain (e.g. "3 rooms held back"). */
  | { ok: false; reason: SmartUnavailable; pool: SmartPool; excludedRooms: ExcludedRoom[]; excludedStaff: ExcludedStaff[] };

function wireRoom(entry: AssignmentRoom): WireRoom {
  const { room, estimate, credits, priority, ownership } = entry;
  return {
    room_id: room.roomId,
    room_number: room.roomNumber,
    floor: room.floorKnown ? room.floor : null,
    building: room.building,
    expected_owner_id: ownership.userId,
    minutes: estimate ? estimate.minutes : null,
    minutes_basis: estimate ? estimate.basis : null,
    credits: credits.credits,
    reasons: [...priority.reasons],
    arrival_at: priority.arrivalAt === null ? null : Math.floor(priority.arrivalAt / 1000),
  };
}

function wireStaff(model: AssignmentsModel, receiver: Receiver, poolIds: ReadonlySet<string>): WireStaff {
  const { member } = receiver;
  const all = (model.rooms ?? []).map((entry) => entry.room);
  const ownedPool = (model.rooms ?? []).filter((entry) => entry.ownership.userId === member.userId && poolIds.has(entry.room.roomId)).map((entry) => entry.room.roomId);
  // Their load WITHOUT the pool rooms they currently own: the plan decides those and the planner adds them back.
  const base = projectPersonLoad(member.userId, all, { release: ownedPool }, contextFor(model, member));
  const stays = (model.rooms ?? []).filter(
    (entry) => entry.ownership.userId === member.userId && !poolIds.has(entry.room.roomId) && (entry.room.statusInfo.stage === "to_clean" || entry.room.statusInfo.stage === "in_progress"),
  );
  const floors = new Map<string, { building: string | null; floor: number }>();
  const buildings = new Set<string>();
  for (const entry of stays) {
    if (entry.room.building !== null) buildings.add(entry.room.building);
    if (entry.room.floorKnown) floors.set(`${entry.room.building ?? ""}|${entry.room.floor}`, { building: entry.room.building, floor: entry.room.floor });
  }
  const credits = base.credits;
  return {
    user_id: member.userId,
    base_minutes: base.minutes.remainingMinutes,
    base_unknown_rooms: base.minutes.roomsWithoutEstimate,
    base_rooms: base.minutes.remainingRooms,
    base_credits: credits.available ? credits.remaining : 0,
    credits_complete: credits.available && credits.complete,
    credit_target: base.capacity.target,
    shift_minutes_left: base.shift.minutesLeft,
    floors: [...floors.values()].sort((a, b) => (a.building ?? "").localeCompare(b.building ?? "") || a.floor - b.floor),
    buildings: [...buildings].sort(),
  };
}

export function buildSmartInput(args: BuildArgs): BuildOutcome {
  const { model, scope, selectedIds, toggles, property } = args;
  const pool = buildPool(model, scope, selectedIds);
  const people = buildReceivers(model, staffPolicyFrom(property));
  const reason = smartReadiness({ model, gateAllowed: args.gateAllowed, isOnline: args.isOnline, scope, pool, receivers: people });
  if (reason) return { ok: false, reason, pool, excludedRooms: pool.excluded, excludedStaff: people.excluded };

  const poolIds = new Set(pool.rooms.map((entry) => entry.room.roomId));
  const wirePreferences = toWirePreferences(toggles, property);
  const verifiedAt = "verifiedAt" in model.availability && typeof model.availability.verifiedAt === "number" ? model.availability.verifiedAt : model.generatedAt;
  const body: SmartBalanceBody = {
    date: model.hotelDate,
    scope,
    rooms: pool.rooms.map(wireRoom),
    staff: people.receivers.map((receiver) => wireStaff(model, receiver, poolIds)),
    preferences: wirePreferences,
    snapshot_verified_at: verifiedAt,
  };
  return { ok: true, input: { body, scope, toggles, wirePreferences, pool, receivers: people.receivers, excludedStaff: people.excluded, hotelDate: model.hotelDate, snapshotVerifiedAt: verifiedAt } };
}
