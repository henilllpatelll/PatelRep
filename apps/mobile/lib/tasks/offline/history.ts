import type { Task } from "@/lib/api/tasks";
import { dayBucket, type DayBucket } from "@/lib/tasks/taskDisplay";

/* Completed Tasks history: pure ordering / grouping. Rows come only from the server's completion
   records (GET /tasks/mine/completed, the signed-in employee's own, hotel-scoped); nothing here counts or
   invents a completion, and a row without a server completion time is not shown (it has no place in time). */

function completedMs(task: Task): number {
  const ms = task.completed_at ? new Date(task.completed_at).getTime() : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
}

/** Newest completion first; equal instants fall back to id (descending) — the server's keyset order. */
export function sortHistory(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const delta = completedMs(b) - completedMs(a);
    if (delta !== 0) return delta > 0 ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Add a page to what is already shown: no duplicates (the newest copy wins), one deterministic order. */
export function mergeHistory(existing: readonly Task[], incoming: readonly Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of existing) byId.set(task.id, task);
  for (const task of incoming) byId.set(task.id, task);
  return sortHistory([...byId.values()]).filter((task) => task.status === "completed" && !!task.completed_at);
}

export interface HistorySection {
  /** Stable key: "today", "yesterday" or the hotel-local YYYY-MM-DD. */
  key: DayBucket;
  data: Task[];
}

/** Group a sorted history into hotel-local days (the hotel's own midnight, not the phone's). */
export function groupHistory(tasks: readonly Task[], now: Date, zone: string | null): HistorySection[] {
  const sections: HistorySection[] = [];
  for (const task of sortHistory(tasks)) {
    if (!task.completed_at) continue;
    const bucket = dayBucket(task.completed_at, now, zone);
    if (!bucket) continue;
    const last = sections[sections.length - 1];
    if (last && last.key === bucket) last.data.push(task);
    else sections.push({ key: bucket, data: [task] });
  }
  return sections;
}
