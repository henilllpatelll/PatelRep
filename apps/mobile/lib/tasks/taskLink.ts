/* Notification → Task Detail. A tapped notification only ever carries a task id; it grants nothing.
   The screen re-reads that task from the server as the signed-in person and opens it only if the server
   still shows it to them, so a stale tap, another hotel's id or another account's alert opens nothing. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Notification types that point at one task (the API writes these with `data.task_id`). */
export const TASK_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "task_assigned",
  "task_assigned_urgent",
  "task_reassigned",
  "task_cancelled",
  "task_blocker_resolved",
  "task_blocked",
]);

/** The task a notification points at, or null for anything that is not a well-formed task alert. */
export function taskIdFromNotification(data: unknown): string | null {
  const record = data as { type?: unknown; task_id?: unknown; taskId?: unknown } | null | undefined;
  if (!record || typeof record !== "object") return null;
  const id = record.task_id ?? record.taskId;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  // Push payloads carry `type`; stored notification rows are matched by their type column upstream.
  if (typeof record.type === "string" && !TASK_NOTIFICATION_TYPES.has(record.type)) return null;
  return id.toLowerCase();
}

export type LinkOutcome = "unavailable" | "retry";

/** A refusal (missing / forbidden / another hotel) is "unavailable" and never explains which; no answer or a
 *  temporary server problem is "retry". */
export function linkFailureOutcome(error: unknown): LinkOutcome {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return "retry";
  return status >= 500 || status === 408 || status === 429 ? "retry" : "unavailable";
}
