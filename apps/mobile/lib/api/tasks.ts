import { api } from "@/lib/api/client";

/* ─── Tasks API contract (mobile) ───────────────────────────────────────────
   One place that knows the backend shapes:
     GET  /tasks/mine           My Work     (assigned to me, active)
     GET  /tasks/available      Available   (open, unassigned housekeeping pool; housekeeper only)
     GET  /tasks/mine/completed History     (my completed tasks, newest first)
     GET  /tasks/{id}/activity  Detail      (authoritative task + persisted activity feed)
     POST /tasks/{id}/start | /claim | /complete   (complete accepts an optional { note })
     POST /tasks/{id}/blockers  body { reason, details?, client_request_id }   "Unable to Complete?"
     POST /tasks/{id}/resume    body { blocker_id }                           assignee clears their own blocker
     POST /tasks/{id}/comments  body { comment }
     POST /tasks                Add Task (client_request_id = idempotency key; reply meta.replayed)
     GET  /rooms/directory      Room picker (id, number, floor only)
     POST /ai/tasks/confirm     body is a JSON ARRAY of previews (legacy Copilot composer)
   Membership, ordering and authorization are decided by the server; the client only
   normalises rows into `Task` and follows cursors until nothing is left. */

export type TaskStatus = "open" | "in_progress" | "escalated" | "completed" | "cancelled";
export type TaskPriority = "urgent" | "normal" | "low";
export type TaskType = "housekeeping" | "engineering" | "guest_request" | "lost_found" | "general";

/** Reserved for the offline phase: a mutation that has been queued but not yet confirmed. */
export type TaskSyncState = "synced" | "pending" | "failed";

/** Why a task could not be finished. Stable backend values; the app shows localized labels. */
export const BLOCKER_REASONS = [
  "guest_unavailable",
  "do_not_disturb",
  "missing_supplies",
  "access_issue",
  "assistance_needed",
  "equipment_issue",
  "other",
] as const;
export type BlockerReason = (typeof BLOCKER_REASONS)[number];

/** What the supervisor alert actually did. "queued" means notification rows were written, never more. */
export type BlockerNotificationStatus = "pending" | "queued" | "failed" | "not_available";

/** A reported problem on a task. A task is "blocked" while it has one active; its status never changes. */
export interface TaskBlocker {
  id: string;
  reason: BlockerReason;
  details: string | null;
  reported_by: string | null;
  reported_by_name: string | null;
  reported_at: string | null;
  status: "active" | "resolved";
  notification_status: BlockerNotificationStatus;
}

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
  /** Floor of the linked room, when known. */
  room_floor: number | null;
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
  /** The task's active "Unable to Complete" report, or null. Derived from stored blocker rows. */
  blocker: TaskBlocker | null;
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

const NOTIFICATION_STATUSES: readonly BlockerNotificationStatus[] = ["pending", "queued", "failed", "not_available"];

export function normalizeBlocker(raw: unknown): TaskBlocker | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as RawRecord;
  const id = str(record.id);
  if (!id || !BLOCKER_REASONS.includes(record.reason as BlockerReason)) return null;
  return {
    id,
    reason: record.reason as BlockerReason,
    details: str(record.details),
    reported_by: str(record.reported_by),
    reported_by_name: str(record.reported_by_name),
    reported_at: str(record.reported_at),
    status: record.status === "resolved" ? "resolved" : "active",
    notification_status: NOTIFICATION_STATUSES.includes(record.notification_status as BlockerNotificationStatus)
      ? (record.notification_status as BlockerNotificationStatus)
      : "pending",
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
    room_floor: typeof rooms?.floor === "number" ? rooms.floor : null,
    location_text: str(raw.location_text),
    due_at: str(raw.due_at),
    created_at: str(raw.created_at),
    started_at: str(raw.started_at),
    completed_at: str(raw.completed_at),
    is_ai_created: raw.is_ai_created === true,
    guest_request: guest && str(guest.id) ? { id: String(guest.id), status: str(guest.status) } : null,
    blocker: ((blocker) => (blocker && blocker.status === "active" ? blocker : null))(normalizeBlocker(raw.blocker)),
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
  /** Completion only: whether the optional completion note was stored (null = no note sent / not reported). */
  noteSaved: boolean | null;
}

async function mutate(path: string, body: unknown): Promise<TaskMutationResult> {
  const res = await api.post<{ data: RawRecord; meta?: { replayed?: boolean; note_saved?: boolean } }>(path, body);
  if (!res?.data) throw new Error("Unexpected empty response from the task service");
  return {
    task: normalizeTask(res.data),
    replayed: res.meta?.replayed === true,
    noteSaved: typeof res.meta?.note_saved === "boolean" ? res.meta.note_saved : null,
  };
}

