/* ─── Supervisor floor domain ───────────────────────────────────────────────
   Normalizes GET /housekeeping/board rows (room_status spread + nested
   `rooms` join) into a flat view model, and derives the counts, floor
   groups, and per-housekeeper workloads the supervisor surfaces share. */

export interface BoardRoomRaw {
  room_id: string;
  status: string;
  vip_flag?: boolean | null;
  dnd_flag?: boolean | null;
  fo_status?: "OCC" | "VAC" | null;
  checkin_time?: string | null;
  checkout_time?: string | null;
  actual_checkout_at?: string | null;
  assigned_to?: string | null;
  assignment_id?: string | null;
  clean_type?: string | null;
  clean_type_label?: string | null;
  latest_note?: string | null;
  open_work_order_number?: string | null;
  open_work_order_title?: string | null;
  prediction?: { risk_level?: "LOW" | "MEDIUM" | "HIGH" | null } | null;
  rooms?: {
    id?: string;
    room_number?: string | null;
    floor?: number | null;
    room_types?: { name?: string | null; base_clean_minutes?: number | null } | null;
  } | null;
}

export interface FloorRoom {
  roomId: string;
  roomNumber: string;
  floor: number;
  roomType: string | null;
  baseCleanMinutes: number;
  status: string;
  vip: boolean;
  dnd: boolean;
  assignedTo: string | null;
  assignmentId: string | null;
  cleanType: string | null;
  cleanTypeLabel: string | null;
  latestNote: string | null;
  openWorkOrder: string | null;
  highRisk: boolean;
  checkinTime: string | null;
  checkoutTime: string | null;
}

