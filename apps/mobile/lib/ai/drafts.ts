/* ─── Action previews: editable drafts the person reviews before anything exists ──
   The assistant only ever proposes. A draft is built from the server's preview,
   can be edited, is validated against the same limits the API enforces, and is
   turned into the exact request body the confirm endpoint expects. A room is
   "verified" only when the server linked it (`room_id`); a bare number is shown
   as unverified and the server re-checks it on confirm. */

export type ActionKind = "task" | "work_order" | "guest_request";

/** Mirrors apps/api/models/requests.py (SHORT/MEDIUM/LONG_TEXT_MAX). */
export const DRAFT_LIMITS = { title: 120, description: 2000, location: 255, roomNumber: 64, guestName: 120 } as const;

export const TASK_TYPES = ["housekeeping", "engineering", "guest_request", "general"] as const;
export const TASK_PRIORITIES = ["urgent", "normal", "low"] as const;
export const WORK_ORDER_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "furniture",
  "appliance",
  "structural",
  "safety",
  "general",
] as const;
export const GUEST_CATEGORIES = ["service", "housekeeping", "maintenance", "accessibility", "other"] as const;
export const GUEST_PRIORITIES = ["normal", "urgent"] as const;
export const GUEST_IMPACTS = ["low", "standard", "high"] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];
export type GuestCategory = (typeof GUEST_CATEGORIES)[number];
export type GuestPriority = (typeof GUEST_PRIORITIES)[number];
export type GuestImpact = (typeof GUEST_IMPACTS)[number];

export interface RoomRef {
  /** Free text the person can edit. */
  roomNumber: string;
  /** Set only when the server linked this exact number to a room of this hotel. */
  roomId: string | null;
}

export interface TaskDraft extends RoomRef {
  title: string;
  description: string;
  taskType: TaskType;
  priority: TaskPriority;
}

export interface WorkOrderDraft extends RoomRef {
  title: string;
  description: string;
  category: WorkOrderCategory;
  priority: TaskPriority;
  locationText: string;
}

export interface GuestRequestDraft extends RoomRef {
  title: string;
  description: string;
  guestName: string;
  category: GuestCategory;
  priority: GuestPriority;
  guestImpact: GuestImpact;
}

export type ActionPreview =
  | { kind: "task"; draft: TaskDraft }
  | { kind: "work_order"; draft: WorkOrderDraft }
  | { kind: "guest_request"; draft: GuestRequestDraft };

type Raw = Record<string, unknown>;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** The API calls the same thing high / critical / emergency in different places; the app saves three levels. */
function taskPriority(value: unknown): TaskPriority {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "urgent" || v === "high" || v === "critical" || v === "emergency") return "urgent";
  if (v === "low") return "low";
  return "normal";
}

function guestPriority(value: unknown): GuestPriority {
  return taskPriority(value) === "urgent" ? "urgent" : "normal";
}

function roomRef(raw: Raw, numberKeys: string[]): RoomRef {
  const roomNumber = numberKeys.map((key) => text(raw[key], DRAFT_LIMITS.roomNumber)).find(Boolean) ?? "";
  const roomId = text(raw.room_id, 64);
  // An id without a number to show for it is not something a person can review.
  return { roomNumber, roomId: roomId && roomNumber ? roomId : null };
}

export function taskDraftFromRaw(raw: Raw): ActionPreview | null {
  const title = text(raw.title, DRAFT_LIMITS.title);
  if (!title) return null;
  return {
    kind: "task",
    draft: {
      title,
      description: text(raw.description, DRAFT_LIMITS.description),
      taskType: oneOf(raw.task_type, TASK_TYPES, "general"),
      priority: taskPriority(raw.priority),
      ...roomRef(raw, ["room_number_display", "room_number"]),
    },
  };
}

export function workOrderDraftFromRaw(raw: Raw): ActionPreview | null {
  const title = text(raw.title, DRAFT_LIMITS.title);
  if (!title) return null;
  return {
    kind: "work_order",
    draft: {
      title,
      description: text(raw.description, DRAFT_LIMITS.description),
      category: oneOf(raw.category, WORK_ORDER_CATEGORIES, "general"),
      priority: taskPriority(raw.priority),
      locationText: text(raw.location_text, DRAFT_LIMITS.location),
      ...roomRef(raw, ["room_number"]),
    },
  };
}

export function guestRequestDraftFromRaw(raw: Raw): ActionPreview | null {
  const title = text(raw.title, DRAFT_LIMITS.title);
  if (!title) return null;
  const category = oneOf(raw.category, GUEST_CATEGORIES, "service");
  // Accessibility requests are always urgent (the API refuses anything else).
  const priority = category === "accessibility" ? "urgent" : guestPriority(raw.priority);
  return {
    kind: "guest_request",
    draft: {
      title,
      description: text(raw.description, DRAFT_LIMITS.description),
      guestName: text(raw.guest_name, DRAFT_LIMITS.guestName),
      category,
      priority,
      guestImpact: oneOf(raw.guest_impact, GUEST_IMPACTS, "standard"),
      ...roomRef(raw, ["room_number"]),
    },
  };
}

