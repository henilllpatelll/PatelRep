import { stageAllocation } from "@/lib/housekeeping/assignmentDraft";
import { emptyDraft } from "@/lib/housekeeping/assignmentPlan";
import { moveChange } from "@/lib/housekeeping/assignmentDraft";
import { toBatchRequest } from "@/lib/housekeeping/assignmentBatch";
import { expectedOwnerId } from "@/lib/housekeeping/assignmentOwnership";
import { changesOf, moveProposal, removeProposal, type SmartPlan } from "@/lib/housekeeping/smartBalancePlan";
import { buildPreview, buildStaffDetail, canonicalChanges, explain } from "@/lib/housekeeping/smartBalancePreview";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { everyoneOnShift, room } from "../helpers/bulkFixtures";
import { inputOf, planOf, NOW } from "../helpers/smartBalanceFixtures";

/* 101 102 free · 103 free, no estimate · 104 DND · 105 hk-2 cleaning now (30 min) · 106 hk-1 owns, not started (30 min) */
const RAW = [room("101", "DIRTY"), room("102", "DIRTY"), room("103", "DIRTY", { minutes: null }), room("104", "DIRTY", { dnd_flag: true }), room("105", "IN_PROGRESS", { owner: "hk-2" }), room("106", "DIRTY", { owner: "hk-1" })];
const modelOf = (raw = RAW, options = {}) => assignmentsOf({ raw, roster: everyoneOnShift(), ...options });
const nameOf = (id: string) => id;

function plan(spec: Parameters<typeof planOf>[2] = {}, scope: "unassigned" | "all_unstarted" = "unassigned", model = modelOf()): { model: ReturnType<typeof modelOf>; plan: SmartPlan } {
  return { model, plan: planOf(model, inputOf(model, scope), spec) };
}

describe("the counts", () => {
  it("come from the plan and the verified board, not from assumptions", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated: [["103", "insufficient_capacity"]] });
    const preview = buildPreview(model, p);
    expect(preview?.counts).toMatchObject({
      eligible: 3,
      planned: 2,
      newRooms: 2,
      moved: 0,
      preserved: 1, // 106 stays with hk-1
      unallocated: 1,
      takenOut: 0,
      excludedRooms: 1, // 104 (DND)
      blockedRooms: 1,
      protectedInProgress: 1, // 105
      affectedStaff: 2,
      excludedStaff: 0,
      edited: 0,
    });
  });

  it("an unallocated room is not an excluded blocker, and they are reported apart", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "solver_no_solution"]] });
    const preview = buildPreview(model, p);
    expect(preview?.counts.unallocated).toBe(2);
    expect(preview?.counts.excludedRooms).toBe(1);
    expect(preview?.leftOut.map((item) => [item.roomNumber, item.reason])).toEqual([["102", "insufficient_capacity"], ["103", "solver_no_solution"]]);
    expect(p.excludedRooms.map((item) => item.roomNumber)).toEqual(["104"]);
  });

  it("does not count a room as new when its owner is unchanged", () => {
    const { model, plan: p } = plan({ retain: ["106"], assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] }, "all_unstarted");
    const preview = buildPreview(model, p);
    expect(preview?.counts).toMatchObject({ planned: 1, newRooms: 1, moved: 0, preserved: 1 });
  });

  it("a moved room is a reassignment and releases the previous owner", () => {
    const { model, plan: p } = plan({ assign: [["106", "hk-3"], ["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] }, "all_unstarted");
    const preview = buildPreview(model, p);
    expect(preview?.counts).toMatchObject({ planned: 2, newRooms: 1, moved: 1, preserved: 0 });
    const hk1 = preview?.staff.find((person) => person.userId === "hk-1");
    expect(hk1).toMatchObject({ releases: ["106"], gains: [] });
    expect(hk1?.before.minutes.minutes).toBe(30);
    expect(hk1?.after.minutes).toMatchObject({ minutes: 0, rooms: 0 }); // nothing left to do: a real, known zero
  });

  it("counts urgent rooms covered and urgent rooms left out separately", () => {
    const { model, plan: base } = plan({ assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const urgent: SmartPlan = {
      ...base,
      proposals: { ...base.proposals, "room-101": { ...base.proposals["room-101"], tier: "critical" } },
      leftOut: { ...base.leftOut, "room-102": { ...base.leftOut["room-102"], tier: "high" } },
    };
    const preview = buildPreview(model, urgent);
    expect(preview?.counts.urgentCovered).toBe(1);
    expect(preview?.counts.urgentUnallocated).toBe(1);
  });
});

describe("before and after", () => {
  it("shows existing workload plus the proposal, per person", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const hk2 = buildPreview(model, p)?.staff.find((person) => person.userId === "hk-2");
    expect(hk2?.before.minutes).toMatchObject({ minutes: 30, rooms: 1 });
    expect(hk2?.after.minutes).toMatchObject({ minutes: 60, rooms: 2 });
    expect(hk2?.deltaMinutes).toEqual({ value: 30, partial: false });
    expect(hk2?.gains).toEqual(["101"]);
  });

  it("keeps a missing estimate visible: the figure is 'at least', never a made-up total", () => {
    const { model, plan: p } = plan({ assign: [["103", "hk-3"]], unallocated: [["101", "insufficient_capacity"], ["102", "insufficient_capacity"]] });
    const preview = buildPreview(model, p);
    const hk3 = preview?.staff.find((person) => person.userId === "hk-3");
    expect(preview?.counts.missingEstimates).toBe(1);
    expect(hk3?.before.minutes).toMatchObject({ minutes: 0, rooms: 0 });
    expect(hk3?.after.minutes).toMatchObject({ minutes: null, missing: 1, rooms: 1 }); // one room, length unknown: no total
    expect(hk3?.deltaMinutes).toBeNull();
  });

  it("marks a person the property let through a normally excluding rule", () => {
    const model = modelOf(RAW, { roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "active")]) });
    const input = inputOf(model, "unassigned", { property: { ...require("@/lib/housekeeping/smartBalancePolicy").DEFAULT_PROPERTY_PREFERENCES, avoidOnBreak: false } });
    const p = planOf(model, input, { assign: [["101", "hk-2"]] });
    const hk2 = buildPreview(model, p)?.staff.find((person) => person.userId === "hk-2");
    expect(hk2).toMatchObject({ admitted: "on_break", attendance: "on_break" });
  });
});

