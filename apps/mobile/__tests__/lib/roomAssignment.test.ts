import {
  assignmentBlock,
  buildPicker,
  buildReview,
  buildWorkload,
  classifyFailure,
  detectConflict,
  estimateRoom,
  intentFor,
  judgeOutcome,
  projectAssignment,
  removalBlock,
  shownMinutes,
} from "@/lib/housekeeping/roomAssignment";
import { normalizeBoardRecords, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { BoardStaffMember } from "@/lib/housekeeping/roomBoardState";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { rawRoom } from "../helpers/roomBoardFixtures";

const rooms = (...raw: BoardRoomRaw[]): BoardRoom[] => normalizeBoardRecords(raw).rooms;
const one = (number: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoom => rooms(rawRoom(number, status, extra))[0];
const mine = (id: string, extra: Partial<BoardRoomRaw> = {}) => ({ assigned_to: id, assignment_id: `as-${id}`, ...extra });

const member = (userId: string, name: string, availability: BoardStaffMember["availability"] = "on_shift"): BoardStaffMember => ({
  userId,
  name,
  role: "housekeeper",
  availability,
  assignedRooms: 0,
  openRooms: 0,
});

describe("assignment eligibility", () => {
  it.each([
    ["DIRTY", null],
    ["OCCUPIED", null],
    ["PICKUP", null],
    ["IN_PROGRESS", "in_progress"],
    ["CLEAN", "awaiting_inspection"],
    ["INSPECTED", "guest_ready"],
    ["OOO", "unavailable"],
    ["OUT_OF_ORDER", "unavailable"],
    ["OUT_OF_SERVICE", "unavailable"],
    ["MYSTERY", "unknown_status"],
  ])("%s → %s", (status, block) => {
    expect(assignmentBlock(one("101", status))).toBe(block);
  });

  it("assign when nobody is tied to the room, reassign when somebody is (dated row or mirror)", () => {
    expect(intentFor(one("101", "DIRTY"))).toBe("assign");
    expect(intentFor(one("101", "DIRTY", mine("hk-1")))).toBe("reassign");
    expect(intentFor(one("101", "DIRTY", { assigned_to: "hk-1" }))).toBe("reassign");
  });

  it("removal needs something to remove and an unstarted room: never an active, submitted or inspected one", () => {
    expect(removalBlock(one("101", "DIRTY"))).toBe("nothing_to_remove");
    expect(removalBlock(one("101", "DIRTY", mine("hk-1")))).toBeNull();
    expect(removalBlock(one("101", "DIRTY", { assigned_to: "hk-1" }))).toBeNull();
    expect(removalBlock(one("101", "IN_PROGRESS", mine("hk-1")))).toBe("in_progress");
    expect(removalBlock(one("101", "CLEAN", mine("hk-1")))).toBe("awaiting_inspection");
    expect(removalBlock(one("101", "INSPECTED", mine("hk-1")))).toBe("guest_ready");
  });
});

describe("room estimates", () => {
  it("uses the room type's configured minutes, and a learned figure ahead of it for the same room + clean type", () => {
    const room = one("101", "DIRTY", { clean_type: "DEP" });
    expect(estimateRoom(room)).toEqual({ minutes: 30, basis: "room_type" });
    expect(estimateRoom(room, () => ({ minutes: 41.4 }))).toEqual({ minutes: 41, basis: "history" });
  });

  it("never applies a learned figure to a stayover pickup", () => {
    expect(estimateRoom(one("101", "PICKUP"), () => ({ minutes: 50 }))).toEqual({ minutes: 30, basis: "room_type" });
  });

  it("has NO estimate when the room type sent no minutes — never a made-up default", () => {
    const raw = rawRoom("101", "DIRTY");
    raw.rooms = { ...raw.rooms, room_types: { name: "King", code: "K" } };
    expect(estimateRoom(rooms(raw)[0])).toBeNull();
    const zero = rawRoom("102", "DIRTY");
    zero.rooms = { ...zero.rooms, room_types: { code: "K", base_clean_minutes: 0 } };
    expect(estimateRoom(rooms(zero)[0])).toBeNull();
  });

  it("different room types keep their own minutes (no flat per-room figure)", () => {
    const suite = rawRoom("201", "DIRTY");
    suite.rooms = { ...suite.rooms, room_types: { code: "S", base_clean_minutes: 55 } };
    expect(estimateRoom(rooms(suite)[0])?.minutes).toBe(55);
    expect(estimateRoom(one("101", "DIRTY"))?.minutes).toBe(30);
  });
});

describe("workload", () => {
  it("counts total, completed, in progress and remaining rooms for one person only", () => {
    const board = rooms(
      rawRoom("101", "DIRTY", mine("hk-1")),
      rawRoom("102", "IN_PROGRESS", mine("hk-1")),
      rawRoom("103", "CLEAN", mine("hk-1")),
      rawRoom("104", "INSPECTED", mine("hk-1")),
      rawRoom("105", "OOO", mine("hk-1")),
      rawRoom("106", "DIRTY", mine("hk-2")),
    );
    const load = buildWorkload("hk-1", board);
    expect(load).toMatchObject({ total: 5, completed: 2, inProgress: 1, remainingRooms: 2, remainingMinutes: 60, roomsWithoutEstimate: 0, minutesComplete: true, overloaded: false });
  });

  it("is the REAL total — not capped at a working day — and flags overload past it", () => {
    const heavy = Array.from({ length: 18 }, (_, i) => rawRoom(`${200 + i}`, "DIRTY", mine("hk-1")));
    const load = buildWorkload("hk-1", rooms(...heavy));
    expect(load.remainingMinutes).toBe(540);
    expect(load.overloaded).toBe(true);
    expect(shownMinutes(load)).toBe(540);
  });

  it("exactly a working day is not overload", () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => rawRoom(`${200 + i}`, "DIRTY", mine("hk-1")));
    expect(buildWorkload("hk-1", rooms(...sixteen)).overloaded).toBe(false);
  });

  it("reports a missing estimate honestly: a lower bound with a count, or nothing — never 0", () => {
    const noMinutes = (number: string) => {
      const raw = rawRoom(number, "DIRTY", mine("hk-1"));
      raw.rooms = { ...raw.rooms, room_types: { code: "K" } };
      return raw;
    };
    const mixed = buildWorkload("hk-1", rooms(rawRoom("101", "DIRTY", mine("hk-1")), noMinutes("102")));
    expect(mixed).toMatchObject({ remainingRooms: 2, remainingMinutes: 30, roomsWithoutEstimate: 1, minutesComplete: false });
    expect(shownMinutes(mixed)).toBe(30);

    const none = buildWorkload("hk-1", rooms(noMinutes("102")));
    expect(none.remainingRooms).toBe(1);
    expect(shownMinutes(none)).toBeNull();
  });

  it("a person with nothing left really has zero", () => {
    const done = buildWorkload("hk-1", rooms(rawRoom("101", "INSPECTED", mine("hk-1"))));
    expect(done.remainingRooms).toBe(0);
    expect(shownMinutes(done)).toBe(0);
  });

  it("an overloaded lower bound is still overload", () => {
    const rows = Array.from({ length: 17 }, (_, i) => rawRoom(`${300 + i}`, "DIRTY", mine("hk-1")));
    const odd = rawRoom("399", "DIRTY", mine("hk-1"));
    odd.rooms = { ...odd.rooms, room_types: { code: "K" } };
    const load = buildWorkload("hk-1", rooms(...rows, odd));
    expect(load.minutesComplete).toBe(false);
    expect(load.overloaded).toBe(true);
  });
});

