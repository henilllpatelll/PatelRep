import type { TeamSchedule } from "@/lib/api/schedulingTeam";
import { knownValue, type SourceFailure, type SourceState } from "@/lib/housekeeping/supervisorSources";
import {
  buildAttention,
  buildDayRoster,
  buildShiftGroups,
  buildWeekSummaries,
  countAttendance,
  countScheduled,
  type AttendanceCounts,
  type AttendanceMode,
  type AttentionItem,
  type DayRoster,
  type DaySummary,
  type ScheduleContext,
  type ShiftGroup,
  type SourceNotes,
} from "@/lib/scheduling/teamScheduleModel";
import { weekDays, weekStartOf } from "@/lib/scheduling/teamScheduleDates";

/* ─── Team Schedule — what a screen shows for one selected day ──────────────
   Pure. Two sources feed the screen, each tracked on its own (see useTeamSchedule):

     week  the selected day's Monday–Sunday plan, no attendance (a plan, loaded for both views)
     day   today only, WITH attendance — the one place a "who actually started" claim can come from

   For the hotel's current day the attendance read is preferred; if it cannot be read the plan still shows, with
   every status "Unknown" and a notice saying why. For any other day there is no attendance claim at all.
   An error is never an empty schedule: `state` is `failed` and the screen offers a retry. */

export type DayViewState = "loading" | "failed" | "ready";

export interface DayView {
  state: DayViewState;
  failure: SourceFailure | null;
  date: string;
  roster: DayRoster | null;
  groups: ShiftGroup[];
  /** People in this supervisor's scope (not just those scheduled that day); null = unknown. */
  staffInScope: number | null;
  /** The plan was read and it has nobody at all in scope, so "nothing scheduled" is a fact. */
  verifiedEmpty: boolean;
  scheduledCount: number | null;
  /** Attendance counts, only for a verified, fresh read of the hotel's current day. */
  counts: AttendanceCounts | null;
  attention: AttentionItem[];
  /** Epoch ms the data on screen was last verified; null while loading/failed. */
  verifiedAt: number | null;
  /** True when what is shown is older than the last successful read could vouch for (offline, failed refresh, aged). */
  stale: boolean;
  /** Epoch ms the attendance claim was read by the server; null when no attendance is shown. */
  attendanceAsOf: number | null;
}

function emptyNotes(): SourceNotes {
  return { staleSince: null, attendanceUnavailable: false, incomplete: false, unreadableShifts: 0 };
}

const isSettled = (state: SourceState<TeamSchedule>): boolean => state.status === "available" || state.status === "empty" || state.status === "stale";

/** Chooses which source answers for `date` and reads it into a DayView. */
export function selectDayView(date: string, today: string, week: SourceState<TeamSchedule>, day: SourceState<TeamSchedule>, ctx: ScheduleContext): DayView {
  const isToday = date === today;
  // Today prefers the attendance read when it has answered at all (even stale: its plan is still the newest plan).
  const useDay = isToday && isSettled(day);
  // Until the attendance read answers (or fails), today shows a skeleton rather than a flash of "Unknown" labels.
  const chosen = useDay ? day : isToday && day.status === "loading" ? day : week;
  const schedule = knownValue(chosen, null as unknown as TeamSchedule);

  if (chosen.status === "empty" || (chosen.status === "stale" && chosen.data === null)) {
    // A verified (or last-verified) answer with nobody in scope.
    return viewFor(date, null, chosen, "not_applicable", ctx, true);
  }
  if (!schedule) {
    return {
      state: chosen.status === "failed" ? "failed" : "loading",
      failure: chosen.status === "failed" ? chosen.failure : null,
      date,
      roster: null,
      groups: [],
      staffInScope: null,
      verifiedEmpty: false,
      scheduledCount: null,
      counts: null,
      attention: [],
      verifiedAt: null,
      stale: false,
      attendanceAsOf: null,
    };
  }
  const fresh = chosen.status === "available";
  let mode: AttendanceMode = "not_applicable";
  if (isToday) mode = useDay && fresh && schedule.attendance.verified ? "verified" : "unavailable";
  return viewFor(date, schedule, chosen, mode, ctx, false);
}

function viewFor(date: string, schedule: TeamSchedule | null, chosen: SourceState<TeamSchedule>, mode: AttendanceMode, ctx: ScheduleContext, verifiedEmpty: boolean): DayView {
  const fetchedAt = chosen.status === "available" || chosen.status === "empty" || chosen.status === "stale" ? chosen.fetchedAt : null;
  const stale = chosen.status === "stale";
  if (!schedule) {
    return {
      state: "ready",
      failure: null,
      date,
      roster: { date, mode: "not_applicable", people: [], shifts: [] },
      groups: [],
      staffInScope: 0,
      verifiedEmpty,
      scheduledCount: 0,
      counts: null,
      attention: buildAttention({ date, mode: "not_applicable", people: [], shifts: [] }, { ...emptyNotes(), staleSince: stale ? fetchedAt : null }, ctx),
      verifiedAt: fetchedAt,
      stale,
      attendanceAsOf: null,
    };
  }
  const roster = buildDayRoster(schedule, date, mode, ctx);
  const notes: SourceNotes = {
    staleSince: stale ? fetchedAt : null,
    // Stale already explains itself; "unavailable" is for a fresh read whose attendance the server could not verify.
    attendanceUnavailable: mode === "unavailable" && !stale,
    incomplete: !schedule.complete,
    unreadableShifts: schedule.unreadableShifts,
  };
  return {
    state: "ready",
    failure: null,
    date,
    roster,
    groups: buildShiftGroups(roster.people),
    staffInScope: schedule.totalPeople,
    verifiedEmpty,
    scheduledCount: countScheduled(roster),
    counts: countAttendance(roster),
    attention: buildAttention(roster, notes, ctx),
    verifiedAt: fetchedAt,
    stale,
    attendanceAsOf: mode === "verified" && schedule.attendance.asOf ? Date.parse(schedule.attendance.asOf) : null,
  };
}

export interface WeekView {
  days: string[];
  /** null = the plan for the week is unknown (loading or failed); a day with nothing is a verified 0. */
  summaries: DaySummary[] | null;
  stale: boolean;
}

export function selectWeekView(date: string, week: SourceState<TeamSchedule>): WeekView {
  const days = weekDays(date);
  if (week.status === "empty" || (week.status === "stale" && week.data === null)) {
    return { days, summaries: days.map((d) => ({ date: d, people: 0, shifts: 0, drafts: 0 })), stale: week.status === "stale" };
  }
  const schedule = knownValue(week, null as unknown as TeamSchedule);
  if (!schedule || schedule.dateFrom !== weekStartOf(date)) return { days, summaries: null, stale: false };
  return { days, summaries: buildWeekSummaries(schedule, days), stale: week.status === "stale" };
}
