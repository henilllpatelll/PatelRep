import {
  affectedUserIds,
  changesTo,
  checkDraft,
  moveChange,
  rebaseDraft,
  removeFromDraft,
  stageAllocation,
} from "@/lib/housekeeping/assignmentDraft";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import { draftChanges, emptyDraft } from "@/lib/housekeeping/assignmentPlan";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, bulkBoard, bulkModel, everyoneOnShift, room } from "../helpers/bulkFixtures";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource } from "@/lib/housekeeping/supervisorSources";

const SCOPE = "tenant-1:sup-1";
const fresh = () => emptyDraft(SCOPE, HOTEL_DATE, NOW);
const model = bulkModel();

function boardWith(overrides: Record<string, BoardRoomRaw>): BoardRoomRaw[] {
  return bulkBoard().map((raw) => overrides[raw.rooms?.room_number ?? ""] ?? raw);
}

describe("staging an allocation", () => {
  it("stages each room as a proposed change prepared against the owner the supervisor saw", () => {
    const { draft, staged, rejected } = stageAllocation(model, fresh(), { "room-101": "hk-2", "room-102": "hk-3" }, "bulk");
    expect(staged).toEqual(["room-101", "room-102"]);
    expect(rejected).toEqual([]);
    expect(draftChanges(draft)).toEqual([
      expect.objectContaining({ roomId: "room-101", kind: "assign", fromUserId: null, toUserId: "hk-2", expected: { expect_unassigned: true }, acknowledged: [], source: "bulk" }),
      expect.objectContaining({ roomId: "room-102", kind: "assign", fromUserId: null, toUserId: "hk-3" }),
    ]);
  });

  it("does not touch anything live: the model is only read", () => {
    const before = JSON.stringify((model.rooms ?? []).map((entry) => [entry.room.roomId, entry.ownership.userId]));
    stageAllocation(model, fresh(), { "room-101": "hk-2" }, "bulk");
    expect(JSON.stringify((model.rooms ?? []).map((entry) => [entry.room.roomId, entry.ownership.userId]))).toBe(before);
  });

  it("rejects, with the exact reason, rooms that cannot be proposed and stages the rest", () => {
    const { draft, staged, rejected } = stageAllocation(
      model,
      fresh(),
      { "room-101": "hk-2", "room-104": "hk-2", "room-106": "hk-2", "room-999": "hk-2", "room-102": "ghost", "room-107": "hk-1" },
      "bulk",
    );
    expect(staged).toEqual(["room-101"]);
    expect(Object.keys(draft.changes)).toEqual(["room-101"]);
    const reasons = Object.fromEntries(rejected.map((entry) => [entry.roomId, entry.rejection.reason]));
    expect(reasons).toEqual({
      "room-104": "needs_acknowledgement", // DND: a bulk publication never carries an acknowledgement
      "room-106": "room_blocked", // being cleaned
      "room-999": "room_missing",
      "room-102": "employee_unknown",
      "room-107": "already_assigned_to_employee",
    });
  });

  it("replaces a room already in the draft instead of duplicating it", () => {
    const first = stageAllocation(model, fresh(), { "room-101": "hk-2" }, "bulk").draft;
    const second = stageAllocation(model, first, { "room-101": "hk-3" }, "bulk").draft;
    expect(draftChanges(second)).toHaveLength(1);
    expect(second.changes["room-101"].toUserId).toBe("hk-3");
  });

  it("moves a proposed change to another person and keeps its source", () => {
    const first = stageAllocation(model, fresh(), { "room-101": "hk-2" }, "smart_balance").draft;
    const moved = moveChange(model, first, "room-101", "hk-3");
    expect(moved.draft.changes["room-101"]).toMatchObject({ toUserId: "hk-3", source: "smart_balance" });
  });

  it("never grows past one publication's capacity", () => {
    const raw = Array.from({ length: MAX_BATCH_CHANGES + 5 }, (_, i) => room(String(1000 + i), "DIRTY"));
    const big = assignmentsOf({ raw, roster: everyoneOnShift() });
    const assignments = Object.fromEntries((big.rooms ?? []).map((entry) => [entry.room.roomId, "hk-1"]));
    const result = stageAllocation(big, fresh(), assignments, "bulk");
    expect(draftChanges(result.draft)).toHaveLength(MAX_BATCH_CHANGES);
    expect(result.overLimit).toHaveLength(5);
    // Replacing a room that is already in a full draft is still allowed.
    const replaced = stageAllocation(big, result.draft, { [result.staged[0]]: "hk-2" }, "bulk");
    expect(replaced.overLimit).toEqual([]);
    expect(draftChanges(replaced.draft)).toHaveLength(MAX_BATCH_CHANGES);
  });

  it("removes a proposed change and reports who is affected", () => {
    const staged = stageAllocation(model, fresh(), { "room-101": "hk-2", "room-102": "hk-3", "room-201": "hk-2" }, "bulk").draft;
    expect(changesTo(staged, "hk-2").map((change) => change.roomId).sort()).toEqual(["room-101", "room-201"]);
    expect(affectedUserIds(staged).sort()).toEqual(["hk-2", "hk-3"]);
    const less = removeFromDraft(staged, "room-101");
    expect(Object.keys(less.changes).sort()).toEqual(["room-102", "room-201"]);
    expect(removeFromDraft(less, "room-nope")).toBe(less);
  });
});

