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
  priorityRank,
  type WorkOrder,
} from "@/lib/engineering/workOrders";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import type { PmDraftSummary } from "@/lib/engineering/pmDraftStore";
import { summarizePending, type PendingAction } from "@/lib/engineering/offlineActions";
import type { PmSyncCounts } from "@/lib/engineering/pmSyncItems";
import { ACTIONABLE_STATUSES, availableOrders, focusWorkOrderId, resolveFocus, type FocusState } from "@/lib/engineering/homeFocus";

export { ACTIONABLE_STATUSES };

export type WorkAttentionReason = "emergency" | "urgent_unassigned" | "past_due" | "on_hold";

export type AttentionItem =
  | { kind: "wo"; key: string; reason: WorkAttentionReason; wo: WorkOrder }
  | { kind: "pm"; key: string; reason: "pm_overdue"; pm: PmScheduleView }
  /** Saved PM inspections that stopped and need the person (review / refused / unknown outcome). */
  | { kind: "sync"; key: string; reason: "sync_blocked"; count: number };

export type AttentionReason = AttentionItem["reason"];

const REASON_RANK: Record<AttentionReason, number> = {
  emergency: 0,
  sync_blocked: 1,
  urgent_unassigned: 2,
  past_due: 3,
  pm_overdue: 4,
  on_hold: 5,
};

