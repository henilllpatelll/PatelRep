import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import {
  EMPTY_FILTERS,
  applyFilters,
  applySearch,
  buildFilterAvailability,
  buildFilterChips,
  filterCount,
  floorKeyOf,
  floorsForBuilding,
  removeChip,
  roomMatchesFilters,
  searchRank,
  selectBuilding,
  toggleIn,
  unavailableApplied,
  type BoardFilters,
} from "@/lib/housekeeping/roomBoardFilters";
import {
  MIN_FLOORS_FOR_JUMP,
  buildFloorJumps,
  buildQueryItems,
  floorTotals,
  runBoardQuery,
  LIST_THRESHOLD,
} from "@/lib/housekeeping/roomBoardQuery";
import { compareLocation, isFlatSort, sortViews, usableTime, type BoardSortKey } from "@/lib/housekeeping/roomBoardSort";
import type { BoardRoomView } from "@/lib/housekeeping/roomBoardState";
import { HOTEL_DATE, NOW, ZONE, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const ctx = { now: NOW, timeZone: ZONE };
const viewsOf = (raw = hotelBoard()): BoardRoomView[] =>
  normalizeBoardRecords(raw, HOTEL_DATE).rooms.map((room) => ({ room, assignee: null }));
const numbers = (list: BoardRoomView[]) => list.map((view) => view.room.roomNumber);
const filters = (patch: Partial<BoardFilters>): BoardFilters => ({ ...EMPTY_FILTERS, ...patch });

// Hotel-local noon on 2026-10-16 is 17:00Z. Times below are on / around that day.
const TODAY_AM = "2026-10-16T14:00:00Z"; // 09:00 local, already passed
const TODAY_PM = "2026-10-16T20:00:00Z"; // 15:00 local
const TODAY_LATE = "2026-10-17T03:00:00Z"; // 22:00 local, still the 16th
const TOMORROW = "2026-10-17T18:00:00Z";
const YESTERDAY = "2026-10-15T18:00:00Z";

const withTimes = (number: string, status: string, extra = {}) => rawRoom(number, status, extra);

describe("search", () => {
  const list = viewsOf([rawRoom("201", "DIRTY"), rawRoom("202", "DIRTY"), rawRoom("1201", "DIRTY"), rawRoom("20", "DIRTY"), rawRoom("PH1", "DIRTY"), rawRoom("301A", "DIRTY")]);

  it("matches numeric prefixes and substrings, exact first then prefix then contains", () => {
    expect(numbers(applySearch(list, "20"))).toEqual(["20", "201", "202", "1201"]);
  });

  it("matches alphanumeric room identifiers case-insensitively", () => {
    expect(numbers(applySearch(list, "ph1"))).toEqual(["PH1"]);
    expect(numbers(applySearch(list, "301a"))).toEqual(["301A"]);
    expect(numbers(applySearch(list, "301A"))).toEqual(["301A"]);
  });

  it("trims and ignores whitespace, and an empty query keeps every room", () => {
    expect(numbers(applySearch(list, "  202  "))).toEqual(["202"]);
    expect(numbers(applySearch(list, "2 0 2"))).toEqual(["202"]);
    expect(applySearch(list, "   ")).toHaveLength(list.length);
  });

  it("returns nothing for a query that matches no room", () => {
    expect(applySearch(list, "999")).toEqual([]);
  });

  it("ranks exact 0, prefix 1, contains 2, none null", () => {
    expect([searchRank("201", "201"), searchRank("201", "20"), searchRank("1201", "20"), searchRank("201", "9")]).toEqual([0, 1, 2, null]);
  });

  it("searches room numbers only, never guest information", () => {
    const guest = viewsOf([rawRoom("101", "DIRTY", { latest_note: "Smith family", guest_name: "Smith" } as never)]);
    expect(applySearch(guest, "smith")).toEqual([]);
  });
});

describe("status filters (OR within the category)", () => {
  const list = viewsOf();
  const matching = (statuses: BoardFilters["statuses"]) =>
    numbers(applyFilters(list, filters({ statuses }), buildFilterAvailability(list.map((v) => v.room)), ctx));

  it("maps stages: DIRTY/OCCUPIED/PICKUP = to clean, CLEAN = awaiting inspection, INSPECTED = ready", () => {
    expect(matching(["toClean"])).toEqual(["101", "102", "103", "201"]);
    expect(matching(["working"])).toEqual(["104"]);
    expect(matching(["toInspect"])).toEqual(["105"]);
    expect(matching(["ready"])).toEqual(["106"]);
  });

  it("keeps out of order and out of service distinct (OOO + OUT_OF_ORDER together, OUT_OF_SERVICE alone)", () => {
    expect(matching(["outOfOrder"])).toEqual(["107", "108"]);
    expect(matching(["outOfService"])).toEqual(["109"]);
  });

  it("combines selections with OR", () => {
    expect(matching(["toClean", "toInspect"])).toEqual(["101", "102", "103", "105", "201"]);
  });

  it("does not drop an unrecognised status: it stays under All and has its own filter", () => {
    const mixed = viewsOf([rawRoom("101", "DIRTY"), rawRoom("102", "MYSTERY")]);
    const availability = buildFilterAvailability(mixed.map((v) => v.room));
    expect(availability.hasUnrecognized).toBe(true);
    expect(numbers(applyFilters(mixed, filters({ statuses: ["unrecognized"] }), availability, ctx))).toEqual(["102"]);
    expect(applyFilters(mixed, EMPTY_FILTERS, availability, ctx)).toHaveLength(2);
    expect(buildFilterAvailability(list.map((v) => v.room)).hasUnrecognized).toBe(false);
  });
});

describe("operational filters (AND across categories)", () => {
  const raw = [
    withTimes("101", "DIRTY", { checkin_time: TODAY_PM }),
    withTimes("102", "DIRTY", { checkin_time: TODAY_PM, assigned_to: "hk-1", assignment_id: "a1" }),
    withTimes("103", "DIRTY", { checkin_time: TOMORROW }),
    withTimes("104", "OCCUPIED", { checkout_time: TODAY_AM, dnd_flag: true, fo_status: "OCC" }),
    withTimes("105", "CLEAN", { checkout_time: TODAY_AM, vip_flag: true }),
    withTimes("106", "DIRTY", { open_work_order_id: "wo1", open_work_order_title: "Leak" }),
    withTimes("107", "DIRTY", { checkin_time: YESTERDAY, prediction: { risk_level: "HIGH" } }),
    withTimes("108", "INSPECTED", { prediction: { risk_level: "HIGH" } }),
    withTimes("109", "OOO", { vip_flag: true }),
  ];
  const list = viewsOf(raw);
  const availability = buildFilterAvailability(list.map((v) => v.room));
  const run = (patch: Partial<BoardFilters>) => numbers(applyFilters(list, filters(patch), availability, ctx));

  it("unassigned means in-service work with nobody tied to it", () => {
    expect(run({ flags: ["unassigned"] })).toEqual(["101", "103", "104", "106", "107"]);
  });

  it("arrivals / departures today compare with the hotel's date, not the phone's", () => {
    expect(run({ flags: ["arrivalsToday"] })).toEqual(["101", "102"]);
    expect(run({ flags: ["departuresToday"] })).toEqual(["104", "105"]);
    // 22:00 local on the 16th is 03:00Z on the 17th — still the hotel's today.
    const late = viewsOf([rawRoom("201", "DIRTY", { checkin_time: TODAY_LATE })]);
    const a = buildFilterAvailability(late.map((v) => v.room));
    expect(applyFilters(late, filters({ flags: ["arrivalsToday"] }), a, ctx)).toHaveLength(1);
  });

  it("VIP, DND and open work order read the recorded flags", () => {
    expect(run({ flags: ["vip"] })).toEqual(["105", "109"]);
    expect(run({ flags: ["dnd"] })).toEqual(["104"]);
    expect(run({ flags: ["workOrder"] })).toEqual(["106"]);
  });

  it("urgent follows the Phase 1 recorded-reason rule (a VIP not ready, a passed arrival…)", () => {
    // 101/102 arrive 15:00 (after noon, not passed); 105 is a VIP not ready; 109 is out of service so never urgent.
    expect(run({ flags: ["urgent"] })).toEqual(["105", "107"]);
  });

  it("readiness risk uses the stored HIGH forecast and ignores ready / unavailable rooms", () => {
    expect(run({ flags: ["risk"] })).toEqual(["107"]);
  });

  it("different categories combine with AND", () => {
    expect(run({ statuses: ["toClean"], flags: ["unassigned", "arrivalsToday"] })).toEqual(["101"]);
    expect(run({ flags: ["arrivalsToday", "departuresToday"] })).toEqual([]);
    expect(run({ statuses: ["toClean", "toInspect"], flags: ["departuresToday", "vip"] })).toEqual(["105"]);
  });
});

describe("filters whose data source is missing", () => {
  it("are unavailable, not false zeros", () => {
    const list = viewsOf();
    const availability = buildFilterAvailability(list.map((v) => v.room));
    expect([...availability.unavailableFlags].sort()).toEqual(["arrivalsToday", "departuresToday", "risk"]);
    const applied = filters({ flags: ["arrivalsToday"] });
    expect(unavailableApplied(applied, availability)).toEqual(["arrivalsToday"]);
    // Not applied: every room still shows rather than a misleading empty board.
    expect(applyFilters(list, applied, availability, ctx)).toHaveLength(list.length);
  });

  it("become available as soon as the board carries the data", () => {
    const list = viewsOf([rawRoom("101", "DIRTY", { checkin_time: TOMORROW, checkout_time: TODAY_AM, prediction: { risk_level: "LOW" } })]);
    expect(buildFilterAvailability(list.map((v) => v.room)).unavailableFlags.size).toBe(0);
  });
});

describe("building and floor", () => {
  const raw = [
    rawRoom("101", "DIRTY"),
    rawRoom("201", "DIRTY"),
    rawRoom("301", "DIRTY", { rooms: { room_number: "301", floor: 3, building: "B" } }),
    rawRoom("102", "DIRTY", { rooms: { room_number: "102", floor: 1, building: "B" } }),
    rawRoom("900", "DIRTY", { rooms: { room_number: "900", building: null } }),
  ];
  const list = viewsOf(raw);
  const rooms = list.map((v) => v.room);
  const availability = buildFilterAvailability(rooms);

  it("offers building selection only when there are several buildings, and lists floors per building", () => {
    expect(availability.buildings).toEqual(["A", "B", "~"]);
    expect(buildFilterAvailability(viewsOf([rawRoom("101", "DIRTY"), rawRoom("201", "DIRTY")]).map((v) => v.room)).buildings).toEqual(["A"]);
    expect(floorsForBuilding(availability, "B").map((f) => f.key)).toEqual(["B|1", "B|3"]);
    expect(floorsForBuilding(availability, null).map((f) => f.key)).toEqual(["A|1", "A|2", "B|1", "B|3", "~|~"]);
  });

  it("filters by building and by building-qualified floor, so floor 1 of A and B never mix", () => {
    const run = (patch: Partial<BoardFilters>) => numbers(applyFilters(list, filters(patch), availability, ctx));
    expect(run({ building: "B" })).toEqual(["301", "102"]);
    expect(run({ floors: ["A|1"] })).toEqual(["101"]);
    expect(run({ floors: ["A|1", "B|1"] })).toEqual(["101", "102"]);
    expect(run({ building: "B", floors: ["B|3"] })).toEqual(["301"]);
  });

  it("keeps rooms with no building or no floor selectable instead of dropping them", () => {
    const run = (patch: Partial<BoardFilters>) => numbers(applyFilters(list, filters(patch), availability, ctx));
    expect(run({ building: "~" })).toEqual(["900"]);
    expect(run({ floors: ["~|~"] })).toEqual(["900"]);
    expect(floorKeyOf(rooms[4])).toBe("~|~");
  });

  it("choosing a building drops floors that belong to other buildings", () => {
    const next = selectBuilding(filters({ floors: ["A|1", "B|3"] }), "B");
    expect(next).toEqual({ ...EMPTY_FILTERS, building: "B", floors: ["B|3"] });
    expect(selectBuilding(next, null).building).toBeNull();
  });
});

describe("chips", () => {
  const applied = filters({ statuses: ["toClean"], flags: ["unassigned", "vip"], building: "A", floors: ["A|2", "~|~"] });

  it("has one chip per applied filter and counts them", () => {
    expect(filterCount(applied)).toBe(6);
    expect(buildFilterChips(applied).map((c) => c.id)).toEqual(["status:toClean", "flag:unassigned", "flag:vip", "building:A", "floor:A|2", "floor:~|~"]);
  });

  it("removing a chip removes exactly that filter", () => {
    const chips = buildFilterChips(applied);
    expect(removeChip(applied, chips[1]).flags).toEqual(["vip"]);
    expect(removeChip(applied, chips[3]).building).toBeNull();
    expect(removeChip(applied, chips[4]).floors).toEqual(["~|~"]);
    expect(removeChip(applied, chips[0]).statuses).toEqual([]);
  });

  it("parses a floor chip's building and floor", () => {
    const floor = buildFilterChips(filters({ floors: ["A|2", "~|~"] }));
    expect(floor[0]).toMatchObject({ building: "A", floor: 2 });
    expect(floor[1]).toMatchObject({ building: null, floor: null });
  });

  it("toggleIn adds then removes", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sorting", () => {
  const order = (raw: ReturnType<typeof rawRoom>[], sort: BoardSortKey) => numbers(sortViews(viewsOf(raw), sort, ctx));

  it("room number is natural, not lexicographic, and handles alphanumeric ids", () => {
    expect(order([rawRoom("201", "DIRTY"), rawRoom("110", "DIRTY"), rawRoom("12", "DIRTY"), rawRoom("103", "DIRTY"), rawRoom("101", "DIRTY"), rawRoom("1A", "DIRTY"), rawRoom("2", "DIRTY")], "roomNumber")).toEqual([
      "1A",
      "2",
      "12",
      "101",
      "103",
      "110",
      "201",
    ]);
  });

  it("floor sorts building, then floor, then room, with unknown last", () => {
    const raw = [
      rawRoom("301", "DIRTY", { rooms: { room_number: "301", floor: 3, building: "A" } }),
      rawRoom("102", "DIRTY", { rooms: { room_number: "102", floor: 1, building: "B" } }),
      rawRoom("101", "DIRTY", { rooms: { room_number: "101", floor: 1, building: "A" } }),
      rawRoom("900", "DIRTY", { rooms: { room_number: "900", building: null } }),
      rawRoom("501", "DIRTY", { rooms: { room_number: "501", building: "A" } }),
    ];
    expect(order(raw, "floor")).toEqual(["101", "301", "501", "102", "900"]);
  });

  it("departure sorts by recorded checkout, earliest first; missing and stale times sort last", () => {
    const raw = [
      rawRoom("101", "DIRTY"),
      rawRoom("102", "DIRTY", { checkout_time: TOMORROW }),
      rawRoom("103", "DIRTY", { checkout_time: YESTERDAY }),
      rawRoom("104", "DIRTY", { checkout_time: TODAY_AM }),
      rawRoom("105", "DIRTY", { checkout_time: TODAY_PM }),
      rawRoom("106", "DIRTY", { checkout_time: "not a date" }),
    ];
    expect(order(raw, "departure")).toEqual(["104", "105", "102", "101", "103", "106"]);
  });

  it("arrival works the same way on check-in", () => {
    const raw = [rawRoom("101", "DIRTY", { checkin_time: TODAY_PM }), rawRoom("102", "DIRTY"), rawRoom("103", "DIRTY", { checkin_time: TODAY_AM })];
    expect(order(raw, "arrival")).toEqual(["103", "101", "102"]);
  });

  it("a missing timestamp is never read as 'immediately'", () => {
    expect(usableTime(null, ctx)).toBeNull();
    expect(usableTime(YESTERDAY, ctx)).toBeNull();
    expect(usableTime(TODAY_AM, ctx)).toBe(Date.parse(TODAY_AM));
  });

  it("cleaning status follows the day's flow: unrecognised, to clean, working, to inspect, ready, unavailable", () => {
    const raw = [
      rawRoom("106", "INSPECTED"),
      rawRoom("107", "OOO"),
      rawRoom("105", "CLEAN"),
      rawRoom("104", "IN_PROGRESS"),
      rawRoom("101", "DIRTY"),
      rawRoom("108", "MYSTERY"),
    ];
    expect(order(raw, "status")).toEqual(["108", "101", "104", "105", "106", "107"]);
  });

  it("priority first: urgent before plain, unassigned before assigned, ready and unavailable last", () => {
    const raw = [
      rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "a" }),
      rawRoom("102", "DIRTY"),
      rawRoom("103", "DIRTY", { priority: 1 }),
      rawRoom("104", "INSPECTED"),
      rawRoom("105", "OOO"),
      rawRoom("106", "CLEAN"),
      rawRoom("107", "DIRTY", { vip_flag: true }),
      rawRoom("108", "DIRTY", { priority: 3 }),
    ];
    // 103 priority 1 and 108 priority 3 and 107 VIP each have one recorded reason; the stronger priority wins the tie.
    expect(order(raw, "priority")).toEqual(["103", "108", "107", "102", "106", "101", "104", "105"]);
  });

  it("priority ties fall through to building, floor and natural room number — deterministically", () => {
    const raw = [rawRoom("110", "DIRTY"), rawRoom("12", "DIRTY"), rawRoom("101", "DIRTY")];
    const first = order(raw, "priority");
    expect(first).toEqual(["12", "101", "110"]);
    expect(order([...raw].reverse(), "priority")).toEqual(first);
  });

  it("an arrival time is not a deadline: it only orders rooms that are otherwise equal", () => {
    const raw = [rawRoom("101", "DIRTY"), rawRoom("102", "DIRTY", { checkin_time: TODAY_LATE }), rawRoom("103", "DIRTY", { checkin_time: TODAY_PM })];
    expect(order(raw, "priority")).toEqual(["103", "102", "101"]);
  });

  it("does not mutate its input and compareLocation is a total order", () => {
    const list = viewsOf();
    const copy = [...list];
    sortViews(list, "priority", ctx);
    expect(list).toEqual(copy);
    const [a, b] = list;
    expect(Math.sign(compareLocation(a.room, b.room))).toBe(-Math.sign(compareLocation(b.room, a.room)));
  });

  it("flat sorts are the time- and flow-based ones", () => {
    expect(["departure", "arrival", "status"].every((s) => isFlatSort(s as BoardSortKey))).toBe(true);
    expect(["priority", "roomNumber", "floor"].some((s) => isFlatSort(s as BoardSortKey))).toBe(false);
  });
});

