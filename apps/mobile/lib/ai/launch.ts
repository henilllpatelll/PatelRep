import type { AssistantContextIds } from "@/lib/ai/copilotChat";

/* ─── Opening the assistant with some context ───────────────────────────────
   `openAssistant({ contextType: "room", entityId })` is the one way any screen
   hands the assistant a subject. The ids are only ever CLAIMS: they are checked
   to look like ids here, then sent as `context` for the server to verify against
   this person and this hotel before it uses them (see resolve_trusted_context).
   Nothing in a launch is an authorisation, and a label is display text only. */

export const CONTEXT_TYPES = ["general", "shift", "room", "cleaningSession", "task", "maintenanceIssue", "sop"] as const;
export type AssistantContextType = (typeof CONTEXT_TYPES)[number];

/** Contexts that carry no record: the assistant just knows it is the housekeeping assistant / current shift. */
export type PlainContextType = "general" | "shift";
/** Contexts about a room: a room itself, its open cleaning session, or a maintenance issue raised for it. */
export type RoomContextType = "room" | "cleaningSession" | "maintenanceIssue";

export type AssistantLaunch = (
  | { contextType: PlainContextType }
  | { contextType: RoomContextType; entityId: string; label?: string }
  | { contextType: "task"; entityId: string; label?: string }
  | { contextType: "sop"; entityId: string; label?: string }
) & {
  /** Text placed in the composer (never sent by itself). */
  prefill?: string;
  /** Open straight into the voice panel. */
  voice?: boolean;
};

/** What the assistant is currently about; `null` entityId means no specific record. */
export interface ActiveContext {
  type: AssistantContextType;
  entityId: string | null;
  /** Shown to the person; replaced by the server-verified room number once a reply confirms it. */
  label: string | null;
  /** Stable identity: two launches with the same key are the same subject. */
  key: string;
}

export const GENERAL_CONTEXT: ActiveContext = { type: "general", entityId: null, label: null, key: "general" };

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for something shaped like a record id. This is hygiene, not authorisation: the server verifies it. */
export function isValidEntityId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value.trim());
}

const MAX_LABEL = 40;

function cleanLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const trimmed = label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return trimmed || null;
}

/** A launch becomes a context only when its id is well formed; anything else falls back to the general one. */
export function normalizeLaunch(launch: AssistantLaunch | null | undefined): ActiveContext {
  if (!launch) return GENERAL_CONTEXT;
  if (launch.contextType === "general" || launch.contextType === "shift") {
    return { type: launch.contextType, entityId: null, label: null, key: launch.contextType };
  }
  if (!(CONTEXT_TYPES as readonly string[]).includes(launch.contextType)) return GENERAL_CONTEXT;
  const entityId = "entityId" in launch ? launch.entityId : undefined;
  if (!isValidEntityId(entityId)) return GENERAL_CONTEXT;
  const id = entityId.trim().toLowerCase();
  return { type: launch.contextType, entityId: id, label: cleanLabel("label" in launch ? launch.label : null), key: `${launch.contextType}:${id}` };
}

/** The ids sent with each message. Room-shaped contexts all point at the room; the server checks the person may see it. */
export function contextToIds(context: ActiveContext): AssistantContextIds {
  if (!context.entityId) return {};
  switch (context.type) {
    case "room":
    case "cleaningSession":
    case "maintenanceIssue":
      return { roomId: context.entityId };
    case "task":
      return { taskId: context.entityId };
    case "sop":
      return { documentId: context.entityId };
    default:
      return {};
  }
}

/** True when switching from one context to another must not carry the old conversation along. */
export function contextChanged(from: ActiveContext, to: ActiveContext): boolean {
  return from.key !== to.key;
}
