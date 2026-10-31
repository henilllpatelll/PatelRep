import type { TeamSchedule, TeamShift, WorkforceStatus } from "@/lib/api/schedulingTeam";
import { clockMinutes, formatWallClock, hotelDayOf } from "@/lib/scheduling/teamScheduleDates";

/* ─── Team Schedule — the verified day model ────────────────────────────────
   Pure. Turns the `/schedules/team` answer into what the screens draw. Three rules run through all of it:

   1. PLAN IS NOT ATTENDANCE. A shift_assignments row says who is expected. Only a verified hk_shift_sessions read
      (the server's `attendance.verified`, and only while the answer is fresh) says who started. Past/future days and
      unverified reads carry no attendance claim at all.
   2. LATE IS NOT ABSENT. A scheduled person with no clock-in is "Not clocked in" — a fact about the roster. Nothing
      here calls anyone absent or a no-show; that needs an explicit absence record (a later phase).
   3. UNKNOWN IS NEVER ZERO. Counts that depend on attendance are `null` when attendance is not verified, so the
      screen cannot print "0 working" for "we could not tell". */

export type AttendanceMode = "verified" | "unavailable" | "not_applicable";
export type DisplayStatus = "on_shift" | "on_break" | "scheduled" | "not_clocked_in" | "shift_ended" | "unknown";
export type ShiftPeriod = "morning" | "afternoon" | "evening" | "overnight";

export interface ScheduleContext {
  zone: string | null;
  language?: string;
  nowMs: number;
}

export interface DayShift {
  id: string;
  userId: string;
  workDate: string;
  name: string | null;
  /** Groups shifts that are the same window under the same name. */
  windowKey: string;
  period: ShiftPeriod;
  startsAtMs: number;
  endsAtMs: number;
  startLabel: string;
  endLabel: string;
  endsNextDay: boolean;
  carried: boolean;
  draft: boolean;
  /** A pending change drawn over the published schedule (draft preview only); null for a published shift. */
  proposal: "new" | "changed" | "cancelled" | null;
  notes: string | null;
}

export interface RosterPerson {
  userId: string;
  name: string | null;
  roles: string[];
  /** Has at least one shift on this day. false = on shift (per attendance) with nothing on the schedule. */
  scheduled: boolean;
  shifts: DayShift[];
  /** null = this day makes no attendance claim (a past or future day). */
  status: DisplayStatus | null;
  firstStartMs: number | null;
}

export interface DayRoster {
  date: string;
  mode: AttendanceMode;
  people: RosterPerson[];
  shifts: DayShift[];
}

/* ─── Periods & shifts ────────────────────────────────────────────────────── */

/** By the shift's real start time on the hotel's wall clock — never by its template name. */
export function periodOf(startMinutes: number): ShiftPeriod {
  if (startMinutes >= 300 && startMinutes < 720) return "morning";
  if (startMinutes >= 720 && startMinutes < 1020) return "afternoon";
  if (startMinutes >= 1020 && startMinutes < 1260) return "evening";
  return "overnight";
}

function startMinutesOf(shift: TeamShift, zone: string | null): number {
  const wall = clockMinutes(shift.startTime);
  if (wall !== null) return wall;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone ?? undefined, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(new Date(shift.startsAt));
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (read("hour") % 24) * 60 + read("minute");
}

