import type { Room } from "@/stores/appStore";
import { getProgress, hasPendingSync, type LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { resolveEstimate, type EstimateBasis } from "@/lib/housekeeping/cleaningEstimate";
import { classifyRoom, type RoomClassification } from "@/lib/housekeeping/needsAttention";
import { roomIssueHref } from "@/lib/ai/quickActions";

/**
 * Everything the room screens and the room-aware assistant say about ONE room, worked out on the phone from
 * the same room and clean-session records the screen shows. No model is asked, nothing is written, and
 * nothing here can allow, deny or reorder work: it only reads and explains. A room that is not on the
 * person's list (reassigned, wrong day, another hotel) yields "gone", never an answer.
 */

export interface TextLine {
  key: string;
  params?: Record<string, unknown>;
}

/* ─── Readiness (before cleaning) ───────────────────────────────────────────── */

export interface ReadinessFacts {
  estimate: { minutes: number; basis: EstimateBasis };
  /** What the list last said about maintenance. "none" means none on record, not a guarantee. */
  workOrder: { state: "open"; label: string; status: string | null } | { state: "none" };
}

export function buildReadinessFacts(room: Room): ReadinessFacts {
  const number = room.open_work_order_number?.trim();
  const title = room.open_work_order_title?.trim();
  const hasOpen = Boolean(room.open_work_order_id || number || title);
  return {
    estimate: resolveEstimate(room),
    workOrder: hasOpen
      ? { state: "open", label: [number ? `#${number}` : null, title].filter(Boolean).join(" · ") || "", status: room.open_work_order_status ?? null }
      : { state: "none" },
  };
}

/* ─── One line of guidance ──────────────────────────────────────────────────── */

export interface GuidanceInput {
  room: Room;
  session: LocalCleanSession | undefined;
  classification: RoomClassification;
  /** The supervisor's sequence (or the standard queue) puts this room next. */
  isNext: boolean;
}

/**
 * At most one short, true, actionable line, in this order: a restriction, unsent changes, what is left on the
 * checklist, a recorded maintenance follow-up, "this is next". Nothing is generated and nothing repeats as the
 * checklist changes: the line is recomputed from the records, never from a model.
 */
export function buildRoomGuidance({ room, session, classification, isNext }: GuidanceInput): TextLine | null {
  if (classification.restricted) return { key: "rooms.guidance.restricted" };
  const live = Boolean(session && !session.completionConfirmed);
  if (live && session && hasPendingSync(session)) return { key: "rooms.guidance.pending" };
  if (live && session && session.checklist.length > 0) {
    const { total, done } = getProgress(session.checklist);
    const left = total - done;
    if (left > 0) return { key: "rooms.guidance.itemsLeft", params: { count: left } };
  }
  if (room.open_work_order_id || room.open_work_order_number) return { key: "rooms.guidance.workOrder" };
  if (isNext && !live) return { key: "rooms.guidance.next" };
  return null;
}

/* ─── Questions about this room ─────────────────────────────────────────────── */

export type RoomQuestionId = "checklistLeft" | "reportProblem" | "openWorkOrders" | "findProcedure";

/** The suggested questions for a room. The checklist one exists only while a clean is open. */
export function roomQuestionIds(hasLiveSession: boolean): RoomQuestionId[] {
  return [...(hasLiveSession ? (["checklistLeft"] as const) : []), "reportProblem", "openWorkOrders", "findProcedure"];
}

export type RoomAnswer =
  /** The room is not on this person's list (any more). Nothing about it is shown. */
  | { type: "gone"; lines: TextLine[] }
  | { type: "answer"; lines: TextLine[]; href?: string }
  /** Send the person to the procedures search, about this room. */
  | { type: "compose"; hint: "sop_query" };

const MAX_LISTED = 3;

export function answerRoomQuestion(
  id: RoomQuestionId,
  input: { room: Room | null; session: LocalCleanSession | undefined },
): RoomAnswer {
  const { room, session } = input;
  if (!room) return { type: "gone", lines: [{ key: "assistant.roomQ.gone" }] };
  const live = Boolean(session && !session.completionConfirmed);

  switch (id) {
    case "checklistLeft": {
      if (!live || !session || session.checklist.length === 0) {
        return { type: "answer", lines: [{ key: "assistant.roomQ.checklist.none" }] };
      }
      const open = session.checklist.filter((item) => !item.checked);
      const lines: TextLine[] = [];
      if (open.length === 0) {
        lines.push({ key: "assistant.roomQ.checklist.allDone" });
      } else {
        const required = open.filter((item) => item.is_required).length;
        lines.push({ key: "assistant.roomQ.checklist.left", params: { count: open.length, required } });
        lines.push({
          key: "assistant.roomQ.checklist.names",
          params: { names: open.slice(0, MAX_LISTED).map((item) => item.label).join(", "), more: Math.max(0, open.length - MAX_LISTED) },
        });
      }
      if (hasPendingSync(session)) lines.push({ key: "assistant.roomQ.checklist.pending" });
      return { type: "answer", lines };
    }
    case "reportProblem":
      return { type: "answer", lines: [{ key: "assistant.roomQ.report" }], href: roomIssueHref(room.id) };
    case "openWorkOrders": {
      const facts = buildReadinessFacts(room);
      if (facts.workOrder.state === "open") {
        return {
          type: "answer",
          lines: [{ key: "assistant.roomQ.workOrder.open", params: { label: facts.workOrder.label, status: facts.workOrder.status ?? "" } }],
          href: room.open_work_order_id ? `/(app)/work-orders/${encodeURIComponent(room.open_work_order_id)}` : undefined,
        };
      }
      return { type: "answer", lines: [{ key: "assistant.roomQ.workOrder.none" }] };
    }
    case "findProcedure":
      return { type: "compose", hint: "sop_query" };
  }
}

/** Convenience for callers that only have the room: the restriction view of it. */
export function classifyForAssist(room: Room, session: LocalCleanSession | undefined): RoomClassification {
  return classifyRoom(room, { hasLiveSession: Boolean(session && !session.completionConfirmed) });
}
