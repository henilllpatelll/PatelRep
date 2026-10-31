/* ─── Engineering Home model ────────────────────────────────────────────────
   Pure counting + ordering for the Home tab, so the numbers on the cards, the
   Continue card and the Needs Attention list all come from one deduplicated
   set of work orders and can never disagree. No i18n, no I/O.

   Definitions (the API already limits an engineer's list to "assigned to me
   or unassigned"; chief_engineer/gm lists are hotel-wide):
   - queue scope  — active work orders: open, escalated, in_progress, on_hold.
   - My Jobs      — queue work assigned to me that I can act on now
                    (open, escalated, in_progress). On-hold work is waiting,
                    so it is a follow-up in Needs Attention, not a job to do.
   - Urgent       — queue work with priority emergency or urgent, any status
                    in scope (an on-hold emergency is still an emergency).
   - PM Due       — active PM schedules overdue or due today (hotel calendar). */

import {
  ACTIVE_WORK_ORDER_STATUSES,
  isHighPriority,
  sortQueue,
  type WorkOrder,
  type WorkOrderStatus,
} from "@/lib/engineering/workOrders";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";

/** Statuses an engineer can start or keep working right now. */
export const ACTIONABLE_STATUSES: readonly WorkOrderStatus[] = ["open", "escalated", "in_progress"];

export type WorkAttentionReason = "emergency" | "urgent_unassigned" | "past_due" | "on_hold";

export type AttentionItem =
  | { kind: "wo"; key: string; reason: WorkAttentionReason; wo: WorkOrder }
  | { kind: "pm"; key: string; reason: "pm_overdue"; pm: PmScheduleView };

export type AttentionReason = AttentionItem["reason"];

const REASON_RANK: Record<AttentionReason, number> = {
  emergency: 0,
  urgent_unassigned: 1,
  past_due: 2,
  pm_overdue: 3,
  on_hold: 4,
};

export interface HomeModel {
  myJobs: number;
  urgent: number;
  pmDue: number;
  /** The viewer's own in-progress job to continue (most severe first); never someone else's. */
  activeJob: WorkOrder | null;
  /** Further in-progress jobs of mine beyond `activeJob`. */
  moreActive: number;
  /** Every attention signal, most severe first, one entry per work order / PM schedule. */
  attention: AttentionItem[];
}

/** Keeps the first row for each id and drops anything that is not active work. */
export function activeQueue(orders: readonly WorkOrder[]): WorkOrder[] {
  const seen = new Set<string>();
  const out: WorkOrder[] = [];
  for (const wo of orders) {
    if (!wo?.id || seen.has(wo.id)) continue;
    if (!ACTIVE_WORK_ORDER_STATUSES.includes(wo.status)) continue;
    seen.add(wo.id);
    out.push(wo);
  }
  return out;
}

function isPastDue(wo: WorkOrder, now: Date): boolean {
  if (!wo.due_at) return false;
  const due = new Date(wo.due_at).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

export function buildHomeModel(
  orders: readonly WorkOrder[],
  pm: readonly PmScheduleView[],
  viewerId: string | null | undefined,
  now: Date = new Date(),
): HomeModel {
  const queue = activeQueue(orders);
  const mine = (wo: WorkOrder) => viewerId != null && wo.assigned_to === viewerId;

  const myJobs = queue.filter((wo) => mine(wo) && ACTIONABLE_STATUSES.includes(wo.status)).length;
  const urgent = queue.filter((wo) => isHighPriority(wo.priority)).length;
  const pmDue = pm.filter((p) => p.state === "overdue" || p.state === "due_today").length;

  const inProgress = sortQueue(
    queue.filter((wo) => mine(wo) && wo.status === "in_progress"),
    now,
  );
  const activeJob = inProgress[0] ?? null;

  // One entry per work order: the most severe reason wins. The job on the Continue card is not repeated.
  const items: AttentionItem[] = [];
  for (const wo of sortQueue(queue, now)) {
    if (activeJob && wo.id === activeJob.id) continue;
    let reason: WorkAttentionReason | null = null;
    if (wo.priority === "emergency") reason = "emergency";
    else if (wo.priority === "urgent" && !wo.assigned_to) reason = "urgent_unassigned";
    else if (isPastDue(wo, now)) reason = "past_due";
    else if (wo.status === "on_hold" && mine(wo)) reason = "on_hold";
    if (reason) items.push({ kind: "wo", key: `wo:${wo.id}`, reason, wo });
  }
  for (const view of pm) {
    if (view.state === "overdue") items.push({ kind: "pm", key: `pm:${view.id}`, reason: "pm_overdue", pm: view });
  }

  // Stable sort: severity first, then the order each source was already in (priority/age, most overdue PM).
  const attention = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => REASON_RANK[a.item.reason] - REASON_RANK[b.item.reason] || a.index - b.index)
    .map(({ item }) => item);

  return { myJobs, urgent, pmDue, activeJob, moreActive: Math.max(0, inProgress.length - 1), attention };
}

/* ─── Sync status ─────────────────────────────────────────────────────────── */

export type SyncStatusKind = "offline" | "pending" | "failed" | "syncing" | "synced" | "unsynced";

export interface SyncStatus {
  kind: SyncStatusKind;
  /** Whole minutes since the last successful load (synced / offline / failed). */
  minutes: number | null;
  pending: number;
}

/**
 * What the header may truthfully say. "Synced" only after a load actually succeeded; a screen that merely mounted,
 * or whose last refresh failed, never claims it.
 */
export function resolveSyncStatus(input: {
  online: boolean;
  pending: number;
  /** Latest queue request failed. */
  failed: boolean;
  refreshing: boolean;
  syncedAt: Date | null;
  now: Date;
}): SyncStatus {
  const minutes = input.syncedAt ? Math.max(0, Math.floor((input.now.getTime() - input.syncedAt.getTime()) / 60_000)) : null;
  const base = { minutes, pending: input.pending };
  if (!input.online) return { kind: "offline", ...base };
  if (input.refreshing) return { kind: "syncing", ...base };
  if (input.failed) return { kind: "failed", ...base };
  if (input.pending > 0) return { kind: "pending", ...base };
  if (!input.syncedAt) return { kind: "unsynced", ...base };
  return { kind: "synced", ...base };
}