export function toDayShift(shift: TeamShift, ctx: ScheduleContext): DayShift {
  const startMinutes = startMinutesOf(shift, ctx.zone);
  const endMinutes = clockMinutes(shift.endTime);
  const endDay = hotelDayOf(shift.endsAt, ctx.zone);
  const endsNextDay = endDay !== null && endDay > shift.workDate;
  return {
    id: shift.id,
    userId: shift.userId,
    workDate: shift.workDate,
    name: shift.name,
    windowKey: `${startMinutes}|${endMinutes ?? shift.endsAt}|${(shift.name ?? "").trim().toLowerCase()}`,
    period: periodOf(startMinutes),
    startsAtMs: Date.parse(shift.startsAt),
    endsAtMs: Date.parse(shift.endsAt),
    startLabel: formatWallClock(shift.workDate, shift.startTime, shift.startsAt, ctx.zone, ctx.language),
    endLabel: formatWallClock(endDay ?? shift.workDate, shift.endTime, shift.endsAt, ctx.zone, ctx.language),
    endsNextDay,
    carried: shift.carriedFromPreviousDay,
    draft: shift.publication === "draft" || shift.proposal !== undefined,
    proposal: shift.proposal?.kind ?? null,
    notes: shift.notes,
  };
}

const byStart = (a: DayShift, b: DayShift) => a.startsAtMs - b.startsAtMs || a.endsAtMs - b.endsAtMs || a.id.localeCompare(b.id);

/** The shifts that belong on `date`: that day's own, plus an overnight shift still running into the range's first day. */
export function shiftsForDay(schedule: TeamSchedule, date: string, ctx: ScheduleContext): DayShift[] {
  return schedule.shifts
    .filter((shift) => {
      if (shift.workDate === date) return true;
      // A carried shift is yesterday's: it appears today only while it is still running (or, for a future day, always).
      return shift.carriedFromPreviousDay && date === schedule.dateFrom && Date.parse(shift.endsAt) > ctx.nowMs;
    })
    .map((shift) => toDayShift(shift, ctx))
    .sort(byStart);
}

/* ─── Attendance → display status ─────────────────────────────────────────── */

/**
 * One person's label. The server's status is about the PERSON's latest session, so it is read against the
 * person's shifts for the day: a clock-out with a later shift still to come is "Scheduled", and no clock-in before
 * any shift has started is "Scheduled" too — only a started shift with no clock-in is "Not clocked in".
 */
export function resolveDisplayStatus(status: WorkforceStatus | null, shifts: readonly DayShift[], mode: AttendanceMode, nowMs: number): DisplayStatus | null {
  if (mode === "not_applicable") return null;
  if (mode === "unavailable" || status === null || status === "unknown") return "unknown";
  switch (status) {
    case "working":
      return "on_shift";
    case "on_break":
      return "on_break";
    case "clocked_out":
      return shifts.some((shift) => shift.startsAtMs > nowMs) ? "scheduled" : "shift_ended";
    case "not_clocked_in":
    case "scheduled":
      return shifts.some((shift) => shift.startsAtMs <= nowMs) ? "not_clocked_in" : "scheduled";
  }
}

/* ─── The day ─────────────────────────────────────────────────────────────── */

const collator = new Intl.Collator(undefined, { sensitivity: "base" });
export const compareNames = (a: string | null, b: string | null): number =>
  (a === null ? 1 : 0) - (b === null ? 1 : 0) || collator.compare(a ?? "", b ?? "");

export function buildDayRoster(schedule: TeamSchedule, date: string, mode: AttendanceMode, ctx: ScheduleContext): DayRoster {
  const shifts = shiftsForDay(schedule, date, ctx);
  const shiftsByUser = new Map<string, DayShift[]>();
  for (const shift of shifts) shiftsByUser.set(shift.userId, [...(shiftsByUser.get(shift.userId) ?? []), shift]);
  // The server puts the same person-level status on the person and on each of their shifts; read it once, by id.
  const shiftStatus = new Map<string, WorkforceStatus | null>();
  for (const shift of schedule.shifts) if (!shiftStatus.has(shift.userId)) shiftStatus.set(shift.userId, shift.status);

  const people: RosterPerson[] = [];
  for (const person of schedule.people) {
    const own = shiftsByUser.get(person.userId) ?? [];
    const status = person.status ?? shiftStatus.get(person.userId) ?? null;
    // Someone with no shift today appears only if attendance verifiably says they are working.
    const workingUnscheduled = own.length === 0 && mode === "verified" && (status === "working" || status === "on_break");
    if (own.length === 0 && !workingUnscheduled) continue;
    people.push({
      userId: person.userId,
      name: person.name,
      roles: person.roles,
      scheduled: own.length > 0,
      shifts: own,
      status: resolveDisplayStatus(status, own, mode, ctx.nowMs),
      firstStartMs: own[0]?.startsAtMs ?? null,
    });
  }
  people.sort((a, b) => (a.firstStartMs ?? Infinity) - (b.firstStartMs ?? Infinity) || compareNames(a.name, b.name) || a.userId.localeCompare(b.userId));
  return { date, mode, people, shifts };
}