describe("the preview is exactly what 'Add to draft' would stage", () => {
  it("canonicalChanges equals staging the optimizer's and the edited groups through the Phase 5 path", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated: [["103", "insufficient_capacity"]] });
    const edited = moveProposal(p, "room-101", "hk-3");
    if (!edited.ok) throw new Error("edit failed");
    const { changes } = canonicalChanges(model, edited.plan);
    const byRoom = Object.fromEntries(changes.map((change) => [change.roomNumber, change]));
    expect(byRoom["101"]).toMatchObject({ kind: "assign", toUserId: "hk-3", source: "ai_editor", fromUserId: null });
    expect(byRoom["102"]).toMatchObject({ kind: "assign", toUserId: "hk-3", source: "smart_balance" });
    const direct = stageAllocation(model, emptyDraft(p.scopeKey, p.hotelDate, p.snapshotVerifiedAt), { "room-102": "hk-3" }, "smart_balance");
    expect(direct.draft.changes["room-102"]).toEqual(byRoom["102"]);
  });

  it("every change carries the owner the supervisor saw", () => {
    const { model, plan: p } = plan({ assign: [["106", "hk-3"]], unallocated: [["101", "insufficient_capacity"], ["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] }, "all_unstarted");
    const [change] = canonicalChanges(model, p).changes;
    expect(change).toMatchObject({ kind: "reassign", fromUserId: "hk-1", toUserId: "hk-3" });
    expect(expectedOwnerId(change.expected)).toBe("hk-1");
  });

  it("a change the app's own checks refuse is reported, not staged", () => {
    const { plan: p } = plan({ assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const lostStaff = assignmentsOf({ raw: RAW, roster: everyoneOnShift(), staff: { status: "failed", error: "x", fetchedAt: null } as never });
    const result = canonicalChanges(lostStaff, p);
    expect(result.changes).toEqual([]);
    expect(result.unplaceable.map((item) => [item.roomNumber, item.rejection.reason])).toEqual([["101", "employee_unverifiable"]]);
  });

  it("only an untouched recommendation is published as an AI suggestion, in the same atomic request as manual changes", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated: [["103", "insufficient_capacity"]] });
    const moved = moveProposal(p, "room-101", "hk-3");
    if (!moved.ok) throw new Error("edit failed");
    const { changes } = canonicalChanges(model, moved.plan);
    const request = toBatchRequest("op-1", p.hotelDate, changes);
    if (!request.ok) throw new Error(request.refusal);
    expect(request.request.changes).toEqual([
      { room_id: "room-101", kind: "assign", housekeeper_id: "hk-3", expect_unassigned: true }, // the supervisor's edit
      { room_id: "room-102", kind: "assign", housekeeper_id: "hk-3", expect_unassigned: true, is_ai_suggested: true },
    ]);
  });

  it("moving a Smart Balance change inside the draft makes it the supervisor's own", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const staged = stageAllocation(model, emptyDraft(p.scopeKey, p.hotelDate, NOW), { "room-101": "hk-2" }, "smart_balance");
    expect(staged.draft.changes["room-101"].source).toBe("smart_balance");
    const moved = moveChange(model, staged.draft, "room-101", "hk-3");
    expect(moved.draft.changes["room-101"]).toMatchObject({ toUserId: "hk-3", source: "ai_editor" });
    const manual = stageAllocation(model, emptyDraft(p.scopeKey, p.hotelDate, NOW), { "room-102": "hk-2" }, "bulk");
    expect(moveChange(model, manual.draft, "room-102", "hk-3").draft.changes["room-102"].source).toBe("bulk");
  });
});