export interface HomeModel {
  myJobs: number;
  urgent: number;
  pmDue: number;
  /** The contextual primary card (see homeFocus.ts). */
  focus: FocusState;
  /** The viewer's own in-progress job to continue (most severe first); never someone else's. */
  activeJob: WorkOrder | null;
  /** Further in-progress jobs of mine beyond `activeJob`. */
  moreActive: number;
  /** Unassigned open work a technician could pick up. */
  available: number;
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

const instant = (iso: string | null | undefined, fallback: number): number => {
  if (!iso) return fallback;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? fallback : t;
};

/**
 * Order inside one attention reason, fully deterministic so equal records never swap places between refreshes:
 * priority (emergency first), earliest due time (none last; a malformed time counts as none), oldest created first
 * (it has waited longest), then id.
 */
export function compareForAttention(a: WorkOrder, b: WorkOrder): number {
  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;
  const due = instant(a.due_at, Infinity);
  const otherDue = instant(b.due_at, Infinity);
  if (due !== otherDue) return due < otherDue ? -1 : 1;
  const created = instant(a.created_at, 0) - instant(b.created_at, 0);
  if (created !== 0) return created;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isPastDue(wo: WorkOrder, now: Date): boolean {
  if (!wo.due_at) return false;
  const due = new Date(wo.due_at).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

export interface HomeModelOptions {
  /** Role may claim / work orders; false (chief engineer) never gets a personal focus card. */
  canAct?: boolean;
  drafts?: readonly PmDraftSummary[];
  /** Saved PM inspections stuck waiting for the person. */
  blockedSync?: number;
  loaded?: { queue: boolean; pm: boolean; drafts: boolean };
}

export function buildHomeModel(
  orders: readonly WorkOrder[],
  pm: readonly PmScheduleView[],
  viewerId: string | null | undefined,
  now: Date = new Date(),
  options: HomeModelOptions = {},
): HomeModel {
  const queue = activeQueue(orders);
  const mine = (wo: WorkOrder) => viewerId != null && wo.assigned_to === viewerId;

  const myJobs = queue.filter((wo) => mine(wo) && ACTIONABLE_STATUSES.includes(wo.status)).length;
  const urgent = queue.filter((wo) => isHighPriority(wo.priority)).length;
  const pmDue = pm.filter((p) => p.state === "overdue" || p.state === "due_today").length;

  const canAct = options.canAct ?? true;
  const focus = resolveFocus({
    queue,
    viewerId,
    canAct,
    pm,
    drafts: options.drafts ?? [],
    loaded: options.loaded ?? { queue: true, pm: true, drafts: true },
    now,
  });
  const activeJob = focus.kind === "continue_repair" ? focus.wo : null;
  const moreActive = focus.kind === "continue_repair" ? focus.moreActive : 0;
  const focusId = focusWorkOrderId(focus);

  // One entry per work order: the most severe reason wins. The order on the primary card is not repeated.
  const items: AttentionItem[] = [];
  for (const wo of [...queue].sort(compareForAttention)) {
    if (focusId && wo.id === focusId) continue;
    let reason: WorkAttentionReason | null = null;
    if (wo.priority === "emergency") reason = "emergency";
    else if (wo.priority === "urgent" && !wo.assigned_to) reason = "urgent_unassigned";
    else if (isPastDue(wo, now)) reason = "past_due";
    else if (wo.status === "on_hold" && mine(wo)) reason = "on_hold";
    if (reason) items.push({ kind: "wo", key: `wo:${wo.id}`, reason, wo });
  }
  const overduePm = pm.filter((view) => view.state === "overdue").sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const view of overduePm) {
    if (view.state === "overdue") items.push({ kind: "pm", key: `pm:${view.id}`, reason: "pm_overdue", pm: view });
  }
  if ((options.blockedSync ?? 0) > 0) items.push({ kind: "sync", key: "sync:pm", reason: "sync_blocked", count: options.blockedSync as number });

  // Severity first, then the within-reason order above for work orders and the most overdue PM first; PM ties break by id.
  const attention = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => REASON_RANK[a.item.reason] - REASON_RANK[b.item.reason] || a.index - b.index)
    .map(({ item }) => item);

  return { myJobs, urgent, pmDue, focus, activeJob, moreActive, available: availableOrders(queue).length, attention };
}

/* ─── Sync status ─────────────────────────────────────────────────────────── */

export type SyncStatusKind = "offline" | "pending" | "review" | "failed" | "syncing" | "synced" | "unsynced" | "unverified";

export interface SyncStatus {
  kind: SyncStatusKind;
  /** Whole minutes since the last successful load (synced / offline / failed). */
  minutes: number | null;
  /** Saved changes that have not reached the server yet (queued or being sent). */
  pending: number;
  /** Changes that need the person: refused, stuck, in conflict or needing review. */
  attention: number;
}

/** What the engineering queues hold, from the same sources the Engineering Sync screen lists. null = could not be read. */
export interface EngineeringSyncCounts {
  /** Saved and waiting for the server (work-order actions, reports, PM inspections), including ones being sent now. */
  waiting: number;
  /** A person has to look: refused, stuck, in conflict, needing review, or a failed PM submission. */
  attention: number;
  /** Every source was readable. When false the counts are lower bounds and "all synced" must not be said. */
  verified: boolean;
}

export function buildEngineeringSyncCounts(input: {
  actions: readonly PendingAction[] | null;
  pm: PmSyncCounts | null;
  refusedReports: number | null;
  claimConflicts: number;
}): EngineeringSyncCounts {
  const wo = input.actions ? summarizePending(input.actions) : { waiting: 0, needsAttention: 0 };
  const pm = input.pm ?? { waiting: 0, syncing: 0, needsReview: 0, failed: 0 };
  const waiting = wo.waiting + pm.waiting + pm.syncing;
  const attention = wo.needsAttention + input.claimConflicts + (input.refusedReports ?? 0) + pm.needsReview + pm.failed;
  return { waiting, attention, verified: input.actions != null && input.pm != null && input.refusedReports != null };
}

/**
 * What the header may truthfully say. "Synced" only after a load actually succeeded AND every queue could be read and
 * is empty; a screen that merely mounted, or whose last refresh failed, never claims it. Saved drafts are not pending
 * uploads and are not counted here.
 */
export function resolveSyncStatus(input: {
  online: boolean;
  pending: number;
  /** Latest queue request failed. */
  failed: boolean;
  refreshing: boolean;
  syncedAt: Date | null;
  now: Date;
  /** Changes that need the person (default 0). */
  attention?: number;
  /** A sync run is sending queued changes right now. */
  sending?: boolean;
  /** Every queue could be read (default true). */
  verified?: boolean;
}): SyncStatus {
  const syncedMs = input.syncedAt?.getTime();
  const minutes = syncedMs != null && !Number.isNaN(syncedMs) ? Math.max(0, Math.floor((input.now.getTime() - syncedMs) / 60_000)) : null;
  const attention = input.attention ?? 0;
  const base = { minutes, pending: input.pending, attention };
  if (!input.online) return { kind: "offline", ...base };
  if (input.refreshing || input.sending) return { kind: "syncing", ...base };
  if (attention > 0) return { kind: "review", ...base };
  if (input.failed) return { kind: "failed", ...base };
  if (input.pending > 0) return { kind: "pending", ...base };
  if (input.verified === false) return { kind: "unverified", ...base };
  if (minutes == null) return { kind: "unsynced", ...base };
  return { kind: "synced", ...base };
}