describe("the query pipeline", () => {
  const list = viewsOf();
  const availability = buildFilterAvailability(list.map((v) => v.room));
  const query = (patch: Partial<Parameters<typeof runBoardQuery>[0]>) =>
    runBoardQuery({ views: list, search: "", filters: EMPTY_FILTERS, segment: "all", sort: "priority", availability, ctx, ...patch });

  it("shows everything, grouped, with whole-board counts when nothing is applied", () => {
    const result = query({});
    expect(result.visible).toHaveLength(10);
    expect(result.layout).toBe("grid");
    expect(result.counts).toEqual({ all: 10, toClean: 4, working: 1, toInspect: 1, ready: 1 });
    expect(result.emptyReason).toBeNull();
  });

  it("derives segment counts from the filtered dataset before the segment's own restriction", () => {
    const result = query({ filters: filters({ flags: ["unassigned"] }), segment: "toInspect" });
    // Unassigned actionable rooms: 101, 201 (DIRTY). Everything else is assigned or not actionable.
    expect(result.counts).toEqual({ all: 2, toClean: 2, working: 0, toInspect: 0, ready: 0 });
    expect(result.matched).toHaveLength(2);
    expect(result.visible).toHaveLength(0);
    expect(result.emptyReason).toBe("segment");
  });

  it("applies search, then filters, then the segment", () => {
    const result = query({ search: "10", filters: filters({ statuses: ["toClean", "working"] }), segment: "toClean" });
    expect(numbers(result.visible)).toEqual(["101", "102", "103"]);
    expect(result.counts.all).toBe(4); // 101,102,103,104 — before the segment's own restriction
  });

  it("uses a list for search results, flat sorts and small filtered sets; a grid otherwise", () => {
    expect(query({ search: "1" }).layout).toBe("list");
    expect(query({ sort: "departure" }).layout).toBe("list");
    expect(query({ filters: filters({ statuses: ["ready"] }) }).layout).toBe("list");
    const big = viewsOf(Array.from({ length: LIST_THRESHOLD + 5 }, (_, i) => rawRoom(`${100 + i}`, "DIRTY")));
    const bigAvailability = buildFilterAvailability(big.map((v) => v.room));
    const bigQuery = runBoardQuery({ views: big, search: "", filters: filters({ statuses: ["toClean"] }), segment: "all", sort: "priority", availability: bigAvailability, ctx });
    expect(bigQuery.layout).toBe("grid");
  });

  it("puts an exact room-number match first whatever the sort", () => {
    const result = query({ search: "10", sort: "floor" });
    expect(numbers(result.visible)[0]).toBe("101");
    const exact = runBoardQuery({ views: viewsOf([rawRoom("10", "DIRTY"), rawRoom("101", "DIRTY"), rawRoom("110", "DIRTY")]), search: "10", filters: EMPTY_FILTERS, segment: "all", sort: "roomNumber", availability, ctx });
    expect(numbers(exact.visible)).toEqual(["10", "101", "110"]);
  });

  it("names why the board is empty: search, filters or segment — and never when the hotel itself is empty", () => {
    expect(query({ search: "999" }).emptyReason).toBe("search");
    expect(query({ filters: filters({ flags: ["dnd"] }) }).emptyReason).toBe("filters");
    expect(query({ search: "106", filters: filters({ statuses: ["toClean"] }) }).emptyReason).toBe("filters");
    expect(query({ filters: filters({ flags: ["unassigned"] }), segment: "ready" }).emptyReason).toBe("segment");
    expect(runBoardQuery({ views: [], search: "9", filters: EMPTY_FILTERS, segment: "all", sort: "priority", availability, ctx }).emptyReason).toBeNull();
  });

  it("does not hide a room from the full inventory: filtering is a view, the dataset is untouched", () => {
    const before = list.length;
    query({ filters: filters({ statuses: ["ready"] }), search: "106" });
    expect(list).toHaveLength(before);
  });

  it("reflects a realtime change on the next run (assignment removes a room from 'unassigned')", () => {
    const run = (views: BoardRoomView[]) =>
      runBoardQuery({ views, search: "", filters: filters({ flags: ["unassigned"] }), segment: "all", sort: "roomNumber", availability, ctx });
    expect(numbers(run(list).visible)).toEqual(["101", "201"]);
    const updated = viewsOf(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, assigned_to: "hk-3", assignment_id: "a-101" } : row)));
    expect(numbers(run(updated).visible)).toEqual(["201"]);
    const removed = viewsOf(hotelBoard().filter((row) => row.room_id !== "room-201"));
    expect(numbers(run(removed).visible)).toEqual(["101"]);
  });

  it("is quick enough for a large hotel", () => {
    const raw = Array.from({ length: 1200 }, (_, i) =>
      rawRoom(`${Math.floor(i / 40) + 1}${String((i % 40) + 1).padStart(2, "0")}`, ["DIRTY", "CLEAN", "INSPECTED", "IN_PROGRESS", "OOO"][i % 5], i % 7 === 0 ? { vip_flag: true } : {}),
    );
    const big = viewsOf(raw);
    const bigAvailability = buildFilterAvailability(big.map((v) => v.room));
    const started = Date.now();
    const result = runBoardQuery({ views: big, search: "1", filters: filters({ statuses: ["toClean", "toInspect"], flags: ["vip"] }), segment: "all", sort: "priority", availability: bigAvailability, ctx });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.visible.length).toBeGreaterThan(0);
    expect(new Set(result.visible.map((v) => v.room.roomId)).size).toBe(result.visible.length);
  });
});

