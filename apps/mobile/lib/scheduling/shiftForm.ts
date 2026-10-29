import type { ShiftInput, ShiftPatch, ShiftTemplate } from "@/lib/api/schedulingManage";
import type { TeamShift } from "@/lib/api/schedulingTeam";
import { parseClockText } from "@/lib/housekeeping/hotelTime";
import { addDaysToYmd, clockMinutes, isYmd, mondayIndex } from "@/lib/scheduling/teamScheduleDates";

/* ─── Add / Edit / Copy Shift — the form's rules ────────────────────────────
   Pure. Dates are hotel-local calendar labels ("YYYY-MM-DD") and times are hotel wall-clock text; the phone's own
   time zone is never consulted, and the server resolves them to instants (overnight, DST). Everything here is
   convenience and early feedback: the server re-validates every write and has the final word. */

export type FormMode = "add" | "edit" | "copy";

/** Same bound as the team schedule read (42 days) and the server's batch limit. */
export const RECURRENCE_MAX_DAYS = 42;
export const BATCH_MAX = 500;
export const NOTES_MAX = 500;

export interface ShiftDraft {
  userId: string | null;
  /** Narrows the employee and template lists; the employee's own department always wins. */
  departmentId: string | null;
  date: string;
  templateId: string | null;
  /** Use the typed times below instead of the template's, for this shift only. */
  customTimes: boolean;
  startText: string;
  endText: string;
  notes: string;
  recurring: boolean;
  /** 0 = Monday … 6 = Sunday. */
  weekdays: number[];
  /** Last day of a recurring series, inclusive. */
  endDate: string;
}

export function emptyDraft(date: string): ShiftDraft {
  return { userId: null, departmentId: null, date, templateId: null, customTimes: false, startText: "", endText: "", notes: "", recurring: false, weekdays: [], endDate: addDaysToYmd(date, 27) };
}

/* ─── Times ───────────────────────────────────────────────────────────────── */

export interface Clock {
  /** "HH:MM", what the server takes. */
  value: string;
  minutes: number;
}

export function toClock(hour: number, minute: number): Clock {
  return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, minutes: hour * 60 + minute };
}

/** "7:00 AM" / "13:30" / "7pm" → a clock, or null. */
export function parseTimeText(text: string): Clock | null {
  const parsed = parseClockText(text);
  return parsed ? toClock(parsed.hour, parsed.minute) : null;
}

export function templateClock(value: string | null | undefined): Clock | null {
  const minutes = clockMinutes(value);
  return minutes === null ? null : toClock(Math.floor(minutes / 60), minutes % 60);
}

/** An end at or before the start runs into the next calendar day, exactly as the server reads it. */
export function isOvernight(start: Clock, end: Clock): boolean {
  return end.minutes <= start.minutes;
}

/** Wall-clock length in minutes. A DST change makes the real length one hour different; the server's instants win. */
export function wallMinutes(start: Clock, end: Clock): number {
  return isOvernight(start, end) ? 24 * 60 - start.minutes + end.minutes : end.minutes - start.minutes;
}

/* ─── Recurrence ──────────────────────────────────────────────────────────── */

/** Every date from `start` to `end` (inclusive) that falls on one of `weekdays`. Empty for an unusable range. */
export function occurrenceDates(start: string, end: string, weekdays: readonly number[]): string[] {
  if (!isYmd(start) || !isYmd(end) || end < start || weekdays.length === 0) return [];
  const wanted = new Set(weekdays);
  const dates: string[] = [];
  for (let day = start, guard = 0; day <= end && guard <= RECURRENCE_MAX_DAYS; day = addDaysToYmd(day, 1), guard += 1) {
    if (wanted.has(mondayIndex(day))) dates.push(day);
  }
  return dates;
}

/** Days covered by the series, counted inclusively. */
export function recurrenceSpanDays(start: string, end: string): number {
  if (!isYmd(start) || !isYmd(end) || end < start) return 0;
  let days = 1;
  for (let day = start; day < end && days <= RECURRENCE_MAX_DAYS + 1; day = addDaysToYmd(day, 1)) days += 1;
  return days;
}

