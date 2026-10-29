import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { AttentionItem, DayShift, DisplayStatus, RosterPerson, ShiftGroup } from "@/lib/scheduling/teamScheduleModel";

/* ─── Team Schedule — words ─────────────────────────────────────────────────
   Pure: model values → translated text and the non-colour cue (icon) that goes with each status. Colour is only
   ever an extra; every status also has an icon and a word. */

export type Translate = (key: string, options?: Record<string, unknown>) => string;
type IconName = ComponentProps<typeof Ionicons>["name"];

export type StatusTone = "ready" | "pickup" | "clean" | "neutral";

export const STATUS_PRESENTATION: Record<DisplayStatus, { icon: IconName; tone: StatusTone }> = {
  on_shift: { icon: "radio-button-on", tone: "ready" },
  on_break: { icon: "cafe-outline", tone: "pickup" },
  scheduled: { icon: "time-outline", tone: "clean" },
  // A caution, never a verdict: "Not clocked in" is not "absent".
  not_clocked_in: { icon: "alert-circle-outline", tone: "pickup" },
  shift_ended: { icon: "checkmark-done-outline", tone: "neutral" },
  unknown: { icon: "help-circle-outline", tone: "neutral" },
};

export function statusLabel(status: DisplayStatus, t: Translate): string {
  return t(`teamSchedule.status.${status}`);
}

export function personName(person: Pick<RosterPerson, "name">, t: Translate): string {
  return person.name ?? t("teamSchedule.unnamed");
}

const KNOWN_ROLES: ReadonlySet<string> = new Set(["housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm"]);

/** A role id as a person would say it; an id this app has no word for is shown tidied, never dropped. */
export function roleLabel(role: string, t: Translate): string {
  if (KNOWN_ROLES.has(role)) return t(`teamSchedule.roles.${role}`);
  const words = role.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : t("teamSchedule.roles.other");
}

export function rolesLine(roles: readonly string[], t: Translate): string | null {
  return roles.length > 0 ? roles.map((role) => roleLabel(role, t)).join(" · ") : null;
}

/** "7:00 AM – 3:30 PM", or "11:00 PM – 7:00 AM (next day)" for an overnight shift. */
export function windowText(shift: Pick<DayShift, "startLabel" | "endLabel" | "endsNextDay">, t: Translate): string {
  return t(shift.endsNextDay ? "teamSchedule.windowNextDay" : "teamSchedule.window", { start: shift.startLabel, end: shift.endLabel });
}

export function groupWindowText(group: Pick<ShiftGroup, "startLabel" | "endLabel" | "endsNextDay">, t: Translate): string {
  return windowText(group, t);
}

export function periodLabel(period: DayShift["period"], t: Translate): string {
  return t(`teamSchedule.period.${period}`);
}

/** A shift's heading: its own name when it has one, otherwise the part of the day it starts in. */
export function groupTitle(group: Pick<ShiftGroup, "name" | "period">, t: Translate): string {
  return group.name ?? periodLabel(group.period, t);
}

/** The person's shifts on one line for a screen reader and a card: windows only, in start order. */
export function shiftsSummary(person: Pick<RosterPerson, "shifts">, t: Translate): string {
  return person.shifts.map((shift) => windowText(shift, t)).join(", ");
}

export function personA11y(person: RosterPerson, t: Translate): string {
  const parts = [personName(person, t), rolesLine(person.roles, t), person.scheduled ? shiftsSummary(person, t) : t("teamSchedule.notScheduled")];
  if (person.status) parts.push(statusLabel(person.status, t));
  return parts.filter(Boolean).join(". ");
}

/** "35 min ago" / "2 h 5 min ago": minutes are the unit that matters on a clock-in question. */
export function sinceText(fromMs: number, nowMs: number, t: Translate): string {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (minutes < 1) return t("teamSchedule.since.now");
  if (minutes < 60) return t("teamSchedule.since.minutes", { count: minutes });
  return t("teamSchedule.since.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function attentionTitle(item: AttentionItem, t: Translate): string {
  const name = item.name ?? t("teamSchedule.unnamed");
  switch (item.kind) {
    case "not_clocked_in":
      return t("teamSchedule.attention.notClockedIn.title", { name });
    case "ended_early":
      return t("teamSchedule.attention.endedEarly.title", { name });
    case "unscheduled_on_shift":
      return t("teamSchedule.attention.unscheduled.title", { name });
    case "attendance_unavailable":
      return t("teamSchedule.attention.attendanceUnavailable.title");
    case "stale_data":
      return t("teamSchedule.attention.stale.title");
    case "incomplete":
      return t("teamSchedule.attention.incomplete.title");
    case "unreadable":
      return t("teamSchedule.attention.unreadable.title", { count: item.count ?? 0 });
  }
}

export function attentionBody(item: AttentionItem, ctx: { nowMs: number; zone: string | null; language?: string }, t: Translate): string {
  const clock = item.atMs !== null ? formatHotelTime(new Date(item.atMs), ctx.zone, ctx.language) ?? "" : "";
  switch (item.kind) {
    case "not_clocked_in":
      return t("teamSchedule.attention.notClockedIn.body", { time: clock, since: item.atMs !== null ? sinceText(item.atMs, ctx.nowMs, t) : "" });
    case "ended_early":
      return t("teamSchedule.attention.endedEarly.body", { time: clock });
    case "unscheduled_on_shift":
      return t("teamSchedule.attention.unscheduled.body");
    case "attendance_unavailable":
      return t("teamSchedule.attention.attendanceUnavailable.body");
    case "stale_data":
      return t("teamSchedule.attention.stale.body", { time: clock });
    case "incomplete":
      return t("teamSchedule.attention.incomplete.body");
    case "unreadable":
      return t("teamSchedule.attention.unreadable.body");
  }
}