describe("projection", () => {
  const load = (minutes: number, complete = true) => ({
    total: 1, completed: 0, inProgress: 0, remainingRooms: 1, remainingMinutes: minutes, roomsWithoutEstimate: complete ? 0 : 1, minutesComplete: complete, overloaded: minutes > 480,
  });

  it("current + this room = projected", () => {
    expect(projectAssignment(load(120), { minutes: 35, basis: "room_type" })).toEqual({ currentMinutes: 120, roomMinutes: 35, projectedMinutes: 155, overload: false });
  });

  it("flags a projected overload even when the person is not overloaded yet", () => {
    expect(projectAssignment(load(460), { minutes: 30, basis: "room_type" })?.overload).toBe(true);
  });

  it("is omitted — not guessed — without a room estimate or with an incomplete current total", () => {
    expect(projectAssignment(load(120), null)).toBeNull();
    expect(projectAssignment(load(120, false), { minutes: 30, basis: "room_type" })).toBeNull();
  });
});

describe("picker", () => {
  const board = rooms(
    rawRoom("201", "DIRTY"),
    rawRoom("202", "DIRTY", mine("hk-1")),
    rawRoom("203", "DIRTY", mine("hk-1")),
    rawRoom("302", "DIRTY", mine("hk-2")),
  );
  const staff = [
    member("hk-1", "Ana Rodriguez", "on_shift"),
    member("hk-2", "Carlos Martinez", "on_shift"),
    member("hk-3", "Beth Break", "on_break"),
    member("hk-4", "Eve Ended", "ended"),
    member("hk-5", "Nina Nope", "not_clocked_in"),
  ];
  const target = board[0];
  const build = (over: Partial<Parameters<typeof buildPicker>[0]> = {}) =>
    buildPicker({ staff, rosterTrust: "verified", rooms: board, room: target, query: "", filter: "on_shift", ...over });

  it("with a verified roster the default list is ONLY verified on-shift people, least work first", () => {
    const picker = build();
    expect(picker.rosterVerified).toBe(true);
    expect(picker.candidates.map((c) => c.userId)).toEqual(["hk-2", "hk-1"]);
    expect(picker.counts).toEqual({ onShift: 2, all: 5 });
    expect(picker.candidates.every((c) => c.ack === null && c.availability === "on_shift")).toBe(true);
  });

  it("All staff lists break / ended / not-clocked-in people with their real state, each needing an acknowledgement", () => {
    const picker = build({ filter: "all" });
    const byId = Object.fromEntries(picker.candidates.map((c) => [c.userId, c]));
    expect(byId["hk-3"]).toMatchObject({ availability: "on_break", ack: "not_on_shift" });
    expect(byId["hk-4"]).toMatchObject({ availability: "ended", ack: "not_on_shift" });
    expect(byId["hk-5"]).toMatchObject({ availability: "not_clocked_in", ack: "not_on_shift" });
    // On-shift people come first.
    expect(picker.candidates.slice(0, 2).map((c) => c.ack)).toEqual([null, null]);
  });

  it("an unverified roster claims nobody is on shift: everyone is `unknown`, needs acknowledgement, and there is no On shift list", () => {
    for (const trust of ["unknown", "stale"] as const) {
      const picker = build({ rosterTrust: trust, filter: "on_shift" });
      expect(picker.rosterVerified).toBe(false);
      expect(picker.filter).toBe("all");
      expect(picker.candidates).toHaveLength(5);
      expect(picker.candidates.every((c) => c.availability === "unknown" && c.ack === "unverified")).toBe(true);
    }
  });

  it("an active account (assignments) is never read as attendance", () => {
    const picker = build({ staff: [member("hk-9", "Dan Desk", "not_clocked_in")], rooms: rooms(rawRoom("201", "DIRTY"), rawRoom("205", "DIRTY", mine("hk-9"))), filter: "on_shift" });
    expect(picker.candidates).toHaveLength(0);
    expect(picker.empty).toBe("no_on_shift");
  });

  it("searches by name, case-insensitively and trimmed", () => {
    expect(build({ filter: "all", query: "  CARL " }).candidates.map((c) => c.userId)).toEqual(["hk-2"]);
    expect(build({ filter: "all", query: "zzz" }).empty).toBe("no_match");
  });

  it("shows empty states: no staff at all, nobody on shift, nobody matching", () => {
    expect(build({ staff: [] }).empty).toBe("no_staff");
    expect(build({ staff: [member("hk-3", "Beth Break", "on_break")] }).empty).toBe("no_on_shift");
    expect(build({ query: "zzz" }).empty).toBe("no_match");
  });

  it("marks the room's current assignee: shown, not a meaningful choice, no projection", () => {
    const reassign = buildPicker({ staff, rosterTrust: "verified", rooms: board, room: board[1], query: "", filter: "on_shift" });
    const current = reassign.candidates.find((c) => c.userId === "hk-1");
    expect(current?.isCurrent).toBe(true);
    expect(current?.projection).toBeNull();
    expect(reassign.candidates.find((c) => c.userId === "hk-2")?.isCurrent).toBe(false);
  });

  it("a missing employee name is shown as unavailable (name null), never an empty or dash row, and cannot be searched", () => {
    const picker = build({ staff: [member("hk-6", "—"), member("hk-7", "  ")], filter: "all" });
    expect(picker.candidates.map((c) => c.name)).toEqual([null, null]);
    expect(build({ staff: [member("hk-6", "—")], filter: "all", query: "a" }).candidates).toHaveLength(0);
  });

  it("carries workload, floors and a projection for each candidate", () => {
    const ana = build().candidates.find((c) => c.userId === "hk-1");
    expect(ana?.workload).toMatchObject({ total: 2, remainingRooms: 2, remainingMinutes: 60 });
    expect(ana?.floors).toEqual([2]);
    expect(ana?.projection).toEqual({ currentMinutes: 60, roomMinutes: 30, projectedMinutes: 90, overload: false });
  });

  it("omits the projection when the room has no estimate", () => {
    const raw = rawRoom("201", "DIRTY");
    raw.rooms = { ...raw.rooms, room_types: { code: "K" } };
    const noEstimate = rooms(raw, rawRoom("202", "DIRTY", mine("hk-1")));
    const picker = buildPicker({ staff, rosterTrust: "verified", rooms: noEstimate, room: noEstimate[0], query: "", filter: "on_shift" });
    expect(picker.candidates.every((c) => c.projection === null)).toBe(true);
  });
});

