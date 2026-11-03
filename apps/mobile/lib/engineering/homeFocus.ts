/* ─── Technician Home: the one contextual primary card ──────────────────────
   Pure state machine. Given the person's real queue, PM schedules and saved PM drafts it decides which single card the
   Home leads with. Nothing here starts, claims or completes anything; every state only links somewhere.

   Order (first match wins):
     1  my in-progress emergency          → continue_repair
     2  my other in-progress work         → continue_repair
     3  my assigned emergency (open/esc.) → start_next
     4  my assigned urgent                → start_next
     5  my other overdue assigned work    → start_next
     6  my other actionable assigned work → start_next
     7  a real saved PM draft of mine     → resume_pm
     8  unassigned work I could pick up   → available_work
     9  nothing, and everything loaded    → caught_up
   Tie-breakers inside 1-6, in order: priority (emergency first), earliest due time (no due time last), oldest created
   first (it has waited longest), then id (so the order never flickers between renders).

   "Mine" is exactly `assigned_to === viewer`; an unassigned or someone else's order is never presented as the person's
   job. A role that cannot act on work orders (chief engineer) always gets `none`. */

import { priorityRank, type WorkOrder, type WorkOrderStatus } from "@/lib/engineering/workOrders";
import type { PmDraftSummary } from "@/lib/engineering/pmDraftStore";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";

/** Statuses an engineer can start or keep working right now (on-hold work is waiting, not a job to do). */
export const ACTIONABLE_STATUSES: readonly WorkOrderStatus[] = ["open", "escalated", "in_progress"];

export interface PmDraftFocus {
  draft: PmDraftSummary;
  /** The schedule the draft belongs to, when the loaded schedules still contain it. */
  schedule: PmScheduleView | null;
}

export type FocusState =
  /** Not a technician home (or nothing to say yet): render no card. */
  | { kind: "none" }
  | { kind: "continue_repair"; wo: WorkOrder; moreActive: number }
  | { kind: "start_next"; wo: WorkOrder; queued: number }
  | { kind: "resume_pm"; pm: PmDraftFocus }
  | { kind: "available_work"; count: number }
  /** Everything that decides "all clear" loaded and found nothing. */
  | { kind: "caught_up" }
  /** Repairs are clear, but PM could not be read, so the card does not claim a full all-clear. */
  | { kind: "caught_up_pm_unknown" };

export interface FocusInput {
  /** Deduplicated active work orders (see homeModel.activeQueue). */
  queue: readonly WorkOrder[];
  viewerId: string | null | undefined;
  canAct: boolean;
  pm: readonly PmScheduleView[];
  drafts: readonly PmDraftSummary[];
  loaded: { queue: boolean; pm: boolean; drafts: boolean };
  now: Date;
}

const time = (iso: string | null | undefined, fallback: number): number => {
  if (!iso) return fallback;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? fallback : t;
};

/** Lower is more urgent. null = not a candidate for the repair cards. */
export function focusRank(wo: WorkOrder, viewerId: string | null | undefined, now: Date): number | null {
  if (!viewerId || wo.assigned_to !== viewerId) return null;
  if (!ACTIONABLE_STATUSES.includes(wo.status)) return null;
  if (wo.status === "in_progress") return wo.priority === "emergency" ? 0 : 1;
  if (wo.priority === "emergency") return 2;
  if (wo.priority === "urgent") return 3;
  const due = time(wo.due_at, NaN);
  if (!Number.isNaN(due) && due < now.getTime()) return 4;
  return 5;
}

export function compareFocus(a: WorkOrder, b: WorkOrder, viewerId: string | null | undefined, now: Date): number {
  const ra = focusRank(a, viewerId, now) ?? 99;
  const rb = focusRank(b, viewerId, now) ?? 99;
  if (ra !== rb) return ra - rb;
  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr !== 0) return pr;
  const due = time(a.due_at, Infinity) - time(b.due_at, Infinity);
  if (due !== 0 && !Number.isNaN(due)) return due;
  const created = time(a.created_at, 0) - time(b.created_at, 0);
  if (created !== 0) return created;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Newest saved draft first; a draft whose schedule is no longer an active one is not offered. */
export function pickDraft(drafts: readonly PmDraftSummary[], pm: readonly PmScheduleView[], pmLoaded: boolean): PmDraftFocus | null {
  const ordered = [...drafts].sort((a, b) => time(b.updatedAt, 0) - time(a.updatedAt, 0) || (a.scheduleId < b.scheduleId ? -1 : 1));
  for (const draft of ordered) {
    const schedule = pm.find((p) => p.id === draft.scheduleId) ?? null;
    // With the schedule list loaded, a draft for a schedule that is gone (retired / completed elsewhere) is stale.
    if (pmLoaded && !schedule) continue;
    return { draft, schedule };
  }
  return null;
}

/** My assigned, actionable orders in the order the focus card would offer them. */
export function rankedAssigned(queue: readonly WorkOrder[], viewerId: string | null | undefined, now: Date): WorkOrder[] {
  return queue.filter((wo) => focusRank(wo, viewerId, now) != null).sort((a, b) => compareFocus(a, b, viewerId, now));
}

/** Unassigned work a technician could take on (their list already excludes other people's work). */
export function availableOrders(queue: readonly WorkOrder[]): WorkOrder[] {
  return queue.filter((wo) => !wo.assigned_to && (wo.status === "open" || wo.status === "escalated"));
}

export function resolveFocus(input: FocusInput): FocusState {
  const { queue, viewerId, canAct, pm, drafts, loaded, now } = input;
  if (!canAct || !loaded.queue) return { kind: "none" };

  const ranked = rankedAssigned(queue, viewerId, now);
  const inProgress = ranked.filter((wo) => wo.status === "in_progress");
  if (inProgress.length > 0) return { kind: "continue_repair", wo: inProgress[0], moreActive: inProgress.length - 1 };

  if (ranked.length > 0) return { kind: "start_next", wo: ranked[0], queued: ranked.length };

  const draft = pickDraft(drafts, pm, loaded.pm);
  if (draft) return { kind: "resume_pm", pm: draft };

  const available = availableOrders(queue);
  if (available.length > 0) return { kind: "available_work", count: available.length };

  // An all-clear needs every source that could say otherwise to have been read.
  if (!loaded.drafts) return { kind: "none" };
  return loaded.pm ? { kind: "caught_up" } : { kind: "caught_up_pm_unknown" };
}

/** The work order the focus card presents, so Needs Attention does not repeat it. */
export function focusWorkOrderId(focus: FocusState): string | null {
  return focus.kind === "continue_repair" || focus.kind === "start_next" ? focus.wo.id : null;
}
