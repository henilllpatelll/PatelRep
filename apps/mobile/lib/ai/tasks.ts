import { api } from "@/lib/api/client";

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  task_type?: string | null;
  status?: string | null;
  priority?: string | null;
  due_at?: string | null;
  room_id?: string | null;
  room_number?: string | null;
  rooms?: { room_number?: string | null } | null;
  location_text?: string | null;
  source?: string | null;
  ai_suggested?: boolean | null;
};

export type TaskBucket = "overdue" | "now" | "today";

export interface TaskQueueEntry {
  task: Task;
  position: number;
  bucket: TaskBucket;
  /** Minutes past due (positive) when overdue, otherwise null */
  overdueMinutes: number | null;
}

export type TaskPreview = {
  title: string;
  task_type: string;
  priority: string;
  room_number?: string;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

const DUE_SOON_MS = 2 * 60 * 60 * 1000;

export function getTaskRoomNumber(task: Task): string | null {
  return task.room_number ?? task.rooms?.room_number ?? task.location_text ?? null;
}

function parseDue(task: Task): Date | null {
  if (!task.due_at) return null;
  const date = new Date(task.due_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTaskBucket(task: Task, now: Date = new Date()): TaskBucket {
  const due = parseDue(task);
  if (due && due.getTime() < now.getTime()) return "overdue";
  if (task.priority === "urgent" || task.priority === "high") return "now";
  if (due && due.getTime() - now.getTime() <= DUE_SOON_MS) return "now";
  return "today";
}

function scoreTask(task: Task, now: Date): number {
  const due = parseDue(task);
  if (due && due.getTime() < now.getTime()) return 0;
  if (task.priority === "urgent") return 10;
  if (task.priority === "high") return 20;
  if (due && due.getTime() - now.getTime() <= DUE_SOON_MS) return 30;
  if (task.source === "guest" || task.task_type === "guest_request") return 40;
  if (task.priority === "low") return 60;
  return 50;
}

/** Open tasks in the order they should be worked, with buckets and positions. */
export function buildTaskQueue(tasks: Task[], now: Date = new Date()): TaskQueueEntry[] {
  const open = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");

  const ordered = [...open].sort((a, b) => {
    const scoreDelta = scoreTask(a, now) - scoreTask(b, now);
    if (scoreDelta !== 0) return scoreDelta;
    const dueDelta = (parseDue(a)?.getTime() ?? Infinity) - (parseDue(b)?.getTime() ?? Infinity);
    if (dueDelta !== 0) return dueDelta;
    return a.title.localeCompare(b.title);
  });

  return ordered.map((task, index) => {
    const due = parseDue(task);
    const overdueMinutes =
      due && due.getTime() < now.getTime() ? Math.max(1, Math.round((now.getTime() - due.getTime()) / 60000)) : null;
    return { task, position: index + 1, bucket: getTaskBucket(task, now), overdueMinutes };
  });
}

export interface TaskBriefing {
  headline: string;
  watchouts: string[];
}

/** On-device briefing for the task list — instant, free, offline-safe. */
export function buildTaskBriefing(queue: TaskQueueEntry[], t: Translate): TaskBriefing {
  if (queue.length === 0) {
    return { headline: t("tasks.brief.allClear"), watchouts: [] };
  }

  const overdue = queue.filter((entry) => entry.bucket === "overdue");
  const first = queue[0];

  let headline: string;
  if (overdue.length > 0) {
    headline = t("tasks.brief.overdue", { count: overdue.length, title: overdue[0].task.title });
  } else if (first.task.priority === "urgent" || first.task.priority === "high") {
    headline = t("tasks.brief.urgent", { title: first.task.title });
  } else {
    headline = t("tasks.brief.next", { title: first.task.title });
  }

  const watchouts: string[] = [];
  const guestCount = queue.filter(
    (entry) => entry.task.source === "guest" || entry.task.task_type === "guest_request",
  ).length;
  if (guestCount > 0) watchouts.push(t("tasks.brief.guestCount", { count: guestCount }));
  const roomCount = queue.filter((entry) => getTaskRoomNumber(entry.task)).length;
  if (roomCount > 0) watchouts.push(t("tasks.brief.roomCount", { count: roomCount }));

  return { headline, watchouts: watchouts.slice(0, 2) };
}

type CopilotTaskResponse = {
  message: string;
  intent?: string;
  task_preview?: TaskPreview;
};

/** Parse a plain-language task description through the AI copilot.
 *  Returns the preview to confirm, or a message when no task was detected.
 *  Throws on network/AI failure so the composer can show a clear error.
 *  Note: `context` must be a dict — the API reads intent_hint from it. */
export async function parseTaskWithAI(message: string): Promise<CopilotTaskResponse> {
  return api.post<CopilotTaskResponse>("/ai/copilot/chat", {
    message,
    context: { source: "mobile_tasks", intent_hint: "task_creation" },
  });
}

/** Create the task the AI proposed. */
export async function confirmAITask(preview: TaskPreview): Promise<void> {
  await api.post("/ai/tasks/confirm", { ...preview, use_ai: true });
}