export interface AttendanceCounts {
  /** People with a shift on the day. */
  scheduled: number;
  onShift: number;
  onBreak: number;
  /** Scheduled, and no shift of theirs has started yet. */
  upcoming: number;
  notClockedIn: number;
  shiftEnded: number;
  unknown: number;
  /** On shift according to attendance but with nothing on the schedule (a subset of `onShift` + `onBreak`). */
  unscheduledOnShift: number;
}

/** Plan counts: always knowable from a fresh plan. */
export function countScheduled(roster: DayRoster): number {
  return roster.people.filter((person) => person.scheduled).length;
}

/** Attendance counts, or null when the day makes no verified attendance claim. */
export function countAttendance(roster: DayRoster): AttendanceCounts | null {
  if (roster.mode !== "verified") return null;
  const counts: AttendanceCounts = { scheduled: countScheduled(roster), onShift: 0, onBreak: 0, upcoming: 0, notClockedIn: 0, shiftEnded: 0, unknown: 0, unscheduledOnShift: 0 };
  for (const person of roster.people) {
    switch (person.status) {
      case "on_shift":
        counts.onShift += 1;
        break;
      case "on_break":
        counts.onBreak += 1;
        break;
      case "scheduled":
        counts.upcoming += 1;
        break;
      case "not_clocked_in":
        counts.notClockedIn += 1;
        break;
      case "shift_ended":
        counts.shiftEnded += 1;
        break;
      default:
        counts.unknown += 1;
    }
    if (!person.scheduled && (person.status === "on_shift" || person.status === "on_break")) counts.unscheduledOnShift += 1;
  }
  return counts;
}

/* ─── Shift groups ────────────────────────────────────────────────────────── */

export interface ShiftGroup {
  key: string;
  name: string | null;
  period: ShiftPeriod;
  startLabel: string;
  endLabel: string;
  endsNextDay: boolean;
  startsAtMs: number;
  /** One entry per person in the group, in the order the day lists them. */
  members: { person: RosterPerson; shift: DayShift }[];
}

/**
 * The day's shifts as groups of the same window, in real start order. A person with two shifts appears in two groups
 * (once per shift); nothing is keyed by person or date alone, so one shift can never overwrite another.
 */
export function buildShiftGroups(people: readonly RosterPerson[]): ShiftGroup[] {
  const groups = new Map<string, ShiftGroup>();
  for (const person of people) {
    for (const shift of person.shifts) {
      let group = groups.get(shift.windowKey);
      if (!group) {
        group = {
          key: shift.windowKey,
          name: shift.name,
          period: shift.period,
          startLabel: shift.startLabel,
          endLabel: shift.endLabel,
          endsNextDay: shift.endsNextDay,
          startsAtMs: shift.startsAtMs,
          members: [],
        };
        groups.set(shift.windowKey, group);
      }
      group.startsAtMs = Math.min(group.startsAtMs, shift.startsAtMs);
      group.members.push({ person, shift });
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, members: [...group.members].sort((a, b) => compareNames(a.person.name, b.person.name) || a.person.userId.localeCompare(b.person.userId)) }))
    .sort((a, b) => a.startsAtMs - b.startsAtMs || a.key.localeCompare(b.key));
}

