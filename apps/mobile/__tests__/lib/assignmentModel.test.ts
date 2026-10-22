import { evaluateMutationGate, isLive } from "@/lib/housekeeping/roomBoardState";
import { buildBoardMetrics } from "@/lib/housekeeping/roomBoardSelectors";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import { normalizeBoardRooms } from "@/lib/housekeeping/supervisor";
import {
  recommendCandidates,
  selectNeedsOwnerNotAssignable,
  selectSoftBlocked,
  selectSummary,
  selectUnassignedAssignable,
  selectUrgent,
  groupRoomsByLocation,
} from "@/lib/housekeeping/assignmentSelectors";
import {
  EMPTY_ASSIGNMENT_FILTERS,
  assignmentFilterCount,
  queueOf,
  runAssignmentQuery,
  sortAssignmentRooms,
  type AssignmentQueryInput,
} from "@/lib/housekeeping/assignmentQuery";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import { availableSource } from "@/lib/housekeeping/supervisorSources";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

describe("hotel date and scope isolation", () => {
  it("a board requested for an earlier hotel day is never shown as today's", () => {
    const model = assignmentsOf({ boardDate: "2026-10-15" });
    expect(model.availability).toMatchObject({ kind: "previous_day", boardDate: "2026-10-15", hotelDate: HOTEL_DATE });
    expect(model.rooms).toBeNull();
    expect(model.team).toBeNull();
    expect(model.property).toBeNull();
    expect(selectSummary(model)).toBeNull();
    expect(evaluateMutationGate(model.availability, true)).toEqual({ allowed: false, blockedBy: "previous_day" });
  });

  it("the model reports the hotel's date, not the device's", () => {
    // 2026-10-17 02:00Z is still the 16th in Chicago.
    const model = assignmentsOf({ now: Date.parse("2026-10-17T02:00:00Z") });
    expect(model.hotelDate).toBe("2026-10-16");
    expect(model.timeZone).toBe("America/Chicago");
  });
});

describe("shared-source freshness", () => {
  it("a board older than the freshness window is stale: still shown, never live, never writable", () => {
    const model = assignmentsOf({ fetchedAt: NOW - STALE_AFTER_MS - 1_000 });
    expect(model.availability.kind).toBe("stale");
    expect(isLive(model.availability)).toBe(false);
    expect(model.rooms).toHaveLength(10);
    expect(evaluateMutationGate(model.availability, true).allowed).toBe(false);
  });

  it("a fresh board is live and writable only while online", () => {
    const model = assignmentsOf();
    expect(isLive(model.availability)).toBe(true);
    expect(evaluateMutationGate(model.availability, true).allowed).toBe(true);
    expect(evaluateMutationGate(model.availability, false)).toEqual({ allowed: false, blockedBy: "offline" });
  });

  it("is composed from the Room Board model it is given, not a second copy of the data", () => {
    const model = assignmentsOf();
    expect(model.board.rooms?.map((view) => view.room)).toEqual(expect.arrayContaining(model.rooms?.map((entry) => entry.room) ?? []));
    expect(model.generatedAt).toBe(model.board.generatedAt);
    expect(model.rosterTrust).toBe(model.board.rosterTrust);
  });
});

describe("summary populations nest and agree with Supervisor Today", () => {
  const raw = [
    ...hotelBoard(),
    rawRoom("301", "IN_PROGRESS"), // unowned, being cleaned: needs an owner, cannot be handed out
    rawRoom("302", "DIRTY", { dnd_flag: true }), // unowned, soft-blocked
    rawRoom("303", "DIRTY", { assigned_to: "hk-3", assignment_id: "as-303", do_not_service: true }), // owned, soft-blocked
  ];

  it("counts each population once, in a chain", () => {
    expect(selectSummary(assignmentsOf({ raw }))).toEqual({
      inventory: 13,
      inService: 10,
      remainingWork: 8, // 101 102 103 104 201 301 302 303
      assignedWork: 4, // 102 103 104 303
      unassignedWork: 4, // 101 201 301 302
      assignable: 3, // 101 201 302
      autoAssignable: 2, // 101 201 (302 is DND)
      unassignableUnowned: 1, // 301
      urgentAssignable: 1, // 201 (VIP)
      softBlocked: 2, // 302 303
    });
  });

  it("the populations are nested", () => {
    const summary = selectSummary(assignmentsOf({ raw }));
    expect(summary).not.toBeNull();
    const s = summary as NonNullable<typeof summary>;
    expect(s.inventory).toBeGreaterThanOrEqual(s.inService);
    expect(s.inService).toBeGreaterThanOrEqual(s.remainingWork);
    expect(s.remainingWork).toBe(s.assignedWork + s.unassignedWork);
    expect(s.unassignedWork).toBe(s.assignable + s.unassignableUnowned);
    expect(s.assignable).toBeGreaterThanOrEqual(s.autoAssignable);
  });

  it("unassignedWork is exactly the number Supervisor Today and the Room Board report", () => {
    const model = assignmentsOf({ raw });
    const summary = selectSummary(model);
    expect(summary?.unassignedWork).toBe(model.board.readiness?.unassignedActionable);
    expect(summary?.unassignedWork).toBe(buildBoardMetrics(model.rooms?.map((entry) => entry.room) ?? []).unassigned);
    expect(summary?.inService).toBe(model.board.readiness?.inService);
  });

  it("a verified empty hotel is zero, not unknown", () => {
    const model = assignmentsOf({ raw: [] });
    expect(model.rooms).toEqual([]);
    expect(selectSummary(model)).toMatchObject({ inventory: 0, remainingWork: 0, unassignedWork: 0 });
  });

  it("room lists use the same definitions", () => {
    const model = assignmentsOf({ raw });
    const rooms = model.rooms ?? [];
    expect(selectUnassignedAssignable(rooms).map((entry) => entry.room.roomNumber).sort()).toEqual(["101", "201", "302"]);
    expect(selectNeedsOwnerNotAssignable(rooms).map((entry) => entry.room.roomNumber)).toEqual(["301"]);
    expect(selectSoftBlocked(rooms).map((entry) => entry.room.roomNumber).sort()).toEqual(["302", "303"]);
    expect(selectUrgent(rooms).map((entry) => entry.room.roomNumber)).toEqual(["201"]);
  });

  it("groups by building and floor without placing an unknown floor on floor 0", () => {
    const groups = groupRoomsByLocation(assignmentsOf({ raw: [rawRoom("101", "DIRTY"), rawRoom("201", "DIRTY", { rooms: { id: "r", room_number: "201", building: "B", room_types: { code: "K" } } })] }).rooms ?? []);
    expect(groups.map((group) => group.building)).toEqual(["A", "B"]);
    expect(groups[1].floors.map((floor) => floor.floor)).toEqual([null]);
  });
});