describe("one person's part of the plan", () => {
  it("separates finished, started and not-started work, and what is protected, retained or moving out", () => {
    const raw = [...RAW, room("107", "CLEAN", { owner: "hk-1" }), room("108", "DIRTY", { owner: "hk-1" })];
    const model = modelOf(raw);
    const p = planOf(model, inputOf(model, "all_unstarted"), { assign: [["106", "hk-3"]], retain: ["108"], unallocated: [["101", "insufficient_capacity"], ["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const detail = buildStaffDetail(model, p, "hk-1");
    expect(detail?.existing).toEqual([
      { roomId: "room-106", roomNumber: "106", stage: "not_started", status: "moving_out", movingToUserId: "hk-3" },
      { roomId: "room-107", roomNumber: "107", stage: "completed", status: "protected", movingToUserId: null },
      { roomId: "room-108", roomNumber: "108", stage: "not_started", status: "retained", movingToUserId: null },
    ]);
  });

  it("started work is protected for its owner", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const detail = buildStaffDetail(model, p, "hk-2");
    expect(detail?.existing).toEqual([{ roomId: "room-105", roomNumber: "105", stage: "in_progress", status: "protected", movingToUserId: null }]);
    expect(detail?.proposed.map((row) => [row.roomNumber, row.kind, row.origin])).toEqual([["101", "new", "optimizer"]]);
  });

  it("recomputes after an edit: both the person who loses the room and the one who gains it change", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"], ["102", "hk-2"]], unallocated: [["103", "insufficient_capacity"]] });
    const moved = moveProposal(p, "room-101", "hk-3");
    if (!moved.ok) throw new Error("edit failed");
    const before = buildPreview(model, p);
    const after = buildPreview(model, moved.plan);
    expect(before?.staff.find((s) => s.userId === "hk-2")?.gains).toEqual(["101", "102"]);
    expect(after?.staff.find((s) => s.userId === "hk-2")?.gains).toEqual(["102"]);
    expect(after?.staff.find((s) => s.userId === "hk-3")?.gains).toEqual(["101"]);
    expect(after?.counts.edited).toBe(1);
  });

  it("removing a proposal changes the plan and the counts, never the board", () => {
    const { model, plan: p } = plan({ assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated: [["103", "insufficient_capacity"]] });
    const removed = removeProposal(p, "room-101");
    if (!removed.ok) throw new Error("edit failed");
    const preview = buildPreview(model, removed.plan);
    expect(preview?.counts).toMatchObject({ planned: 1, takenOut: 1, unallocated: 1 });
    expect(changesOf(removed.plan).map((proposal) => proposal.roomNumber)).toEqual(["102"]);
    expect(model.rooms?.find((entry) => entry.room.roomNumber === "101")?.ownership.assigned).toBe(false);
  });
});

describe("explanations come only from supported facts", () => {
  it("words the planner's structured reasons and nothing else", () => {
    const lines = explain(
      { origin: "optimizer", kind: "new", reasons: [{ code: "urgent", reason: "guest_waiting" }, { code: "lowest_workload", minutes: 45 }, { code: "same_floor", floor: 3 }, { code: "same_building", building: "B" }, { code: "moved_from_owner", from: "hk-1" }] },
      nameOf,
    );
    expect(lines).toEqual([
      { key: "urgent.guest_waiting", params: {} },
      { key: "lowestWorkload", params: { minutes: 45 } },
      { key: "sameFloor", params: { floor: 3 } },
      { key: "sameBuilding", params: { building: "B" } },
      { key: "movedFrom", params: { name: "hk-1" } },
    ]);
  });

  it("a supervisor's edit is explained as exactly that - never as the optimizer's reasoning", () => {
    expect(explain({ origin: "edited", kind: "new", reasons: [{ code: "lowest_workload", minutes: 5 }] }, nameOf)).toEqual([{ key: "edited", params: {} }]);
  });

  it("a plan with no grounded reason says nothing rather than inventing one", () => {
    expect(explain({ origin: "optimizer", kind: "new", reasons: [] }, nameOf)).toEqual([]);
  });
});
