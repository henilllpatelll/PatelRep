import {
  expectedOwnerId,
  expectedOwnerOf,
  ownerUnchanged,
  resolveOwnership,
  usableName,
} from "@/lib/housekeeping/assignmentOwnership";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import { assignmentsOf } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, rawRoom } from "../helpers/roomBoardFixtures";
import { availableSource, failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import type { AssignableStaff, BoardRoomRaw } from "@/lib/housekeeping/supervisor";

const roomOf = (extra: Partial<BoardRoomRaw>) => normalizeBoardRecords([rawRoom("101", "DIRTY", extra)]).rooms[0];
const names = new Map([["hk-1", "Ana Torres"]]);

describe("ownership", () => {
  it("a dated assignment: assigned, named, with the id needed to delete it", () => {
    const ownership = resolveOwnership(roomOf({ assigned_to: "hk-1", assignment_id: "as-1", assignment_date: HOTEL_DATE }), names);
    expect(ownership).toMatchObject({
      source: "dated",
      assigned: true,
      userId: "hk-1",
      assignmentId: "as-1",
      assignmentDate: HOTEL_DATE,
      name: "Ana Torres",
      unlisted: false,
    });
  });

  it("a mirror-only assignment is still an assignment — it just has no dated row to delete", () => {
    const ownership = resolveOwnership(roomOf({ assigned_to: "hk-1" }), names);
    expect(ownership).toMatchObject({ source: "status_mirror", assigned: true, assignmentId: null, userId: "hk-1" });
  });

  it("an unassigned room", () => {
    expect(resolveOwnership(roomOf({}), names)).toMatchObject({ source: "none", assigned: false, userId: null, name: null, unlisted: false });
  });

  it("an owner the staff list cannot name is an unknown person, NOT an unassigned room", () => {
    const ownership = resolveOwnership(roomOf({ assigned_to: "ghost", assignment_id: "as-9" }), names);
    expect(ownership).toMatchObject({ assigned: true, userId: "ghost", name: null, unlisted: true });
  });

  it("a placeholder or blank name counts as unknown", () => {
    expect(usableName("—")).toBeNull();
    expect(usableName("   ")).toBeNull();
    expect(usableName(undefined)).toBeNull();
    expect(usableName(" Ana ")).toBe("Ana");
    const ownership = resolveOwnership(roomOf({ assigned_to: "hk-1" }), new Map([["hk-1", "—"]]));
    expect(ownership).toMatchObject({ assigned: true, name: null, unlisted: true });
  });

  it("with the staff list unavailable every owner is unnamed but still assigned, and nobody is 'unlisted'", () => {
    const ownership = resolveOwnership(roomOf({ assigned_to: "hk-1" }), null);
    expect(ownership).toMatchObject({ assigned: true, name: null, staffListKnown: false, unlisted: false });
  });
});

describe("expected owner (compare-and-set fields)", () => {
  it("an unassigned room asserts it is still unassigned", () => {
    expect(resolveOwnership(roomOf({}), names).expected).toEqual({ expect_unassigned: true });
    expect(expectedOwnerOf(null)).toEqual({ expect_unassigned: true });
  });

  it("an assigned room asserts the owner that was seen — including a mirror-only owner", () => {
    expect(resolveOwnership(roomOf({ assigned_to: "hk-1", assignment_id: "as-1" }), names).expected).toEqual({ expected_assigned_to: "hk-1" });
    expect(resolveOwnership(roomOf({ assigned_to: "hk-1" }), names).expected).toEqual({ expected_assigned_to: "hk-1" });
  });

  it("never asserts both", () => {
    for (const userId of [null, "hk-1"]) {
      const expected = expectedOwnerOf(userId) as Record<string, unknown>;
      expect(Object.keys(expected)).toHaveLength(1);
    }
  });

  it("reads back the owner an expectation names, and whether the room still has it", () => {
    expect(expectedOwnerId({ expect_unassigned: true })).toBeNull();
    expect(expectedOwnerId({ expected_assigned_to: "hk-1" })).toBe("hk-1");
    expect(ownerUnchanged(roomOf({ assigned_to: "hk-1" }), { expected_assigned_to: "hk-1" })).toBe(true);
    expect(ownerUnchanged(roomOf({ assigned_to: "hk-2" }), { expected_assigned_to: "hk-1" })).toBe(false);
    expect(ownerUnchanged(roomOf({}), { expect_unassigned: true })).toBe(true);
    expect(ownerUnchanged(roomOf({ assigned_to: "hk-1" }), { expect_unassigned: true })).toBe(false);
  });
});

describe("ownership in the composed model", () => {
  const raw = [rawRoom("101", "DIRTY", { assigned_to: "ghost", assignment_id: "as-1" }), rawRoom("102", "DIRTY")];

  it("an assigned room whose owner has no profile name never appears unassigned", () => {
    const model = assignmentsOf({ raw });
    const ghost = model.rooms?.find((entry) => entry.room.roomNumber === "101");
    expect(ghost?.ownership).toMatchObject({ assigned: true, name: null, unlisted: true });
    expect(ghost?.eligibility.needsAssignee).toBe(false);
    expect(model.rooms?.filter((entry) => entry.eligibility.needsAssignee).map((entry) => entry.room.roomNumber)).toEqual(["102"]);
  });

  it("the unnamed owner still has a team entry holding their rooms", () => {
    const member = assignmentsOf({ raw }).team?.find((candidate) => candidate.userId === "ghost");
    expect(member).toMatchObject({ listed: false, name: null });
    expect(member?.rooms.map((room) => room.roomNumber)).toEqual(["101"]);
  });

  it("a staff list that failed to load does not turn assigned rooms into unassigned ones", () => {
    const staff = failedSource<AssignableStaff[]>(Object.assign(new Error("down"), { status: 500 }), loadingSource());
    const model = assignmentsOf({ raw, staff });
    expect(model.staffListKnown).toBe(false);
    expect(model.rooms?.find((entry) => entry.room.roomNumber === "101")?.ownership).toMatchObject({ assigned: true, staffListKnown: false, unlisted: false });
  });

  it("a verified staff list names the owner and that room is not 'unlisted'", () => {
    const named = assignmentsOf({ raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-1" })] });
    expect(named.rooms?.[0].ownership).toMatchObject({ assigned: true, name: "Ana Torres", unlisted: false });
  });

  it("the staff list becoming available later names a previously unnamed owner (no stale name sticks)", () => {
    const withList = availableSource<AssignableStaff[]>([{ userId: "ghost", name: "Gus Host", role: "housekeeper" }], NOW);
    const model = assignmentsOf({ raw, staff: withList });
    expect(model.rooms?.find((entry) => entry.room.roomNumber === "101")?.ownership.name).toBe("Gus Host");
  });
});
