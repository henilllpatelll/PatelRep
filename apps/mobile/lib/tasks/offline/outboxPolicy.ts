import type { Task, TaskStatus } from "@/lib/api/tasks";
import { conflictReason, isMine, type ConflictReason, type Viewer } from "@/lib/tasks/taskActions";

/* ─── Offline completion: what may be queued, and how a replay outcome is judged ─
   Pure rules, no I/O. The server stays the authority: nothing here grants anything, it only decides
   whether queuing is *worth offering* and how to react to the server's answer. */

/** Offline support matrix (see lib/tasks/offline/README in the PR description). Only "complete" is queueable. */
export const OFFLINE_MATRIX = {
  readMyWork: "cached",
  readTaskDetail: "cached",
  readCompletedHistory: "cached",
  complete: "queued",
  claim: "online-only",
  start: "online-only",
  create: "online-only",
  aiParse: "online-only",
  reportProblem: "online-only",
  postNote: "online-only",
} as const;

export type OutboxState = "pending" | "conflict" | "failed";
export type OutboxConflict = ConflictReason | "forbidden" | "rejected" | "expired";

export interface OutboxEntry {
  /** Local id of this mutation (one per task: a second completion for the same task is refused). */
  mutationId: string;
  op: "complete";
  taskId: string;
  userId: string;
  tenantId: string;
  /** Slim copy of the task at queue time, only so the pending item stays visible and readable. */
  task: Task;
  /** The optional completion note; sent WITH the completion so both land (or fail) together. */
  note: string | null;
  observedStatus: TaskStatus;
  observedAssignee: string | null;
  queuedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  state: OutboxState;
  conflict: { reason: OutboxConflict; at: string } | null;
}

export type QueueRefusal = "no_session" | "not_assigned" | "not_in_progress" | "blocked" | "duplicate" | "note_too_long" | "storage";

/** Everything that must hold before a completion may be saved for later. */
export function checkQueueable(
  task: Task | null,
  viewer: Viewer,
  existing: Readonly<Record<string, OutboxEntry>>,
  note: string,
  noteMax: number,
): QueueRefusal | null {
  if (!viewer.userId || !task) return "no_session";
  if (existing[task.id]) return "duplicate";
  if (!isMine(task, viewer)) return "not_assigned";
  if (task.status !== "in_progress") return "not_in_progress";
  if (task.blocker) return "blocked";
  if (note.trim().length > noteMax) return "note_too_long";
  return null;
}

export const MAX_TRANSIENT_ATTEMPTS = 8;
export const OUTBOX_MAX_ENTRIES = 25;
/** A queued item the server never accepted is surfaced for review after this long (never silently dropped). */
export const OUTBOX_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_CAP_MS = 15 * 60 * 1000;
const RATE_LIMIT_FLOOR_MS = 60_000;

/** Bounded exponential backoff: 15 s, 30 s, 1 m, 2 m ... capped at 15 m. `status` 429 never retries sooner than a minute. */
export function backoffMs(attempts: number, status: number | null = null): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_CAP_MS);
  return status === 429 ? Math.max(delay, RATE_LIMIT_FLOOR_MS) : delay;
}

export type Outcome =
  /** Nothing is known about the server's answer, or it was a temporary failure: keep the entry, retry later. */
  | { kind: "retry"; status: number | null }
  /** The session is not usable right now: keep the entry, do not count an attempt, wait for sign-in. */
  | { kind: "auth" }
  /** The server refused for a business reason: stop retrying and explain. */
  | { kind: "conflict"; status: number; errorCode: string | null };

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** Judge a failed completion request. A request that never got an HTTP answer is always "retry". */
export function classifyCompletionError(error: unknown): Outcome {
  const status = statusOf(error);
  if (status === null) {
    const message = error instanceof Error ? error.message : "";
    return /not authenticated|session expired/i.test(message) ? { kind: "auth" } : { kind: "retry", status: null };
  }
  if (status === 401) return { kind: "auth" };
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { kind: "retry", status };
  const code = (error as { code?: unknown } | null)?.code;
  return { kind: "conflict", status, errorCode: typeof code === "string" ? code : null };
}

/**
 * Why a queued completion was refused, from the task as the server reports it NOW.
 * `current` null = the task can no longer be read at all.
 */
export function replayConflict(status: number, errorCode: string | null, current: Task | null | undefined, viewer: Viewer): OutboxConflict {
  if (errorCode === "task_blocked") return "blocked";
  if (current === null) return "unavailable";
  if (current) {
    const reason = conflictReason("complete", current, viewer);
    if (reason !== "changed") return reason;
  }
  if (status === 403) return "forbidden";
  if (status === 409) return "changed";
  return "rejected";
}

/** Only a lost race ("changed") is worth an explicit, user-triggered retry; everything else is final. */
export function canRetryConflict(reason: OutboxConflict | undefined): boolean {
  return reason === "changed" || reason === undefined;
}

/** A task the server already shows as completed means the queued completion is confirmed (done on another path). */
export function isCompletedForMe(current: Task | null | undefined, viewer: Viewer): boolean {
  return !!current && current.status === "completed" && isMine(current, viewer);
}

export function newMutationId(now: number = Date.now()): string {
  return `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
