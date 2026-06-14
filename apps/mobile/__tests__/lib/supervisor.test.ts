import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  extractAssignableStaff,
  filterBySegment,
  groupByFloor,
  isActionable,
  normalizeBoardRooms,
  sortRoomsByNumber,
  type BoardRoomRaw,
} from "@/lib/housekeeping/supervisor";

function rawRoom(overrides: Partial<BoardRoomRaw> & { room_id: string }): BoardRoomRaw {
  return {
    status: "DIRTY",
    rooms: { id: overrides.room_id, room_number: overrides.room_id.replace("r-", ""), floor: 1 },
    ...overrides,
  };
}

describe("normalizeBoardRooms", () => {
  it("flattens the nested rooms join into a flat view model", () => {
    const rows: BoardRoomRaw[] = [
      {
        room_id: "r-101",
        status: "DIRTY",
        vip_flag: true,
        dnd_flag: false,
        assigned_to: "hk-1",
        assignment_id: "as-1",
        clean_type: "DEP",
        clean_type_label: "Departure",
        latest_note: "Guest asked for towels",
        open_work_order_title: "AC rattle",
        prediction: { risk_level: "HIGH" },
        rooms: {
          id: "r-101",
          room_number: "101",
          floor: 1,
          room_types: { name: "King", base_clean_minutes: 25 },
        },
      },
    ];
    const [room] = normalizeBoardRooms(rows);
    expect(room).toMatchObject({
      roomId: "r-101",
      roomNumber: "101",
      floor: 1,
      roomType: "King",
      baseCleanMinutes: 25,
      status: "DIRTY",
      vip: true,
      dnd: false,
      assignedTo: "hk-1",
      assignmentId: "as-1",
      cleanType: "DEP",
        cleanTypeLabel: "Departure",
        latestNote: "Guest asked for towels",
        openWorkOrder: "AC rattle",
        highRisk: true,
        foStatus: null,
      });
  });

  it("preserves front-office occupancy separately from housekeeping status", () => {
    const [room] = normalizeBoardRooms([
      rawRoom({ room_id: "r-109", status: "DIRTY", fo_status: "VAC" }),
    ]);
    expect(room.foStatus).toBe("VAC");
  });

  it("drops rows without a room number and defaults clean minutes", () => {
    const rows: BoardRoomRaw[] = [
      { room_id: "r-1", status: "DIRTY", rooms: null },
      { room_id: "r-2", status: "DIRTY", rooms: { room_number: "202", floor: 2 } },
    ];
    const rooms = normalizeBoardRooms(rows);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomNumber).toBe("202");
    expect(rooms[0].baseCleanMinutes).toBe(30);
  });
});

describe("buildFloorSnapshot", () => {
  it("counts statuses, unassigned actionable rooms, and flags", () => {
    const rooms = normalizeBoardRooms([
      rawRoom({ room_id: "r-101", status: "DIRTY" }),
      rawRoom({ room_id: "r-102", status: "OCCUPIED", dnd_flag: true }),
      rawRoom({ room_id: "r-103", status: "PICKUP", assigned_to: "hk-1" }),
      rawRoom({ room_id: "r-104", status: "IN_PROGRESS", assigned_to: "hk-1" }),
      rawRoom({ room_id: "r-105", status: "CLEAN", assigned_to: "hk-2" }),
      rawRoom({ room_id: "r-106", status: "INSPECTED", vip_flag: true }),
      rawRoom({ room_id: "r-107", status: "OUT_OF_ORDER", dnd_flag: true }),
      rawRoom({ room_id: "r-108", status: "DIRTY", vip_flag: true }),
    ]);
    const snapshot = buildFloorSnapshot(rooms);
    expect(snapshot).toEqual({
      total: 8,
      ready: 1,
      submitted: 1,
      inProgress: 1,
      toClean: 4,
      ooo: 1,
      unassigned: 3, // 101, 102, 108 — actionable without an assignee
      dnd: 1, // OOO room with DND does not count
      vip: 1, // INSPECTED VIP no longer needs attention
    });
  });
});

describe("filterBySegment", () => {
  const rooms = normalizeBoardRooms([
    rawRoom({ room_id: "r-1", status: "DIRTY" }),
    rawRoom({ room_id: "r-2", status: "PICKUP" }),
    rawRoom({ room_id: "r-3", status: "IN_PROGRESS" }),
    rawRoom({ room_id: "r-4", status: "CLEAN" }),
    rawRoom({ room_id: "r-5", status: "INSPECTED" }),
    rawRoom({ room_id: "r-6", status: "OOO" }),
  ]);

  it("splits segments by working state", () => {
    expect(filterBySegment(rooms, "all")).toHaveLength(6);
    expect(filterBySegment(rooms, "toClean").map((r) => r.status)).toEqual(["DIRTY", "PICKUP"]);
    expect(filterBySegment(rooms, "working").map((r) => r.status)).toEqual(["IN_PROGRESS", "CLEAN"]);
    expect(filterBySegment(rooms, "ready").map((r) => r.status)).toEqual(["INSPECTED"]);
  });
});

