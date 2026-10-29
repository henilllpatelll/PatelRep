import type { ShiftDetail } from "@/lib/api/schedulingManage";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";

/* ─── Shift status timeline ─────────────────────────────────────────────────
   Pure. The events that actually happened, in order, from the server's verified hk_shift_sessions rows. Nothing is
   invented: no timestamp is guessed, a shift on the schedule is never "proof" of attendance, and a missing clock-in is
   reported as "no clock-in recorded", never as an absence. */

export type TimelineKind = "scheduled" | "started" | "break" | "ended";

export interface TimelineEvent {
  key: string;
  kind: TimelineKind;
  /** Hotel-local clock text, or null when the time is not known. */
  time: string | null;
  /** Minutes of break taken, for a "break" row. */
  breakMinutes?: number;
  /** The person is on a break right now (per the last verified read). */
  ongoing?: boolean;
}

export type AttendanceNote = "future" | "unverified" | "none" | "recorded";

export interface Timeline {
  /** Why there may be no attendance rows: the shift is in the future / could not be verified / nobody clocked in. */
  note: AttendanceNote;
  events: TimelineEvent[];
}

export function buildTimeline(detail: ShiftDetail, scheduledStartLabel: string, zone: string | null, language?: string): Timeline {
  const events: TimelineEvent[] = [{ key: "scheduled", kind: "scheduled", time: scheduledStartLabel }];
  const { applicable, verified, sessions } = detail.attendance;
  if (!applicable) return { note: "future", events };
  if (!verified) return { note: "unverified", events };
  if (sessions.length === 0) return { note: "none", events };
  sessions.forEach((session, index) => {
    events.push({ key: `start:${index}`, kind: "started", time: formatHotelTime(session.startedAt, zone, language) });
    const total = Math.round(session.breakSeconds / 60);
    if (session.status === "on_break") {
      events.push({ key: `break:${index}`, kind: "break", time: formatHotelTime(session.onBreakSince, zone, language), breakMinutes: total, ongoing: true });
    } else if (total > 0) {
      events.push({ key: `break:${index}`, kind: "break", time: null, breakMinutes: total });
    }
    if (session.status === "ended" && session.endedAt) {
      events.push({ key: `end:${index}`, kind: "ended", time: formatHotelTime(session.endedAt, zone, language) });
    }
  });
  return { note: "recorded", events };
}
