import type { Task } from "@/lib/api/tasks";

/* ─── What the signed-in employee may do with a task ─────────────────────────
   Display rules only. The server is the authority and re-checks every request; this decides
   which buttons are worth showing so a housekeeper is never offered a mutation that would be
   refused. Derived purely from the authoritative task row + who is looking. */

export type TaskAction = "start" | "complete" | "claim" | "resume";

export interface Viewer {
  userId: string | null;
  role: string | null;
}

const ACTIVE: ReadonlySet<Task["status"]> = new Set(["open", "in_progress", "escalated"]);

export function isActive(task: Task): boolean {
  return ACTIVE.has(task.status);
}

export function isMine(task: Task, viewer: Viewer): boolean {
  return !!viewer.userId && task.assigned_to === viewer.userId;
}

/** Open, unassigned housekeeping work a housekeeper may claim (mirrors GET /tasks/available + POST claim). */
export function isClaimable(task: Task, viewer: Viewer): boolean {
  return (
    viewer.role === "housekeeper" &&
    task.status === "open" &&
    task.assigned_to === null &&
    task.task_type === "housekeeping"
  );
}

/** The one primary action for this task right now, or null when it is read-only. */
export function primaryAction(task: Task, viewer: Viewer): TaskAction | null {
  if (isClaimable(task, viewer)) return "claim";
  if (!isMine(task, viewer)) return null;
  // A reported problem comes first: the work can not be started or finished until it is cleared.
  if (task.blocker && isActive(task)) return "resume";
  if (task.status === "in_progress") return "complete";
  if (task.status === "open" || task.status === "escalated") return "start";
  return null;
}

/** Notes can be added while the task is live and it is either mine or in the pool I can see. */
export function canAddNote(task: Task, viewer: Viewer): boolean {
  return isActive(task) && (isMine(task, viewer) || isClaimable(task, viewer));
}

export type ConflictReason = "completed" | "cancelled" | "reassigned" | "claimed" | "unavailable" | "blocked" | "changed";

/**
 * Why a request was refused, judged from the task as the server reports it AFTER the refusal.
 * `current` is null when the task can no longer be read (removed, or no longer visible to me).
 */
export function conflictReason(action: TaskAction, current: Task | null, viewer: Viewer): ConflictReason {
  if (!current) return "unavailable";
  if (current.status === "completed") return "completed";
  if (current.status === "cancelled") return "cancelled";
  if (current.assigned_to && !isMine(current, viewer)) return action === "claim" ? "claimed" : "reassigned";
  if (current.blocker && action !== "resume") return "blocked";
  return "changed";
}