/* ─── Validation ──────────────────────────────────────────────────────────── */

export type FormError =
  | "employee"
  | "template"
  | "date"
  | "pastDate"
  | "startTime"
  | "endTime"
  | "sameTimes"
  | "weekdays"
  | "endDate"
  | "rangeTooLong"
  | "noOccurrences"
  | "tooMany"
  | "notesTooLong";

export interface FormContext {
  /** The hotel's current calendar day. */
  today: string;
  template: ShiftTemplate | null;
}

export interface ResolvedTimes {
  /** Sent to the server only when they differ from the template (a per-shift override). */
  override: { startTime: string; endTime: string } | null;
  start: Clock;
  end: Clock;
}

export function resolveTimes(draft: ShiftDraft, template: ShiftTemplate | null): { times: ResolvedTimes | null; errors: FormError[] } {
  if (draft.customTimes) {
    const start = parseTimeText(draft.startText);
    const end = parseTimeText(draft.endText);
    const errors: FormError[] = [];
    if (!start) errors.push("startTime");
    if (!end) errors.push("endTime");
    if (start && end && start.minutes === end.minutes) errors.push("sameTimes");
    return errors.length > 0 || !start || !end ? { times: null, errors } : { times: { override: { startTime: start.value, endTime: end.value }, start, end }, errors };
  }
  const start = templateClock(template?.startTime);
  const end = templateClock(template?.endTime);
  return start && end ? { times: { override: null, start, end }, errors: [] } : { times: null, errors: [] };
}

export function validateDraft(draft: ShiftDraft, ctx: FormContext, mode: FormMode): FormError[] {
  const errors: FormError[] = [];
  if (!draft.userId) errors.push("employee");
  if (!draft.templateId || !ctx.template) errors.push("template");
  if (!isYmd(draft.date)) errors.push("date");
  else if (draft.date < ctx.today) errors.push("pastDate"); // shifts are never created or moved into the past
  errors.push(...resolveTimes(draft, ctx.template).errors);
  if (draft.notes.length > NOTES_MAX) errors.push("notesTooLong");
  if (draft.recurring && mode !== "edit") {
    if (draft.weekdays.length === 0) errors.push("weekdays");
    if (!isYmd(draft.endDate) || draft.endDate < draft.date) errors.push("endDate");
    else if (recurrenceSpanDays(draft.date, draft.endDate) > RECURRENCE_MAX_DAYS) errors.push("rangeTooLong");
    else if (draft.weekdays.length > 0) {
      const count = occurrenceDates(draft.date, draft.endDate, draft.weekdays).length;
      if (count === 0) errors.push("noOccurrences");
      else if (count > BATCH_MAX) errors.push("tooMany");
    }
  }
  return errors;
}

/* ─── Requests ────────────────────────────────────────────────────────────── */

/** The shifts a draft would create: one for a single shift, one per matching date for a recurring series. */
export function buildInputs(draft: ShiftDraft, template: ShiftTemplate): ShiftInput[] {
  const { times } = resolveTimes(draft, template);
  const userId = draft.userId;
  if (!userId || !times) return [];
  const dates = draft.recurring ? occurrenceDates(draft.date, draft.endDate, draft.weekdays) : [draft.date];
  const notes = draft.notes.trim() || null;
  return dates.map((workDate) => ({ userId, shiftId: template.id, workDate, startTime: times.override?.startTime ?? null, endTime: times.override?.endTime ?? null, notes }));
}

