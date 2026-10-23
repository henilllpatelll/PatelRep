import { ackKey, buildDraftReview } from "@/lib/housekeeping/assignmentDraftReview";
import { stageAllocation } from "@/lib/housekeeping/assignmentDraft";
import { emptyDraft, stageChange } from "@/lib/housekeeping/assignmentPlan";
import { availableSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import { SETTINGS, assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, bulkBoard, bulkModel, everyoneOnShift, room } from "../helpers/bulkFixtures";

const SCOPE = "tenant-1:sup-1";
const fresh = () => emptyDraft(SCOPE, HOTEL_DATE, NOW);
const none = new Set<string>();

function draftOf(model: ReturnType<typeof bulkModel>, assignments: Record<string, string>) {
  return stageAllocation(model, fresh(), assignments, "bulk").draft;
}

describe("the review of a clean draft", () => {
  const model = bulkModel();
  const draft = draftOf(model, { "room-101": "hk-2", "room-102": "hk-2", "room-201": "hk-3", "room-103": "hk-3" });
  const review = buildDraftReview(model, draft, SCOPE, none)!;

  it("summarises the whole operation", () => {
    expect(review).toMatchObject({ changeCount: 4, employeeCount: 2, counts: { assign: 4, reassign: 0, remove: 0 } });
    // 101, 102 and 201 have estimates (30 each); 103 has none: a lower bound, never counted as zero.
    expect(review.minutes).toEqual({ minutes: 90, partial: true, missing: 1 });
    expect(review.canPublish).toBe(true);
    expect(review.blockers).toEqual([]);
  });

  it("shows current and proposed workload per person, and the rooms they would receive", () => {
    const ben = review.employees.find((employee) => employee.userId === "hk-2")!;
    expect(ben.name).toBe("Ben Ortiz");
    expect(ben.current.minutes).toMatchObject({ minutes: 0, rooms: 0 });
    expect(ben.proposed.minutes).toMatchObject({ minutes: 60, partial: false, rooms: 2 });
    expect(ben.added.map((item) => [item.roomNumber, item.kind, item.estimateMinutes]).sort()).toEqual([["101", "assign", 30], ["102", "assign", 30]]);
    expect(ben.released).toEqual([]);
    expect(ben.addedMinutes).toEqual({ minutes: 60, partial: false, missing: 0 });

    const cara = review.employees.find((employee) => employee.userId === "hk-3")!;
    expect(cara.proposed.minutes).toMatchObject({ minutes: 30, partial: true, missing: 1 });
    expect(cara.addedMinutes).toEqual({ minutes: 30, partial: true, missing: 1 });
  });

  it("reports unassigned work before and after", () => {
    expect(review.unassignedAfter).toBe(review.unassignedBefore - 4);
  });

  it("validates, naming what each check is about", () => {
    expect(Object.fromEntries(review.validations.map((validation) => [validation.id, validation.state]))).toEqual({
      rooms_eligible: "pass",
      staff_verified: "pass",
      ownership_unchanged: "pass",
      capacity_rules: "pass",
    });
  });

  it("lists people with the most to review first", () => {
    expect(review.employees.map((employee) => employee.name)).toEqual(["Ben Ortiz", "Cara Reyes"]);
  });
});

describe("what blocks Publish", () => {
  const model = bulkModel();

  it("an empty draft", () => {
    const review = buildDraftReview(model, fresh(), SCOPE, none)!;
    expect(review.blockers).toContain("empty");
    expect(review.canPublish).toBe(false);
  });

  it("a board that is unknown has no review at all", () => {
    const unknown = assignmentsOf({ raw: [] });
    expect(buildDraftReview({ ...unknown, rooms: null, team: null }, fresh(), SCOPE, none)).toBeNull();
  });

  it("a draft that belongs to another hotel, person or day", () => {
    const draft = draftOf(model, { "room-101": "hk-2" });
    expect(buildDraftReview(model, draft, "tenant-2:sup-1", none)!.blockers).toContain("scope");
    expect(buildDraftReview(model, { ...draft, hotelDate: "2026-10-01" }, SCOPE, none)!.blockers).toContain("scope");
  });

  it("a board that is not live (stale)", () => {
    const stale = assignmentsOf({ raw: bulkBoard(), roster: everyoneOnShift(), fetchedAt: NOW - 60 * 60_000 });
    const draft = draftOf(stale, { "room-101": "hk-2" });
    const review = buildDraftReview(stale, draft, SCOPE, none)!;
    expect(review.blockers).toContain("board");
    expect(review.canPublish).toBe(false);
  });

  it("a proposed change that no longer holds, with the failed validation named", () => {
    const draft = draftOf(model, { "room-101": "hk-2", "room-102": "hk-3" });
    const moved = bulkModel({ raw: bulkBoard().map((raw) => (raw.room_id === "room-101" ? room("101", "DIRTY", { owner: "hk-1" }) : raw.room_id === "room-102" ? room("102", "IN_PROGRESS") : raw)) });
    const review = buildDraftReview(moved, draft, SCOPE, none)!;
    expect(review.blockers).toContain("problems");
    expect(review.problems.map((problem) => problem.reason).sort()).toEqual(["assignee_changed", "not_assignable"]);
    expect(Object.fromEntries(review.validations.map((validation) => [validation.id, [validation.state, validation.count]]))).toMatchObject({
      rooms_eligible: ["fail", 1],
      ownership_unchanged: ["fail", 1],
    });
    expect(review.canPublish).toBe(false);
  });

  it("a person who is no longer in the verified staff list", () => {
    const draft = draftOf(model, { "room-101": "hk-2" });
    const gone = bulkModel({ staff: availableSource([{ userId: "hk-3", name: "Cara Reyes", role: "housekeeper" }], NOW) });
    const review = buildDraftReview(gone, draft, SCOPE, none)!;
    expect(review.blockers).toContain("problems");
    expect(review.validations.find((validation) => validation.id === "staff_verified")?.state).toBe("fail");
  });

  it("a change that carries a room acknowledgement cannot be sent in bulk", () => {
    const draft = stageChange(fresh(), { roomId: "room-101", roomNumber: "101", kind: "assign", fromUserId: null, toUserId: "hk-2", expected: { expect_unassigned: true }, acknowledged: ["dnd"], removal: { kind: "none" }, source: "bulk" });
    expect(buildDraftReview(model, draft, SCOPE, none)!.blockers).toContain("unsendable");
  });
});

describe("acknowledgements are per person and must be given", () => {
  it("someone not verified on shift needs an acknowledgement before Publish unlocks", () => {
    const model = bulkModel({ roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break")]) });
    const draft = draftOf(model, { "room-101": "hk-1", "room-102": "hk-2", "room-201": "hk-3" });
    const review = buildDraftReview(model, draft, SCOPE, none)!;
    expect(review.employees.map((employee) => [employee.userId, employee.acks])).toEqual(
      expect.arrayContaining([["hk-1", []], ["hk-2", ["on_break"]], ["hk-3", ["not_clocked_in"]]]),
    );
    expect(review.blockers).toContain("acknowledgements");
    expect(review.validations.find((validation) => validation.id === "staff_verified")?.state).toBe("attention");
    expect(review.unmetAckKeys.sort()).toEqual([ackKey("hk-2", "on_break"), ackKey("hk-3", "not_clocked_in")]);

    const partly = buildDraftReview(model, draft, SCOPE, new Set([ackKey("hk-2", "on_break")]))!;
    expect(partly.canPublish).toBe(false);
    const all = buildDraftReview(model, draft, SCOPE, new Set(review.requiredAckKeys))!;
    expect(all.canPublish).toBe(true);
    expect(all.unmetAckKeys).toEqual([]);
  });

  it("an unknown roster is not 'available': every person needs the unverified acknowledgement", () => {
    const model = assignmentsOf({ raw: bulkBoard(), roster: loadingSource() });
    const draft = draftOf(model, { "room-101": "hk-1" });
    expect(buildDraftReview(model, draft, SCOPE, none)!.employees[0].acks).toEqual(["attendance_unverified"]);
  });

  it("a REAL capacity limit asks for confirmation; a person well within it needs none", () => {
    // hk-1 holds 18 credits against a 16 target ("at"); one more DEP room (3) makes it 21, more than 2 past it: "over".
    const raw = [...["101", "102", "103", "104", "105", "106"].map((number) => room(number, "DIRTY", { owner: "hk-1" })), room("201", "DIRTY"), room("202", "DIRTY")];
    const model = assignmentsOf({ raw, roster: everyoneOnShift() });
    const draft = draftOf(model, { "room-201": "hk-1", "room-202": "hk-2" });
    const review = buildDraftReview(model, draft, SCOPE, none)!;
    expect(review.employees.find((employee) => employee.userId === "hk-1")!.acks).toEqual(["over_capacity"]);
    expect(review.employees.find((employee) => employee.userId === "hk-2")!.acks).toEqual([]);
    expect(review.validations.find((validation) => validation.id === "capacity_rules")).toMatchObject({ state: "attention", count: 1 });
  });

  it("without capacity settings, capacity is 'unknown', never a pass", () => {
    const model = assignmentsOf({ raw: bulkBoard(), roster: everyoneOnShift(), settings: { status: "failed", error: "x", fetchedAt: null } as never });
    const draft = draftOf(model, { "room-101": "hk-2" });
    expect(buildDraftReview(model, draft, SCOPE, none)!.validations.find((validation) => validation.id === "capacity_rules")?.state).toBe("unknown");
    expect(SETTINGS.targetCredits).toBe(16);
  });
});

describe("mixed kinds in one draft (the contract Smart Balance and recovery will use)", () => {
  it("shows a reassignment on both people and a removal as a release", () => {
    const model = bulkModel();
    const draft = stageChange(
      stageChange(fresh(), { roomId: "room-107", roomNumber: "107", kind: "reassign", fromUserId: "hk-1", toUserId: "hk-2", expected: { expected_assigned_to: "hk-1" }, acknowledged: [], removal: { kind: "none" }, source: "bulk" }),
      { roomId: "room-101", roomNumber: "101", kind: "assign", fromUserId: null, toUserId: "hk-3", expected: { expect_unassigned: true }, acknowledged: [], removal: { kind: "none" }, source: "bulk" },
    );
    const review = buildDraftReview(model, draft, SCOPE, none)!;
    expect(review.counts).toEqual({ assign: 1, reassign: 1, remove: 0 });
    const ana = review.employees.find((employee) => employee.userId === "hk-1")!;
    expect(ana.released.map((item) => item.roomNumber)).toEqual(["107"]);
    expect(ana.proposed.minutes.rooms).toBeLessThan(ana.current.minutes.rooms);
    const ben = review.employees.find((employee) => employee.userId === "hk-2")!;
    expect(ben.added.map((item) => [item.roomNumber, item.fromName])).toEqual([["107", "Ana Torres"]]);
    expect(review.canPublish).toBe(true);
  });
});
