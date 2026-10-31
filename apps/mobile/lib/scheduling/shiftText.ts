import type { ScheduleWarning, WriteFailure } from "@/lib/api/schedulingManage";
import { isOvernight, wallMinutes, type Clock, type FormError } from "@/lib/scheduling/shiftForm";
import type { Translate } from "@/lib/scheduling/teamScheduleText";

/* Words for the shift-management flows: failures, warnings and form errors. Pure. Every server refusal has a
   plain-language sentence of its own; the server's raw message is shown only for a code this app has no word for. */

export function failureTitle(failure: WriteFailure, t: Translate): string {
  return t(`teamSchedule.manage.failure.${failure.kind}.title`);
}

export function failureBody(failure: WriteFailure, t: Translate): string {
  // An unmapped refusal says what the server said rather than nothing.
  if (failure.kind === "unknown" && failure.message) return failure.message;
  return t(`teamSchedule.manage.failure.${failure.kind}.body`);
}

const WARNING_CODES: ReadonlySet<string> = new Set(["insufficient_rest", "weekly_overtime", "long_shift", "past_date", "employee_department_unknown"]);

export function warningText(warning: ScheduleWarning, t: Translate): string {
  return WARNING_CODES.has(warning.code) ? t(`teamSchedule.manage.warning.${warning.code}`) : (warning.detail ?? t("teamSchedule.manage.warning.other"));
}

export function formErrorText(error: FormError, t: Translate): string {
  return t(`teamSchedule.manage.formError.${error}`);
}

/** "8 h" / "7 h 30 min": the wall-clock length of a shift. */
export function durationText(start: Clock, end: Clock, t: Translate): string {
  const minutes = wallMinutes(start, end);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("teamSchedule.manage.duration.hours", { hours }) : t("teamSchedule.manage.duration.hoursMinutes", { hours, minutes: rest });
}

export function overnightHint(start: Clock, end: Clock, t: Translate): string | null {
  return isOvernight(start, end) ? t("teamSchedule.manage.overnight") : null;
}
