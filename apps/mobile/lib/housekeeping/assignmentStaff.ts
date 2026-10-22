import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { rosterTrustOf } from "@/lib/housekeeping/roomBoardState";
import { compareRoomNumbers } from "@/lib/housekeeping/roomBoardSelectors";
import type { AssignableStaff } from "@/lib/housekeeping/supervisor";
import { knownValue, type SourceState } from "@/lib/housekeeping/supervisorSources";
import type { RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import { scheduledUserIds, shiftTimeFor, type ScheduledShift, type ShiftTime } from "@/lib/housekeeping/assignmentSchedule";
import { usableName } from "@/lib/housekeeping/assignmentOwnership";
import { computePersonLoad, type LoadContext, type PersonLoad, type WorkloadSettings } from "@/lib/housekeeping/assignmentWorkload";
import type { LearnedLookup } from "@/lib/housekeeping/roomAssignment";

/* ─── Supervisor Assignments — the team ─────────────────────────────────────
   Pure. THREE INDEPENDENT FACTS about a person, each from its own source, none inferred from another:

     attendance   did they clock in?   GET /shifts/roster (hk_shift_sessions) — only a VERIFIED roster speaks
     schedule     are they rostered?   GET /schedules/assignments            — a plan, not attendance
     ownership    which rooms are theirs?  the Room Board's assignments       — says nothing about attendance

   An assigned room is NOT evidence that its attendant is on shift. A failed, stale or missing roster makes
   attendance `unknown` for everybody — it is never read as "nobody is working".

   KNOWN LIMIT OF THE ROSTER (see apps/api/routers/shifts.py): it returns, per person, the latest shift that
   STARTED within the requested day. `started_at` is stored in UTC, so before the hotel-local-day window fix a
   shift started late in the hotel's evening (after local ~19:00 in Chicago, i.e. the next UTC day) was missing
   from that evening's roster, and an overnight shift still running was missing the next morning. The server
   now windows by the hotel's local day and carries still-open shifts over; the client cannot tell the two
   server versions apart, which is one more reason absence from the roster is only ever "not clocked in" (a
   fact about the roster), not "absent from work". */

export type Attendance =
  | "on_shift"
  | "on_break"
  | "shift_ended"
  | "scheduled_not_clocked_in"
  | "not_clocked_in"
  | "unknown";

export interface AttendanceFacts {
  attendance: Attendance;
  /** The roster answered and is fresh. When false, `attendance` is `unknown`. */
  rosterVerified: boolean;
  /** From a fresh schedule: true/false. null = the schedule is unavailable or stale. */
  scheduled: boolean | null;
}

function scheduleIds(schedule: SourceState<ScheduledShift[]>): Set<string> | null {
  // Only a fresh answer may say "scheduled" or "not scheduled"; a stale plan could be out of date.
  if (schedule.status !== "available" && schedule.status !== "empty") return null;
  return scheduledUserIds(knownValue(schedule, []) ?? []);
}

/**
 * Attendance for one person.
 *   verified roster + their row    → on shift / on break / shift ended (an implausible open shift → unknown)
 *   verified roster + no row       → scheduled but not clocked in, or not clocked in
 *   roster stale / failed / loading → unknown (whatever the schedule says)
 */
export function resolveAttendance(
  userId: string,
  roster: SourceState<RosterEntry[]>,
  schedule: SourceState<ScheduledShift[]>,
): AttendanceFacts {
  const scheduledIds = scheduleIds(schedule);
  const scheduled = scheduledIds === null ? null : scheduledIds.has(userId);
  if (rosterTrustOf(roster) !== "verified") return { attendance: "unknown", rosterVerified: false, scheduled };
  const entry = (knownValue(roster, []) ?? []).find((candidate) => candidate.userId === userId);
  if (!entry) return { attendance: scheduled ? "scheduled_not_clocked_in" : "not_clocked_in", rosterVerified: true, scheduled };
  const attendance: Attendance =
    entry.availability === "on_shift" ? "on_shift" : entry.availability === "on_break" ? "on_break" : entry.availability === "ended" ? "shift_ended" : "unknown";
  return { attendance, rosterVerified: true, scheduled };
}

/** Sort rank used wherever people are offered: working first, definitely-not-working last, unknown between. */
export const ATTENDANCE_RANK: Record<Attendance, number> = {
  on_shift: 0,
  scheduled_not_clocked_in: 1,
  on_break: 2,
  unknown: 3,
  not_clocked_in: 4,
  shift_ended: 5,
};

/* ─── Team members ────────────────────────────────────────────────────────── */

export type StaffConcern =
  /** Clocked out, rooms still open. */
  | "shift_ended_with_open_rooms"
  /** Verified not clocked in (and not expected yet), rooms open. */
  | "not_clocked_in_with_open_rooms"
  /** Credit target, scheduled shift time or a full day is already exceeded. */
  | "overloaded";

export interface AssignmentTeamMember {
  userId: string;
  /** null = the staff list has no usable name for this person (or the list is unavailable). */
  name: string | null;
  /** In the verified staff list. false = known only because rooms are assigned to them. */
  listed: boolean;
  role: string | null;
  attendance: Attendance;
  rosterVerified: boolean;
  scheduled: boolean | null;
  shift: ShiftTime | null;
  /** Rooms owned by this person today, in any stage, by room number. */
  rooms: BoardRoom[];
  floors: number[];
  buildings: string[];
  load: PersonLoad;
  concerns: StaffConcern[];
}

export interface TeamInputs {
  rooms: readonly BoardRoom[];
  /** null = the staff list is unavailable. */
  staff: readonly AssignableStaff[] | null;
  roster: SourceState<RosterEntry[]>;
  schedule: SourceState<ScheduledShift[]>;
  shifts: readonly ScheduledShift[];
  settings: WorkloadSettings | null;
  learned?: LearnedLookup;
  now: number;
  hotelDate: string;
  timeZone: string | null | undefined;
}

function concernsOf(attendance: Attendance, load: PersonLoad, shift: ShiftTime | null): StaffConcern[] {
  const concerns: StaffConcern[] = [];
  const open = load.minutes.remainingRooms > 0;
  if (open && attendance === "shift_ended") concerns.push("shift_ended_with_open_rooms");
  if (open && (attendance === "not_clocked_in" || (attendance === "scheduled_not_clocked_in" && shift?.phase === "during"))) {
    concerns.push("not_clocked_in_with_open_rooms");
  }
  if (load.warnings.includes("over_credit_target") || load.warnings.includes("exceeds_shift_time") || load.warnings.includes("exceeds_full_day")) {
    concerns.push("overloaded");
  }
  return concerns;
}

const nameCollator = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * One entry per person who is listed OR owns a room — including people with ZERO rooms (they are the
 * capacity available to take work) and owners the staff list cannot name (their rooms are theirs).
 * Order: name (unnamed last), then user id — stable and independent of attendance, so lists do not jump.
 */
export function buildTeam(input: TeamInputs): AssignmentTeamMember[] {
  const listed = new Map((input.staff ?? []).map((member) => [member.userId, member]));
  const byOwner = new Map<string, BoardRoom[]>();
  for (const room of input.rooms) {
    const owner = room.assignment.userId;
    if (!owner) continue;
    const list = byOwner.get(owner);
    if (list) list.push(room);
    else byOwner.set(owner, [room]);
  }
  const ids = new Set<string>([...listed.keys(), ...byOwner.keys()]);

  const members = [...ids].map<AssignmentTeamMember>((userId) => {
    const staff = listed.get(userId);
    const facts = resolveAttendance(userId, input.roster, input.schedule);
    const shift = shiftTimeFor(
      input.shifts.filter((candidate) => candidate.userId === userId),
      { hotelDate: input.hotelDate, now: input.now, timeZone: input.timeZone },
    );
    const context: LoadContext = { settings: input.settings, shiftTime: shift, ...(input.learned ? { learned: input.learned } : {}) };
    const owned = [...(byOwner.get(userId) ?? [])].sort(compareRoomNumbers);
    const load = computePersonLoad(userId, owned, context);
    return {
      userId,
      name: usableName(staff?.name),
      listed: staff !== undefined,
      role: staff?.role ?? null,
      attendance: facts.attendance,
      rosterVerified: facts.rosterVerified,
      scheduled: facts.scheduled,
      shift,
      rooms: owned,
      floors: [...new Set(owned.filter((room) => room.floorKnown).map((room) => room.floor))].sort((a, b) => a - b),
      buildings: [...new Set(owned.map((room) => room.building).filter((b): b is string => b !== null))].sort((a, b) => nameCollator.compare(a, b)),
      load,
      concerns: concernsOf(facts.attendance, load, shift),
    };
  });

  return members.sort(
    (a, b) =>
      (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
      nameCollator.compare(a.name ?? "", b.name ?? "") ||
      a.userId.localeCompare(b.userId),
  );
}
