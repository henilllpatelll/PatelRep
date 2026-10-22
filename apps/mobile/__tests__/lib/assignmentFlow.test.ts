import { buildConflictView, classifyWrite, detectLiveConflict } from "@/lib/housekeeping/assignmentFlow";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const err = (status?: number, message = "x", code?: string) => Object.assign(new Error(message), { ...(status ? { status } : {}), ...(code ? { code } : {}) });
const everyone = rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);

describe("classifyWrite — only a 4xx proves the write did not happen", () => {
  it.each([
    ["no status (lost connection / timeout)", err()],
    ["a 500", err(500)],
    ["a 502", err(502)],
    ["a 503", err(503)],
    ["a 504", err(504)],
  ])("%s is unknown, so it is read back and never retried", (_name, error) => {
    expect(classifyWrite(error)).toEqual({ kind: "unknown" });
  });

  it("401 and 403 are a permission failure", () => {
    expect(classifyWrite(err(403))).toEqual({ kind: "definite", failure: "permission", conflict: null });
    expect(classifyWrite(err(401))).toMatchObject({ failure: "permission" });
  });

  it.each([
    ["assignment_changed", "assignee_changed"],
    ["room_not_assignable", "not_assignable"],
    ["acknowledgement_required", "acknowledgement_changed"],
  ])("a 409 with code %s is the conflict %s", (code, conflict) => {
    expect(classifyWrite(err(409, "x", code))).toEqual({ kind: "definite", failure: "conflict", conflict });
  });

  it("recognises the legacy 409 messages of the existing endpoint", () => {
    expect(classifyWrite(err(409, "This room can no longer be assigned; refresh the board."))).toMatchObject({ conflict: "not_assignable" });
    expect(classifyWrite(err(409, "This room's assignment changed; refresh the board."))).toMatchObject({ conflict: "assignee_changed" });
    expect(classifyWrite(err(409, "One or more rooms are already assigned for that date."))).toMatchObject({ conflict: "assignee_changed" });
  });

  it("404 distinguishes the person from the room", () => {
    expect(classifyWrite(err(404, "Housekeeper not found"))).toMatchObject({ failure: "employee_ineligible", conflict: "employee_unavailable" });
    expect(classifyWrite(err(404, "Room not found"))).toMatchObject({ failure: "room_unavailable", conflict: "room_missing" });
  });

  it("other 4xx answers are a definite, non-conflict failure", () => {
    expect(classifyWrite(err(422))).toEqual({ kind: "definite", failure: "save_failed", conflict: null });
    expect(classifyWrite(err(400))).toMatchObject({ kind: "definite", failure: "save_failed" });
  });

  it("an expired session is its own definite failure", () => {
    expect(classifyWrite(new Error("Session expired"))).toEqual({ kind: "definite", failure: "session", conflict: null });
  });

  it("anything that is not an Error is treated as unclear", () => {
    expect(classifyWrite(undefined)).toEqual({ kind: "unknown" });
    expect(classifyWrite("boom")).toEqual({ kind: "unknown" });
  });
});

describe("detectLiveConflict", () => {
  const model = (raw = hotelBoard()) => assignmentsOf({ raw, roster: everyone });

  it("is null while the room is as reviewed", () => {
    expect(detectLiveConflict(model(), { roomId: "room-101", reviewedOwnerId: null, targetUserId: "hk-2" })).toBeNull();
    expect(detectLiveConflict(model(), { roomId: "room-102", reviewedOwnerId: "hk-1", targetUserId: "hk-2" })).toBeNull();
  });

  it("flags a changed owner, a started clean, a missing room and a vanished person", () => {
    const taken = model([rawRoom("101", "DIRTY", { assigned_to: "hk-3" })]);
    expect(detectLiveConflict(taken, { roomId: "room-101", reviewedOwnerId: null })).toBe("assignee_changed");
    expect(detectLiveConflict(model([rawRoom("101", "IN_PROGRESS")]), { roomId: "room-101", reviewedOwnerId: null })).toBe("not_assignable");
    expect(detectLiveConflict(model(), { roomId: "room-999", reviewedOwnerId: null })).toBe("room_missing");
    expect(detectLiveConflict(model(), { roomId: "room-101", reviewedOwnerId: null, targetUserId: "ghost" })).toBe("employee_unavailable");
  });

  it("is silent while the board is unknown — an unknown board is not a conflict", () => {
    const loading = assignmentsOf({ raw: hotelBoard(), boardDate: "2026-01-01" });
    expect(loading.rooms).toBeNull();
    expect(detectLiveConflict(loading, { roomId: "room-101", reviewedOwnerId: null })).toBeNull();
  });
});

describe("buildConflictView", () => {
  it("names the owner reviewed and the owner now", () => {
    const taken = assignmentsOf({ raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-3" })], roster: everyone });
    const view = buildConflictView(taken, { roomId: "room-101", roomNumber: "101", reason: "assignee_changed", reviewedOwnerId: null });
    expect(view).toMatchObject({ roomNumber: "101", previous: { userId: null, name: null }, current: { userId: "hk-3", name: "Cara Reyes" }, stage: "to_clean" });
  });

  it("reports a room that left the board as 'not on the board', not as unassigned", () => {
    const view = buildConflictView(assignmentsOf({ roster: everyone }), { roomId: "room-999", roomNumber: "999", reason: "room_missing", reviewedOwnerId: "hk-1" });
    expect(view.current).toBeUndefined();
    expect(view.previous.name).toBe("Ana Torres");
    expect(view.stage).toBeNull();
  });

  it("carries the stage that explains a blocked room", () => {
    const started = assignmentsOf({ raw: [rawRoom("101", "IN_PROGRESS")], roster: everyone });
    expect(buildConflictView(started, { roomId: "room-101", roomNumber: "101", reason: "not_assignable", reviewedOwnerId: null }).stage).toBe("in_progress");
  });
});