const OOO_STATUSES = new Set(["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);
const ACTIONABLE_STATUSES = new Set(["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS"]);

export function isOutOfOrder(status: string): boolean {
  return OOO_STATUSES.has(status);
}

/** Rooms a housekeeper still needs to work — the set that should be assigned. */
export function isActionable(status: string): boolean {
  return ACTIONABLE_STATUSES.has(status);
}

export function normalizeBoardRooms(rows: BoardRoomRaw[]): FloorRoom[] {
  return rows
    .filter((row) => row.room_id && row.rooms?.room_number)
    .map((row) => {
      const room = row.rooms ?? {};
      const wo = row.open_work_order_title || row.open_work_order_number;
      return {
        roomId: row.room_id,
        roomNumber: room.room_number ?? "",
        floor: room.floor ?? 0,
        roomType: room.room_types?.name ?? null,
        baseCleanMinutes: room.room_types?.base_clean_minutes ?? 30,
        status: row.status,
        vip: Boolean(row.vip_flag),
        dnd: Boolean(row.dnd_flag),
        assignedTo: row.assigned_to ?? null,
        assignmentId: row.assignment_id ?? null,
        cleanType: row.clean_type ?? null,
        cleanTypeLabel: row.clean_type_label ?? null,
        latestNote: row.latest_note ?? null,
        openWorkOrder: wo ?? null,
        highRisk: row.prediction?.risk_level === "HIGH",
        checkinTime: row.checkin_time ?? null,
        checkoutTime: row.checkout_time ?? null,
      };
    });
}

export function sortRoomsByNumber<T extends { roomNumber: string }>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/* ─── Floor snapshot — the shape of the day in counts ─────────────────────── */

export interface FloorSnapshot {
  total: number;
  ready: number;
  submitted: number;
  inProgress: number;
  toClean: number;
  ooo: number;
  unassigned: number;
  dnd: number;
  vip: number;
}

export function buildFloorSnapshot(rooms: FloorRoom[]): FloorSnapshot {
  const snapshot: FloorSnapshot = {
    total: rooms.length,
    ready: 0,
    submitted: 0,
    inProgress: 0,
    toClean: 0,
    ooo: 0,
    unassigned: 0,
    dnd: 0,
    vip: 0,
  };
  for (const room of rooms) {
    if (room.status === "INSPECTED") snapshot.ready += 1;
    else if (room.status === "CLEAN") snapshot.submitted += 1;
    else if (room.status === "IN_PROGRESS") snapshot.inProgress += 1;
    else if (isOutOfOrder(room.status)) snapshot.ooo += 1;
    else if (isActionable(room.status)) snapshot.toClean += 1;
    if (isActionable(room.status) && !room.assignedTo) snapshot.unassigned += 1;
    if (room.dnd && !isOutOfOrder(room.status)) snapshot.dnd += 1;
    if (room.vip && room.status !== "INSPECTED" && !isOutOfOrder(room.status)) snapshot.vip += 1;
  }
  return snapshot;
}

/* ─── Board segments ──────────────────────────────────────────────────────── */

export type BoardSegment = "all" | "toClean" | "working" | "ready";

export function filterBySegment(rooms: FloorRoom[], segment: BoardSegment): FloorRoom[] {
  switch (segment) {
    case "toClean":
      return rooms.filter((room) => isActionable(room.status) && room.status !== "IN_PROGRESS");
    case "working":
      return rooms.filter((room) => room.status === "IN_PROGRESS" || room.status === "CLEAN");
    case "ready":
      return rooms.filter((room) => room.status === "INSPECTED");
    default:
      return rooms;
  }
}

export interface FloorGroup {
  floor: number;
  rooms: FloorRoom[];
}

export function groupByFloor(rooms: FloorRoom[]): FloorGroup[] {
  const byFloor = new Map<number, FloorRoom[]>();
  for (const room of rooms) {
    const group = byFloor.get(room.floor);
    if (group) group.push(room);
    else byFloor.set(room.floor, [room]);
  }
  return [...byFloor.entries()]
    .sort(([a], [b]) => a - b)
    .map(([floor, floorRooms]) => ({ floor, rooms: sortRoomsByNumber(floorRooms) }));
}

/* ─── Team workloads — per-housekeeper view of the same board ─────────────── */

export interface TeamLoad {
  housekeeperId: string;
  name: string;
  rooms: FloorRoom[];
  total: number;
  done: number;
  inProgress: number;
  minutesLeft: number;
}

export function buildTeamLoads(rooms: FloorRoom[], nameById: Map<string, string>): TeamLoad[] {
  const byHousekeeper = new Map<string, TeamLoad>();
  for (const room of rooms) {
    if (!room.assignedTo) continue;
    let load = byHousekeeper.get(room.assignedTo);
    if (!load) {
      load = {
        housekeeperId: room.assignedTo,
        name: nameById.get(room.assignedTo) ?? "—",
        rooms: [],
        total: 0,
        done: 0,
        inProgress: 0,
        minutesLeft: 0,
      };
      byHousekeeper.set(room.assignedTo, load);
    }
    load.rooms.push(room);
    load.total += 1;
    if (room.status === "CLEAN" || room.status === "INSPECTED") load.done += 1;
    else if (room.status === "IN_PROGRESS") load.inProgress += 1;
    if (isActionable(room.status)) load.minutesLeft += room.baseCleanMinutes;
  }
  const loads = [...byHousekeeper.values()];
  for (const load of loads) load.rooms = sortRoomsByNumber(load.rooms);
  return loads.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/* ─── Staff — assignable housekeeping staff from GET /staff ───────────────── */

export interface AssignableStaff {
  userId: string;
  name: string;
  role: string;
}

const ASSIGNABLE_ROLES = new Set(["housekeeper", "housekeeping_supervisor"]);

interface StaffRowRaw {
  user_id?: string | null;
  full_name?: string | null;
  role?: string | null;
  status?: string | null;
}

/** GET /staff returns `{ data: { staff: [...], total } }` — NOT a bare array. */
export function extractAssignableStaff(payload: unknown): AssignableStaff[] {
  const data = (payload as { data?: unknown })?.data;
  const rows: StaffRowRaw[] = Array.isArray(data)
    ? (data as StaffRowRaw[])
    : ((data as { staff?: StaffRowRaw[] })?.staff ?? []);
  return rows
    .filter(
      (row) =>
        row.user_id &&
        ASSIGNABLE_ROLES.has(row.role ?? "") &&
        (row.status == null || row.status === "active"),
    )
    .map((row) => ({
      userId: row.user_id as string,
      name: row.full_name?.trim() || "—",
      role: row.role ?? "housekeeper",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function buildNameById(staff: AssignableStaff[]): Map<string, string> {
  return new Map(staff.map((member) => [member.userId, member.name]));
}