describe("grid items and floor navigation", () => {
  const raw = [
    ...["101", "102", "103"].map((n) => rawRoom(n, "DIRTY")),
    ...["201", "202"].map((n) => rawRoom(n, "CLEAN")),
    rawRoom("301", "DIRTY"),
    rawRoom("401", "INSPECTED"),
    rawRoom("501", "DIRTY"),
  ];
  const list = viewsOf(raw);
  const availability = buildFilterAvailability(list.map((v) => v.room));
  const base = { views: list, search: "", filters: EMPTY_FILTERS, segment: "all" as const, sort: "roomNumber" as const, availability, ctx };

  it("builds floor headings with full-floor totals so a filtered floor reads 'x of y'", () => {
    const result = runBoardQuery({ ...base, segment: "toClean" });
    const items = buildQueryItems(result, floorTotals(list), 2);
    const floors = items.filter((item) => item.type === "floor");
    expect(floors.map((f) => f.type === "floor" && [f.floor, f.shown, f.total])).toEqual([
      [1, 3, 3],
      [3, 1, 1],
      [5, 1, 1],
    ]);
    const second = buildQueryItems(runBoardQuery({ ...base, segment: "toClean", search: "" }), floorTotals(viewsOf([...raw, rawRoom("104", "INSPECTED")])), 2);
    expect(second.find((item) => item.type === "floor" && item.floor === 1)).toMatchObject({ shown: 3, total: 4 });
  });

  it("packs rooms into rows of the requested width and keeps the chosen order inside a floor", () => {
    const result = runBoardQuery({ ...base, sort: "priority" });
    const rows = buildQueryItems(result, floorTotals(list), 2).filter((item) => item.type === "row");
    expect(rows[0].type === "row" && numbers(rows[0].views)).toEqual(["101", "102"]);
  });

  it("offers one jump target per floor and only worth showing with several floors", () => {
    const items = buildQueryItems(runBoardQuery(base), floorTotals(list), 2);
    const jumps = buildFloorJumps(items);
    expect(jumps.map((j) => j.floor)).toEqual([1, 2, 3, 4, 5]);
    expect(jumps.length).toBeGreaterThanOrEqual(MIN_FLOORS_FOR_JUMP);
    for (const jump of jumps) expect(items[jump.index]).toMatchObject({ type: "floor", key: jump.key });
    expect(jumps.every((j) => !j.buildingShown)).toBe(true);
  });

  it("names the building in a multi-building jump", () => {
    const multi = viewsOf([rawRoom("101", "DIRTY"), rawRoom("102", "DIRTY", { rooms: { room_number: "102", floor: 1, building: "B" } })]);
    const items = buildQueryItems(
      runBoardQuery({ ...base, views: multi, availability: buildFilterAvailability(multi.map((v) => v.room)) }),
      floorTotals(multi),
      2,
    );
    expect(items.filter((item) => item.type === "building")).toHaveLength(2);
    expect(buildFloorJumps(items).every((j) => j.buildingShown)).toBe(true);
  });
});

describe("roomMatchesFilters", () => {
  it("is true for any room when no filter is applied", () => {
    const list = viewsOf();
    const availability = buildFilterAvailability(list.map((v) => v.room));
    expect(list.every((v) => roomMatchesFilters(v.room, EMPTY_FILTERS, availability, ctx))).toBe(true);
  });
});
