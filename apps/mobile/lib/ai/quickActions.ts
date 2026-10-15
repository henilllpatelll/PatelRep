import type { AssistantLaunch } from "@/lib/ai/launch";
import type { IntentHint } from "@/lib/ai/contract";
import { isAssistantRole } from "@/lib/ai/fab";

/* ─── The assistant's quick actions ─────────────────────────────────────────
   Every action does something real that already exists in the app: it reads the
   room order Home already ranked, opens the existing room-issue form, opens the
   existing Add Task sheet, or points the assistant at an intent. None is a
   canned reply, and none is offered to a role that could not do it. */

export type QuickActionId = "nextRoom" | "reportIssue" | "createTask" | "askQuestion" | "findProcedure";

export interface QuickActionDef {
  id: QuickActionId;
  icon: "bed-outline" | "warning-outline" | "add-circle-outline" | "help-circle-outline" | "book-outline";
}

const ALL: Record<QuickActionId, QuickActionDef> = {
  nextRoom: { id: "nextRoom", icon: "bed-outline" },
  reportIssue: { id: "reportIssue", icon: "warning-outline" },
  createTask: { id: "createTask", icon: "add-circle-outline" },
  askQuestion: { id: "askQuestion", icon: "help-circle-outline" },
  findProcedure: { id: "findProcedure", icon: "book-outline" },
};

/** The compact sheet's four actions. Only housekeepers have the compact assistant. */
export function sheetQuickActions(role: string | null | undefined): QuickActionDef[] {
  if (!isAssistantRole(role)) return [];
  return [ALL.nextRoom, ALL.reportIssue, ALL.createTask, ALL.askQuestion];
}

/** The full assistant's starting chips. */
export function chatQuickActions(role: string | null | undefined): QuickActionDef[] {
  if (!isAssistantRole(role)) return [];
  return [ALL.nextRoom, ALL.reportIssue, ALL.createTask, ALL.findProcedure];
}

export type QuickCommand =
  /** Show the room Home ranks first, read straight from Home's data (no model). */
  | { type: "nextRoom" }
  /** Open the room issue form for a room that is known. */
  | { type: "navigate"; href: string }
  /** Ask which room first (the person's own rooms), then open that room's issue form. */
  | { type: "pickRoom" }
  /** Put the cursor in the composer. */
  | { type: "focus" }
  /** Point the assistant at an intent, with a sentence to finish. */
  | { type: "compose"; hint: IntentHint };

export function roomIssueHref(roomId: string): string {
  return `/(app)/my-rooms/${encodeURIComponent(roomId)}?action=issue`;
}

export function addTaskHref(prefill?: string): string {
  const text = prefill?.trim();
  return text ? `/(app)/tasks?add=1&prefill=${encodeURIComponent(text.slice(0, 500))}` : "/(app)/tasks?add=1";
}

/** What a quick action does, given the room the assistant is already about (if any). */
export function resolveQuickAction(id: QuickActionId, roomId: string | null): QuickCommand {
  switch (id) {
    case "nextRoom":
      return { type: "nextRoom" };
    case "reportIssue":
      return roomId ? { type: "navigate", href: roomIssueHref(roomId) } : { type: "pickRoom" };
    case "createTask":
      return { type: "navigate", href: addTaskHref() };
    case "askQuestion":
      return { type: "focus" };
    case "findProcedure":
      return { type: "compose", hint: "sop_query" };
  }
}

/** A room-shaped launch carries the room the assistant is about; anything else has none. */
export function roomIdOf(context: AssistantLaunch | { type: string; entityId: string | null } | null): string | null {
  if (!context) return null;
  const type = "contextType" in context ? context.contextType : context.type;
  const id = "entityId" in context ? context.entityId : null;
  return (type === "room" || type === "cleaningSession" || type === "maintenanceIssue") && typeof id === "string" ? id : null;
}