describe("groupByFloor / sortRoomsByNumber", () => {
  it("groups ascending by floor with numeric room ordering", () => {
    const rooms = normalizeBoardRooms([
      { room_id: "a", status: "DIRTY", rooms: { room_number: "210", floor: 2 } },
      { room_id: "b", status: "DIRTY", rooms: { room_number: "102", floor: 1 } },
      { room_id: "c", status: "DIRTY", rooms: { room_number: "21", floor: 2 } },
      { room_id: "d", status: "DIRTY", rooms: { room_number: "110", floor: 1 } },
    ]);
    const groups = groupByFloor(rooms);
    expect(groups.map((g) => g.floor)).toEqual([1, 2]);
    expect(groups[0].rooms.map((r) => r.roomNumber)).toEqual(["102", "110"]);
    expect(groups[1].rooms.map((r) => r.roomNumber)).toEqual(["21", "210"]);
    expect(sortRoomsByNumber(rooms).map((r) => r.roomNumber)).toEqual(["21", "102", "110", "210"]);
  });
});

describe("buildTeamLoads", () => {
  it("groups assigned rooms per housekeeper with progress and minutes left", () => {
    const rooms = normalizeBoardRooms([
      rawRoom({ room_id: "r-1", status: "DIRTY", assigned_to: "hk-b", rooms: { room_number: "105", floor: 1, room_types: { base_clean_minutes: 20 } } }),
      rawRoom({ room_id: "r-2", status: "INSPECTED", assigned_to: "hk-b", rooms: { room_number: "101", floor: 1 } }),
      rawRoom({ room_id: "r-3", status: "IN_PROGRESS", assigned_to: "hk-a", rooms: { room_number: "201", floor: 2, room_types: { base_clean_minutes: 40 } } }),
      rawRoom({ room_id: "r-4", status: "DIRTY", assigned_to: null }),
    ]);
    const names = new Map([
      ["hk-a", "Ana"],
      ["hk-b", "Bea"],
    ]);
    const loads = buildTeamLoads(rooms, names);
    expect(loads.map((l) => l.name)).toEqual(["Ana", "Bea"]);
    const [ana, bea] = loads;
    expect(ana).toMatchObject({ total: 1, done: 0, inProgress: 1, minutesLeft: 40 });
    expect(bea).toMatchObject({ total: 2, done: 1, inProgress: 0, minutesLeft: 20 });
    expect(bea.rooms.map((r) => r.roomNumber)).toEqual(["101", "105"]);
  });
});

describe("extractAssignableStaff", () => {
  it("reads the nested staff payload and keeps only active housekeeping roles", () => {
    const payload = {
      data: {
        staff: [
          { id: "role-1", user_id: "u-1", full_name: "Claudia", role: "housekeeper", status: "active" },
          { id: "role-2", user_id: "u-2", full_name: "Sam", role: "housekeeping_supervisor", status: "active" },
          { id: "role-3", user_id: "u-3", full_name: "Ed", role: "engineer", status: "active" },
          { id: "role-4", user_id: "u-4", full_name: "Ines", role: "housekeeper", status: "inactive" },
        ],
        total: 4,
      },
    };
    const staff = extractAssignableStaff(payload);
    expect(staff.map((s) => s.userId)).toEqual(["u-1", "u-2"]);
    expect(staff[0].name).toBe("Claudia");
  });

  it("tolerates a bare array payload", () => {
    const staff = extractAssignableStaff({
      data: [{ user_id: "u-9", full_name: "Mia", role: "housekeeper", status: "active" }],
    });
    expect(staff).toHaveLength(1);
    expect(buildNameById(staff).get("u-9")).toBe("Mia");
  });
});

describe("isActionable", () => {
  it("marks the working statuses only", () => {
    expect(isActionable("DIRTY")).toBe(true);
    expect(isActionable("OCCUPIED")).toBe(true);
    expect(isActionable("PICKUP")).toBe(true);
    expect(isActionable("IN_PROGRESS")).toBe(true);
    expect(isActionable("CLEAN")).toBe(false);
    expect(isActionable("INSPECTED")).toBe(false);
    expect(isActionable("OUT_OF_ORDER")).toBe(false);
  });
});
