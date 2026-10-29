import type { ImpactItem, NotificationStatus, ReviewIssue, ShiftFace } from "@/lib/api/schedulingRevisions";
import { formatHotelTime, hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { formatLongDate, formatShortDate, formatWallClock } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";

/* Words for the publish flow. Pure, so the wording rules are testable:
   - an issue is described by its CODE (translated); the server's English `detail` is only a last resort;
   - "queued", "in the app" and "accepted by the push provider" are three different sentences, and nothing here says "delivered". */

export function faceWindow(face: ShiftFace | null, zone: string | null, language?: string): string {
  if (!face) return "";
  const start = formatWallClock(face.workDate, face.startTime, `${face.workDate}T12:00:00Z`, zone, language);
  const end = formatWallClock(face.workDate, face.endTime, `${face.workDate}T12:00:00Z`, zone, language);
  return `${start} – ${end}`;
}

/** "Jan 8, 12:00 PM" in the HOTEL's calendar and clock, so a night-shift supervisor and the front desk read the same moment. */
export function stampText(iso: string | null | undefined, zone: string | null, language?: string): string {
  if (!iso) return "";
  const time = formatHotelTime(new Date(iso), zone, language) ?? "";
  const key = hotelDateKey(iso, zone);
  return key ? `${formatShortDate(key, language)}, ${time}` : time;
}

export function rangeText(range: { from: string; to: string } | null, language?: string): string {
  if (!range) return "";
  return range.from === range.to ? formatLongDate(range.from, language) : `${formatShortDate(range.from, language)} – ${formatShortDate(range.to, language)}`;
}

const KNOWN_ISSUES = new Set([
  "stale_shift", "overlapping_shift", "duplicate_assignment", "approved_time_off", "coverage_commitment", "has_attendance", "past_date",
  "department_mismatch", "invalid_time", "schedule_policy_blocked", "insufficient_rest", "weekly_overtime", "long_shift",
  "employee_department_unknown", "marked_unavailable", "outside_availability", "pending_time_off",
]);

export function issueText(issue: ReviewIssue, t: Translate): string {
  if (KNOWN_ISSUES.has(issue.code)) return t(`teamSchedule.publish.issue.${issue.code}`);
  return issue.detail ?? t("teamSchedule.publish.issue.other");
}

export function impactLine(item: ImpactItem, zone: string | null, language: string | undefined, t: Translate): string {
  const date = formatShortDate(item.workDate, language);
  const before = faceWindow(item.before, zone, language);
  const after = faceWindow(item.after, zone, language);
  switch (item.kind) {
    case "added":
      return t("teamSchedule.publish.impact.added", { date, window: after });
    case "removed":
      return t("teamSchedule.publish.impact.removed", { date, window: before });
    case "cancelled":
      return t("teamSchedule.publish.impact.cancelled", { date, window: before });
    default:
      return t("teamSchedule.publish.impact.changed", { date, before, after });
  }
}

/** One honest sentence for the state of the employee messages. */
export function notificationHeadline(status: NotificationStatus | null, failedToRead: boolean, t: Translate): string {
  if (!status) return t(failedToRead ? "teamSchedule.publish.notify.unknown" : "teamSchedule.publish.notify.checking");
  switch (status.state) {
    case "none":
      return t("teamSchedule.publish.notify.none");
    case "processing":
      return t("teamSchedule.publish.notify.processing", { count: status.queued || status.total });
    case "failed":
      return t("teamSchedule.publish.notify.failed", { count: status.failed });
    default:
      return t("teamSchedule.publish.notify.inApp", { count: status.inApp });
  }
}

/** Provider facts, kept apart from the headline: accepted by the push service is not delivery to a phone. */
export function pushLines(status: NotificationStatus | null, t: Translate): string[] {
  if (!status || status.total === 0) return [];
  const lines: string[] = [];
  if (status.pushAccepted > 0) lines.push(t("teamSchedule.publish.notify.pushAccepted", { count: status.pushAccepted }));
  if (status.pushFailed > 0) lines.push(t("teamSchedule.publish.notify.pushFailed", { count: status.pushFailed }));
  if (status.noDevice > 0) lines.push(t("teamSchedule.publish.notify.noDevice", { count: status.noDevice }));
  if (status.optedOut > 0) lines.push(t("teamSchedule.publish.notify.optedOut", { count: status.optedOut }));
  return lines;
}

export function eventLabel(event: string, t: Translate): string {
  const known = new Set([
    "draft_created", "draft_edited", "draft_discarded", "publication_attempted", "publication_succeeded", "publication_rejected",
    "notification_queued", "notification_sent", "notification_failed", "notification_retried", "corrective_published",
  ]);
  return known.has(event) ? t(`teamSchedule.publish.event.${event}`) : event;
}
