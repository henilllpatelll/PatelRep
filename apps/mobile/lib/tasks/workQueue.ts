import { fetchCompletedPage, type Task } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";

/* ─── My Work classification ────────────────────────────────────────────────
   Membership comes from the server (GET /tasks/mine). This file only decides how
   the already-authorised tasks are laid out, with a total order that mirrors the
   server's sort so merged/updated lists never reshuffle differently from a fresh load. */

const UP_NEXT_WINDOW_MS = 4 * 60 * 60 * 1000;
const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, normal: 1, low: 2 };
const NO_TIME = Number.MAX_SAFE_INTEGER;

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function isOverdue(task: Task, now: Date): boolean {
  const due = time(task.due_at);
  return due !== null && due < now.getTime();
}

/** Minutes past due, or null when the task is not overdue / has no due time. */
export function overdueMinutes(task: Task, now: Date): number | null {
  const due = time(task.due_at);
  if (due === null || due >= now.getTime()) return null;
  return Math.max(1, Math.round((now.getTime() - due) / 60000));
}

/** Whole minutes since the task was started (server `started_at`), or null. */
export function minutesSince(value: string | null, now: Date): number | null {
  const at = time(value);
  if (at === null) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 60000));
}

function sortKey(task: Task, now: Date): [number, number, number, number, string] {
  const bucket = isOverdue(task, now) ? 0 : task.status === "in_progress" || task.status === "escalated" ? 1 : 2;
  return [
    bucket,
    PRIORITY_RANK[task.priority] ?? 1,
    time(task.due_at) ?? NO_TIME,
    time(task.created_at) ?? 0,
    task.id,
  ];
}

/** Deterministic work order: overdue, then in-progress/escalated, then the rest; urgent first, earliest due first. */
export function sortWork(tasks: Task[], now: Date): Task[] {
  const keyed = tasks.map((task) => ({ task, key: sortKey(task, now) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < 4; i += 1) {
      const delta = (a.key[i] as number) - (b.key[i] as number);
      if (delta !== 0) return delta;
    }
    return a.key[4] < b.key[4] ? -1 : a.key[4] > b.key[4] ? 1 : 0;
  });
  return keyed.map((entry) => entry.task);
}

export interface WorkBuckets {
  /** Tasks with an active reported problem, in work order. Unfinished work: shown once, here, never also below. */
  needsAttention: Task[];
  /** Highest-priority task not yet started; excluded from the lists below. */
  nextUp: Task | null;
  /** Everything started, longest-running first. */
  inProgress: Task[];
  /** Overdue, urgent or due within four hours. */
  upNext: Task[];
  /** The rest: later-due or unscheduled lower-priority work. */
  later: Task[];
  /** Assigned and not yet started (includes Next Up and any blocked, unstarted task). */
  remaining: number;
  /** Everything with status in_progress, blocked or not — what the "In progress" summary counts. */
  started: number;
}

export function buildWorkBuckets(tasks: Task[], now: Date): WorkBuckets {
  const active = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  const sorted = sortWork(active, now);

  // A blocked task keeps its status (and so its counts) but is listed once, in Needs attention.
  const needsAttention = sorted.filter((task) => task.blocker !== null);
  const listed = sorted.filter((task) => task.blocker === null);

  const inProgress = listed
    .filter((task) => task.status === "in_progress")
    .sort((a, b) => (time(a.started_at) ?? NO_TIME) - (time(b.started_at) ?? NO_TIME) || (a.id < b.id ? -1 : 1));
  const actionable = listed.filter((task) => task.status === "open" || task.status === "escalated");

  const [nextUp = null, ...rest] = actionable;
  const upNext: Task[] = [];
  const later: Task[] = [];
  for (const task of rest) {
    const due = time(task.due_at);
    const soon = isOverdue(task, now) || task.priority === "urgent" || (due !== null && due - now.getTime() <= UP_NEXT_WINDOW_MS);
    (soon ? upNext : later).push(task);
  }
  const blockedNotStarted = needsAttention.filter((task) => task.status !== "in_progress").length;
  const started = sorted.filter((task) => task.status === "in_progress").length;
  return { needsAttention, nextUp, inProgress, upNext, later, remaining: actionable.length + blockedNotStarted, started };
}

export interface DoneToday {
  count: number;
  /** More pages were not read; the true count may be higher. */
  atLeast: boolean;
}

const DONE_PAGE_LIMIT = 100;
const DONE_MAX_PAGES = 3;

/** Tasks I completed today (hotel calendar day), read from the server's completion history. */
export async function fetchDoneToday(zone: string | null | undefined, now: Date = new Date()): Promise<DoneToday> {
  const today = hotelDateKey(now, zone);
  let cursor: string | null = null;
  let count = 0;
  for (let page = 0; page < DONE_MAX_PAGES; page += 1) {
    const result = await fetchCompletedPage(cursor, DONE_PAGE_LIMIT);
    let reachedEarlier = false;
    for (const task of result.tasks) {
      const day = hotelDateKey(task.completed_at, zone);
      if (day === today) count += 1;
      else if (day !== null && today !== null && day < today) reachedEarlier = true;
    }
    if (reachedEarlier || !result.hasMore || !result.nextCursor) return { count, atLeast: false };
    cursor = result.nextCursor;
  }
  return { count, atLeast: true };
}
