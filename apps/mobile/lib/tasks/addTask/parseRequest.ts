import { api } from "@/lib/api/client";
import {
  ADD_TASK_LIMITS,
  ADD_TASK_TYPES,
  dueFromIso,
  emptyDraft,
  type AddTaskType,
  type TaskDraft,
} from "@/lib/tasks/addTask/draft";

/* ─── Describe -> suggested details ─────────────────────────────────────────
   Wraps the existing AI copilot task extraction (POST /ai/copilot/chat, intent task_creation). The
   server has already verified the room against this hotel and validated the due time in the hotel's
   zone; this adapter additionally refuses to trust the shape of the reply: every field is checked
   against the values this app can actually save, and anything else is left for the person to fill in.
   It never creates anything — it only returns a draft to review. */

export type ParseFailure = "offline" | "timeout" | "rate_limited" | "unavailable" | "invalid" | "network";

export type ParseResult =
  | { status: "ok"; draft: TaskDraft }
  /** The AI understood the message but found no task in it. */
  | { status: "none"; message: string }
  | { status: "failed"; reason: ParseFailure };

type RawTask = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Why a request failed, from the error alone (the API client throws ApiError for HTTP errors, plain Error otherwise). */
export function classifyParseError(error: unknown): ParseFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    if (status === 429) return "rate_limited";
    if (status === 408 || status === 504) return "timeout";
    return "unavailable"; // 402 (no credits), 5xx (provider down), anything else the server refused
  }
  const message = error instanceof Error ? error.message : "";
  if (/timed out/i.test(message)) return "timeout";
  return "network";
}

/**
 * Turn one raw task from the AI into a draft, or null if it is unusable (no title).
 * `now` and `zone` place a due time on today / tomorrow in the hotel's calendar.
 */
export function draftFromAiTask(
  raw: RawTask,
  base: TaskDraft,
  zone: string | null | undefined,
  now: Date,
): TaskDraft | null {
  const title = text(raw.title);
  if (!title) return null;

  const rawType = String(raw.task_type ?? "").toLowerCase();
  const type: AddTaskType | null = (ADD_TASK_TYPES as readonly string[]).includes(rawType)
    ? (rawType as AddTaskType)
    : null;

  const rawPriority = String(raw.priority ?? "normal").toLowerCase();
  const urgent = rawPriority === "urgent" || rawPriority === "high" || rawPriority === "critical";
  const priority = urgent ? "urgent" : rawPriority === "low" ? "low" : "normal";

  // A room is "verified" only when the server linked it (room_id). A number without an id is
  // shown as unverified so the person corrects it; it is never sent as a room.
  const roomId = text(raw.room_id);
  const roomNumber = text(raw.room_number_display) ?? text(raw.room_number);
  const location: TaskDraft["location"] =
    roomId && roomNumber
      ? { kind: "room", roomId, roomNumber }
      : roomNumber
        ? { kind: "unverified", text: roomNumber }
        : { kind: "none" };

  let due: TaskDraft["due"] = { mode: "none" };
  if (raw.due_unresolved === true) due = { mode: "unresolved" };
  else if (text(raw.due_at)) due = dueFromIso(String(raw.due_at), zone, now);

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 1;

  return {
    ...base,
    title: title.slice(0, ADD_TASK_LIMITS.title),
    description: (text(raw.description) ?? "").slice(0, ADD_TASK_LIMITS.description),
    type,
    priority,
    priorityConfirmed: priority !== "urgent",
    location,
    due,
    aiSuggested: true,
    lowConfidence: confidence < 0.7,
  };
}

interface Envelope {
  data?: { response_type?: string; message?: string; tasks?: unknown };
}

/** Ask the AI to suggest task details for `description`. Never throws. */
export async function parseTaskRequest(
  description: string,
  options: { isOnline: boolean; zone: string | null | undefined; role: string | null; now?: Date },
): Promise<ParseResult> {
  if (!options.isOnline) return { status: "failed", reason: "offline" };
  const now = options.now ?? new Date();

  let response: Envelope;
  try {
    response = await api.post<Envelope>("/ai/copilot/chat", {
      message: description,
      context: { source: "mobile_tasks", intent_hint: "task_creation" },
    });
  } catch (error) {
    return { status: "failed", reason: classifyParseError(error) };
  }

  const data = response?.data;
  if (!data || typeof data !== "object") return { status: "failed", reason: "invalid" };
  if (data.response_type !== "task_preview") {
    return { status: "none", message: text(data.message) ?? "" };
  }
  if (!Array.isArray(data.tasks)) return { status: "failed", reason: "invalid" };

  const base: TaskDraft = { ...emptyDraft(options.role), requestText: description };
  const drafts = (data.tasks as unknown[])
    .filter((raw): raw is RawTask => !!raw && typeof raw === "object")
    .map((raw) => draftFromAiTask(raw, base, options.zone, now))
    .filter((draft): draft is TaskDraft => draft !== null);

  if (drafts.length === 0) {
    // Tasks came back but none were usable: that is a malformed reply, not "no task found".
    return (data.tasks as unknown[]).length > 0
      ? { status: "failed", reason: "invalid" }
      : { status: "none", message: text(data.message) ?? "" };
  }
  return { status: "ok", draft: { ...drafts[0], extraTasks: drafts.length - 1 } };
}