/** One persisted thing that happened to a task. Everything here comes from stored rows. */
export type TaskActivityKind =
  | "created"
  | "claimed"
  | "started"
  | "completed"
  | "cancelled"
  | "comment"
  | "system_note"
  | "blocker_reported"
  | "blocker_resolved";
/** How a blocker was closed. */
export type BlockerResolution = "resumed" | "resolved" | "completed" | "reassigned";

export interface TaskActivityEvent {
  id: string;
  kind: TaskActivityKind;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  /** Comment text, blocker details (blocker_reported) or a supervisor's note (blocker_resolved). */
  text: string | null;
  /** blocker_reported only. */
  reason: BlockerReason | null;
  /** blocker_resolved only. */
  resolution: BlockerResolution | null;
}

const ACTIVITY_KINDS: readonly TaskActivityKind[] = [
  "created",
  "claimed",
  "started",
  "completed",
  "cancelled",
  "comment",
  "system_note",
  "blocker_reported",
  "blocker_resolved",
];
const RESOLUTIONS: readonly BlockerResolution[] = ["resumed", "resolved", "completed", "reassigned"];

export interface TaskActivity {
  task: Task;
  events: TaskActivityEvent[];
  /** Older comments exist that were not returned. */
  truncated: boolean;
}

/** The task as it is right now, plus its activity feed (oldest first). */
export async function fetchTaskActivity(taskId: string): Promise<TaskActivity> {
  const res = await api.get<{ data?: { task?: RawRecord; events?: RawRecord[] }; meta?: { truncated?: boolean } }>(
    `/tasks/${taskId}/activity`,
  );
  if (!res?.data?.task) throw new Error("Unexpected empty response from the task service");
  const events: TaskActivityEvent[] = (res.data.events ?? [])
    .filter((e) => ACTIVITY_KINDS.includes(e.kind as TaskActivityKind) && typeof e.at === "string")
    .map((e) => ({
      id: String(e.id ?? ""),
      kind: e.kind as TaskActivityKind,
      at: e.at as string,
      actor_id: str(e.actor_id),
      actor_name: str(e.actor_name),
      text: str(e.text),
      reason: BLOCKER_REASONS.includes(e.reason as BlockerReason) ? (e.reason as BlockerReason) : null,
      resolution: RESOLUTIONS.includes(e.resolution as BlockerResolution) ? (e.resolution as BlockerResolution) : null,
    }));
  return { task: normalizeTask(res.data.task), events, truncated: res.meta?.truncated === true };
}

/** Start a task already assigned to me. Throws ApiError on 403/404/409 — never resolves on failure. */
export const startTask = (taskId: string) => mutate(`/tasks/${taskId}/start`, {});

/** Self-assign and start an open, unassigned housekeeping task. 409 = someone else got it first. */
export const claimTask = (taskId: string) => mutate(`/tasks/${taskId}/claim`, {});

/** Complete a task. The completion time is set by the server. Throws ApiError on any failure. */
export const completeTask = (taskId: string, note?: string) =>
  mutate(`/tasks/${taskId}/complete`, note && note.trim() ? { note: note.trim() } : {});

export interface BlockerMutationResult {
  task: Task;
  blocker: TaskBlocker | null;
  /** The server already had this report / the blocker was already closed; nothing was written again. */
  replayed: boolean;
}

async function mutateBlocker(path: string, body: unknown): Promise<BlockerMutationResult> {
  const res = await api.post<{ data?: { task?: RawRecord; blocker?: RawRecord | null }; meta?: { replayed?: boolean } }>(path, body);
  if (!res?.data?.task) throw new Error("Unexpected empty response from the task service");
  return { task: normalizeTask(res.data.task), blocker: normalizeBlocker(res.data.blocker), replayed: res.meta?.replayed === true };
}

/** The most the API accepts in a blocker's additional details. */
export const BLOCKER_DETAILS_MAX = 1000;

export interface BlockerReport {
  reason: BlockerReason;
  details?: string;
  /** Idempotency key: a retry of the same submission returns the report the first attempt stored. */
  clientRequestId: string;
}

/**
 * Report why a task assigned to me can not be finished. The task itself is not changed (it stays
 * assigned and unfinished). Resolves only with the server's stored report; throws ApiError otherwise
 * (`code`: blocker_already_active, task_closed, not_assignee, task_changed).
 */
