import { estimateRoom, type LearnedLookup, type RoomEstimate } from "@/lib/housekeeping/roomAssignment";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { BoardAvailability, BoardRoomView, RoomBoardModel, RosterTrust } from "@/lib/housekeeping/roomBoardState";
import { ageSource, fetchedAtOf, knownValue, loadingSource, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { evaluateEligibility, type RoomEligibility } from "@/lib/housekeeping/assignmentEligibility";
import { resolveOwnership, type RoomOwnership } from "@/lib/housekeeping/assignmentOwnership";
import { comparePriority, describePriority, type RoomPriority } from "@/lib/housekeeping/assignmentPriority";
import type { ScheduledShift } from "@/lib/housekeeping/assignmentSchedule";
import { buildTeam, type AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import {
  buildPropertyLoad,
  roomCredits,
  type PropertyLoad,
  type RoomCredits,
  type WorkloadSettings,
} from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — the composed model ───────────────────────────
   ONE pure function from the shared Room Board model (board + staff + roster + late checkouts, already
   scoped to hotel/user/date and freshness-aged) plus the Assignments-only sources (workload settings and
   today's schedule) to everything the Assignments screens read. It fetches nothing and holds nothing.

   The board, staff and roster are NOT re-fetched or re-interpreted here: `RoomBoardModel` is the single
   source for them, so the Assignments counts cannot drift from Supervisor Today or the Room Board. The two
   extra sources are independent — a failure in either leaves every room, owner and estimate intact and only
   withholds what depends on it (credit figures, "scheduled", shift time left). */

/** Settings change rarely; the schedule changes by the day. How long each may be called current. */
export const SETTINGS_STALE_AFTER_MS = 30 * 60_000;
export const SCHEDULE_STALE_AFTER_MS = 15 * 60_000;

export interface AssignmentAuxSources {
  settings: SourceState<WorkloadSettings>;
  schedule: SourceState<ScheduledShift[]>;
}

export function initialAssignmentAuxSources(): AssignmentAuxSources {
  return { settings: loadingSource(), schedule: loadingSource() };
}

export type AuxTrust = "verified" | "stale" | "unknown";

function trustOf(state: SourceState<unknown>): AuxTrust {
  return state.status === "available" || state.status === "empty" ? "verified" : state.status === "stale" ? "stale" : "unknown";
}

/** The value of a source that can never be "verified empty" (settings): its last answer, or null. */
function heldValue<T>(state: SourceState<T>): T | null {
  return state.status === "available" || state.status === "stale" ? state.data : null;
}

/** One room as the Assignments screens use it. It carries `room` so every Room Board selector applies to it unchanged. */
export interface AssignmentRoom {
  room: BoardRoom;
  /** The Room Board's view of the room (its resolved assignee and that person's attendance). */
  view: BoardRoomView;
  ownership: RoomOwnership;
  eligibility: RoomEligibility;
  priority: RoomPriority;
  /** The cleaning estimate, or null when there is none (never defaulted). */
  estimate: RoomEstimate | null;
  credits: RoomCredits;
}

export interface AssignmentsModel {
  generatedAt: number;
  hotelDate: string;
  timeZone: string;
  /** The Room Board's own verdict on the board; assignments may be changed only when it is live (see the hook's gate). */
  availability: BoardAvailability;
  /** null = unknown (the board is loading, failed, or belongs to another day). A verified empty hotel is `[]`. */
  rooms: AssignmentRoom[] | null;
  /** null when `rooms` is null: ownership, and therefore every load, is unknown. */
  team: AssignmentTeamMember[] | null;
  property: PropertyLoad | null;
  settings: { trust: AuxTrust; value: WorkloadSettings | null; fetchedAt: number | null };
  schedule: { trust: AuxTrust; shifts: ScheduledShift[] | null; fetchedAt: number | null };
  rosterTrust: RosterTrust;
  staffListKnown: boolean;
  /** Whether the guest-waiting signal was supplied. false = unknown; priority never claims "no guest waiting". */
  guestWaitingKnown: boolean;
  /** The Room Board model this was composed from (readiness, warnings, sources). */
  board: RoomBoardModel;
}

export interface ComposeOptions {
  /** Room ids with a guest waiting, or null/undefined when not known. */
  guestWaiting?: ReadonlySet<string> | null;
  learned?: LearnedLookup;
}

export function composeAssignments(board: RoomBoardModel, aux: AssignmentAuxSources, options: ComposeOptions = {}): AssignmentsModel {
  const now = board.generatedAt;
  const settingsSource = ageSource(aux.settings, now, SETTINGS_STALE_AFTER_MS);
  const scheduleSource = ageSource(aux.schedule, now, SCHEDULE_STALE_AFTER_MS);
  const settings = heldValue(settingsSource);
  const shifts = knownValue(scheduleSource, []);
  const staffList = knownValue(board.sources.staff, []);
  const nameById = staffList ? new Map(staffList.map((member) => [member.userId, member.name])) : null;
  const guestWaiting = options.guestWaiting ?? null;
  const learned = options.learned;

  const rooms: AssignmentRoom[] | null = board.rooms
    ? board.rooms
        .map<AssignmentRoom>((view) => {
          const { room } = view;
          return {
            room,
            view,
            ownership: resolveOwnership(room, nameById),
            eligibility: evaluateEligibility(room, now),
            priority: describePriority(room, { now, timeZone: board.timeZone, guestWaiting }),
            estimate: estimateRoom(room, learned),
            credits: roomCredits(room, settings),
          };
        })
        .sort(comparePriority)
    : null;

  const boardRooms = rooms ? rooms.map((entry) => entry.room) : null;
  const team = boardRooms
    ? buildTeam({
        rooms: boardRooms,
        staff: staffList,
        roster: board.sources.roster,
        schedule: scheduleSource,
        shifts: shifts ?? [],
        settings,
        ...(learned ? { learned } : {}),
        now,
        hotelDate: board.hotelDate,
        timeZone: board.timeZone,
      })
    : null;

  return {
    generatedAt: now,
    hotelDate: board.hotelDate,
    timeZone: board.timeZone,
    availability: board.availability,
    rooms,
    team,
    property: boardRooms ? buildPropertyLoad(boardRooms, settings, learned) : null,
    settings: { trust: trustOf(settingsSource), value: settings, fetchedAt: fetchedAtOf(settingsSource) },
    schedule: { trust: trustOf(scheduleSource), shifts, fetchedAt: fetchedAtOf(scheduleSource) },
    rosterTrust: board.rosterTrust,
    staffListKnown: staffList !== null,
    guestWaitingKnown: guestWaiting !== null,
    board,
  };
}
