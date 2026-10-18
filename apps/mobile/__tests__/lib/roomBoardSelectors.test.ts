import { normalizeBoardRecords, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import {
  buildBoardMetrics,
  compareByOperationalPriority,
  compareRoomNumbers,
  filterByStage,
  filterByStatus,
  filterUnassigned,
  findAwaitingInspection,
  findUrgentRooms,
  groupByBuildingAndFloor,
  isUnassignedWork,
  roomIndicators,
  searchByRoomNumber,
  selectAvailableStaff,
  sortByRoomNumber,
  sortRooms,
  urgentReasons,
} from "@/lib/housekeeping/roomBoardSelectors";
import { composeRoomBoard, initialRoomBoardSources, type BoardRoomView, type BoardStaffMember } from "@/lib/housekeeping/roomBoardState";
import { buildReadinessSummary } from "@/lib/housekeeping/supervisorToday";
import { availableSource } from "@/lib/housekeeping/supervisorSources";
import { HOTEL_DATE, NOW, STAFF, ZONE, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const rooms = (raw = hotelBoard()) => normalizeBoardRecords(raw, HOTEL_DATE).rooms;
const views = (raw = hotelBoard()): BoardRoomView[] => rooms(raw).map((room) => ({ room, assignee: null }));
const numbers = (list: Array<{ room: BoardRoom }> | BoardRoom[]) =>
  list.map((item) => ("room" in item ? item.room.roomNumber : item.roomNumber));

describe("grouping by building and floor", () => {
  it("groups building → floor → rooms in natural order", () => {
    const groups = groupByBuildingAndFloor(
      rooms([
        rawRoom("1002", "DIRTY"),
        rawRoom("102", "DIRTY"),
        rawRoom("101", "DIRTY"),
        rawRoom("201", "DIRTY", { rooms: { room_number: "201", floor: 2, building: "A" } }),
        rawRoom("301", "DIRTY", { rooms: { room_number: "301", floor: 3, building: "B" } }),
      ]),
    );
    expect(groups.map((g) => g.building)).toEqual(["A", "B"]);
    expect(groups[0].floors.map((f) => f.floor)).toEqual([1, 2, 10]);
    expect(groups[0].floors[0].rooms.map((r) => r.roomNumber)).toEqual(["101", "102"]);
  });

  it("puts rooms with no building or no floor in their own trailing groups — never on a fake floor 0", () => {
    const groups = groupByBuildingAndFloor(
      rooms([
        rawRoom("101", "DIRTY"),
        { room_id: "nf", status: "DIRTY", rooms: { room_number: "999", building: "A" } },
        { room_id: "nb", status: "DIRTY", rooms: { room_number: "555", floor: 5 } },
      ]),
    );
    expect(groups.map((g) => g.building)).toEqual(["A", null]);
    expect(groups[0].floors.map((f) => f.floor)).toEqual([1, null]);
    expect(groups[0].floors[1].rooms.map((r) => r.roomNumber)).toEqual(["999"]);
    expect(groups[1].floors[0].floor).toBe(5);
  });

  it("accepts view models as well as bare rooms", () => {
    const groups = groupByBuildingAndFloor(views());
    expect(groups.flatMap((g) => g.floors.flatMap((f) => f.rooms)).every((item) => "room" in item)).toBe(true);
  });
});

describe("filters", () => {
  it("filters by stage", () => {
    expect(numbers(filterByStage(views(), ["to_clean"]))).toEqual(["101", "102", "103", "201"]);
    expect(numbers(filterByStage(views(), ["unavailable"]))).toEqual(["107", "108", "109"]);
    expect(numbers(filterByStage(views(), ["in_progress", "awaiting_inspection"]))).toEqual(["104", "105"]);
  });

  it("filters by exact backend status, including unrecognised ones by their raw text", () => {
    const list = views([...hotelBoard(), rawRoom("401", "MYSTERY")]);
    expect(numbers(filterByStatus(list, ["PICKUP"]))).toEqual(["103"]);
    expect(numbers(filterByStatus(list, ["MYSTERY"]))).toEqual(["401"]);
    expect(numbers(filterByStatus(list, ["OOO", "OUT_OF_SERVICE"]))).toEqual(["107", "109"]);
  });

  it("finds unassigned work: only rooms still needing housekeeping, judged by user id (not name)", () => {
    expect(numbers(filterUnassigned(views()))).toEqual(["101", "201"]);
    // Assigned to a user whose NAME is unknown is still assigned.
    const noName: BoardRoomView[] = views([rawRoom("101", "DIRTY", { assigned_to: "ghost", assignment_id: null })]);
    expect(filterUnassigned(noName)).toEqual([]);
    expect(isUnassignedWork(rooms([rawRoom("101", "INSPECTED")])[0])).toBe(false);
    expect(isUnassignedWork(rooms([rawRoom("101", "OOO")])[0])).toBe(false);
    expect(isUnassignedWork(rooms([rawRoom("101", "CLEAN")])[0])).toBe(false);
  });

  it("finds rooms awaiting inspection (CLEAN) and never counts them as ready", () => {
    const awaiting = findAwaitingInspection(views());
    expect(numbers(awaiting)).toEqual(["105"]);
    expect(awaiting.every((item) => !item.room.statusInfo.guestReady)).toBe(true);
  });
});

describe("room-number search", () => {
  const list = views([rawRoom("101", "DIRTY"), rawRoom("110", "DIRTY"), rawRoom("201", "DIRTY"), rawRoom("1101", "DIRTY"), rawRoom("A12", "DIRTY"), rawRoom("12", "DIRTY")]);

  it("ranks exact, then prefix, then contains — each in natural room order", () => {
    // "101": exact first, then rooms that merely contain it.
    expect(numbers(searchByRoomNumber(list, "101"))).toEqual(["101", "1101"]);
    // "1": no exact match; prefix matches (natural order) before contains matches (natural order).
    expect(numbers(searchByRoomNumber(list, "1"))).toEqual(["12", "101", "110", "1101", "201", "A12"]);
  });

  it("is case-insensitive, trims whitespace and returns everything for an empty query", () => {
    expect(numbers(searchByRoomNumber(list, "  a12 "))).toEqual(["A12"]);
    expect(searchByRoomNumber(list, "   ")).toHaveLength(list.length);
    expect(searchByRoomNumber(list, "zzz")).toEqual([]);
  });
});

describe("urgent rooms — recorded facts only", () => {
  const TZ = ZONE;

  it("a reclean request, a VIP not ready, an elevated priority, a stored HIGH risk and a passed arrival are each urgent", () => {
    const [reclean, vip, priority, risk, arrival] = rooms([
      rawRoom("101", "DIRTY", { reclean_requested_at: "2026-10-16T16:00:00Z" }),
      rawRoom("102", "DIRTY", { vip_flag: true }),
      rawRoom("103", "DIRTY", { priority: 2 }),
      rawRoom("104", "DIRTY", { prediction: { risk_level: "HIGH" } }),
      rawRoom("105", "DIRTY", { checkin_time: "2026-10-16T16:00:00Z" }),
    ]);
    expect(urgentReasons(reclean, NOW, TZ)).toEqual(["reclean_requested"]);
    expect(urgentReasons(vip, NOW, TZ)).toEqual(["vip_not_ready"]);
    expect(urgentReasons(priority, NOW, TZ)).toEqual(["priority_elevated"]);
    expect(urgentReasons(risk, NOW, TZ)).toEqual(["high_risk"]);
    expect(urgentReasons(arrival, NOW, TZ)).toEqual(["arrival_passed"]);
  });

  it("does not invent urgency: default priority, future arrival, MEDIUM risk, no prediction", () => {
    const [plain, future, medium] = rooms([
      rawRoom("101", "DIRTY", { priority: 5 }),
      rawRoom("102", "DIRTY", { checkin_time: "2026-10-16T22:00:00Z" }),
      rawRoom("103", "DIRTY", { prediction: { risk_level: "MEDIUM", confidence_score: 0.99 } }),
    ]);
    for (const room of [plain, future, medium]) expect(urgentReasons(room, NOW, TZ)).toEqual([]);
  });

  it("ignores an arrival time left over from another day", () => {
    const [stale] = rooms([rawRoom("101", "DIRTY", { checkin_time: "2026-10-14T20:00:00Z" })]);
    expect(urgentReasons(stale, NOW, TZ)).toEqual([]);
  });

  it("judges 'today' on the hotel's calendar: an arrival at 11 PM last night (Chicago) is not today's", () => {
    const [lastNight] = rooms([rawRoom("101", "DIRTY", { checkin_time: "2026-10-16T04:30:00Z" })]); // 23:30 on the 15th, Chicago
    expect(urgentReasons(lastNight, NOW, TZ)).toEqual([]);
  });

  it("guest-ready and unavailable rooms are never urgent", () => {
    const list = rooms([
      rawRoom("101", "INSPECTED", { vip_flag: true, priority: 1 }),
      rawRoom("102", "OOO", { vip_flag: true }),
      rawRoom("103", "CLEAN", { vip_flag: true }),
    ]);
    expect(urgentReasons(list[0], NOW, TZ)).toEqual([]);
    expect(urgentReasons(list[1], NOW, TZ)).toEqual([]);
    // Submitted but not yet inspected is still not ready, so it can be urgent.
    expect(urgentReasons(list[2], NOW, TZ)).toEqual(["vip_not_ready"]);
  });

  it("lists reasons in a fixed order and findUrgentRooms uses them", () => {
    const [all] = rooms([
      rawRoom("101", "DIRTY", {
        vip_flag: true,
        priority: 1,
        reclean_requested_at: "2026-10-16T16:00:00Z",
        checkin_time: "2026-10-16T15:00:00Z",
        prediction: { risk_level: "HIGH" },
      }),
    ]);
    expect(urgentReasons(all, NOW, TZ)).toEqual(["reclean_requested", "arrival_passed", "vip_not_ready", "priority_elevated", "high_risk"]);
    expect(numbers(findUrgentRooms(views(), NOW, TZ))).toEqual(["201"]); // the VIP in hotelBoard
  });
});

describe("sorting", () => {
  it("sorts by room number naturally and deterministically (ties by id)", () => {
    const list = rooms([rawRoom("1001", "DIRTY"), rawRoom("101", "DIRTY"), rawRoom("20", "DIRTY"), rawRoom("9", "DIRTY")]);
    expect(sortByRoomNumber(list).map((r) => r.roomNumber)).toEqual(["9", "20", "101", "1001"]);
    const twins = rooms([rawRoom("101", "DIRTY", { room_id: "b" }), rawRoom("101", "DIRTY", { room_id: "a" })]);
    expect(sortByRoomNumber(twins).map((r) => r.roomId)).toEqual(["a", "b"]);
    expect(compareRoomNumbers(twins[0], twins[0])).toBe(0);
  });

  it("operational priority: work first, then guest-ready, then unavailable; urgency, known arrival, queue, number", () => {
    const list = views([
      rawRoom("101", "INSPECTED"),
      rawRoom("102", "OOO"),
      rawRoom("103", "DIRTY"),
      rawRoom("104", "DIRTY", { vip_flag: true }),
      rawRoom("105", "DIRTY", { vip_flag: true, priority: 1 }),
      rawRoom("106", "CLEAN"),
      rawRoom("107", "IN_PROGRESS"),
      rawRoom("108", "DIRTY", { checkin_time: "2026-10-16T21:00:00Z" }),
      rawRoom("109", "DIRTY", { checkin_time: "2026-10-16T19:00:00Z" }),
      rawRoom("110", "MYSTERY"),
    ]);
    expect(numbers(sortRooms(list, "priority", NOW, ZONE))).toEqual([
      "110", // an unrecognised status needs a look, so it is not buried
      "105", // two urgent reasons
      "104", // one urgent reason
      "109", // known arrival today, earlier
      "108", // known arrival today, later
      "106", // awaiting inspection (supervisor's own queue) before plain to-clean
      "103", // to clean
      "107", // in progress
      "101", // guest ready
      "102", // unavailable
    ]);
  });

  it("is a total, stable order: shuffling the input never changes the result", () => {
    const base = views([...hotelBoard(), rawRoom("302", "CLEAN"), rawRoom("303", "DIRTY", { priority: 3 })]);
    const expected = numbers(sortRooms(base, "priority", NOW, ZONE));
    for (let seed = 1; seed <= 5; seed += 1) {
      const shuffled = [...base].sort((a, b) => ((a.room.roomNumber.charCodeAt(2) * seed) % 7) - ((b.room.roomNumber.charCodeAt(2) * seed) % 7));
      expect(numbers(sortRooms(shuffled, "priority", NOW, ZONE))).toEqual(expected);
    }
    expect(numbers(sortRooms(base, "roomNumber", NOW, ZONE))).toEqual(numbers(sortByRoomNumber(base.map((v) => v.room))));
    const [a, b] = rooms([rawRoom("101", "DIRTY"), rawRoom("101", "DIRTY", { room_id: "z" })]);
    expect(Math.sign(compareByOperationalPriority(a, b, NOW, ZONE))).toBe(-Math.sign(compareByOperationalPriority(b, a, NOW, ZONE)));
  });

  it("does not mutate its input", () => {
    const list = views();
    const copy = [...list];
    sortRooms(list, "priority", NOW, ZONE);
    expect(list).toEqual(copy);
  });
});

describe("metrics", () => {
  it("uses the in-service denominator and keeps CLEAN out of 'ready'", () => {
    const metrics = buildBoardMetrics(rooms());
    expect(metrics).toMatchObject({
      inventory: 10,
      inService: 7,
      unavailable: 3,
      guestReady: 1,
      awaitingInspection: 1,
      inProgress: 1,
      toClean: 4,
      unknown: 0,
      unassigned: 2,
      vip: 1,
    });
    expect(metrics.readiness).toBeCloseTo(1 / 7);
  });

  it("agrees with Supervisor Today's readiness summary", () => {
    const list = rooms([...hotelBoard(), rawRoom("401", "MYSTERY"), rawRoom("402", "INSPECTED", { dnd_flag: true })]);
    const metrics = buildBoardMetrics(list);
    const summary = buildReadinessSummary(list, { nowMs: NOW, timeZone: ZONE });
    expect(metrics.inventory).toBe(summary.inventoryTotal);
    expect(metrics.inService).toBe(summary.inService);
    expect(metrics.guestReady).toBe(summary.ready);
    expect(metrics.awaitingInspection).toBe(summary.awaitingInspection);
    expect(metrics.inProgress).toBe(summary.inProgress);
    expect(metrics.toClean).toBe(summary.toClean);
    expect(metrics.unknown).toBe(summary.unclassified);
    expect(metrics.unassigned).toBe(summary.unassignedActionable);
    expect(metrics.readiness).toBe(summary.progress);
  });

  it("has no readiness when nothing is in service, and an empty board is all zeros", () => {
    expect(buildBoardMetrics(rooms([rawRoom("101", "OOO")])).readiness).toBeNull();
    expect(buildBoardMetrics([])).toMatchObject({ inventory: 0, inService: 0, readiness: null });
  });

  it("excludes out-of-service rooms from VIP / DND counts", () => {
    const metrics = buildBoardMetrics(rooms([rawRoom("101", "OOO", { vip_flag: true, dnd_flag: true }), rawRoom("102", "DIRTY", { dnd_flag: true })]));
    expect(metrics).toMatchObject({ vip: 0, dnd: 1 });
  });
});

describe("indicators", () => {
  it("reports VIP / DND / service-declined / inspection / reclean / work order / note / late checkout", () => {
    const [room] = rooms([
      rawRoom("101", "CLEAN", {
        vip_flag: true,
        dnd_flag: true,
        do_not_service: true,
        inspection_required: true,
        reclean_requested_at: "2026-10-16T16:00:00Z",
        open_work_order_id: "wo-1",
        latest_note: "Smells of smoke",
        prediction: { risk_level: "HIGH" },
      }),
    ]);
    expect(roomIndicators({ ...room, lateCheckout: { requestId: "l", status: "pending", requestedTime: null } })).toEqual({
      vip: true,
      dnd: true,
      serviceDeclined: true,
      inspectionRequired: true,
      awaitingInspection: true,
      recleanRequested: true,
      openWorkOrder: true,
      hasNote: true,
      lateCheckout: true,
      highRisk: true,
    });
  });

  it("claims 'inspection required' only for a room awaiting one that the backend flagged", () => {
    const [flaggedButDirty, unflagged, unknownFlag] = rooms([
      rawRoom("101", "DIRTY", { inspection_required: true }),
      rawRoom("102", "CLEAN", { inspection_required: false }),
      rawRoom("103", "CLEAN"),
    ]);
    expect(roomIndicators(flaggedButDirty).inspectionRequired).toBe(false);
    expect(roomIndicators(unflagged)).toMatchObject({ awaitingInspection: true, inspectionRequired: false });
    expect(roomIndicators(unknownFlag)).toMatchObject({ awaitingInspection: true, inspectionRequired: false });
  });
});

describe("available staff — attendance stated honestly", () => {
  const member = (userId: string, name: string, availability: BoardStaffMember["availability"], openRooms: number): BoardStaffMember => ({
    userId,
    name,
    role: "housekeeper",
    availability,
    assignedRooms: openRooms,
    openRooms,
  });

  it("with a verified roster only people on shift are offered, least-loaded first", () => {
    const { members, restrictedToShift } = selectAvailableStaff(
      [member("a", "Zed", "on_shift", 3), member("b", "Amy", "on_shift", 3), member("c", "Cal", "on_shift", 1), member("d", "Dee", "not_clocked_in", 0), member("e", "Eli", "ended", 0), member("f", "Fay", "on_break", 0)],
      "verified",
    );
    expect(restrictedToShift).toBe(true);
    expect(members.map((m) => m.userId)).toEqual(["c", "b", "a"]);
  });

  it.each(["stale", "unknown"] as const)("with a %s roster nobody is filtered out or called on shift", (trust) => {
    const { members, restrictedToShift } = selectAvailableStaff([member("a", "Zed", "unknown", 2), member("b", "Amy", "unknown", 0)], trust);
    expect(restrictedToShift).toBe(false);
    expect(members.map((m) => m.userId)).toEqual(["b", "a"]);
    expect(members.every((m) => m.availability === "unknown")).toBe(true);
  });

  it("composes end to end from the board model", () => {
    const model = composeRoomBoard(
      { ...initialRoomBoardSources(), board: availableSource(normalizeBoardRecords(hotelBoard(), HOTEL_DATE), NOW), staff: availableSource(STAFF, NOW) },
      { now: NOW, timeZone: ZONE },
    );
    const { members, restrictedToShift } = selectAvailableStaff(model.staff, model.rosterTrust);
    expect(restrictedToShift).toBe(false); // roster still loading → unknown
    // Least-loaded first: hk-3 has nothing open, hk-2 one room in progress, hk-1 two rooms to clean.
    expect(members.map((m) => m.userId)).toEqual(["hk-3", "hk-2", "hk-1"]);
  });
});
