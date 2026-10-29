import type { DayRule, DayState, RequestItem, ReasonCategory, Window } from "@/lib/api/schedulingRequests";
import { addDaysToYmd, clockMinutes, formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";

/* ─── Availability, time off and swaps — pure rules for the Phase 5 screens ─────
   Nothing here talks to the server or decides a policy. It mirrors the server's validation closely enough to give a person
   an answer before they send (the server still re-checks everything), and turns server facts into words. */

export const STEP_MINUTES = 15;
export const MAX_WINDOWS = 4;
export const DEFAULT_WINDOW: Window = { start: "07:00", end: "15:00" };
export const ALL_DAY: Window = { start: "00:00", end: "00:00" };
export const MAX_LEAVE_DAYS = 60;

/* ─── Clock times ─────────────────────────────────────────────────────────── */

/** "7:00" / "07:00:00" → "07:00" (a value that is not a time comes back unchanged). */
export function normalizeClock(value: string): string {
  const minutes = clockMinutes(value);
  return minutes === null ? value : fromMinutes(minutes);
}

export function fromMinutes(total: number): string {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Move a clock time by whole 15-minute steps, wrapping around midnight. */
export function stepClock(clock: string, steps: number): string {
  const minutes = clockMinutes(clock) ?? 0;
  return fromMinutes(minutes + steps * STEP_MINUTES);
}

function localeFor(language?: string): string {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

/** "7:00 AM" for a wall-clock time. Formatted at a fixed UTC date so the phone's own zone can never shift it. */
export function clockLabel(clock: string | null | undefined, language?: string): string {
  const minutes = clockMinutes(clock ?? undefined);
  if (minutes === null) return "—";
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)).toLocaleTimeString(localeFor(language), { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

export const isAllDay = (w: Window): boolean => w.start === w.end;
export const endsNextDay = (w: Window): boolean => (clockMinutes(w.end) ?? 0) < (clockMinutes(w.start) ?? 0);

/** "7:00 AM – 3:00 PM", "All day", or "10:00 PM – 6:00 AM (next day)". */
export function windowLabel(w: Window, language: string | undefined, t: Translate): string {
  if (isAllDay(w)) return t("teamSchedule.availability.allDay");
  return t(endsNextDay(w) ? "teamSchedule.availability.windowNextDay" : "teamSchedule.availability.window", { start: clockLabel(w.start, language), end: clockLabel(w.end, language) });
}

export const windowsLabel = (windows: readonly Window[], language: string | undefined, t: Translate): string => windows.map((w) => windowLabel(w, language, t)).join(", ");

/* ─── The availability editor ─────────────────────────────────────────────── */

export interface DayDraft {
  weekday: number;
  state: DayState;
  windows: Window[];
}

export function draftFromWeek(rules: readonly DayRule[]): DayDraft[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const rule = rules.find((r) => r.weekday === weekday);
    return { weekday, state: rule?.state ?? "unset", windows: rule && rule.state === "available" ? rule.windows.map((w) => ({ ...w })) : [] };
  });
}

export function sameDrafts(a: readonly DayDraft[], b: readonly DayDraft[]): boolean {
  return a.length === b.length && a.every((day, i) => {
    const other = b[i];
    return day.weekday === other.weekday && day.state === other.state && day.windows.length === other.windows.length
      && day.windows.every((w, j) => w.start === other.windows[j].start && w.end === other.windows[j].end);
  });
}

/** Switch a day's state: available starts with the usual hours so nobody has to type them. */
export function withState(day: DayDraft, state: DayState): DayDraft {
  if (state === "available") return { ...day, state, windows: day.windows.length > 0 ? day.windows : [{ ...DEFAULT_WINDOW }] };
  return { ...day, state, windows: [] };
}

export function withWindow(day: DayDraft, index: number, patch: Partial<Window>): DayDraft {
  return { ...day, windows: day.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)) };
}

