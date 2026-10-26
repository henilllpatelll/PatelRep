import {
  MAX_ASSIGNMENTS_PER_REQUEST,
  draftChanges,
  draftIsCurrent,
  emptyDraft,
  planChange,
  previewDraft,
  settleUncertain,
  stageChange,
  summarizePublication,
  toSaveRequests,
  unstageChange,
  validateDraft,
  type PlanRequest,
  type PlannedChange,
  type RoomResult,
} from "@/lib/housekeeping/assignmentPlan";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import type { AssignableStaff } from "@/lib/housekeeping/supervisor";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const SCOPE = "hotel-1:sup-1";
const everyone = rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);
const model = (raw: BoardRoomRaw[] = hotelBoard()) => assignmentsOf({ raw, roster: everyone });

const plan = (m: ReturnType<typeof model>, request: Partial<PlanRequest> & { roomId: string }) =>
  planChange(m, { toUserId: "hk-3", source: "single", ...request });
const must = (result: ReturnType<typeof planChange>): PlannedChange => {
  if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.rejection)}`);
  return result.change;
};

describe("planning one change", () => {
  it("assigns an unassigned room, asserting it is still unassigned", () => {
    const change = must(plan(model(), { roomId: "room-101" }));
    expect(change).toMatchObject({ kind: "assign", fromUserId: null, toUserId: "hk-3", expected: { expect_unassigned: true }, removal: { kind: "none" } });
  });

  it("reassigns an owned room, asserting the owner that was seen", () => {
    const change = must(plan(model(), { roomId: "room-102" }));
    expect(change).toMatchObject({ kind: "reassign", fromUserId: "hk-1", toUserId: "hk-3", expected: { expected_assigned_to: "hk-1" } });
  });

  it("a mirror-only owner is reassigned and removed against the mirror, not a dated row", () => {
    const m = model([rawRoom("101", "DIRTY", { assigned_to: "hk-1" })]);
    expect(must(plan(m, { roomId: "room-101" }))).toMatchObject({ kind: "reassign", expected: { expected_assigned_to: "hk-1" } });
    expect(must(plan(m, { roomId: "room-101", toUserId: null }))).toMatchObject({ kind: "remove", removal: { kind: "mirror", roomId: "room-101" } });
  });

  it("removal of a dated assignment targets its row", () => {
    expect(must(plan(model(), { roomId: "room-102", toUserId: null }))).toMatchObject({
      kind: "remove",
      toUserId: null,
      fromUserId: "hk-1",
      removal: { kind: "assignment", assignmentId: "as-102" },
      expected: { expected_assigned_to: "hk-1" },
    });
  });

  it("refuses to remove what is not assigned", () => {
    expect(plan(model(), { roomId: "room-101", toUserId: null })).toEqual({ ok: false, rejection: { reason: "nothing_to_remove" } });
  });

  it.each([
    ["room-104", "in_progress"], // being cleaned
    ["room-105", "awaiting_inspection"],
    ["room-106", "guest_ready"],
    ["room-107", "out_of_service"],
  ])("%s is blocked (%s) for assignment, reassignment AND removal", (roomId, block) => {
    expect(plan(model(), { roomId })).toEqual({ ok: false, rejection: { reason: "room_blocked", block } });
    if (roomId === "room-104" || roomId === "room-105") {
      expect(plan(model(), { roomId, toUserId: null })).toEqual({ ok: false, rejection: { reason: "room_blocked", block } });
    }
  });

  it("a soft-blocked room needs every block acknowledged, then records what was accepted", () => {
    const m = model([rawRoom("101", "DIRTY", { dnd_flag: true, do_not_service: true })]);
    expect(plan(m, { roomId: "room-101" })).toEqual({ ok: false, rejection: { reason: "needs_acknowledgement", missing: ["service_declined", "dnd"] } });
    expect(plan(m, { roomId: "room-101", acknowledged: ["dnd"] })).toEqual({ ok: false, rejection: { reason: "needs_acknowledgement", missing: ["service_declined"] } });
    expect(must(plan(m, { roomId: "room-101", acknowledged: ["dnd", "service_declined"] })).acknowledged).toEqual(["service_declined", "dnd"]);
  });

  it("removing a soft-blocked assignment needs no acknowledgement", () => {
    const m = model([rawRoom("101", "DIRTY", { dnd_flag: true, assigned_to: "hk-1", assignment_id: "as-1" })]);
    expect(plan(m, { roomId: "room-101", toUserId: null }).ok).toBe(true);
  });

  it("rejects an employee that is not on the verified staff list", () => {
    expect(plan(model(), { roomId: "room-101", toUserId: "stranger" })).toEqual({ ok: false, rejection: { reason: "employee_unknown" } });
  });

  it("cannot verify an employee when the staff list is unavailable", () => {
    const staff = failedSource<AssignableStaff[]>(Object.assign(new Error("x"), { status: 500 }), loadingSource());
    const m = assignmentsOf({ roster: everyone, staff });
    expect(plan(m, { roomId: "room-101" })).toEqual({ ok: false, rejection: { reason: "employee_unverifiable" } });
  });

  it("refuses a no-op and an unknown room", () => {
    expect(plan(model(), { roomId: "room-102", toUserId: "hk-1" })).toEqual({ ok: false, rejection: { reason: "already_assigned_to_employee" } });
    expect(plan(model(), { roomId: "room-999" })).toEqual({ ok: false, rejection: { reason: "room_missing" } });
  });

  it("an unknown board plans nothing", () => {
    expect(plan(assignmentsOf({ boardDate: "2026-10-15" }), { roomId: "room-101" })).toEqual({ ok: false, rejection: { reason: "board_unavailable" } });
  });
});

describe("the draft", () => {
  const change = must(plan(model(), { roomId: "room-101" }));
  const draft = emptyDraft(SCOPE, HOTEL_DATE, NOW);

  it("holds at most one change per room and never mutates", () => {
    const one = stageChange(draft, change);
    const replaced = stageChange(one, { ...change, toUserId: "hk-2" });
    expect(draftChanges(draft)).toEqual([]);
    expect(draftChanges(one)).toHaveLength(1);
    expect(draftChanges(replaced)).toHaveLength(1);
    expect(replaced.changes["room-101"].toUserId).toBe("hk-2");
    expect(draftChanges(unstageChange(replaced, "room-101"))).toEqual([]);
    expect(unstageChange(draft, "room-101")).toBe(draft);
  });

  it("belongs to one hotel/user scope and one hotel date", () => {
    expect(draftIsCurrent(draft, SCOPE, HOTEL_DATE)).toBe(true);
    expect(draftIsCurrent(draft, "hotel-2:sup-1", HOTEL_DATE)).toBe(false);
    expect(draftIsCurrent(draft, "hotel-1:sup-2", HOTEL_DATE)).toBe(false);
    expect(draftIsCurrent(draft, SCOPE, "2026-10-17")).toBe(false);
    expect(draftIsCurrent(draft, null, HOTEL_DATE)).toBe(false);
  });
});

describe("validating a draft against a newer read", () => {
  const base = model();
  const assign = must(plan(base, { roomId: "room-101" }));
  const reassign = must(plan(base, { roomId: "room-102" }));
  const remove = must(plan(base, { roomId: "room-103", toUserId: null }));
  const draft = [assign, reassign, remove].reduce(stageChange, emptyDraft(SCOPE, HOTEL_DATE, NOW));

  it("everything unchanged → every change is ready, no conflicts", () => {
    const result = validateDraft(draft, model(), SCOPE);
    expect(result.ready).toHaveLength(3);
    expect(result.issues).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("another supervisor assigned the room first → assignee_changed with both owners", () => {
    const raw = hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, assigned_to: "hk-2", assignment_id: "as-x" } : row));
    const result = validateDraft(draft, model(raw), SCOPE);
    expect(result.ready.map((c) => c.roomId).sort()).toEqual(["room-102", "room-103"]);
    expect(result.issues).toEqual([{ change: assign, reason: "assignee_changed" }]);
    expect(result.conflicts).toEqual([
      { roomId: "room-101", roomNumber: "101", kind: "assignee_changed", expectedOwnerId: null, currentOwnerId: "hk-2", currentStage: "to_clean" },
    ]);
  });

  it("the room's cleaning started in the meantime → not_assignable, even if the owner is unchanged", () => {
    const raw = hotelBoard().map((row) => (row.room_id === "room-102" ? { ...row, status: "IN_PROGRESS" } : row));
    const result = validateDraft(draft, model(raw), SCOPE);
    expect(result.issues.find((issue) => issue.change.roomId === "room-102")?.reason).toBe("not_assignable");
    expect(result.conflicts.find((c) => c.roomId === "room-102")).toMatchObject({ kind: "not_assignable", currentStage: "in_progress", currentOwnerId: "hk-1" });
    expect(result.ready.map((c) => c.roomId)).not.toContain("room-102");
  });

  it("a removal whose assignment someone already removed is a conflict", () => {
    const raw = hotelBoard().map((row) => (row.room_id === "room-103" ? { ...row, assigned_to: null, assignment_id: null } : row));
    expect(validateDraft(draft, model(raw), SCOPE).issues.find((issue) => issue.change.roomId === "room-103")?.reason).toBe("assignee_changed");
  });

  it("the room already went where we were sending it → already_assigned", () => {
    const raw = hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, assigned_to: "hk-3", assignment_id: "as-y" } : row));
    expect(validateDraft(draft, model(raw), SCOPE).issues[0]).toMatchObject({ reason: "already_assigned" });
  });

  it("a room that disappeared → room_missing", () => {
    const raw = hotelBoard().filter((row) => row.room_id !== "room-101");
    expect(validateDraft(draft, model(raw), SCOPE).conflicts[0]).toMatchObject({ roomId: "room-101", kind: "room_missing", currentOwnerId: undefined, currentStage: null });
  });

  it("an employee who left the staff list → employee_unknown", () => {
    const staff = { status: "available" as const, data: [{ userId: "hk-1", name: "Ana", role: "housekeeper" }, { userId: "hk-2", name: "Ben", role: "housekeeper" }], fetchedAt: NOW };
    const m = assignmentsOf({ roster: everyone, staff });
    expect(validateDraft(draft, m, SCOPE).issues.map((issue) => issue.reason)).toContain("employee_unknown");
  });

  it("a draft from another scope or day is refused whole", () => {
    expect(validateDraft(draft, model(), "hotel-2:sup-1").ready).toEqual([]);
    expect(validateDraft(draft, model(), "hotel-2:sup-1").issues.every((issue) => issue.reason === "scope_changed")).toBe(true);
    expect(validateDraft(draft, model(), null).issues.every((issue) => issue.reason === "scope_changed")).toBe(true);
    const yesterday = { ...draft, hotelDate: "2026-10-15" };
    expect(validateDraft(yesterday, model(), SCOPE).ready).toEqual([]);
  });

  it("an unknown board validates nothing as ready", () => {
    const result = validateDraft(draft, assignmentsOf({ boardDate: "2026-10-15" }), SCOPE);
    expect(result.ready).toEqual([]);
    expect(result.issues.every((issue) => issue.reason === "board_unavailable" || issue.reason === "scope_changed")).toBe(true);
  });
});

describe("preview: what the plan does to the team", () => {
  it("shows each affected person before and after, and the unassigned count", () => {
    const m = model();
    const changes = [must(plan(m, { roomId: "room-101", toUserId: "hk-3" })), must(plan(m, { roomId: "room-102", toUserId: "hk-3" }))];
    const preview = previewDraft(m, changes);
    expect(preview).not.toBeNull();
    const byId = Object.fromEntries((preview?.staff ?? []).map((delta) => [delta.userId, delta]));
    expect(Object.keys(byId).sort()).toEqual(["hk-1", "hk-3"]);
    expect(byId["hk-3"]).toMatchObject({ roomsAdded: 2, roomsReleased: 0 });
    expect(byId["hk-3"].before.minutes.remainingRooms).toBe(0);
    expect(byId["hk-3"].after.minutes.remainingRooms).toBe(2);
    expect(byId["hk-1"]).toMatchObject({ roomsAdded: 0, roomsReleased: 1 });
    expect(byId["hk-1"].after.minutes.remainingRooms).toBe(byId["hk-1"].before.minutes.remainingRooms - 1);
    // 101 was unassigned (+1 owned), 102 only moved between people.
    expect(preview).toMatchObject({ changeCount: 2, unassignedBefore: 2, unassignedAfter: 1 });
  });

  it("removing an assignment returns the room to the unassigned pool", () => {
    const m = model();
    expect(previewDraft(m, [must(plan(m, { roomId: "room-102", toUserId: null }))])).toMatchObject({ unassignedBefore: 2, unassignedAfter: 3 });
  });

  it("reports the warnings a plan would create, not the ones that already existed", () => {
    const heavy = Array.from({ length: 6 }, (_, i) => rawRoom(`${301 + i}`, "DIRTY", { assigned_to: "hk-3", assignment_id: `as-h${i}`, clean_type: "DEP" })); // 18 credits: "at" a 16 target, not over
    const m = model([...hotelBoard(), ...heavy, rawRoom("401", "DIRTY", { clean_type: "DEP" })]);
    const preview = previewDraft(m, [must(plan(m, { roomId: "room-401", toUserId: "hk-3" }))]);
    const delta = preview?.staff.find((d) => d.userId === "hk-3");
    expect(delta?.before.warnings).not.toContain("over_credit_target");
    expect(delta?.newWarnings).toContain("over_credit_target"); // 21 credits against a 16 target (over is more than +2)
  });

  it("is unknown when the board is", () => {
    expect(previewDraft(assignmentsOf({ boardDate: "2026-10-15" }), [])).toBeNull();
  });
});

describe("turning a plan into requests", () => {
  const change = (i: number, source: PlannedChange["source"] = "bulk"): PlannedChange => ({
    roomId: `room-${i}`,
    roomNumber: `${i}`,
    kind: "assign",
    fromUserId: null,
    toUserId: "hk-1",
    expected: { expect_unassigned: true },
    acknowledged: [],
    removal: { kind: "none" },
    source,
  });

  it("EVERY assignment item carries its expected owner — an unconditional item is never produced", () => {
    const m = model();
    const changes = [must(plan(m, { roomId: "room-101" })), must(plan(m, { roomId: "room-102" }))];
    const { assignmentBatches } = toSaveRequests(changes);
    const items = assignmentBatches.flatMap((batch) => batch.assignments);
    expect(items).toHaveLength(2);
    for (const item of items) expect("expected_assigned_to" in item || item.expect_unassigned === true).toBe(true);
    expect(items.find((item) => item.room_id === "room-102")).toEqual({ room_id: "room-102", housekeeper_id: "hk-3", expected_assigned_to: "hk-1", acknowledged_blocks: [] });
    expect(items.find((item) => item.room_id === "room-101")).toEqual({ room_id: "room-101", housekeeper_id: "hk-3", expect_unassigned: true, acknowledged_blocks: [] });
  });

  it("sends the soft blocks the supervisor acknowledged, so the server can check them against the room", () => {
    const m = model([rawRoom("101", "DIRTY", { dnd_flag: true })]);
    const planned = must(plan(m, { roomId: "room-101", acknowledged: ["dnd"] }));
    const [item] = toSaveRequests([planned]).assignmentBatches.flatMap((batch) => batch.assignments);
    expect(item).toMatchObject({ expect_unassigned: true, acknowledged_blocks: ["dnd"] });
  });

  it("splits manual and AI-suggested items — a request carries one is_ai_suggested flag", () => {
    const { assignmentBatches } = toSaveRequests([change(1, "single"), change(2, "smart_balance"), change(3, "ai_editor"), change(4, "bulk")]);
    expect(assignmentBatches.map((b) => [b.isAiSuggested, b.assignments.map((a) => a.room_id)])).toEqual([
      [false, ["room-1", "room-4"]],
      [true, ["room-2", "room-3"]],
    ]);
  });

  it(`never exceeds ${MAX_ASSIGNMENTS_PER_REQUEST} items per request`, () => {
    const { assignmentBatches } = toSaveRequests(Array.from({ length: 205 }, (_, i) => change(i)));
    expect(assignmentBatches.map((batch) => batch.assignments.length)).toEqual([200, 5]);
  });

  it("removals are separate and carry their plan; they are never sent as assignments", () => {
    const m = model();
    const requests = toSaveRequests([must(plan(m, { roomId: "room-102", toUserId: null }))]);
    expect(requests.assignmentBatches).toEqual([]);
    expect(requests.removals).toEqual([{ roomId: "room-102", roomNumber: "102", plan: { kind: "assignment", assignmentId: "as-102" } }]);
  });

  it("an empty plan produces no requests", () => {
    expect(toSaveRequests([])).toEqual({ assignmentBatches: [], removals: [] });
  });
});

describe("outcomes — never claiming atomicity", () => {
  const result = (roomId: string, outcome: RoomResult["outcome"]): RoomResult => ({ roomId, roomNumber: roomId, outcome });

  it("a publication is never atomic and can be partly applied", () => {
    const summary = summarizePublication([result("a", "applied"), result("b", "conflict"), result("c", "failed"), result("d", "not_attempted"), result("e", "rejected")]);
    expect(summary.atomic).toBe(false);
    expect(summary).toMatchObject({ applied: 1, conflicts: 1, failed: 1, notAttempted: 1, rejected: 1, unknown: 0, allApplied: false, needsVerification: false });
  });

  it("only a fully confirmed publication is 'all applied'", () => {
    expect(summarizePublication([result("a", "applied"), result("b", "applied")])).toMatchObject({ allApplied: true, atomic: false });
    expect(summarizePublication([]).allApplied).toBe(false);
  });

  it("an unclear outcome must be verified before anything is retried", () => {
    const summary = summarizePublication([result("a", "applied"), result("b", "unknown_outcome")]);
    expect(summary).toMatchObject({ unknown: 1, needsVerification: true, allApplied: false });
  });

  it("settles an unclear outcome from a fresh read of the room", () => {
    const [assign] = [must(plan(model(), { roomId: "room-101" }))];
    const fresh = (extra: Partial<BoardRoomRaw>) => normalizeBoardRecords([rawRoom("101", "DIRTY", extra)]).rooms[0];
    expect(settleUncertain(assign, fresh({ assigned_to: "hk-3", assignment_id: "x" }))).toBe("applied");
    expect(settleUncertain(assign, fresh({}))).toBe("not_applied");
    expect(settleUncertain(assign, fresh({ assigned_to: "hk-2", assignment_id: "x" }))).toBe("unverifiable");
    expect(settleUncertain(assign, null)).toBe("unverifiable");
    const remove = must(plan(model(), { roomId: "room-102", toUserId: null }));
    const owned = normalizeBoardRecords([rawRoom("102", "OCCUPIED", { assigned_to: "hk-1", assignment_id: "as-102" })]).rooms[0];
    expect(settleUncertain(remove, normalizeBoardRecords([rawRoom("102", "OCCUPIED")]).rooms[0])).toBe("applied");
    expect(settleUncertain(remove, owned)).toBe("not_applied");
  });
});
