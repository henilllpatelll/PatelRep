import { useCallback, useRef, useState } from "react";
import { createTask, type Task } from "@/lib/api/tasks";
import type { CreateTaskInput } from "@/lib/tasks/addTask/draft";

/* ─── Create Task request ───────────────────────────────────────────────────
   Success is reported only from the server's stored row. A failure is classified by what the person
   can do next, and — because it decides whether the idempotency key may be reused — by whether the
   server could possibly have created the task:

     rejected     the server answered 4xx: nothing was created. Fix the details; a NEW key is used.
     forbidden    403: this role may not do that. Nothing was created.
     unconfirmed  no answer (timeout/network) or a 5xx: the task MAY exist. Retry with the SAME key —
                  the server returns the existing task instead of making a second one.
     signedOut    the session ended (401 / expired token): the server refused before creating anything.
                  Sign in again; the same key is safe to reuse.
     offline      not sent at all. */

export type SubmitOutcome =
  | { kind: "created"; task: Task; replayed: boolean }
  | { kind: "rejected"; status: number; message: string | null }
  | { kind: "forbidden" }
  | { kind: "signedOut" }
  | { kind: "unconfirmed" }
  | { kind: "offline" };

const SIGNED_OUT_RE = /not authenticated|session expired/i;

export function classifyCreateError(error: unknown): Exclude<SubmitOutcome, { kind: "created" } | { kind: "offline" }> {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") {
    return error instanceof Error && SIGNED_OUT_RE.test(error.message) ? { kind: "signedOut" } : { kind: "unconfirmed" };
  }
  if (status === 401) return { kind: "signedOut" };
  if (status === 403) return { kind: "forbidden" };
  if (status >= 500 || status === 408) return { kind: "unconfirmed" };
  const message = error instanceof Error && error.message ? error.message : null;
  return { kind: "rejected", status, message };
}

export type TaskDestination = "mine" | "pool" | "team";

/**
 * Where a just-created task shows up for the person who made it, judged from the stored row (not from
 * what was asked for): assigned to me -> My Work; an open, unassigned housekeeping task a housekeeper
 * can claim -> Available; anything else was sent to the team and is in none of my lists.
 */
export function taskDestination(task: Task, viewer: { id: string | null; role: string | null }): TaskDestination {
  if (viewer.id && task.assigned_to === viewer.id) return "mine";
  if (!task.assigned_to && task.status === "open" && task.task_type === "housekeeping" && viewer.role === "housekeeper") {
    return "pool";
  }
  return "team";
}

export async function submitCreateTask(input: CreateTaskInput, isOnline: boolean): Promise<SubmitOutcome> {
  if (!isOnline) return { kind: "offline" };
  try {
    const result = await createTask(input);
    return { kind: "created", task: result.task, replayed: result.replayed };
  } catch (error) {
    return classifyCreateError(error);
  }
}

/** One submit at a time: a second tap while the first is in flight does nothing. */
export function useCreateTask() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const submit = useCallback(async (input: CreateTaskInput, isOnline: boolean): Promise<SubmitOutcome | null> => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    try {
      return await submitCreateTask(input, isOnline);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, submit };
}