/** A new one-hour window starts an hour after the last one ends, so the editor never begins with an overlap. No room left = unchanged. */
export function addWindow(day: DayDraft): DayDraft {
  if (day.windows.length >= MAX_WINDOWS) return day;
  const last = day.windows[day.windows.length - 1];
  if (last && (isAllDay(last) || endsNextDay(last))) return day;
  const start = last ? stepClock(last.end, 4) : "17:00";
  const startMinutes = clockMinutes(start) ?? 0;
  if (last && startMinutes <= (clockMinutes(last.end) ?? 0)) return day;      // wrapped past midnight
  if (startMinutes >= 23 * 60) return day;
  return { ...day, state: "available", windows: [...day.windows, { start, end: stepClock(start, 4) }] };
}

export function removeWindow(day: DayDraft, index: number): DayDraft {
  const windows = day.windows.filter((_, i) => i !== index);
  return windows.length === 0 ? { ...day, state: "unset", windows: [] } : { ...day, windows };
}

function span(w: Window): [number, number] {
  const start = clockMinutes(w.start) ?? 0;
  let end = clockMinutes(w.end) ?? 0;
  if (end <= start) end += 1440; // overnight, or start === end (a full day)
  return [start, end];
}

export type DayError = "windows_required" | "windows_overlap" | "too_many_windows" | "same_times";

/** Mirrors the server's window_error (plus the editor-only rule that equal times must be "All day", i.e. 00:00–00:00). */
export function dayError(day: DayDraft): DayError | null {
  if (day.state !== "available") return null;
  if (day.windows.length === 0) return "windows_required";
  if (day.windows.length > MAX_WINDOWS) return "too_many_windows";
  if (day.windows.some((w) => w.start === w.end && w.start !== "00:00")) return "same_times";
  const spans = day.windows.map(span).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i += 1) if (spans[i][0] < spans[i - 1][1]) return "windows_overlap";
  return null;
}

export function firstDayError(days: readonly DayDraft[]): { weekday: number; error: DayError } | null {
  for (const day of days) {
    const error = dayError(day);
    if (error) return { weekday: day.weekday, error };
  }
  return null;
}

/** What gets sent: unset days are left out, which the server records as "nothing submitted". */
export function weekPayload(days: readonly DayDraft[]): Array<{ weekday: number; mode: "available" | "unavailable"; windows: Window[] }> {
  return days.flatMap((day) => (day.state === "unset" ? [] : [{ weekday: day.weekday, mode: day.state, windows: day.state === "available" ? day.windows : [] }]));
}

export const dayName = (weekday: number, t: Translate, form: "long" | "short" = "long"): string => t(`teamSchedule.availability.day.${form}.${weekday}`);

/** A compact line for one day: "Mon 7:00 AM – 3:00 PM", "Wed Unavailable", "Sat Not submitted". */
export function dayLine(rule: DayRule, language: string | undefined, t: Translate): string {
  const state = rule.state === "available" ? windowsLabel(rule.windows, language, t) : t(`teamSchedule.availability.state.${rule.state}`);
  return `${dayName(rule.weekday, t, "short")} ${state}`;
}

/** "Available: Mon Tue Fri · Unavailable: Wed · Not submitted: Sat Sun" — the week at a glance, hours are in the detail. */
export function weekSummary(rules: readonly DayRule[], t: Translate): string {
  const groups: Record<DayState, string[]> = { available: [], unavailable: [], unset: [] };
  for (const rule of rules) groups[rule.state].push(dayName(rule.weekday, t, "short"));
  return (["available", "unavailable", "unset"] as const)
    .filter((state) => groups[state].length > 0)
    .map((state) => `${t(`teamSchedule.availability.state.${state}`)}: ${groups[state].join(" ")}`)
    .join(" · ");
}

export function hasAnyHours(rules: readonly DayRule[]): boolean {
  return rules.some((r) => r.state !== "unset");
}

/* ─── The time-off form ───────────────────────────────────────────────────── */

export interface LeaveDraft {
  startDate: string;
  endDate: string;
  partial: boolean;
  startTime: string;
  endTime: string;
  reason: ReasonCategory | null;
  note: string;
}

