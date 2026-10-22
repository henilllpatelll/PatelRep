import { composeAssignments, type AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { ScheduledShift } from "@/lib/housekeeping/assignmentSchedule";
import type { WorkloadSettings } from "@/lib/housekeeping/assignmentWorkload";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import { composeRoomBoard, type RoomBoardModel } from "@/lib/housekeeping/roomBoardState";
import type { AssignableStaff, BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { normalizeRoster, type RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import { HOTEL_DATE, NOW, STAFF, ZONE, hotelBoard } from "./roomBoardFixtures";

export const SETTINGS: WorkloadSettings = {
  targetCredits: 16,
  creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 },
  capacityOverrides: {},
};

/** Roster rows as GET /shifts/roster returns them. */
export const rosterRow = (userId: string, status: "active" | "on_break" | "ended", startedAgoMs = 60 * 60_000) => ({
  user_id: userId,
  status,
  started_at: new Date(NOW - startedAgoMs).toISOString(),
  on_break_since: status === "on_break" ? new Date(NOW - 5 * 60_000).toISOString() : null,
});

export const rosterOf = (rows: Parameters<typeof normalizeRoster>[0], at = NOW): SourceState<RosterEntry[]> =>
  availableSource(normalizeRoster(rows, at), at);

export interface FixtureOptions {
  raw?: BoardRoomRaw[];
  staff?: SourceState<AssignableStaff[]>;
  roster?: SourceState<RosterEntry[]>;
  settings?: SourceState<WorkloadSettings>;
  schedule?: SourceState<ScheduledShift[]>;
  /** The hotel date the board was requested for. */
  boardDate?: string;
  now?: number;
  /** When the board was fetched; defaults to `now`. */
  fetchedAt?: number;
  guestWaiting?: ReadonlySet<string> | null;
}

export function boardModelOf(options: FixtureOptions = {}): RoomBoardModel {
  const now = options.now ?? NOW;
  const at = options.fetchedAt ?? now;
  const board = availableSource(normalizeBoardRecords(options.raw ?? hotelBoard(), options.boardDate ?? HOTEL_DATE), at, (value) => value.rooms.length === 0);
  return composeRoomBoard(
    {
      board,
      staff: options.staff ?? availableSource(STAFF, at),
      roster: options.roster ?? rosterOf([rosterRow("hk-1", "active")], at),
      lateCheckouts: availableSource([], at),
    },
    { now, timeZone: ZONE },
  );
}

export function assignmentsOf(options: FixtureOptions = {}): AssignmentsModel {
  const at = options.fetchedAt ?? options.now ?? NOW;
  return composeAssignments(
    boardModelOf(options),
    {
      settings: options.settings ?? availableSource(SETTINGS, at, () => false),
      schedule: options.schedule ?? availableSource<ScheduledShift[]>([], at),
    },
    { guestWaiting: options.guestWaiting ?? null },
  );
}

export const shift = (userId: string, startTime: string | null = "07:00:00", endTime: string | null = "15:00:00"): ScheduledShift => ({
  userId,
  name: "Day",
  startTime,
  endTime,
});
