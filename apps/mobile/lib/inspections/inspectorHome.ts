import type { CorrectionList, DoneItem, DoneList } from "@/lib/inspections/lists";
import type { QueueItem } from "@/lib/inspections/queue";
import { priorityFacts, sortQueue, type QueueContext } from "@/lib/inspections/queueView";
import { badgeFor, type BadgeKey, type Metric } from "@/lib/inspections/viewText";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";

/* ─── Inspector Home — the model (pure) ─────────────────────────────────────
   Everything here is derived from the three things the inspection screen already reads (the verified queue, the open
   corrections, today's completed inspections). Nothing is invented: a count whose source has not answered is `null`
   ("unavailable"), never zero, and a verified-empty queue is the only way "nothing to inspect" is ever said. */

/** How many "needs attention first" rooms the Home lists. The queue itself is one tap away. */
export const PRIORITY_LIMIT = 3;
/** How many recent results the Home lists. */
export const RECENT_LIMIT = 3;

export interface InspectorHomeInput {
  /** null until the queue has been verified (loading / failed with nothing to show). */
  items: readonly QueueItem[] | null;
  /** null until the corrections have been verified. */
  corrections: CorrectionList | null;
  /** null until today's inspections have been verified. */
  done: DoneList | null;
  ctx: QueueContext;
}

export interface InspectorHomeModel {
  /** The room to inspect next, from the same priority order the queue uses; null = nothing known / nothing waiting. */
  focus: QueueItem | null;
  /** Up to PRIORITY_LIMIT other waiting rooms that carry a recorded reason to go first (overdue, reinspection, arrival, VIP, priority). */
  priority: Array<{ item: QueueItem; badge: BadgeKey }>;
  metrics: {
    awaiting: Metric;
    completed: Metric;
    failed: Metric;
    reinspection: Metric;
  };
  /** Newest-first completed inspections for today. */
  recent: DoneItem[];
  /** The queue is verified empty AND something was inspected today. */
  allComplete: boolean;
  /** The queue is verified empty and nothing has been inspected yet today. */
  nothingWaiting: boolean;
}

export function buildInspectorHome({ items, corrections, done, ctx }: InspectorHomeInput): InspectorHomeModel {
  const ordered = items ? sortQueue(items, "priority", ctx) : [];
  const focus = ordered[0] ?? null;
  const priority: InspectorHomeModel["priority"] = [];
  for (const item of ordered.slice(1)) {
    const badge = badgeFor(priorityFacts(item, ctx));
    if (!badge) continue;
    priority.push({ item, badge });
    if (priority.length === PRIORITY_LIMIT) break;
  }
  const failedToday = done ? done.items.filter((entry) => entry.result === "failed").length : null;
  const doneCount = done ? done.items.length : null;
  return {
    focus,
    priority,
    metrics: {
      awaiting: { value: items ? items.length : null, atLeast: false },
      completed: { value: doneCount, atLeast: false },
      failed: { value: failedToday, atLeast: false },
      reinspection: { value: corrections ? corrections.items.length : null, atLeast: corrections?.truncated ?? false },
    },
    recent: done ? done.items.slice(0, RECENT_LIMIT) : [],
    allComplete: items !== null && items.length === 0 && (doneCount ?? 0) > 0,
    nothingWaiting: items !== null && items.length === 0 && doneCount === 0,
  };
}

/* ─── What the Home can say about the queue itself ───────────────────────────── */

export type QueueAccess =
  /** A verified (or last-known) answer is showing. */
  | "ok"
  /** First load in flight. */
  | "loading"
  /** The server refused this account (401/403): not the same as an empty queue. */
  | "restricted"
  /** Nothing to show and the request failed (offline included). */
  | "unavailable";

export function queueAccess(queue: SourceState<unknown>): QueueAccess {
  switch (queue.status) {
    case "loading":
      return "loading";
    case "failed":
      return queue.failure.kind === "forbidden" ? "restricted" : "unavailable";
    default:
      return "ok";
  }
}