export const reportBlocker = (taskId: string, report: BlockerReport) =>
  mutateBlocker(`/tasks/${taskId}/blockers`, {
    reason: report.reason,
    ...(report.details && report.details.trim() ? { details: report.details.trim() } : {}),
    client_request_id: report.clientRequestId,
  });

/** Clear my own blocker and carry on. `blockerId` pins the report I was looking at (stale screens get blocker_changed). */
export const resumeTask = (taskId: string, blockerId: string) => mutateBlocker(`/tasks/${taskId}/resume`, { blocker_id: blockerId });

/** Supervisor view: one unresolved "Unable to Complete" report, with the task it is on. */
export interface BlockedTaskItem {
  blocker: TaskBlocker;
  task: {
    id: string;
    title: string;
    task_type: TaskType;
    priority: TaskPriority;
    assigned_to_name: string | null;
    room_number: string | null;
    location_text: string | null;
  };
}

/** Manager roles only (403 otherwise). Unresolved blockers of my hotel, longest-waiting first. */
export async function fetchBlockedTasks(): Promise<{ items: BlockedTaskItem[]; hasMore: boolean }> {
  const res = await api.get<{ data?: Array<{ blocker?: RawRecord; task?: RawRecord }>; meta?: { has_more?: boolean } }>("/tasks/blocked");
  const items: BlockedTaskItem[] = [];
  for (const row of res?.data ?? []) {
    const blocker = normalizeBlocker(row.blocker);
    const task = row.task;
    const id = str(task?.id);
    if (!blocker || !task || !id) continue;
    items.push({
      blocker,
      task: {
        id,
        title: str(task.title) ?? "",
        task_type: TYPES.includes(task.task_type as TaskType) ? (task.task_type as TaskType) : "general",
        priority: task.priority === "urgent" || task.priority === "low" ? task.priority : "normal",
        assigned_to_name: str(task.assigned_to_name),
        room_number: str(task.room_number),
        location_text: str(task.location_text),
      },
    });
  }
  return { items, hasMore: res?.meta?.has_more === true };
}

/** A manager closes a blocker (problem fixed or dismissed). The task keeps its owner and status; replay-safe. */
export const resolveBlocker = (taskId: string, blockerId: string, note?: string) =>
  mutateBlocker(`/tasks/${taskId}/blockers/${blockerId}/resolve`, note && note.trim() ? { note: note.trim() } : {});

/** Post a note. The text goes in the JSON body (not the URL); the server trims and validates it. */
export async function addTaskComment(taskId: string, comment: string): Promise<TaskComment> {
  const res = await api.post<{ data?: RawRecord | null }>(`/tasks/${taskId}/comments`, { comment: comment.trim() });
  if (!res?.data) throw new Error("Unexpected empty response from the task service");
  return normalizeComment(res.data);
}

/** Longest note / completion note the API accepts. */
export const TASK_NOTE_MAX = 2000;

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

/** The fields the Add Task flow sends to POST /tasks (built and validated in lib/tasks/addTask/draft.ts). */
export interface CreateTaskBody {
  title: string;
  description?: string;
  task_type: TaskType;
  priority: TaskPriority;
  room_id?: string;
  location_text?: string;
  due_at?: string;
  assigned_to?: string;
  /** Idempotency key: a repeat of the same key returns the task the first attempt created. */
  client_request_id: string;
  ai_suggested?: boolean;
}

export interface CreateTaskResult {
  task: Task;
  /** The server already had a task for this key; nothing new was written. */
  replayed: boolean;
}

/** Create one task. Resolves only with the server's stored row; throws (ApiError or network Error) otherwise. */
export async function createTask(body: CreateTaskBody): Promise<CreateTaskResult> {
  const res = await api.post<{ data?: RawRecord | null; meta?: { replayed?: boolean } }>("/tasks", body);
  if (!res?.data) throw new Error("Unexpected empty response from the task service");
  return { task: normalizeTask(res.data), replayed: res.meta?.replayed === true };
}

export interface RoomOption {
  id: string;
  room_number: string;
  floor: number | null;
  building: string | null;
}

/** Every room of the signed-in hotel (id, number, floor, building) — nothing about guests or status. */
export async function fetchRoomDirectory(): Promise<RoomOption[]> {
  const res = await api.get<{ data?: RawRecord[] }>("/rooms/directory");
  return (Array.isArray(res?.data) ? res.data : [])
    .map((row) => ({
      id: String(row.id ?? ""),
      room_number: String(row.room_number ?? ""),
      floor: typeof row.floor === "number" ? row.floor : null,
      building: str(row.building),
    }))
    .filter((room) => room.id && room.room_number);
}