describe("review", () => {
  it("carries the room, the chosen person, the previous assignee and the clean type", () => {
    const room = one("201", "DIRTY", { ...mine("hk-1"), clean_type: "DEP", clean_type_label: "Departure" });
    const picker = buildPicker({ staff: [member("hk-1", "Maria"), member("hk-2", "Ana")], rosterTrust: "verified", rooms: [room], room, query: "", filter: "all" });
    const candidate = picker.candidates.find((c) => c.userId === "hk-2")!;
    const review = buildReview({ room, candidate, previousName: "Maria" });
    expect(review).toMatchObject({
      intent: "reassign", roomNumber: "201", employeeId: "hk-2", employeeName: "Ana", previousId: "hk-1", previousName: "Maria",
      cleanTypeLabel: "Departure", estimate: { minutes: 30, basis: "room_type" }, ack: null,
    });
  });
});

describe("conflicts (a fresh read against what was reviewed)", () => {
  it("none when the room is exactly as reviewed", () => {
    expect(detectConflict(one("201", "DIRTY"), null)).toBeNull();
    expect(detectConflict(one("201", "DIRTY", mine("hk-1")), "hk-1")).toBeNull();
  });
  it("another supervisor assigned it, reassigned it or removed it", () => {
    expect(detectConflict(one("201", "DIRTY", mine("hk-9")), null, { targetId: "hk-2" })).toBe("assignee_changed");
    expect(detectConflict(one("201", "DIRTY", mine("hk-9")), "hk-1", { targetId: "hk-2" })).toBe("assignee_changed");
    expect(detectConflict(one("201", "DIRTY"), "hk-1", { targetId: "hk-2" })).toBe("assignee_changed");
  });
  it("the room is already with the person being chosen: nothing to overwrite", () => {
    expect(detectConflict(one("201", "DIRTY", mine("hk-2")), null, { targetId: "hk-2" })).toBe("already_assigned");
  });
  it("the room started being cleaned, was submitted or left the board", () => {
    expect(detectConflict(one("201", "IN_PROGRESS", mine("hk-1")), "hk-1")).toBe("not_assignable");
    expect(detectConflict(one("201", "CLEAN"), null)).toBe("not_assignable");
    expect(detectConflict(null, null)).toBe("room_missing");
  });
});

