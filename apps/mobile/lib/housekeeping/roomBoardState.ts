import { resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import {
  attachLateCheckouts,
  type BoardRoom,
  type BoardSnapshot,
  type LateCheckoutRecord,
} from "@/lib/housekeeping/roomBoardModel";
import { buildTeamLoads, isActionable, type AssignableStaff } from "@/lib/housekeeping/supervisor";
import {
  ageSource,
  fetchedAtOf,
  knownValue,
  type SourceFailure,
  type SourceState,
  type StaleReason,
} from "@/lib/housekeeping/supervisorSources";
import type { RosterEntry, StaffAvailability } from "@/lib/housekeeping/supervisorTeam";
import {
  buildReadinessSummary,
  hotelTodayKey,
  type ReadinessSummary,
} from "@/lib/housekeeping/supervisorToday";

/* ─── Room Board — trust, assignment and composition ────────────────────────
   Turns the shared Supervisor Today sources (board, staff, roster) plus the board's own late-checkout
   source into ONE verified view model. Pure: no React, no I/O.

   WHAT THE BOARD IS ALLOWED TO CLAIM (`BoardAvailability`)
     loading        nothing has answered yet
     ready          verified by the server within the freshness window — the ONLY state that is "live"
     verified_empty the server answered and the hotel has no rooms (a TRUE zero)
     stale          the last verified answer, kept but not verified now (offline / old / a refresh failed)
     unavailable    nothing verified to show: offline, forbidden or a failed request. NEVER "zero rooms".
     previous_day   what is held was requested for an earlier hotel date; it is not shown as today's board

   WHO IS ASSIGNED vs WHO THEY ARE vs WHETHER THEY ARE WORKING — three separate facts:
     assignment.userId       the room is tied to this user id (dated row or status mirror)
     assignee.name           the display name, when the staff list is verified and has them
     assignee.availability   on shift / on break / ended / not clocked in — ONLY from a verified roster,
                             otherwise `unknown`. A missing name never means "unassigned"; an active
                             account never means "on shift". */

/* ─── Availability ────────────────────────────────────────────────────────── */

export type BoardUnavailableCause = "offline" | "forbidden" | "error";

export type BoardAvailability =
  | { kind: "loading" }
  | { kind: "ready"; verifiedAt: number }
  | { kind: "verified_empty"; verifiedAt: number }
  | { kind: "stale"; reason: StaleReason; verifiedAt: number; failure: SourceFailure | null }
  | { kind: "unavailable"; cause: BoardUnavailableCause; failure: SourceFailure | null }
  | { kind: "previous_day"; boardDate: string; hotelDate: string; verifiedAt: number | null };

export type MutationBlock = "loading" | "offline" | "stale" | "unavailable" | "previous_day";

export interface MutationGate {
  allowed: boolean;
  /** Why not; null when allowed. */
  blockedBy: MutationBlock | null;
}

/** Reads the board source (already aged) against the hotel's current date. */
export function resolveBoardAvailability(board: SourceState<BoardSnapshot>, hotelDate: string): BoardAvailability {
  const snapshot = knownValue(board, { rooms: [], invalidRows: 0, duplicateRows: 0 });
  const verifiedAt = fetchedAtOf(board);
  // A held answer for another hotel date is never today's board, however fresh it looks.
  if (snapshot?.forDate && snapshot.forDate !== hotelDate) {
    return { kind: "previous_day", boardDate: snapshot.forDate, hotelDate, verifiedAt };
  }
  switch (board.status) {
    case "loading":
      return { kind: "loading" };
    case "available":
      return { kind: "ready", verifiedAt: board.fetchedAt };
    case "empty":
      return { kind: "verified_empty", verifiedAt: board.fetchedAt };
    case "stale":
      return { kind: "stale", reason: board.reason, verifiedAt: board.fetchedAt, failure: board.failure };
    case "failed":
      return {
        kind: "unavailable",
        cause: board.failure.kind === "offline" ? "offline" : board.failure.kind === "forbidden" ? "forbidden" : "error",
        failure: board.failure,
      };
  }
}

/**
 * Operational mutations (assign, remove, reassign, inspect…) are allowed only on a verified, fresh board and
 * a reachable server. Stale or untrusted data can be read but never acted on.
 */
export function evaluateMutationGate(availability: BoardAvailability, isOnline: boolean): MutationGate {
  if (!isOnline) return { allowed: false, blockedBy: "offline" };
  switch (availability.kind) {
    case "ready":
    case "verified_empty":
      return { allowed: true, blockedBy: null };
    case "loading":
      return { allowed: false, blockedBy: "loading" };
    case "stale":
      return { allowed: false, blockedBy: "stale" };
    case "unavailable":
      return { allowed: false, blockedBy: "unavailable" };
    case "previous_day":
      return { allowed: false, blockedBy: "previous_day" };
  }
}

/** Only a freshly verified answer may be called live. Everything else must say how old it is. */
export function isLive(availability: BoardAvailability): boolean {
  return availability.kind === "ready" || availability.kind === "verified_empty";
}

/** Milliseconds since the board was last verified, or null when it never was. */
export function verifiedAgeMs(availability: BoardAvailability, now: number): number | null {
  const at =
    availability.kind === "ready" || availability.kind === "verified_empty" || availability.kind === "stale"
      ? availability.verifiedAt
      : availability.kind === "previous_day"
        ? availability.verifiedAt
        : null;
  return at === null ? null : Math.max(0, now - at);
}

/* ─── Staff ───────────────────────────────────────────────────────────────── */

export type RosterTrust = "verified" | "stale" | "unknown";

export function rosterTrustOf(roster: SourceState<RosterEntry[]>): RosterTrust {
  return roster.status === "available" || roster.status === "empty" ? "verified" : roster.status === "stale" ? "stale" : "unknown";
}

/**
 * A person's attendance. Only a VERIFIED roster can say anything: absent from a verified roster means
 * `not_clocked_in`; with a stale, failed or missing roster everyone is `unknown`.
 */
export function availabilityFor(userId: string, roster: SourceState<RosterEntry[]>): StaffAvailability {
  if (rosterTrustOf(roster) !== "verified") return "unknown";
  const entries = knownValue(roster, []) ?? [];
  return entries.find((entry) => entry.userId === userId)?.availability ?? "not_clocked_in";
}

export interface RoomAssignee {
  userId: string;
  /** null = the staff list has no name for this id (or is unavailable). The room is STILL assigned. */
  name: string | null;
  availability: StaffAvailability;
}

export interface BoardStaffMember {
  userId: string;
  name: string;
  role: string;
  availability: StaffAvailability;
  /** Rooms currently tied to this person on the board (any stage). */
  assignedRooms: number;
  /** Rooms still to clean or being cleaned. */
  openRooms: number;
}

export interface BoardRoomView {
  room: BoardRoom;
  /** null only when no one is assigned. */
  assignee: RoomAssignee | null;
}

/* ─── Composition ─────────────────────────────────────────────────────────── */

export interface RoomBoardSources {
  board: SourceState<BoardSnapshot>;
  staff: SourceState<AssignableStaff[]>;
  roster: SourceState<RosterEntry[]>;
  lateCheckouts: SourceState<LateCheckoutRecord[]>;
}

export interface RoomBoardModel {
  generatedAt: number;
  hotelDate: string;
  timeZone: string;
  availability: BoardAvailability;
  /** null = unknown (nothing verified to show). A verified empty board is `[]`, never null. */
  rooms: BoardRoomView[] | null;
  /** The same numbers Supervisor Today shows; null when the board is unknown. */
  readiness: ReadinessSummary | null;
  staff: BoardStaffMember[];
  staffNamesKnown: boolean;
  rosterTrust: RosterTrust;
  /** Whether late-checkout information was verified; false = unknown, not "none". */
  lateCheckoutsKnown: boolean;
  /** Board rows that could not be used; surfaced so a short board is explainable. */
  warnings: { invalidRows: number; duplicateRows: number };
  /** Epoch ms of the last verified board answer. */
  lastVerifiedAt: number | null;
  sources: RoomBoardSources;
}

export function initialRoomBoardSources(): RoomBoardSources {
  return {
    board: { status: "loading" },
    staff: { status: "loading" },
    roster: { status: "loading" },
    lateCheckouts: { status: "loading" },
  };
}

const EMPTY_BOARD: BoardSnapshot = { rooms: [], invalidRows: 0, duplicateRows: 0 };

export function composeRoomBoard(
  sources: RoomBoardSources,
  options: { now: number; timeZone?: string | null },
): RoomBoardModel {
  const { now } = options;
  const timeZone = resolveTimeZone(options.timeZone);
  const hotelDate = hotelTodayKey(now, timeZone);
  // Age first: an answer older than the freshness window is shown as stale, not fresh.
  const aged: RoomBoardSources = {
    board: ageSource(sources.board, now),
    staff: ageSource(sources.staff, now),
    roster: ageSource(sources.roster, now),
    lateCheckouts: ageSource(sources.lateCheckouts, now),
  };

  const availability = resolveBoardAvailability(aged.board, hotelDate);
  const snapshot = knownValue(aged.board, EMPTY_BOARD);
  const showRooms = snapshot !== null && availability.kind !== "previous_day";
  const lateCheckouts = knownValue(aged.lateCheckouts, []);
  const staff = knownValue(aged.staff, []);
  const nameById = new Map((staff ?? []).map((member) => [member.userId, member.name]));
  const baseRooms = showRooms ? attachLateCheckouts(snapshot.rooms, lateCheckouts) : null;

  const rooms: BoardRoomView[] | null = baseRooms
    ? baseRooms.map((room) => ({
        room,
        assignee: room.assignment.userId
          ? {
              userId: room.assignment.userId,
              name: nameById.get(room.assignment.userId) ?? null,
              availability: availabilityFor(room.assignment.userId, aged.roster),
            }
          : null,
      }))
    : null;

  const loads = new Map(buildTeamLoads(baseRooms ?? [], new Map(nameById)).map((load) => [load.housekeeperId, load]));
  const staffMembers: BoardStaffMember[] = (staff ?? []).map((member) => {
    const load = loads.get(member.userId);
    return {
      userId: member.userId,
      name: member.name,
      role: member.role,
      availability: availabilityFor(member.userId, aged.roster),
      assignedRooms: load?.total ?? 0,
      openRooms: load ? load.rooms.filter((room) => isActionable(room.status)).length : 0,
    };
  });

  return {
    generatedAt: now,
    hotelDate,
    timeZone,
    availability,
    rooms,
    readiness: baseRooms ? buildReadinessSummary(baseRooms, { nowMs: now, timeZone }) : null,
    staff: staffMembers,
    staffNamesKnown: staff !== null,
    rosterTrust: rosterTrustOf(aged.roster),
    lateCheckoutsKnown: lateCheckouts !== null,
    warnings: { invalidRows: snapshot?.invalidRows ?? 0, duplicateRows: snapshot?.duplicateRows ?? 0 },
    lastVerifiedAt: fetchedAtOf(aged.board),
    sources: aged,
  };
}