describe("existing consumers keep their contract", () => {
  it("the shared board row still carries every FloorRoom field Home and the Room Board read", () => {
    const rows = hotelBoard();
    const board = normalizeBoardRecords(rows).rooms;
    const floorRooms = normalizeBoardRooms(rows);
    expect(board).toHaveLength(floorRooms.length);
    board.forEach((room, index) => {
      const { roomId, roomNumber, roomType, dnd, vip, assignedTo, assignmentId, cleanType, highRisk } = floorRooms[index];
      expect(room).toMatchObject({ roomId, roomNumber, roomType, dnd, vip, assignedTo, assignmentId, cleanType, highRisk });
    });
  });

  it("the new return-later field is additive: null unless the board sent one", () => {
    expect(normalizeBoardRecords(hotelBoard()).rooms.every((room) => room.returnLaterAt === null)).toBe(true);
    const [room] = normalizeBoardRecords([rawRoom("101", "DIRTY", { dnd_retry_at: "2026-10-16T20:00:00Z" })]).rooms;
    expect(room.returnLaterAt).toBe("2026-10-16T20:00:00Z");
    expect(normalizeBoardRecords([rawRoom("101", "DIRTY", { dnd_retry_at: "   " })]).rooms[0].returnLaterAt).toBeNull();
  });
});

describe("recommended candidates", () => {
  const everyone = rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);

  it("the least-loaded working person comes first, with the projected load", () => {
    const model = assignmentsOf({ roster: everyone });
    const ranked = recommendCandidates(model, "room-101");
    expect(ranked.map((candidate) => candidate.member.userId)).toEqual(["hk-3", "hk-2", "hk-1"]);
    expect(ranked[0].after.minutes.remainingMinutes).toBe(30);
    expect(ranked[2].before.minutes.remainingRooms).toBe(2);
    expect(ranked[2].after.minutes.remainingRooms).toBe(3);
  });

  it("working people outrank people who are not clocked in, who stay listed with a caution", () => {
    const model = assignmentsOf({ roster: rosterOf([rosterRow("hk-1", "active")]) });
    const ranked = recommendCandidates(model, "room-101");
    expect(ranked[0].member.userId).toBe("hk-1");
    expect(ranked[0].reasons).toContain("on_shift");
    expect(ranked.slice(1).every((candidate) => candidate.cautions.includes("not_clocked_in"))).toBe(true);
  });

  it("never recommends the current owner for a reassignment", () => {
    const model = assignmentsOf({ roster: everyone });
    expect(recommendCandidates(model, "room-102").map((candidate) => candidate.member.userId)).not.toContain("hk-1");
  });

  it("unknown attendance is a caution, not a disqualification", () => {
    const model = assignmentsOf({ roster: rosterOf([], NOW - STALE_AFTER_MS - 1_000) });
    const ranked = recommendCandidates(model, "room-101");
    expect(ranked).toHaveLength(3);
    expect(ranked.every((candidate) => candidate.cautions.includes("attendance_unknown"))).toBe(true);
  });

  it("warns when the room would overload someone, and ranks them after those it would not", () => {
    const heavy = Array.from({ length: 17 }, (_, i) => rawRoom(`${301 + i}`, "DIRTY", { assigned_to: "hk-3", assignment_id: `as-${i}`, clean_type: "DEP" })); // 51 credits
    const model = assignmentsOf({ raw: [...hotelBoard(), ...heavy], roster: everyone });
    const ranked = recommendCandidates(model, "room-101");
    const overloaded = ranked.find((candidate) => candidate.member.userId === "hk-3");
    expect(overloaded?.cautions).toContain("would_be_overloaded");
    expect(ranked[ranked.length - 1].member.userId).toBe("hk-3");
  });

  it("returns nothing for an unknown room or an unknown board", () => {
    expect(recommendCandidates(assignmentsOf(), "nope")).toEqual([]);
    expect(recommendCandidates(assignmentsOf({ boardDate: "2026-10-15" }), "room-101")).toEqual([]);
  });
});