/** Only what changed, so an edit never re-sends (and re-validates) what the person left alone. null = nothing changed. */
export function buildPatch(original: TeamShift, draft: ShiftDraft, template: ShiftTemplate): ShiftPatch | null {
  const { times } = resolveTimes(draft, template);
  if (!times || !draft.userId) return null;
  const patch: ShiftPatch = { expectedVersion: original.version };
  const startWas = templateClock(original.startTime)?.value;
  const endWas = templateClock(original.endTime)?.value;
  const wantStart = draft.customTimes ? times.start.value : templateClock(template.startTime)?.value;
  const wantEnd = draft.customTimes ? times.end.value : templateClock(template.endTime)?.value;
  const templateChanged = template.id !== original.shiftId;
  const notes = draft.notes.trim();
  if (draft.userId !== original.userId) patch.userId = draft.userId;
  if (draft.date !== original.workDate) patch.workDate = draft.date;
  if (templateChanged) patch.shiftId = template.id;
  // A changed template resets the times to that template's unless the person typed their own.
  if (wantStart && (wantStart !== startWas || templateChanged)) patch.startTime = wantStart;
  if (wantEnd && (wantEnd !== endWas || templateChanged)) patch.endTime = wantEnd;
  if (notes !== (original.notes ?? "")) patch.notes = notes;
  const changed = Object.keys(patch).length > 1;
  return changed ? patch : null;
}

/** Does `current` already show what an edit asked for? Used to tell "my save landed" from "someone else changed it". */
export function matchesIntent(current: TeamShift, patch: ShiftPatch): boolean {
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");
  return (
    (patch.userId === undefined || patch.userId === current.userId) &&
    (patch.workDate === undefined || patch.workDate === current.workDate) &&
    (patch.shiftId === undefined || patch.shiftId === current.shiftId) &&
    (patch.startTime === undefined || templateClock(current.startTime)?.value === patch.startTime) &&
    (patch.endTime === undefined || templateClock(current.endTime)?.value === patch.endTime) &&
    (patch.notes === undefined || same(current.notes, patch.notes))
  );
}

/** A field-by-field list of what differs between the shift the person was editing and the server's current one. */
export type ChangedField = "employee" | "date" | "template" | "startTime" | "endTime" | "notes";

export function diffShifts(mine: TeamShift, current: TeamShift): ChangedField[] {
  const changed: ChangedField[] = [];
  if (mine.userId !== current.userId) changed.push("employee");
  if (mine.workDate !== current.workDate) changed.push("date");
  if (mine.shiftId !== current.shiftId) changed.push("template");
  if (templateClock(mine.startTime)?.value !== templateClock(current.startTime)?.value) changed.push("startTime");
  if (templateClock(mine.endTime)?.value !== templateClock(current.endTime)?.value) changed.push("endTime");
  if ((mine.notes ?? "") !== (current.notes ?? "")) changed.push("notes");
  return changed;
}

/* ─── Drafts from an existing shift ───────────────────────────────────────── */

function clockText(value: string | null): string {
  return templateClock(value)?.value ?? "";
}

/** The shift's own times differ from its template's, so editing must keep them as a custom override. */
export function usesCustomTimes(shift: TeamShift, template: ShiftTemplate | null): boolean {
  if (!template) return true;
  return templateClock(shift.startTime)?.value !== templateClock(template.startTime)?.value || templateClock(shift.endTime)?.value !== templateClock(template.endTime)?.value;
}

export function draftFromShift(shift: TeamShift, template: ShiftTemplate | null, departmentId: string | null): ShiftDraft {
  const custom = usesCustomTimes(shift, template);
  return {
    ...emptyDraft(shift.workDate),
    userId: shift.userId,
    departmentId: shift.departmentId ?? departmentId,
    templateId: shift.shiftId,
    customTimes: custom,
    startText: custom ? clockText(shift.startTime) : "",
    endText: custom ? clockText(shift.endTime) : "",
    notes: shift.notes ?? "",
  };
}

/** Copy: everything but the date, which starts the day after and which the person is asked to confirm. */
export function draftForCopy(shift: TeamShift, template: ShiftTemplate | null, departmentId: string | null, today: string): ShiftDraft {
  const next = addDaysToYmd(shift.workDate, 1);
  return { ...draftFromShift(shift, template, departmentId), date: next < today ? today : next };
}

export function isDirty(draft: ShiftDraft, initial: ShiftDraft): boolean {
  return (Object.keys(draft) as (keyof ShiftDraft)[]).some((key) => JSON.stringify(draft[key]) !== JSON.stringify(initial[key]));
}
