import type { BlockedTaskItem } from "@/lib/api/tasks";
import type { InspectionRecordRaw, ShiftRosterRowRaw } from "@/lib/api/housekeepingSupervisor";
import { hotelDateKey, resolveTimeZone, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import {
  buildFloorSnapshot,
  normalizeBoardRooms,
  type AssignableStaff,
  type BoardRoomRaw,
  type FloorRoom,
} from "@/lib/housekeeping/supervisor";
import { buildTeamPulse, normalizeRoster, type RosterEntry, type TeamPulse } from "@/lib/housekeeping/supervisorTeam";
import {
  type SourceState,
  type Derived,
  ageSource,
  derive,
  knownValue,
  loadingSource,
  offlineSource,
  settleSource,
} from "@/lib/housekeeping/supervisorSources";
import { buildSupervisorAttention, type SupervisorAttention } from "@/lib/housekeeping/supervisorAttention";

/* ─── Supervisor Today — data composition ───────────────────────────────────
   One typed model behind the Today dashboard. Pure functions over per-source
   states (see supervisorSources.ts); no React, no I/O except `loadTodaySources`,
   whose fetchers are injected.

   DEFINITIONS (the one place they live — screens must not re-derive them)

   Room status, as returned by GET /housekeeping/board:
     INSPECTED                 ready — inspected and guest-ready
     CLEAN                     submitted by housekeeping, AWAITING INSPECTION (not guest-ready)
     IN_PROGRESS               being cleaned now
     DIRTY | PICKUP | OCCUPIED to clean — still needs housekeeping
     OOO                       out of order / out of service
     anything else             `unclassified` (counted, never silently dropped)

   Two denominators, never mixed:
     Hotel inventory   inventoryTotal = every room on the board; inService = inventoryTotal − outOfOrder.
                       Readiness progress = ready ÷ inService (null when inService is 0; never > 1).
     Today's workload  workRemaining = toClean + inProgress + awaitingInspection — rooms that still
                       need housekeeping or an inspection. Rooms already INSPECTED are not workload.
   Unassigned actionable = rooms still to clean or being cleaned (DIRTY/PICKUP/OCCUPIED/IN_PROGRESS)
   with no housekeeper. Inspection pass/fail/conditional come ONLY from the inspection history
   endpoint, never from room statuses. */

/* ─── Source data ─────────────────────────────────────────────────────────── */

export interface BoardSnapshot {
  rooms: FloorRoom[];
  /** Raw rows dropped because they had no room id or room number. */
  invalidRows: number;
  /** Raw rows dropped because the same room id appeared twice (first one wins). */
  duplicateRows: number;
}

export interface TodaySources {
  board: SourceState<BoardSnapshot>;
  staff: SourceState<AssignableStaff[]>;
  roster: SourceState<RosterEntry[]>;
  inspections: SourceState<InspectionRecordRaw[]>;
  blockedTasks: SourceState<BlockedTaskItem[]>;
}

export function initialTodaySources(): TodaySources {
  return {
    board: loadingSource(),
    staff: loadingSource(),
    roster: loadingSource(),
    inspections: loadingSource(),
    blockedTasks: loadingSource(),
  };
}

/* ─── Normalisers ─────────────────────────────────────────────────────────── */

/** Board rows → rooms, dropping rows that cannot be tied to a room and de-duplicating by room id. */
export function normalizeBoard(raw: BoardRoomRaw[]): BoardSnapshot {
  const normalized = normalizeBoardRooms(raw);
  const seen = new Set<string>();
  const rooms: FloorRoom[] = [];
  for (const room of normalized) {
    if (seen.has(room.roomId)) continue;
    seen.add(room.roomId);
    rooms.push(room);
  }
  return {
    rooms,
    invalidRows: raw.length - normalized.length,
    duplicateRows: normalized.length - rooms.length,
  };
}

/* ─── Hotel-local date ────────────────────────────────────────────────────── */

export function hotelTodayKey(now: number, timeZone: string | null | undefined): string {
  return hotelDateKey(new Date(now), timeZone) ?? new Date(now).toISOString().slice(0, 10);
}

/** JS getTimezoneOffset() minutes (positive behind UTC, e.g. 300 for CDT) for the hotel's zone on its `date`. */
export function hotelTzOffsetMinutes(date: string, timeZone: string | null | undefined): number {
  const midnight = zonedTimeToInstant(date, 0, 0, resolveTimeZone(timeZone));
  const [y, m, d] = date.split("-").map(Number);
  if (!midnight || !y || !m || !d) return 0;
  return Math.round((midnight.getTime() - Date.UTC(y, m - 1, d)) / 60_000);
}

/* ─── Room readiness ──────────────────────────────────────────────────────── */

export interface ReadinessSummary {
  /** Hotel inventory */
  inventoryTotal: number;
  outOfOrder: number;
  inService: number;
  /** Where every in-service room stands. These five add up to `inService`. */
  ready: number;
  awaitingInspection: number;
  inProgress: number;
  toClean: number;
  unclassified: number;
  /** Today's workload */
  workRemaining: number;
  unassignedActionable: number;
  behindSchedule: number;
  /** ready ÷ inService in [0, 1]; null when there are no in-service rooms (no progress to show). */
  progress: number | null;
}

export function buildReadinessSummary(rooms: FloorRoom[]): ReadinessSummary {
  const snap = buildFloorSnapshot(rooms);
  const inService = snap.total - snap.ooo;
  const unclassified = Math.max(0, inService - snap.ready - snap.submitted - snap.inProgress - snap.toClean);
  const progress = inService > 0 ? Math.min(1, Math.max(0, snap.ready / inService)) : null;
  return {
    inventoryTotal: snap.total,
    outOfOrder: snap.ooo,
    inService,
    ready: snap.ready,
    awaitingInspection: snap.submitted,
    inProgress: snap.inProgress,
    toClean: snap.toClean,
    unclassified,
    workRemaining: snap.toClean + snap.inProgress + snap.submitted,
    unassignedActionable: snap.unassigned,
    behindSchedule: snap.behindSchedule,
    progress,
  };
}

/* ─── Inspection history ──────────────────────────────────────────────────── */

export interface InspectionMetrics {
  total: number;
  passed: number;
  failed: number;
  conditional: number;
  /** A recorded result this app does not recognise — counted, never guessed into pass/fail. */
  other: number;
}

export function buildInspectionMetrics(records: InspectionRecordRaw[]): InspectionMetrics {
  const metrics: InspectionMetrics = { total: 0, passed: 0, failed: 0, conditional: 0, other: 0 };
  const seen = new Set<string>();
  for (const record of records) {
    if (record.id) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
    }
    metrics.total += 1;
    const result = record.overall_result?.toLowerCase();
    if (result === "passed") metrics.passed += 1;
    else if (result === "failed") metrics.failed += 1;
    else if (result === "conditional") metrics.conditional += 1;
    else metrics.other += 1;
  }
  return metrics;
}