describe("search, filter and sort", () => {
  const model = assignmentsOf({
    raw: [
      ...hotelBoard(),
      rawRoom("301", "DIRTY", { rooms: { id: "r", room_number: "301", floor: 3, building: "B", room_types: { code: "K", base_clean_minutes: 30 } } }),
      rawRoom("302", "DIRTY", { dnd_flag: true, rooms: { id: "r", room_number: "302", floor: 3, building: "B", room_types: { code: "K", base_clean_minutes: 30 } } }),
    ],
  });
  const queue = queueOf(model.rooms ?? []);
  const run = (patch: Partial<AssignmentQueryInput> = {}) =>
    runAssignmentQuery({ rooms: queue, search: "", filters: EMPTY_ASSIGNMENT_FILTERS, scope: "all", sort: "roomNumber", ...patch });

  it("the dataset is remaining work only", () => {
    expect(queue.map((entry) => entry.room.roomNumber).sort()).toEqual(["101", "102", "103", "104", "201", "301", "302"]);
  });

  it("scope counts add up to what the search and filters leave", () => {
    const result = run();
    // 302 is unowned but do-not-disturb: it is held back, so it is in "blocked" and not in "unassigned".
    expect(result.counts).toEqual({ all: 7, unassigned: 3, assigned: 3, urgent: 1, blocked: 1 });
    expect(result.counts.unassigned + result.counts.assigned + result.counts.blocked).toBe(result.counts.all);
    expect(result.visible).toHaveLength(7);
  });

  it("scope restricts the result but not the counts", () => {
    const result = run({ scope: "unassigned" });
    expect(result.visible.map((entry) => entry.room.roomNumber)).toEqual(["101", "201", "301"]);
    expect(result.counts.all).toBe(7);
  });

  it("search ranks exact → prefix → contains and keeps counts honest", () => {
    const result = run({ search: "30" });
    expect(result.searching).toBe(true);
    expect(result.visible.map((entry) => entry.room.roomNumber)).toEqual(["301", "302"]);
    expect(result.counts.all).toBe(2);
    expect(run({ search: "301" }).visible.map((entry) => entry.room.roomNumber)).toEqual(["301"]);
  });

  it("filters by building, floor and priority tier; sorts by priority, number or location", () => {
    const building = run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "B" } });
    expect(building.visible.map((entry) => entry.room.roomNumber)).toEqual(["201", "301", "302"]);
    expect(assignmentFilterCount({ ...EMPTY_ASSIGNMENT_FILTERS, building: "B", floors: ["B|3"], tiers: ["high"] })).toBe(3);
    expect(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, floors: ["B|3"] } }).visible.map((entry) => entry.room.roomNumber)).toEqual(["301", "302"]);
    expect(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, tiers: ["elevated"] } }).visible.map((entry) => entry.room.roomNumber)).toEqual(["201"]);
    expect(sortAssignmentRooms(queue, "priority")[0].room.roomNumber).toBe("201");
    expect(sortAssignmentRooms(queue, "location").map((entry) => entry.room.roomNumber)).toEqual(["101", "102", "103", "104", "201", "301", "302"]);
  });

  it("explains an empty result", () => {
    expect(run({ search: "999" }).emptyReason).toBe("search");
    expect(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "Z" } }).emptyReason).toBe("filters");
    expect(run({ scope: "urgent", filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A" } }).emptyReason).toBe("scope");
    expect(runAssignmentQuery({ rooms: [], search: "", filters: EMPTY_ASSIGNMENT_FILTERS, scope: "all", sort: "priority" }).emptyReason).toBeNull();
  });
});

describe("auxiliary sources never blank verified rooms", () => {
  it("with both extra sources unavailable the board, owners and team are intact", () => {
    const model = assignmentsOf({
      settings: { status: "failed", failure: { kind: "error", status: 500 } },
      schedule: { status: "failed", failure: { kind: "error", status: 500 } },
    });
    expect(model.rooms).toHaveLength(10);
    expect(model.team).toHaveLength(3);
    expect(model.settings.trust).toBe("unknown");
    expect(model.schedule).toMatchObject({ trust: "unknown", shifts: null });
    expect(selectSummary(model)?.remainingWork).toBe(5);
  });

  it("an empty schedule is a verified answer: nobody is scheduled", () => {
    const model = assignmentsOf({ schedule: availableSource([], NOW) });
    expect(model.schedule).toMatchObject({ trust: "verified", shifts: [] });
    expect(model.team?.every((member) => member.scheduled === false)).toBe(true);
  });
});