/* ─── Editing ─────────────────────────────────────────────────────────────── */

/** Any field a person can edit on any kind of draft (each kind ignores the ones it does not have). */
export interface DraftPatch extends Partial<RoomRef> {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  taskType?: TaskType;
  category?: WorkOrderCategory | GuestCategory;
  locationText?: string;
  guestName?: string;
  guestImpact?: GuestImpact;
}

/** Apply an edit. Changing the room number drops the server's link: the new number is re-verified on confirm. */
export function patchPreview(preview: ActionPreview, patch: DraftPatch): ActionPreview {
  const roomEdited = patch.roomNumber !== undefined && patch.roomNumber !== preview.draft.roomNumber;
  const merged = { ...preview.draft, ...patch, ...(roomEdited ? { roomId: null } : {}) } as ActionPreview["draft"];
  if (preview.kind === "guest_request") {
    const draft = merged as GuestRequestDraft;
    // Picking "accessibility" forces urgent, and urgent cannot be unset while it is selected.
    if (draft.category === "accessibility") draft.priority = "urgent";
    return { kind: "guest_request", draft };
  }
  return { kind: preview.kind, draft: merged } as ActionPreview;
}

/* ─── Validation ──────────────────────────────────────────────────────────── */

export type DraftField = "title" | "description" | "roomNumber" | "location" | "guestName";
export type DraftErrorCode = "required" | "tooLong" | "needsPlace";
export type DraftErrors = Partial<Record<DraftField, DraftErrorCode>>;

export function validatePreview(preview: ActionPreview): DraftErrors {
  const errors: DraftErrors = {};
  const { draft } = preview;
  if (!draft.title.trim()) errors.title = "required";
  else if (draft.title.length > DRAFT_LIMITS.title) errors.title = "tooLong";
  if (draft.description.length > DRAFT_LIMITS.description) errors.description = "tooLong";
  if (draft.roomNumber.length > DRAFT_LIMITS.roomNumber) errors.roomNumber = "tooLong";
  if (preview.kind === "work_order") {
    if (preview.draft.locationText.length > DRAFT_LIMITS.location) errors.location = "tooLong";
    // A work order has to say where the problem is.
    if (!draft.roomNumber.trim() && !preview.draft.locationText.trim()) errors.location = "needsPlace";
  }
  if (preview.kind === "guest_request" && preview.draft.guestName.length > DRAFT_LIMITS.guestName) {
    errors.guestName = "tooLong";
  }
  return errors;
}

export function isPreviewValid(preview: ActionPreview): boolean {
  return Object.keys(validatePreview(preview)).length === 0;
}

/** True when a room number is shown that the server has not linked to a room of this hotel. */
export function roomIsUnverified(draft: RoomRef): boolean {
  return draft.roomNumber.trim() !== "" && draft.roomId === null;
}

/* ─── Request bodies ──────────────────────────────────────────────────────── */

export const CONFIRM_PATH: Record<ActionKind, string> = {
  task: "/ai/tasks/confirm",
  work_order: "/ai/work-orders/confirm",
  guest_request: "/ai/guest-requests/confirm",
};

function optional<T extends Record<string, unknown>>(entries: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  ) as Partial<T>;
}

/**
 * The body each confirm endpoint takes: a JSON **array** of previews. Rooms go as the server-linked
 * `room_id` when it is still valid, else as the number for the server to verify.
 */
export function buildConfirmBody(preview: ActionPreview, requestKey: string): unknown[] {
  const room = (draft: RoomRef) =>
    draft.roomId ? { room_id: draft.roomId } : optional({ room_number: draft.roomNumber.trim() });
  switch (preview.kind) {
    case "task": {
      const d = preview.draft;
      return [
        {
          title: d.title.trim(),
          ...optional({ description: d.description.trim() }),
          task_type: d.taskType,
          priority: d.priority,
          ...(d.roomId ? { room_id: d.roomId } : optional({ room_number_display: d.roomNumber.trim() })),
        },
      ];
    }
    case "work_order": {
      const d = preview.draft;
      return [
        {
          title: d.title.trim(),
          category: d.category,
          priority: d.priority,
          ...optional({ description: d.description.trim(), location_text: d.locationText.trim() }),
          ...room(d),
          client_request_id: requestKey,
        },
      ];
    }
    case "guest_request": {
      const d = preview.draft;
      return [
        {
          title: d.title.trim(),
          category: d.category,
          priority: d.priority,
          guest_impact: d.guestImpact,
          ...optional({ description: d.description.trim(), guest_name: d.guestName.trim() }),
          ...room(d),
        },
      ];
    }
  }
}