export function emptyLeaveDraft(today: string): LeaveDraft {
  return { startDate: today, endDate: today, partial: false, startTime: "09:00", endTime: "13:00", reason: null, note: "" };
}

export type LeaveError =
  | "end_before_start" | "dates_in_past" | "range_too_long" | "partial_must_be_one_day" | "invalid_partial_times" | "reason_required";

export function daysBetween(startDate: string, endDate: string): number {
  const a = Date.UTC(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, Number(startDate.slice(8, 10)));
  const b = Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(5, 7)) - 1, Number(endDate.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

/** The same checks the server makes, in the same order, so the common mistakes are caught before sending. */
export function leaveError(draft: LeaveDraft, today: string): LeaveError | null {
  if (draft.endDate < draft.startDate) return "end_before_start";
  if (draft.endDate < today) return "dates_in_past";
  if (daysBetween(draft.startDate, draft.endDate) > MAX_LEAVE_DAYS) return "range_too_long";
  if (draft.partial) {
    if (draft.startDate !== draft.endDate) return "partial_must_be_one_day";
    if (clockMinutes(draft.startTime) === null || clockMinutes(draft.endTime) === null || draft.startTime === draft.endTime) return "invalid_partial_times";
  }
  if (!draft.reason) return "reason_required";
  return null;
}

/** Keep the end date from falling behind the start date, and a partial day on a single date. */
export function withStartDate(draft: LeaveDraft, startDate: string): LeaveDraft {
  const endDate = draft.partial || draft.endDate < startDate ? startDate : draft.endDate;
  return { ...draft, startDate, endDate };
}

export function withPartial(draft: LeaveDraft, partial: boolean): LeaveDraft {
  return { ...draft, partial, endDate: partial ? draft.startDate : draft.endDate };
}

export function shiftDate(ymd: string, days: number): string {
  return addDaysToYmd(ymd, days);
}

/** "Mon, Nov 2" or "Nov 2 – Nov 6". */
export function dateRangeLabel(from: string | null, to: string | null, language?: string): string {
  if (!from) return "—";
  if (!to || to === from) return formatShortDate(from, language);
  return `${formatShortDate(from, language)} – ${formatShortDate(to, language)}`;
}

/* ─── Words for requests ───────────────────────────────────────────────────── */

export function statusText(status: string, t: Translate): string {
  return t(`teamSchedule.requests.status.${status}`, { defaultValue: t("teamSchedule.requests.status.pending") });
}

export function reasonText(reason: string, t: Translate): string {
  return t(`teamSchedule.requests.reason.${reason}`, { defaultValue: t("teamSchedule.requests.reason.other") });
}

export function findingText(code: string, t: Translate): string {
  return t(`teamSchedule.requests.finding.${code}`, { defaultValue: t("teamSchedule.requests.finding.other") });
}

export function failureKeyText(key: string, t: Translate): string {
  return t(`teamSchedule.requests.failure.${key}`, { defaultValue: t("teamSchedule.requests.failure.other") });
}

/** Findings the supervisor must tick "I have reviewed" for; mirrors the server's ACK list for swaps. */
export const SWAP_ACK_WARNINGS: readonly string[] = ["insufficient_rest", "weekly_overtime", "long_shift", "marked_unavailable", "outside_availability", "pending_time_off"];

export type MyRequestsFilter = "all" | "action" | "pending" | "approved" | "denied" | "cancelled";
export const MY_REQUEST_FILTERS: readonly MyRequestsFilter[] = ["all", "action", "pending", "approved", "denied", "cancelled"];

export function filterMine(items: readonly RequestItem[], filter: MyRequestsFilter): RequestItem[] {
  if (filter === "all") return [...items];
  if (filter === "action") return items.filter((item) => item.needsMyResponse);
  return items.filter((item) => item.statusGroup === filter);
}

export type TeamFilter = "pending" | "approved" | "denied" | "all";
export const TEAM_FILTERS: readonly TeamFilter[] = ["pending", "approved", "denied", "all"];
