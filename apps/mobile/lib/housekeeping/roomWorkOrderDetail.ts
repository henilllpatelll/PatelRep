import type { WorkOrder } from "@/lib/engineering/workOrders";
import { momentLabel, type HistoryContext } from "@/lib/housekeeping/roomCleaningHistory";

/* ─── Work order detail — view layer (pure, read-only) ──────────────────────
   GET /work-orders/{id} is tenant-scoped by the server. A supervisor reads it here; there is no way to claim,
   start, complete or change it from this drawer. Only what the record holds is shown: an engineer is never
   named (the record carries an id, and no verified name list exists for engineers), and a closed order is
   never presented as open. A work order that belongs to a different room than the one the supervisor opened is
   refused rather than shown. */

const KNOWN_STATUS = new Set(["open", "in_progress", "on_hold", "completed", "cancelled"]);
const KNOWN_PRIORITY = new Set(["low", "medium", "normal", "high", "urgent", "critical", "emergency"]);
const CLOSED = new Set(["completed", "cancelled"]);
const HIGH_PRIORITY = new Set(["high", "urgent", "critical", "emergency"]);

export interface WorkOrderDetail {
  number: string | null;
  title: string;
  description: string | null;
  status: string | null;
  statusLabel: string | null;
  priorityLabel: string | null;
  highPriority: boolean;
  closed: boolean;
  assignment: "assigned" | "unassigned";
  rows: Array<{ key: string; label: string; value: string }>;
  /** Resolution evidence — only for a closed order, only what was recorded. */
  resolution: { notes: string | null; parts: string | null } | null;
}

export type WorkOrderView = { kind: "ok"; detail: WorkOrderDetail } | { kind: "wrong_room" };

export function buildWorkOrderDetail(
  wo: WorkOrder,
  ctx: HistoryContext & { expectedRoomId: string; roomNumber: string },
): WorkOrderView {
  const { t } = ctx;
  // The order carries its own room; if that is not the room asked about, it is somebody else's record.
  if (wo.room_id && wo.room_id !== ctx.expectedRoomId) return { kind: "wrong_room" };

  const status = typeof wo.status === "string" ? wo.status : null;
  const priority = typeof wo.priority === "string" ? wo.priority : null;
  const closed = status !== null && CLOSED.has(status);
  const rows: WorkOrderDetail["rows"] = [{ key: "room", label: t("roomBoard.panel.workOrder.row.room"), value: wo.rooms?.room_number ?? ctx.roomNumber }];
  const reported = momentLabel(wo.created_at, ctx);
  if (reported) rows.push({ key: "reported", label: t("roomBoard.panel.workOrder.row.reported"), value: reported });
  const started = momentLabel(wo.started_at, ctx);
  if (started) rows.push({ key: "started", label: t("roomBoard.panel.workOrder.row.started"), value: started });
  if (!closed) {
    const due = momentLabel(wo.due_at, ctx);
    if (due) rows.push({ key: "due", label: t("roomBoard.panel.workOrder.row.due"), value: due });
  }
  const completed = closed ? momentLabel(wo.completed_at, ctx) : null;
  if (completed) rows.push({ key: "completed", label: t(status === "cancelled" ? "roomBoard.panel.workOrder.row.cancelled" : "roomBoard.panel.workOrder.row.completed"), value: completed });
  rows.push({
    key: "assignment",
    label: t("roomBoard.panel.workOrder.row.assignment"),
    value: wo.assigned_to ? t("roomBoard.panel.workOrder.assigned") : t("roomBoard.panel.workOrder.unassigned"),
  });

  const notes = wo.notes?.trim() || null;
  const parts = wo.parts_used?.trim() || null;
  return {
    kind: "ok",
    detail: {
      number: wo.work_order_number?.trim() || null,
      title: wo.title?.trim() || t("roomBoard.detail.workOrder.untitled"),
      description: wo.description?.trim() || null,
      status,
      statusLabel: status ? (KNOWN_STATUS.has(status) ? t(`workOrders.status.${status}`) : status.replace(/_/g, " ")) : null,
      priorityLabel: priority ? (KNOWN_PRIORITY.has(priority) ? t(`roomBoard.detail.workOrder.priority.${priority}`) : priority) : null,
      highPriority: priority !== null && HIGH_PRIORITY.has(priority) && !closed,
      closed,
      assignment: wo.assigned_to ? "assigned" : "unassigned",
      rows,
      resolution: closed && (notes || parts) ? { notes, parts } : null,
    },
  };
}
