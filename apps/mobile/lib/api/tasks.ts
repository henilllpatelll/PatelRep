import { api } from "@/lib/api/client";

/* ─── Tasks API contract (mobile) ───────────────────────────────────────────
   One place that knows the backend shapes:
     GET  /tasks/mine           My Work     (assigned to me, active)
     GET  /tasks/available      Available   (open, unassigned housekeeping pool; housekeeper only)
     GET  /tasks/mine/completed History     (my completed tasks, newest first)
     GET  /tasks/{id}           Detail      (with comments)
     POST /tasks/{id}/start | /claim | /complete
     POST /tasks/{id}/comments
     POST /ai/tasks/confirm     body is a JSON ARRAY of previews
   Membership, ordering and authorization are decided by the server; the client only
   normalises rows into `Task` and follows cursors until nothing is left. */

export type TaskStatus = "open" | "in_progress" | "escalated" | "completed" | "cancelled";
export type TaskPriority = "urgent" | "normal" | "low";
export type TaskType = "housekeeping" | "engineering" | "guest_request" | "lost_found" | "general";

/** Reserved for the offline phase: a mutation that has been queued but not yet confirmed. */
export type TaskSyncState = "synced" | "pending" | "failed";

export interface TaskComment {
  id: string;
  comment: string;
  user_id: string | null;
  author_name: string | null;
  is_system: boolean;
  created_at: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  task_type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  /** Set only when the task is linked to a real room row of this hotel. */
  room_id: string | null;
  /** Verified room number from the linked room row — never derived from free text. */
  room_number: string | null;
  /** Free-text, non-room location ("Pool deck"). Not a verified room. */
  location_text: string | null;
  due_at: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** True only when the server recorded the task as AI-created. */
  is_ai_created: boolean;
  /** Minimal link to a guest request (id + status only); null when none. */
  guest_request: { id: string; status: string | null } | null;
  /** Present on detail reads only. */
  comments?: TaskComment[];
  sync_state?: TaskSyncState;
}

/** A reviewed AI draft, exactly the fields POST /ai/tasks/confirm accepts. */
export interface TaskPreview {
  title: string;
  description?: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  /** Verified room id, when the parser resolved one. */
  room_id?: string | null;
  /** What the person said/typed; the server re-verifies it before linking a room. */
  room_number_display?: string | null;
  due_at?: string | null;
  assigned_to?: string | null;
}

type RawRecord = Record<string, unknown>;

const STATUSES: readonly TaskStatus[] = ["open", "in_progress", "escalated", "completed", "cancelled"];
const TYPES: readonly TaskType[] = ["housekeeping", "engineering", "guest_request", "lost_found", "general"];

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function displayName(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const record = profile as RawRecord;
  return str(record.preferred_name) ?? str(record.full_name);
}

function normalizePriority(value: unknown): TaskPriority {
  const lowered = typeof value === "string" ? value.toLowerCase() : "";
  if (lowered === "urgent" || lowered === "high" || lowered === "critical") return "urgent";
  if (lowered === "low") return "low";
  return "normal";
}

function normalizeComment(raw: RawRecord): TaskComment {
  return {
    id: String(raw.id ?? ""),
    comment: String(raw.comment ?? ""),
    user_id: str(raw.user_id),
    author_name: displayName(raw.user_profiles),
    is_system: raw.is_system === true,
    created_at: str(raw.created_at),
  };
}

/** Backend task row (with its `rooms`, profile and comment joins) -> client `Task`. */
export function normalizeTask(raw: RawRecord): Task {
  const rooms = raw.rooms && typeof raw.rooms === "object" ? (raw.rooms as RawRecord) : null;
  const status = STATUSES.includes(raw.status as TaskStatus) ? (raw.status as TaskStatus) : "open";
  const type = TYPES.includes(raw.task_type as TaskType) ? (raw.task_type as TaskType) : "general";
  const guest = raw.guest_request && typeof raw.guest_request === "object" ? (raw.guest_request as RawRecord) : null;

  const task: Task = {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    description: str(raw.description),
    task_type: type,
    status,
    priority: normalizePriority(raw.priority),
    assigned_to: str(raw.assigned_to),
    assigned_to_name: displayName(raw.user_profiles),
    created_by: str(raw.created_by),
    created_by_name: displayName(raw.creator_profile),
    room_id: str(raw.room_id),
    room_number: str(rooms?.room_number) ?? str(raw.room_number),
    location_text: str(raw.location_text),
    due_at: str(raw.due_at),
    created_at: str(raw.created_at),
    started_at: str(raw.started_at),
    completed_at: str(raw.completed_at),
    is_ai_created: raw.is_ai_created === true,
    guest_request: guest && str(guest.id) ? { id: String(guest.id), status: str(guest.status) } : null,
  };
  if (Array.isArray(raw.task_comments)) {
    task.comments = (raw.task_comments as RawRecord[])
      .map(normalizeComment)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }
  return task;
}

interface ListEnvelope {
  data?: RawRecord[];
  meta?: { has_more?: boolean; next_cursor?: string | null; truncated?: boolean };
}

export interface TaskPage {
  tasks: Task[];
  hasMore: boolean;
  nextCursor: string | null;
  /** The server hit its scan cap: the list may be incomplete. Always surface this. */
  truncated: boolean;
}

