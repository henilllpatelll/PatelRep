import type { TeamSchedule } from "@/lib/api/schedulingTeam";

/* ─── Technician presence ───────────────────────────────────────────────────
   What today's PUBLISHED schedule says about one technician right now. This is the plan, not attendance and not capacity:
   it never says a person is free, busy or available, because nothing here knows what they are doing. A person the schedule
   does not cover, or a schedule that could not be read in full, gives no answer at all (null), which the screen shows as
   nothing, never as "not scheduled". Draft shifts are proposals and are ignored. */

export type Presence =
  | { kind: "on_shift"; endsAt: string }
  | { kind: "later"; startsAt: string }
  | { kind: "ended" }
  | { kind: "none" };

function ms(instant: string): number {
  return Date.parse(instant);
}

/** Null = unknown. See the file comment for exactly when. */
export function presenceFor(schedule: TeamSchedule | null | undefined, userId: string, nowMs: number): Presence | null {
  if (!schedule || !schedule.complete || schedule.unreadableShifts > 0) return null;
  if (!schedule.people.some((person) => person.userId === userId)) return null;

  const mine = schedule.shifts.filter((shift) => shift.userId === userId && shift.publication === "published");
  const running = mine.filter((shift) => ms(shift.startsAt) <= nowMs && nowMs < ms(shift.endsAt));
  if (running.length > 0) {
    const endsAt = running.reduce((latest, shift) => (ms(shift.endsAt) > ms(latest) ? shift.endsAt : latest), running[0].endsAt);
    return { kind: "on_shift", endsAt };
  }
  const upcoming = mine.filter((shift) => ms(shift.startsAt) > nowMs).sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  if (upcoming.length > 0) return { kind: "later", startsAt: upcoming[0].startsAt };
  // A shift carried over from yesterday that has already finished is not "today's shift ended".
  if (mine.some((shift) => !shift.carriedFromPreviousDay && ms(shift.endsAt) <= nowMs)) return { kind: "ended" };
  return { kind: "none" };
}
