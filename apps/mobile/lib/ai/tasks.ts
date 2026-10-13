import { api } from "@/lib/api/client";
import { createTasks, type Task, type TaskPreview } from "@/lib/api/tasks";

export type { Task, TaskPreview } from "@/lib/api/tasks";
export { claimTask } from "@/lib/api/tasks";

export type TaskBucket = "overdue" | "now" | "today";

export interface TaskQueueEntry {
  task: Task;
  position: number;
  bucket: TaskBucket;
  /** Minutes past due (positive) when overdue, otherwise null */
  overdueMinutes: number | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const DUE_SOON_MS = 2 * 60 * 60 * 1000;

/** The verified room number only; free-text locations are never presented as rooms. */
export function getTaskRoomNumber(task: Task): string | null {
  return task.room_number;
}

/** A non-room place ("Pool deck"), shown only when the task has no verified room. */
export function getTaskLocationText(task: Task): string | null {
  return task.room_number ? null : task.location_text;
}

export function isGuestTask(task: Task): boolean {
  return task.task_type === "guest_request" || task.guest_request != null;
}

function parseDue(task: Task): Date | null {
  if (!task.due_at) return null;
  const date = new Date(task.due_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTaskBucket(task: Task, now: Date = new Date()): TaskBucket {
  const due = parseDue(task);
  if (due && due.getTime() < now.getTime()) return "overdue";
  if (task.priority === "urgent") return "now";
  if (due && due.getTime() - now.getTime() <= DUE_SOON_MS) return "now";
  return "today";
}

function scoreTask(task: Task, now: Date): number {
  const due = parseDue(task);
  if (due && due.getTime() < now.getTime()) return 0;
  if (task.priority === "urgent") return 10;
  if (due && due.getTime() - now.getTime() <= DUE_SOON_MS) return 30;
  if (isGuestTask(task)) return 40;
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
  } else if (first.task.priority === "urgent") {
    headline = t("tasks.brief.urgent", { title: first.task.title });
  } else {
    headline = t("tasks.brief.next", { title: first.task.title });
  }

  const watchouts: string[] = [];
  const guestCount = queue.filter((entry) => isGuestTask(entry.task)).length;
  if (guestCount > 0) watchouts.push(t("tasks.brief.guestCount", { count: guestCount }));
  const roomCount = queue.filter((entry) => getTaskRoomNumber(entry.task)).length;
  if (roomCount > 0) watchouts.push(t("tasks.brief.roomCount", { count: roomCount }));

  return { headline, watchouts: watchouts.slice(0, 2) };
}

type CopilotChatEnvelope = {
  data?: {
    response_type?: string;
    message?: string;
    tasks?: Array<Record<string, unknown>>;
  };
};

export type ParsedTasks = {
  message: string;
  /** Zero or more drafts for the person to review. Empty = no task was detected. */
  previews: TaskPreview[];
};

const PREVIEW_TYPES = ["housekeeping", "engineering", "guest_request", "general"] as const;

function toPreview(raw: Record<string, unknown>): TaskPreview | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const type = String(raw.task_type ?? "general").toLowerCase();
  const priority = String(raw.priority ?? "normal").toLowerCase();
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    title,
    description: text(raw.description),
    task_type: (PREVIEW_TYPES as readonly string[]).includes(type) ? (type as TaskPreview["task_type"]) : "general",
    priority: priority === "urgent" || priority === "high" ? "urgent" : priority === "low" ? "low" : "normal",
    room_id: text(raw.room_id),
    room_number_display: text(raw.room_number_display) ?? text(raw.room_number),
    due_at: text(raw.due_at),
    assigned_to: text(raw.assigned_to),
  };
}

/** Parse a plain-language task description through the AI copilot.
 *  The API answers `{ data: { message, tasks: [...] } }`; this returns the drafts to review,
 *  or an empty list (with the AI's message) when no task was detected.
 *  Throws on network/AI failure so the composer can show a clear error.
 *  Note: `context` must be a dict — the API reads intent_hint from it. */
export async function parseTaskWithAI(message: string): Promise<ParsedTasks> {
  const response = await api.post<CopilotChatEnvelope>("/ai/copilot/chat", {
    message,
    context: { source: "mobile_tasks", intent_hint: "task_creation" },
  });
  const data = response?.data;
  const previews = (data?.response_type === "task_preview" ? data.tasks ?? [] : [])
    .map(toPreview)
    .filter((preview): preview is TaskPreview => preview !== null);
  return { message: data?.message ?? "", previews };
}

/** Create the tasks the AI proposed (after the person reviewed them). */
export async function confirmAITasks(previews: TaskPreview[]) {
  return createTasks(previews);
}
