import { addDaysToYmd, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";

/* ─── Supervisor Assignments — scheduled shifts ─────────────────────────────
   Pure. GET /schedules/assignments?work_date= lists who is SCHEDULED on a date, with the shift's
   hotel-local start/end clock times. Being scheduled is a plan, not attendance: it neither proves a person
   is working nor that they are absent. It is used for two things only — telling "scheduled but not clocked
   in" from "not clocked in", and bounding how much of a person's shift is left.

   KNOWN LIMIT: the schedule is requested for ONE hotel date. A shift scheduled for the previous date that
   runs past midnight is not in today's answer, so its remaining time is reported as unknown rather than
   guessed (`shiftTimeFor` returns null when the person has no shift on the requested date). */

export interface ScheduledShift {
  userId: string;
  name: string | null;
  /** Hotel-local clock time, "HH:MM" or "HH:MM:SS"; null when the schedule row carries none. */
  startTime: string | null;
  endTime: string | null;
}

export interface ScheduleRowRaw {
  user_id?: string | null;
  work_date?: string | null;
  shifts?: { name?: string | null; start_time?: string | null; end_time?: string | null } | null;
}

/**
 * GET /schedules/assignments rows → shifts. Strict: anything other than `{ data: [...] }` throws so the
 * caller reports "schedule unavailable", never an empty schedule. Rows without a user id are dropped; a row
 * for a different date than requested is ignored (the endpoint filters, but a stale cache must not leak in).
 */
export function normalizeScheduledShifts(payload: unknown, forDate: string): ScheduledShift[] {
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) throw new Error("Malformed schedule response");
  const shifts: ScheduledShift[] = [];
  for (const row of data as ScheduleRowRaw[]) {
    const userId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
    if (!userId) continue;
    if (typeof row.work_date === "string" && row.work_date.slice(0, 10) !== forDate) continue;
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
    shifts.push({
      userId,
      name: text(row.shifts?.name),
      startTime: text(row.shifts?.start_time),
      endTime: text(row.shifts?.end_time),
    });
  }
  return shifts;
}

export function scheduledUserIds(shifts: readonly ScheduledShift[]): Set<string> {
  return new Set(shifts.map((shift) => shift.userId));
}

/* ─── Shift time ──────────────────────────────────────────────────────────── */

export interface ShiftTime {
  phase: "before" | "during" | "after";
  /** Whole minutes of the shift still ahead (the full length before it starts, 0 after it ended). */
  minutesLeft: number;
  /** Epoch ms. */
  startsAt: number;
  endsAt: number;
}

function clockOf(text: string | null): { hour: number; minute: number } | null {
  const match = text ? /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function windowOf(shift: ScheduledShift, hotelDate: string, timeZone: string | null | undefined): { start: number; end: number } | null {
  const from = clockOf(shift.startTime);
  const to = clockOf(shift.endTime);
  if (!from || !to) return null;
  const start = zonedTimeToInstant(hotelDate, from.hour, from.minute, timeZone);
  // An end at or before the start is an overnight shift: it ends on the next calendar day.
  let end = zonedTimeToInstant(hotelDate, to.hour, to.minute, timeZone);
  if (!start || !end) return null;
  if (end.getTime() <= start.getTime()) end = zonedTimeToInstant(addDaysToYmd(hotelDate, 1), to.hour, to.minute, timeZone);
  return end ? { start: start.getTime(), end: end.getTime() } : null;
}

/**
 * Where `now` falls in a person's scheduled shift(s) for `hotelDate`, or null when they have no shift with
 * readable times (unknown — not "no time left"). With several shifts: the one in progress, else the next to
 * start, else the last to end.
 */
export function shiftTimeFor(
  shifts: readonly ScheduledShift[],
  options: { hotelDate: string; now: number; timeZone: string | null | undefined },
): ShiftTime | null {
  const windows = shifts
    .map((shift) => windowOf(shift, options.hotelDate, options.timeZone))
    .filter((window): window is { start: number; end: number } => window !== null)
    .sort((a, b) => a.start - b.start);
  if (windows.length === 0) return null;
  const { now } = options;
  const toMinutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));
  const current = windows.find((window) => window.start <= now && now < window.end);
  if (current) return { phase: "during", minutesLeft: toMinutes(current.end - now), startsAt: current.start, endsAt: current.end };
  const next = windows.find((window) => window.start > now);
  if (next) return { phase: "before", minutesLeft: toMinutes(next.end - next.start), startsAt: next.start, endsAt: next.end };
  const last = windows[windows.length - 1];
  return { phase: "after", minutesLeft: 0, startsAt: last.start, endsAt: last.end };
}
