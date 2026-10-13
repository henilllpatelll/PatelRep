import type { TaskPriority } from "@/lib/api/tasks";
import {
  formatHotelTime,
  hotelDateKey,
  parseClockText,
  resolveTimeZone,
  zonedTimeToInstant,
} from "@/lib/housekeeping/hotelTime";

/* ─── Add Task: one draft, one validation, one payload ──────────────────────
   The typed-description path (AI suggestions) and the manual path both end in the same
   `TaskDraft`. Everything the person can change is a field here; `validateDraft` is the only place
   that decides whether it may be saved and `toCreateInput` the only place that builds the request,
   so the two paths can not drift apart. The server re-validates all of it. */

/** Task types a floor employee can file from the phone (a subset of the API's enum). */
export const ADD_TASK_TYPES = ["housekeeping", "engineering", "guest_request", "general"] as const;
export type AddTaskType = (typeof ADD_TASK_TYPES)[number];

/** Priorities in display order. */
export const ADD_TASK_PRIORITIES = ["normal", "urgent", "low"] as const;

/** Limits mirror the API models: title SHORT_TEXT_MAX, description/request LONG_TEXT_MAX, place MEDIUM_TEXT_MAX. */
export const ADD_TASK_LIMITS = { request: 2000, title: 120, description: 2000, place: 255 } as const;

export type LocationDraft =
  | { kind: "none" }
  /** A room of this hotel, chosen from (or confirmed against) the hotel's own room list. */
  | { kind: "room"; roomId: string; roomNumber: string }
  /** A general operational place ("Pool deck"); never treated as a room. */
  | { kind: "place"; text: string }
  /** A room number the AI heard that could not be matched to a real room. Must be corrected. */
  | { kind: "unverified"; text: string };

export type DueDraft =
  | { mode: "none" }
  /** The AI gave a date/time it could not resolve safely. Must be set or cleared. */
  | { mode: "unresolved" }
  /** `day`/`time` are what the person edits; `iso` is kept for dates beyond tomorrow ("other"). */
  | { mode: "set"; day: "today" | "tomorrow" | "other"; time: string; iso: string | null };

export interface TaskDraft {
  /** What was typed or dictated on the Describe step; kept so Back never loses it. */
  requestText: string;
  title: string;
  description: string;
  /** null = the AI named a category we do not offer; the person must choose. */
  type: AddTaskType | null;
  priority: TaskPriority;
  /** An AI-suggested urgent priority stays unconfirmed until the person touches the priority field. */
  priorityConfirmed: boolean;
  location: LocationDraft;
  due: DueDraft;
  assignToMe: boolean;
  /** AI suggested at least some of these details (recorded as is_ai_created). */
  aiSuggested: boolean;
  /** The parser was not confident; the review asks the person to double-check. */
  lowConfidence: boolean;
  /** More tasks were found in the description than the one being reviewed. */
  extraTasks: number;
  /** Idempotency key for the create request. */
  requestId: string;
}

export function newRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // Version-4 UUID without Web Crypto (older Hermes): the API only needs a well-formed, unique value.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** A blank draft with role-appropriate defaults (a housekeeper files housekeeping work for themselves). */
export function emptyDraft(role: string | null = null): TaskDraft {
  return {
    requestText: "",
    title: "",
    description: "",
    type: role === "engineer" || role === "chief_engineer" ? "engineering" : "housekeeping",
    priority: "normal",
    priorityConfirmed: true,
    location: { kind: "none" },
    due: { mode: "none" },
    assignToMe: true,
    aiSuggested: false,
    lowConfidence: false,
    extraTasks: 0,
    requestId: newRequestId(),
  };
}

/** True once the person has put anything in that would be lost by closing. */
export function hasMeaningfulContent(draft: TaskDraft): boolean {
  return (
    draft.requestText.trim().length > 0 ||
    draft.title.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.location.kind !== "none" ||
    draft.due.mode !== "none"
  );
}