/* ─── Composition ─────────────────────────────────────────────────────────── */

export interface SupervisorToday {
  generatedAt: number;
  hotelDate: string;
  timeZone: string;
  readiness: Derived<ReadinessSummary>;
  inspections: Derived<InspectionMetrics>;
  team: Derived<TeamPulse>;
  attention: SupervisorAttention;
  /** Board rows that could not be used; surfaced so a short board is explainable. */
  boardWarnings: { invalidRows: number; duplicateRows: number };
  sources: TodaySources;
}

const EMPTY_BOARD: BoardSnapshot = { rooms: [], invalidRows: 0, duplicateRows: 0 };

export function composeSupervisorToday(
  sources: TodaySources,
  options: { now: number; timeZone?: string | null },
): SupervisorToday {
  const { now } = options;
  const timeZone = resolveTimeZone(options.timeZone);
  // Age first: an answer older than the freshness window is shown as stale, not fresh.
  const aged: TodaySources = {
    board: ageSource(sources.board, now),
    staff: ageSource(sources.staff, now),
    roster: ageSource(sources.roster, now),
    inspections: ageSource(sources.inspections, now),
    blockedTasks: ageSource(sources.blockedTasks, now),
  };
  const board = knownValue(aged.board, EMPTY_BOARD);
  const staff = knownValue(aged.staff, []);
  return {
    generatedAt: now,
    hotelDate: hotelTodayKey(now, timeZone),
    timeZone,
    readiness: derive(aged.board, EMPTY_BOARD, (snapshot) => buildReadinessSummary(snapshot.rooms)),
    inspections: derive(aged.inspections, [], buildInspectionMetrics),
    team: derive(aged.board, EMPTY_BOARD, (snapshot) => buildTeamPulse(snapshot.rooms, staff, aged.roster)),
    attention: buildSupervisorAttention(aged, { now, timeZone }),
    boardWarnings: { invalidRows: board?.invalidRows ?? 0, duplicateRows: board?.duplicateRows ?? 0 },
    sources: aged,
  };
}

/* ─── Loading ─────────────────────────────────────────────────────────────── */

export interface TodayFetchers {
  board(date: string): Promise<BoardRoomRaw[]>;
  staff(): Promise<AssignableStaff[]>;
  roster(date: string): Promise<ShiftRosterRowRaw[]>;
  inspections(date: string, tzOffset: number): Promise<InspectionRecordRaw[]>;
  blockedTasks(): Promise<BlockedTaskItem[]>;
}

/**
 * Refresh every source independently. One rejected request only affects its own source; whatever was
 * verified before stays on screen, relabelled stale. Offline refreshes nothing and demotes everything to stale.
 */
export async function loadTodaySources(
  previous: TodaySources,
  fetchers: TodayFetchers,
  options: { now: number; timeZone?: string | null; online: boolean },
): Promise<TodaySources> {
  const { now, online } = options;
  if (!online) {
    return {
      board: offlineSource(previous.board),
      staff: offlineSource(previous.staff),
      roster: offlineSource(previous.roster),
      inspections: offlineSource(previous.inspections),
      blockedTasks: offlineSource(previous.blockedTasks),
    };
  }
  const date = hotelTodayKey(now, options.timeZone);
  const tzOffset = hotelTzOffsetMinutes(date, options.timeZone);
  const [board, staff, roster, inspections, blockedTasks] = await Promise.allSettled([
    fetchers.board(date).then((raw) => {
      const snapshot = normalizeBoard(raw);
      // Rows came back but none is usable: that is a broken answer, not an empty hotel.
      if (raw.length > 0 && snapshot.rooms.length === 0) throw new Error("Board returned no usable rooms");
      return snapshot;
    }),
    fetchers.staff(),
    fetchers.roster(date).then((rows) => normalizeRoster(rows, now)),
    fetchers.inspections(date, tzOffset),
    fetchers.blockedTasks(),
  ]);
  return {
    board: settleSource(board, previous.board, now, (value) => value.rooms.length === 0),
    staff: settleSource(staff, previous.staff, now),
    roster: settleSource(roster, previous.roster, now),
    inspections: settleSource(inspections, previous.inspections, now),
    blockedTasks: settleSource(blockedTasks, previous.blockedTasks, now),
  };
}
