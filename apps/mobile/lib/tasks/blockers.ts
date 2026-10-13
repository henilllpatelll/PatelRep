import { BLOCKER_DETAILS_MAX, type BlockerNotificationStatus, type BlockerReason, type Task } from "@/lib/api/tasks";
import { isActive, isMine, type Viewer } from "@/lib/tasks/taskActions";

/* ─── "Unable to Complete?" rules ────────────────────────────────────────────
   Display + validation only; the server re-checks every request. A task is blocked while it carries
   an active blocker — its status is never changed by a report, so it is never "completed" by one. */

export { BLOCKER_REASONS } from "@/lib/api/tasks";
export { BLOCKER_DETAILS_MAX };

export function isBlocked(task: Task): boolean {
  return task.blocker !== null && task.blocker.status === "active";
}

/** Assigned to me, still live, and not already reported. Pool tasks and finished work never qualify. */
export function canReportBlocker(task: Task, viewer: Viewer): boolean {
  return isMine(task, viewer) && isActive(task) && !isBlocked(task);
}

/** The assignee can clear their own report; anyone else just sees the state. */
export function canResume(task: Task, viewer: Viewer): boolean {
  return isMine(task, viewer) && isActive(task) && isBlocked(task);
}

export type BlockerProblem = "reasonRequired" | "detailsRequired" | "detailsTooLong";

/** What is wrong with the form, or null when it can be sent. "Other" must be explained; the rest may be bare. */
export function validateBlockerDraft(reason: BlockerReason | null, details: string): BlockerProblem | null {
  if (!reason) return "reasonRequired";
  const trimmed = details.trim();
  if (trimmed.length > BLOCKER_DETAILS_MAX) return "detailsTooLong";
  if (reason === "other" && trimmed.length === 0) return "detailsRequired";
  return null;
}

/** The i18n key that explains a supervisor alert, using only what the server confirmed. */
export function notificationKey(status: BlockerNotificationStatus): string {
  return `tasks.hk.blocker.notify.${status}`;
}
