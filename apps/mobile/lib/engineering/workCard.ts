/* ─── Work-order card model ─────────────────────────────────────────────────
   Pure rules behind the one Engineering Work card: which single action a card leads with, how a due time
   reads in the hotel's own clock, and which hotel-context badges are safe to show. No React, no i18n — the card
   translates what this returns.

   The server is the authority for every permission. These helpers only choose what to offer, and they never
   widen it: a card offers Claim only when the screen says the viewer may claim, and Assign only when the screen
   supplied an assign handler. A chief engineer therefore leads with Assign or Review, never Claim or Continue. */

import { formatHotelTime, hotelDateKey, addDaysToYmd, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { isOverdue, type QueueView } from "@/lib/engineering/workQueue";
import type { WorkOrder, WorkOrderPriority, WorkOrderStatus } from "@/lib/engineering/workOrders";

export type CardActionKind = "claim" | "continue" | "open" | "reviewHold" | "viewRecord" | "review" | "assign";

export interface CardActionInput {
  view: QueueView;
  /** The signed-in person, to tell their own work from a colleague's. */
  viewerId: string | null | undefined;
  /** The screen allows this viewer to claim this order (open, unclaimed, role may claim). */
  claimable: boolean;
  /** The screen supplied an assign handler (manager role, order still assignable, not History). */
  assignable: boolean;
}

export function isFinished(status: WorkOrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/** The one thing a card leads with. Everything else lives behind opening the order. */
export function primaryAction(wo: Pick<WorkOrder, "status" | "assigned_to">, input: CardActionInput): CardActionKind {
  if (isFinished(wo.status)) return "viewRecord";
  if (input.claimable) return "claim";
  const owner = wo.assigned_to ?? null;
  const mine = owner != null && owner === input.viewerId;
  if (mine) {
    if (wo.status === "in_progress") return "continue";
    if (wo.status === "on_hold") return "reviewHold";
    return "open";
  }
  // Not the viewer's order. A manager's job on unowned work is to give it an owner.
  if (owner == null && input.assignable) return "assign";
  return wo.status === "on_hold" ? "reviewHold" : "review";
}

/**
 * A small Assign / Reassign beside the primary action, only when it adds something: the primary action is not
 * already Assign, the order has (or had) an owner worth changing, and the screen allowed it.
 */
export function showsSecondaryAssign(primary: CardActionKind, input: Pick<CardActionInput, "assignable">): boolean {
  return input.assignable && primary !== "assign" && primary !== "viewRecord";
}

export type DueLabel =
  | { kind: "overdue"; minutes: number }
  | { kind: "today"; clock: string }
  | { kind: "tomorrow"; clock: string }
  | { kind: "later"; date: string };

/**
 * When an active order is due, in the hotel's clock. Silent when there is no (valid) due date or the order is
 * finished — never an invented time. Overdue is decided by the same rule as the queue's Overdue filter.
 */
export function dueLabel(
  wo: Pick<WorkOrder, "status" | "due_at">,
  { now = new Date(), timeZone, language = "en" }: { now?: Date; timeZone?: string | null; language?: string } = {},
): DueLabel | null {
  if (isFinished(wo.status) || !wo.due_at) return null;
  const due = new Date(wo.due_at);
  if (Number.isNaN(due.getTime())) return null;
  if (isOverdue(wo as WorkOrder, now)) {
    return { kind: "overdue", minutes: Math.max(0, Math.floor((now.getTime() - due.getTime()) / 60_000)) };
  }
  const clock = formatHotelTime(due, timeZone, language);
  const dueKey = hotelDateKey(due, timeZone);
  const todayKey = hotelDateKey(now, timeZone);
  if (!clock || !dueKey || !todayKey) return null;
  if (dueKey === todayKey) return { kind: "today", clock };
  if (dueKey === addDaysToYmd(todayKey, 1)) return { kind: "tomorrow", clock };
  const date = due.toLocaleDateString(language, { month: "short", day: "numeric", timeZone: resolveTimeZone(timeZone) });
  return { kind: "later", date };
}

export type BadgeKind = "occupied" | "vacant" | "out_of_order" | "out_of_service" | "unrecorded_down" | "guest" | "equipment";

export interface ContextBadge {
  kind: BadgeKind;
  /** Only the equipment badge carries text of its own (the equipment's name). */
  label?: string;
}

/**
 * Hotel-context badges that rest on real data. Occupancy and availability come only from the server's
 * `room_context` (the room board's rule; `unknown` shows nothing), and never on a finished order, where today's
 * room state would say nothing about the day the work was done. Guest reported is a fact about the report itself,
 * so it never implies occupancy; equipment shows only when the order is linked to a named asset. A room number
 * alone, a priority, or a maintenance category proves none of these, so none of them produces a badge.
 */
export function contextBadges(wo: Pick<WorkOrder, "status" | "room_context" | "guest_reported" | "assets">): ContextBadge[] {
  const badges: ContextBadge[] = [];
  const context = isFinished(wo.status) ? null : wo.room_context;
  if (context?.occupancy === "occupied" || context?.occupancy === "vacant") badges.push({ kind: context.occupancy });
  if (context?.availability) badges.push({ kind: context.availability });
  if (wo.guest_reported) badges.push({ kind: "guest" });
  const equipment = wo.assets?.name?.trim();
  if (equipment) badges.push({ kind: "equipment", label: equipment });
  return badges;
}

export type OwnerLine =
  | { kind: "you" }
  | { kind: "name"; name: string }
  | { kind: "assigned" }
  | { kind: "unassigned" };

/**
 * Who has the order, where that is news. In My Work every row is the viewer's and in Available every row is
 * unowned, so repeating it would only add a line.
 */
export function ownerLine(
  wo: Pick<WorkOrder, "assigned_to" | "assigned_to_name" | "status">,
  view: QueueView,
  viewerId: string | null | undefined,
): OwnerLine | null {
  if (view === "mine" || view === "available") return null;
  const owner = wo.assigned_to ?? null;
  if (owner == null) return isFinished(wo.status) ? null : { kind: "unassigned" };
  if (owner === viewerId) return { kind: "you" };
  const name = wo.assigned_to_name?.trim();
  return name ? { kind: "name", name } : { kind: "assigned" };
}

export type StatusTone = "neutral" | "attention" | "active" | "waiting" | "done" | "cancelled";

export function statusTone(status: WorkOrderStatus): StatusTone {
  switch (status) {
    case "escalated":
      return "attention";
    case "in_progress":
      return "active";
    case "on_hold":
      return "waiting";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

export function isEmphasised(priority: WorkOrderPriority): boolean {
  return priority === "emergency" || priority === "urgent";
}