describe("failures and outcomes", () => {
  const api = (status: number, message: string) => Object.assign(new Error(message), { status });

  it.each([
    [api(403, "Forbidden"), "permission", true],
    [api(409, "One or more rooms are already assigned"), "conflict", true],
    [api(404, "Housekeeper not found"), "employee_ineligible", true],
    [api(404, "Room not found"), "room_unavailable", true],
    [api(404, "Assignment not found"), "conflict", true],
    [api(422, "bad"), "save_failed", true],
    [api(500, "boom"), "unknown_outcome", false],
    [api(503, "down"), "unknown_outcome", false],
    [new Error("Network request failed"), "unknown_outcome", false],
    [new Error("Request timed out"), "unknown_outcome", false],
    [new Error("Session expired. Please log in again."), "session", true],
  ])("%p → %s (definite: %s)", (error, failure, definite) => {
    expect(classifyFailure(error)).toEqual({ failure, definite });
  });

  it("offline is a definite refusal: nothing was sent", () => {
    expect(classifyFailure(new Error("x"), false)).toEqual({ failure: "offline", definite: true });
  });

  it("judges an unclear write from the room read back", () => {
    const assigned = { kind: "assigned", userId: "hk-2" } as const;
    expect(judgeOutcome(one("201", "DIRTY", mine("hk-2")), assigned, null)).toBe("applied");
    expect(judgeOutcome(one("201", "DIRTY"), assigned, null)).toBe("not_applied");
    expect(judgeOutcome(one("201", "DIRTY", mine("hk-1")), assigned, "hk-1")).toBe("not_applied");
    // Somebody else's assignment: neither ours nor the old one — cannot tell.
    expect(judgeOutcome(one("201", "DIRTY", mine("hk-9")), assigned, "hk-1")).toBe("unverifiable");
    expect(judgeOutcome(null, assigned, null)).toBe("unverifiable");
    expect(judgeOutcome(one("201", "DIRTY"), { kind: "unassigned" }, "hk-1")).toBe("applied");
    expect(judgeOutcome(one("201", "DIRTY", mine("hk-1")), { kind: "unassigned" }, "hk-1")).toBe("not_applied");
  });
});
