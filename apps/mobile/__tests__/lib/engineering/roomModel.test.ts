import {
  EMPTY_ROOM_FILTERS,
  activeRoomFilterCount,
  applyQuickFilter,
  canManageAvailability,
  groupRoomsByFloor,
  hasAnyRoomFilter,
  mergeRoomPages,
  quickFilterOf,
  roomBoardKey,
  roomBoardParams,
  type RoomBoardRow,
} from "@/lib/engineering/roomModel";

const room = (n: string, floor: number | null, over: Partial<RoomBoardRow> = {}): RoomBoardRow => ({
  id: `r-${n}`,
  room_number: n,
  floor,
  building: null,
  room_type: null,
  occupancy: "unknown",
  housekeeping_status: null,
  availability: null,
  unavailability: null,
  active_repair_count: 0,
  others_active_count: 0,
  top_priority: null,
  top_repair: null,
  last_activity_at: null,
  status_updated_at: null,
  ...over,
});

describe("quick filters", () => {
  it("are shortcuts onto the same fields the sheet edits, so the chip and the sheet can't disagree", () => {
    expect(quickFilterOf(EMPTY_ROOM_FILTERS)).toBe("all");
    expect(quickFilterOf(applyQuickFilter(EMPTY_ROOM_FILTERS, "active"))).toBe("active");
    expect(quickFilterOf(applyQuickFilter(EMPTY_ROOM_FILTERS, "unavailable"))).toBe("unavailable");
    expect(quickFilterOf(applyQuickFilter(EMPTY_ROOM_FILTERS, "occupied"))).toBe("occupied");
    expect(applyQuickFilter(EMPTY_ROOM_FILTERS, "occupied")).toMatchObject({ occupancy: "occupied", maintenance: null });
  });

  it("switching chips replaces the previous chip's field instead of stacking", () => {
    const active = applyQuickFilter(EMPTY_ROOM_FILTERS, "active");
    expect(applyQuickFilter(active, "occupied")).toMatchObject({ maintenance: null, occupancy: "occupied" });
    expect(applyQuickFilter(applyQuickFilter(active, "occupied"), "all")).toEqual(EMPTY_ROOM_FILTERS);
  });

  it("highlights no chip once a combined or sheet-only filter is on", () => {
    expect(quickFilterOf({ ...EMPTY_ROOM_FILTERS, maintenance: "active", occupancy: "occupied" })).toBeNull();
    expect(quickFilterOf({ ...EMPTY_ROOM_FILTERS, maintenance: "oos" })).toBeNull();
    expect(quickFilterOf({ ...EMPTY_ROOM_FILTERS, maintenance: "active", floor: 3 })).toBeNull();
  });

  it("keeps the sort when a chip is tapped", () => {
    expect(applyQuickFilter({ ...EMPTY_ROOM_FILTERS, sort: "urgency" }, "active").sort).toBe("urgency");
  });
});

describe("request building", () => {
  it("sends only what is set and trims the search", () => {
    expect(roomBoardParams(EMPTY_ROOM_FILTERS, "  312 ")).toEqual({ q: "312", maintenance: undefined, occupancy: undefined, floor: undefined, building: undefined, priority: undefined, sort_by: undefined });
    expect(roomBoardParams({ ...EMPTY_ROOM_FILTERS, maintenance: "oos", occupancy: "unknown", floor: 4, priority: "urgent", sort: "urgency" }, "")).toMatchObject({
      maintenance: "oos",
      occupancy: "unknown",
      floor: 4,
      priority: "urgent",
      sort_by: "urgency",
    });
  });

  it("gives each combination its own cache key", () => {
    const keys = new Set([
      roomBoardKey(EMPTY_ROOM_FILTERS, ""),
      roomBoardKey(EMPTY_ROOM_FILTERS, "312"),
      roomBoardKey({ ...EMPTY_ROOM_FILTERS, maintenance: "ooo" }, ""),
      roomBoardKey({ ...EMPTY_ROOM_FILTERS, maintenance: "oos" }, ""),
    ]);
    expect(keys.size).toBe(4);
  });

  it("counts sheet filters but not the sort, and a search alone still counts as filtered", () => {
    expect(activeRoomFilterCount({ ...EMPTY_ROOM_FILTERS, sort: "floor" })).toBe(0);
    expect(activeRoomFilterCount({ ...EMPTY_ROOM_FILTERS, floor: 3, priority: "low", building: "A" })).toBe(3);
    expect(hasAnyRoomFilter(EMPTY_ROOM_FILTERS, "")).toBe(false);
    expect(hasAnyRoomFilter(EMPTY_ROOM_FILTERS, " 12 ")).toBe(true);
  });
});

describe("paging and grouping", () => {
  it("never shows a room twice when a page overlaps the last", () => {
    const merged = mergeRoomPages([room("101", 1), room("102", 1)], [room("102", 1), room("103", 1)]);
    expect(merged.map((r) => r.room_number)).toEqual(["101", "102", "103"]);
  });

  it("groups consecutive rooms by floor in server order, including a floor that is not set", () => {
    const groups = groupRoomsByFloor([room("101", 1), room("102", 1), room("201", 2), room("X", null)], "room");
    expect(groups.map((g) => [g.floor, g.rooms.length])).toEqual([[1, 2], [2, 1], [null, 1]]);
  });

  it("keeps one flat list when sorted by urgency or recent activity, so the order is not hidden behind floors", () => {
    expect(groupRoomsByFloor([room("301", 3), room("101", 1)], "urgency")).toHaveLength(1);
    expect(groupRoomsByFloor([], "updated")).toEqual([]);
  });
});

describe("who may change a room's availability", () => {
  it("matches the API: engineer, GM and housekeeping supervisor; the chief engineer reads only", () => {
    expect(canManageAvailability("engineer")).toBe(true);
    expect(canManageAvailability("gm")).toBe(true);
    expect(canManageAvailability("housekeeping_supervisor")).toBe(true);
    expect(canManageAvailability("chief_engineer")).toBe(false);
    expect(canManageAvailability("front_desk")).toBe(false);
    expect(canManageAvailability("housekeeper")).toBe(false);
    expect(canManageAvailability(null)).toBe(false);
  });
});