/* ─── due time ──────────────────────────────────────────────────────────── */

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(moved.getUTCDate()).padStart(2, "0")}`;
}

/** Turn a due instant (from the AI) into what the due editor shows, in the hotel's zone. */
export function dueFromIso(iso: string, zone: string | null | undefined, now: Date): DueDraft {
  const key = hotelDateKey(iso, zone);
  const today = hotelDateKey(now, zone);
  const time = formatHotelTime(iso, zone, "en");
  if (!key || !today || !time) return { mode: "unresolved" };
  if (key === today) return { mode: "set", day: "today", time, iso };
  if (key === addDays(today, 1)) return { mode: "set", day: "tomorrow", time, iso };
  return { mode: "set", day: "other", time, iso };
}

export type DueFailure = "unresolved" | "invalid" | "past";
export type DueResult = { ok: true; iso: string | null } | { ok: false; reason: DueFailure };

/** The instant to send for the due editor's state, using the hotel's calendar and clock. */
export function resolveDue(due: DueDraft, zone: string | null | undefined, now: Date = new Date()): DueResult {
  if (due.mode === "none") return { ok: true, iso: null };
  if (due.mode === "unresolved") return { ok: false, reason: "unresolved" };

  let instant: Date | null;
  if (due.day === "other") {
    instant = due.iso ? new Date(due.iso) : null;
    if (!instant || Number.isNaN(instant.getTime())) return { ok: false, reason: "unresolved" };
  } else {
    const clock = parseClockText(due.time);
    if (!clock) return { ok: false, reason: "invalid" };
    const today = hotelDateKey(now, resolveTimeZone(zone));
    if (!today) return { ok: false, reason: "invalid" };
    instant = zonedTimeToInstant(due.day === "today" ? today : addDays(today, 1), clock.hour, clock.minute, zone);
    if (!instant) return { ok: false, reason: "invalid" };
  }
  if (instant.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  return { ok: true, iso: instant.toISOString() };
}

/* ─── validation ────────────────────────────────────────────────────────── */

export type DraftErrors = Partial<{
  title: "required" | "tooLong";
  description: "tooLong";
  type: "required";
  priority: "confirm";
  location: "unverified" | "placeRequired" | "placeTooLong" | "roomRequired";
  due: DueFailure;
}>;

export interface DraftValidation {
  errors: DraftErrors;
  valid: boolean;
  /** The due instant to send; only meaningful when there is no `due` error. */
  dueIso: string | null;
}

export function validateDraft(draft: TaskDraft, zone: string | null | undefined, now: Date = new Date()): DraftValidation {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "required";
  else if (title.length > ADD_TASK_LIMITS.title) errors.title = "tooLong";

  if (draft.description.trim().length > ADD_TASK_LIMITS.description) errors.description = "tooLong";
  if (!draft.type) errors.type = "required";
  if (draft.priority === "urgent" && !draft.priorityConfirmed) errors.priority = "confirm";

  const { location } = draft;
  if (location.kind === "unverified") errors.location = "unverified";
  else if (location.kind === "place") {
    const text = location.text.trim();
    if (!text) errors.location = "placeRequired";
    else if (text.length > ADD_TASK_LIMITS.place) errors.location = "placeTooLong";
  }
  if (!errors.location && draft.type === "guest_request" && location.kind !== "room") {
    // A guest request is about a guest's room; a place is not enough to find them.
    errors.location = "roomRequired";
  }

  const due = resolveDue(draft.due, zone, now);
  if (!due.ok) errors.due = due.reason;

  return { errors, valid: Object.keys(errors).length === 0, dueIso: due.ok ? due.iso : null };
}

/* ─── request payload ───────────────────────────────────────────────────── */

/** Exactly the fields POST /tasks accepts from this flow. No department, no one else's id. */
export interface CreateTaskInput {
  title: string;
  description?: string;
  task_type: AddTaskType;
  priority: TaskPriority;
  room_id?: string;
  location_text?: string;
  due_at?: string;
  assigned_to?: string;
  client_request_id: string;
  ai_suggested?: boolean;
}

/** Build the request from a draft that passed `validateDraft`; returns null when it did not. */
export function toCreateInput(
  draft: TaskDraft,
  validation: DraftValidation,
  userId: string | null,
): CreateTaskInput | null {
  if (!validation.valid || !draft.type) return null;
  const input: CreateTaskInput = {
    title: draft.title.trim(),
    task_type: draft.type,
    priority: draft.priority,
    client_request_id: draft.requestId,
  };
  const description = draft.description.trim();
  if (description) input.description = description;
  if (draft.location.kind === "room") input.room_id = draft.location.roomId;
  else if (draft.location.kind === "place") input.location_text = draft.location.text.trim();
  if (validation.dueIso) input.due_at = validation.dueIso;
  // The only assignee this flow can name is the person filing the task.
  if (draft.assignToMe && userId) input.assigned_to = userId;
  if (draft.aiSuggested) input.ai_suggested = true;
  return input;
}