/* ─── Week ────────────────────────────────────────────────────────────────── */

export interface DaySummary {
  date: string;
  /** Distinct people with a shift that starts on the day. */
  people: number;
  shifts: number;
  drafts: number;
}

/** One entry per requested day; a day with nothing scheduled is a verified 0 (the plan itself was read). */
export function buildWeekSummaries(schedule: TeamSchedule, days: readonly string[]): DaySummary[] {
  return days.map((date) => {
    const own = schedule.shifts.filter((shift) => shift.workDate === date);
    return { date, people: new Set(own.map((shift) => shift.userId)).size, shifts: own.length, drafts: own.filter((shift) => shift.publication === "draft").length };
  });
}

/* ─── Attention ───────────────────────────────────────────────────────────── */

export type AttentionKind =
  | "not_clocked_in"
  | "ended_early"
  | "unscheduled_on_shift"
  | "attendance_unavailable"
  | "stale_data"
  | "incomplete"
  | "unreadable";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: "warning" | "info";
  userId: string | null;
  name: string | null;
  /** The instant the observation is about (shift start, scheduled end, last verified read), if any. */
  atMs: number | null;
  /** For summary items: how many (shifts that could not be read). */
  count?: number;
}

export interface SourceNotes {
  /** Epoch ms of the last verified read when what is shown is OLD (offline, failed refresh, aged); null when fresh. */
  staleSince: number | null;
  /** The day should carry attendance but the read could not be verified. */
  attendanceUnavailable: boolean;
  /** Not every person/shift was returned. */
  incomplete: boolean;
  unreadableShifts: number;
}

/**
 * Only observations the data supports. A scheduled person without a clock-in is `not_clocked_in` (never absent);
 * a clock-out before the scheduled end is `ended_early` (a fact, not a judgement).
 */
export function buildAttention(roster: DayRoster, notes: SourceNotes, ctx: ScheduleContext): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (notes.staleSince !== null) items.push({ id: "stale", kind: "stale_data", severity: "warning", userId: null, name: null, atMs: notes.staleSince });
  if (notes.attendanceUnavailable) items.push({ id: "attendance", kind: "attendance_unavailable", severity: "warning", userId: null, name: null, atMs: null });
  if (notes.incomplete) items.push({ id: "incomplete", kind: "incomplete", severity: "warning", userId: null, name: null, atMs: null });
  if (notes.unreadableShifts > 0) items.push({ id: "unreadable", kind: "unreadable", severity: "warning", userId: null, name: null, atMs: null, count: notes.unreadableShifts });

  if (roster.mode === "verified") {
    for (const person of roster.people) {
      if (person.status === "not_clocked_in") {
        const started = person.shifts.filter((shift) => shift.startsAtMs <= ctx.nowMs);
        items.push({ id: `nci:${person.userId}`, kind: "not_clocked_in", severity: "warning", userId: person.userId, name: person.name, atMs: Math.min(...started.map((shift) => shift.startsAtMs)) });
      } else if (person.status === "shift_ended") {
        const planned = person.shifts.filter((shift) => shift.endsAtMs > ctx.nowMs);
        if (planned.length > 0) items.push({ id: `end:${person.userId}`, kind: "ended_early", severity: "info", userId: person.userId, name: person.name, atMs: Math.max(...planned.map((shift) => shift.endsAtMs)) });
      } else if (!person.scheduled && (person.status === "on_shift" || person.status === "on_break")) {
        items.push({ id: `uns:${person.userId}`, kind: "unscheduled_on_shift", severity: "info", userId: person.userId, name: person.name, atMs: null });
      }
    }
  }
  const rank = (item: AttentionItem) => (item.severity === "warning" ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || (a.atMs ?? 0) - (b.atMs ?? 0) || compareNames(a.name, b.name) || a.id.localeCompare(b.id));
}