describe("checking a draft against the live board", () => {
  const draft = stageAllocation(model, fresh(), { "room-101": "hk-2", "room-102": "hk-3", "room-201": "hk-2" }, "bulk").draft;

  it("a draft that still holds is entirely ready", () => {
    const health = checkDraft(draft, model, SCOPE);
    expect(health).toMatchObject({ current: true, problems: [], conflicts: [] });
    expect(health.ready).toHaveLength(3);
  });

  it("flags only the rooms that changed and keeps the rest ready", () => {
    const moved = bulkModel({ raw: boardWith({ "101": room("101", "DIRTY", { owner: "hk-3" }), "102": room("102", "IN_PROGRESS") }) });
    const health = checkDraft(draft, moved, SCOPE);
    expect(health.problems.map((problem) => [problem.change.roomId, problem.reason]).sort()).toEqual([
      ["room-101", "assignee_changed"],
      ["room-102", "not_assignable"],
    ]);
    expect(health.ready.map((change) => change.roomId)).toEqual(["room-201"]);
    expect(health.conflicts.find((conflict) => conflict.roomId === "room-101")).toMatchObject({ expectedOwnerId: null, currentOwnerId: "hk-3" });
  });

  it("catches a room that gained a soft block after it was planned, which the server would refuse", () => {
    const dnd = bulkModel({ raw: boardWith({ "201": room("201", "DIRTY", { vip_flag: true, dnd_flag: true }) }) });
    const health = checkDraft(draft, dnd, SCOPE);
    expect(health.problems.map((problem) => [problem.change.roomId, problem.reason])).toEqual([["room-201", "soft_blocked"]]);
    expect(health.ready.map((change) => change.roomId).sort()).toEqual(["room-101", "room-102"]);
  });

  it("notices a room that left the board and a person who is no longer listed", () => {
    const gone = bulkModel({ raw: bulkBoard().filter((raw) => raw.room_id !== "room-102"), staff: availableSource([{ userId: "hk-2", name: "Ben Ortiz", role: "housekeeper" }], NOW) });
    const reasons = Object.fromEntries(checkDraft(draft, gone, SCOPE).problems.map((problem) => [problem.change.roomId, problem.reason]));
    expect(reasons).toEqual({ "room-102": "room_missing" });
  });

  it("is not current for another hotel or person, or another hotel day: nothing in it is publishable", () => {
    expect(checkDraft(draft, model, "tenant-2:sup-1")).toMatchObject({ current: false, ready: [] });
    expect(checkDraft(draft, model, null).current).toBe(false);
    const nextDay = { ...draft, hotelDate: "2026-10-17" };
    expect(checkDraft(nextDay, model, SCOPE)).toMatchObject({ current: false, ready: [] });
  });

  it("has nothing ready while the board is unknown", () => {
    const unknown = assignmentsOf({ raw: [] });
    const health = checkDraft(draft, { ...unknown, rooms: null, team: null }, SCOPE);
    expect(health.current).toBe(false);
    expect(health.ready).toEqual([]);
  });
});

describe("rebasing onto a newer board", () => {
  const draft = stageAllocation(model, fresh(), { "room-101": "hk-2", "room-102": "hk-3", "room-201": "hk-2" }, "bulk").draft;

  it("leaves a draft that still holds exactly as it was", () => {
    const result = rebaseDraft(draft, model, SCOPE);
    expect(result.draft).toBe(draft);
    expect(result).toMatchObject({ rebased: [], dropped: [] });
  });

  it("re-plans a room whose owner moved against the NEW owner, so it must be reviewed again", () => {
    const moved = bulkModel({ raw: boardWith({ "101": room("101", "DIRTY", { owner: "hk-1" }) }) });
    const result = rebaseDraft(draft, moved, SCOPE);
    expect(result.rebased).toEqual(["room-101"]);
    expect(result.draft.changes["room-101"]).toMatchObject({ kind: "reassign", fromUserId: "hk-1", toUserId: "hk-2", expected: { expected_assigned_to: "hk-1" } });
    // untouched changes are the very same objects
    expect(result.draft.changes["room-102"]).toBe(draft.changes["room-102"]);
    expect(result.draft.changes["room-201"]).toBe(draft.changes["room-201"]);
    expect(checkDraft(result.draft, moved, SCOPE).problems).toEqual([]);
  });

  it("drops what can no longer be proposed and says why", () => {
    const moved = bulkModel({ raw: boardWith({ "101": room("101", "IN_PROGRESS"), "102": room("102", "DIRTY", { dnd_flag: true }) }).filter((raw) => raw.room_id !== "room-201") });
    const result = rebaseDraft(draft, moved, SCOPE);
    expect(result.rebased).toEqual([]);
    expect(result.dropped.map((entry) => [entry.change.roomId, entry.reason]).sort()).toEqual([
      ["room-101", "not_assignable"],
      ["room-102", "soft_blocked"],
      ["room-201", "room_missing"],
    ]);
    expect(Object.keys(result.draft.changes)).toEqual([]);
  });

  it("drops a room that is now already with the person it was proposed for", () => {
    const moved = bulkModel({ raw: boardWith({ "101": room("101", "DIRTY", { owner: "hk-2" }) }) });
    const result = rebaseDraft(draft, moved, SCOPE);
    expect(result.dropped).toEqual([expect.objectContaining({ reason: "already_assigned_to_employee" })]);
    expect(result.draft.changes["room-101"]).toBeUndefined();
  });

  it("does not rebase a draft from another scope or day: the caller discards it", () => {
    expect(rebaseDraft(draft, model, "tenant-2:sup-1")).toEqual({ draft, rebased: [], dropped: [] });
    const roster = rosterOf([rosterRow("hk-1", "active")]);
    expect(rebaseDraft({ ...draft, hotelDate: "2026-10-01" }, bulkModel({ roster }), SCOPE).rebased).toEqual([]);
  });
});