function toPage(envelope: ListEnvelope): TaskPage {
  const rows = Array.isArray(envelope?.data) ? envelope.data : [];
  return {
    tasks: rows.map(normalizeTask),
    hasMore: envelope?.meta?.has_more === true,
    nextCursor: envelope?.meta?.next_cursor ?? null,
    truncated: envelope?.meta?.truncated === true,
  };
}

function pagedPath(base: string, limit: number, cursor?: string | null): string {
  const query = [`limit=${limit}`];
  if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
  return `${base}?${query.join("&")}`;
}

const ACTIVE_PAGE_LIMIT = 200;
/** Safety stop for cursor loops (200 x 25 = 5,000 tasks); reaching it is reported as truncated. */
const MAX_ACTIVE_PAGES = 25;

async function fetchEvery(base: string): Promise<{ tasks: Task[]; truncated: boolean }> {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let truncated = false;
  for (let pageNumber = 0; pageNumber < MAX_ACTIVE_PAGES; pageNumber += 1) {
    const page: TaskPage = toPage(await api.get<ListEnvelope>(pagedPath(base, ACTIVE_PAGE_LIMIT, cursor)));
    for (const task of page.tasks) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        tasks.push(task);
      }
    }
    truncated = truncated || page.truncated;
    if (!page.hasMore || !page.nextCursor) return { tasks, truncated };
    cursor = page.nextCursor;
  }
  return { tasks, truncated: true };
}

/** My Work: every active task assigned to me, in the server's order. */
export function fetchMyWork() {
  return fetchEvery("/tasks/mine");
}

/** Available: the open, unassigned housekeeping pool. Housekeeper role only. */
export function fetchAvailable() {
  return fetchEvery("/tasks/available");
}

/** One page of my completion history (newest first). */
export async function fetchCompletedPage(cursor?: string | null, limit = 30): Promise<TaskPage> {
  return toPage(await api.get<ListEnvelope>(pagedPath("/tasks/mine/completed", limit, cursor)));
}

export interface WorkQueue {
  tasks: Task[];
  truncated: boolean;
}

/** My Work, plus the Available pool for housekeepers; a task never appears twice. */
export async function loadWorkQueue(options: { includeAvailable: boolean }): Promise<WorkQueue> {
  const [mine, pool] = await Promise.all([
    fetchMyWork(),
    options.includeAvailable ? fetchAvailable() : Promise.resolve({ tasks: [] as Task[], truncated: false }),
  ]);
  const seen = new Set(mine.tasks.map((task) => task.id));
  return {
    tasks: [...mine.tasks, ...pool.tasks.filter((task) => !seen.has(task.id))],
    truncated: mine.truncated || pool.truncated,
  };
}

export async function fetchTask(taskId: string): Promise<Task> {
  const res = await api.get<{ data: RawRecord }>(`/tasks/${taskId}`);
  return normalizeTask(res.data);
}

export interface TaskMutationResult {
  task: Task;
  /** The server had already applied this transition; nothing was written again. */
  replayed: boolean;
}

async function mutate(path: string, body: unknown): Promise<TaskMutationResult> {
  const res = await api.post<{ data: RawRecord; meta?: { replayed?: boolean } }>(path, body);
  if (!res?.data) throw new Error("Unexpected empty response from the task service");
  return { task: normalizeTask(res.data), replayed: res.meta?.replayed === true };
}

/** Start a task already assigned to me. Throws ApiError on 403/404/409 — never resolves on failure. */
export const startTask = (taskId: string) => mutate(`/tasks/${taskId}/start`, {});

/** Self-assign and start an open, unassigned housekeeping task. 409 = someone else got it first. */
export const claimTask = (taskId: string) => mutate(`/tasks/${taskId}/claim`, {});

/** Complete a task. The completion time is set by the server. Throws ApiError on any failure. */
export const completeTask = (taskId: string, note?: string) =>
  mutate(`/tasks/${taskId}/complete`, note && note.trim() ? { note: note.trim() } : {});

export async function addTaskComment(taskId: string, comment: string): Promise<void> {
  await api.post(`/tasks/${taskId}/comments?comment=${encodeURIComponent(comment)}`, {});
}

export interface CreateTasksResult {
  tasks: Task[];
  createdCount: number;
  /** Previews the server recognised as repeats of a task I just created. */
  deduplicated: number;
}

const PREVIEW_KEYS: (keyof TaskPreview)[] = [
  "title",
  "description",
  "task_type",
  "priority",
  "room_id",
  "room_number_display",
  "due_at",
  "assigned_to",
];

/** Only the fields the confirm endpoint knows; nothing else from the AI payload is forwarded. */
export function toConfirmPayload(preview: TaskPreview): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of PREVIEW_KEYS) {
    const value = preview[key];
    if (value !== undefined && value !== null && value !== "") payload[key] = value;
  }
  return payload;
}

/** Create tasks from reviewed AI previews. The body is an array, as the endpoint requires. */
export async function createTasks(previews: TaskPreview[]): Promise<CreateTasksResult> {
  const res = await api.post<{
    data?: { created_count?: number; tasks?: RawRecord[] };
    meta?: { deduplicated?: number };
  }>("/ai/tasks/confirm", previews.map(toConfirmPayload));
  const rows = res?.data?.tasks ?? [];
  return {
    tasks: rows.map(normalizeTask),
    createdCount: res?.data?.created_count ?? rows.length,
    deduplicated: res?.meta?.deduplicated ?? 0,
  };
}
