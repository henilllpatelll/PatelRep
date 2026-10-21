import type { CleanSessionRaw, RoomHistoryRow, RoomInspectionRaw } from "@/lib/api/roomPanels";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { momentLabel, type HistoryContext } from "@/lib/housekeeping/roomCleaningHistory";
import { buildInspectionHistory, type InspectionRow } from "@/lib/housekeeping/roomInspectionHistory";
import { isNoteEntry } from "@/lib/housekeeping/roomNote";

/* ─── Room context for the inspection (pure) ────────────────────────────────
   Read-only facts about the room, shaped from the Room Board's existing endpoints. Nothing is invented: a fact the
   server did not give is `null`, and the view says "Not available" for it. A failed read is a different state from a
   read that found nothing — that distinction is made by the caller, never here. */

/** How close a clean session's end must be to the room becoming CLEAN to be called the same cleaning. */
export const SESSION_MATCH_WINDOW_MS = 30 * 60_000;

export interface CleaningSessionFacts {
  minutes: number | null;
  checklistDone: number | null;
  checklistTotal: number | null;
}

/** The completed clean session that ended when this room became CLEAN; null when none matches (it is not guessed). */
export function matchingCleanSession(sessions: readonly CleanSessionRaw[], cleanedAtMs: number | null): CleaningSessionFacts | null {
  if (cleanedAtMs === null) return null;
  let best: { session: CleanSessionRaw; gap: number } | null = null;
  for (const session of sessions) {
    if (session.status !== "completed" || !session.ended_at) continue;
    const ended = Date.parse(session.ended_at);
    if (!Number.isFinite(ended)) continue;
    const gap = Math.abs(ended - cleanedAtMs);
    if (gap <= SESSION_MATCH_WINDOW_MS && (!best || gap < best.gap)) best = { session, gap };
  }
  if (!best) return null;
  const { session } = best;
  const seconds = session.duration_seconds;
  return {
    minutes: typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null,
    checklistDone: typeof session.checklist_done === "number" ? session.checklist_done : null,
    checklistTotal: typeof session.checklist_total === "number" && session.checklist_total > 0 ? session.checklist_total : null,
  };
}

export interface ContextNote {
  key: string;
  text: string;
  /** A verified display name, or null. Never an id. */
  author: string | null;
  at: string | null;
}

export const CONTEXT_NOTE_LIMIT = 3;

/** The newest operational notes on the room. Status changes are not notes. */
export function recentNotes(rows: readonly RoomHistoryRow[], ctx: HistoryContext, limit: number = CONTEXT_NOTE_LIMIT): { notes: ContextNote[]; more: number } {
  const all = rows
    .filter(isNoteEntry)
    .sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0))
    .map((row, index) => ({
      key: row.id ?? `note-${index}`,
      text: (row.notes ?? "").trim(),
      author: row.actor_name?.trim() || null,
      at: momentLabel(row.created_at, ctx),
    }));
  return { notes: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

export const OPEN_WORK_ORDER_STATUSES: readonly string[] = ["open", "escalated", "in_progress", "on_hold"];
export const WORK_ORDER_LIMIT = 5;
const PRIORITY_RANK: Record<string, number> = { emergency: 0, urgent: 1, normal: 2, low: 3 };

export interface ContextWorkOrder {
  id: string;
  number: string | null;
  title: string;
  status: string;
  priority: string;
}

/** Work orders still open on the room, most urgent first. `mayBeMore` is true when the read hit the server's page ceiling. */
export function openWorkOrders(rows: readonly WorkOrder[], fetchLimit: number, limit: number = WORK_ORDER_LIMIT): { orders: ContextWorkOrder[]; total: number; mayBeMore: boolean } {
  const open = rows
    .filter((row) => OPEN_WORK_ORDER_STATUSES.includes(row.status))
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0));
  return {
    orders: open.slice(0, limit).map((row) => ({ id: row.id, number: row.work_order_number ?? null, title: row.title, status: row.status, priority: row.priority })),
    total: open.length,
    mayBeMore: rows.length >= fetchLimit,
  };
}

/** The most recent recorded inspection of the room, or null. */
export function latestInspection(rows: readonly RoomInspectionRaw[], ctx: HistoryContext): InspectionRow | null {
  return buildInspectionHistory(rows, ctx)[0] ?? null;
}
