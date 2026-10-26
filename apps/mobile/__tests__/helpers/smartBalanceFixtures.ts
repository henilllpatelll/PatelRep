import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { DEFAULT_PROPERTY_PREFERENCES, togglesFromProperty, type PropertyAssignmentPreferences, type SmartToggles } from "@/lib/housekeeping/smartBalancePolicy";
import type { SmartScope } from "@/lib/housekeeping/smartBalancePool";
import { buildSmartInput, type SmartInput } from "@/lib/housekeeping/smartBalanceRequest";
import type { SmartBalanceResponse, WireAssignment, WireRejectedRoom, WireUnallocated } from "@/lib/housekeeping/smartBalanceWire";
import { buildSmartPlan, type SmartPlan } from "@/lib/housekeeping/smartBalancePlan";
import { HOTEL_DATE, NOW } from "./roomBoardFixtures";

export const SCOPE_KEY = "tenant-1:sup-1";

export function inputOf(
  model: AssignmentsModel,
  scope: SmartScope = "unassigned",
  options: { selected?: string[]; toggles?: SmartToggles; property?: PropertyAssignmentPreferences; gate?: boolean; online?: boolean } = {},
): SmartInput {
  const property = options.property ?? DEFAULT_PROPERTY_PREFERENCES;
  const outcome = buildSmartInput({
    model,
    gateAllowed: options.gate ?? true,
    isOnline: options.online ?? true,
    scope,
    selectedIds: new Set(options.selected ?? []),
    toggles: options.toggles ?? togglesFromProperty(property),
    property,
  });
  if (!outcome.ok) throw new Error(`not ready: ${outcome.reason}`);
  return outcome.input;
}

const id = (number: string) => `room-${number}`;

export interface AnswerSpec {
  status?: SmartBalanceResponse["status"];
  /** [room number, receiver] - the kind and the from-owner are taken from the request. */
  assign?: [string, string][];
  /** Owned rooms that stay put. */
  retain?: string[];
  unallocated?: [string, WireUnallocated["reason"]][];
  rejected?: [string, WireRejectedRoom["reason"]][];
  rejectedStaff?: string[];
  noCapacity?: string[];
}

/** A well-formed planner answer for `input`, as the strict reader returns it. */
export function answerFor(input: SmartInput, spec: AnswerSpec = {}): SmartBalanceResponse {
  const owner = (number: string) => input.pool.rooms.find((entry) => entry.room.roomNumber === number)?.ownership.userId ?? null;
  const assignments: WireAssignment[] = [
    ...(spec.assign ?? []).map<WireAssignment>(([number, to]) => ({
      room_id: id(number),
      room_number: number,
      kind: owner(number) === null ? "new" : "moved",
      from_user_id: owner(number),
      to_user_id: to,
      tier: "routine",
      reasons: [],
    })),
    ...(spec.retain ?? []).map<WireAssignment>((number) => ({
      room_id: id(number),
      room_number: number,
      kind: "retained",
      from_user_id: owner(number),
      to_user_id: owner(number) as string,
      tier: "routine",
      reasons: [{ code: "keeps_current_owner" }],
    })),
  ];
  return {
    planId: "plan-1",
    date: input.hotelDate,
    scope: input.scope,
    generatedAt: "2026-10-16T17:00:01Z",
    snapshotVerifiedAt: input.snapshotVerifiedAt,
    status: spec.status ?? "optimal",
    assignments,
    unallocated: (spec.unallocated ?? []).map(([number, reason]) => ({ room_id: id(number), room_number: number, reason, tier: "routine" as const })),
    staff: input.receivers.map((receiver) => ({
      user_id: receiver.member.userId,
      rooms_added: assignments.filter((a) => a.to_user_id === receiver.member.userId && a.kind !== "retained").length,
      rooms_released: 0,
      minutes_added_known: 0,
      unknown_added: 0,
      no_capacity: (spec.noCapacity ?? []).includes(receiver.member.userId),
    })),
    rejectedRooms: (spec.rejected ?? []).map(([number, reason]) => ({ room_id: id(number), room_number: number, reason })),
    rejectedStaff: spec.rejectedStaff ?? [],
    assumptions: [],
    warnings: [],
  };
}

/** Every pool room not otherwise mentioned goes in `unallocated` so the answer accounts for all of them. */
export function planOf(model: AssignmentsModel, input: SmartInput, spec: AnswerSpec = {}): SmartPlan {
  const mentioned = new Set([...(spec.assign ?? []).map(([n]) => n), ...(spec.retain ?? []), ...(spec.unallocated ?? []).map(([n]) => n), ...(spec.rejected ?? []).map(([n]) => n)]);
  const rest = input.pool.rooms.filter((entry) => !mentioned.has(entry.room.roomNumber));
  const filled: AnswerSpec = {
    ...spec,
    // Rooms nobody owns that the test did not place were left out for capacity; owned ones simply stay with their owner.
    unallocated: [...(spec.unallocated ?? []), ...rest.filter((entry) => !entry.ownership.assigned).map((entry) => [entry.room.roomNumber, "insufficient_capacity"] as [string, WireUnallocated["reason"]])],
    retain: [...(spec.retain ?? []), ...rest.filter((entry) => entry.ownership.assigned).map((entry) => entry.room.roomNumber)],
  };
  const built = buildSmartPlan(input, answerFor(input, filled), { scopeKey: SCOPE_KEY, now: NOW, model });
  if (!built.ok) throw new Error(`plan refused: ${built.refusal}`);
  return built.plan;
}

export { HOTEL_DATE, NOW };
