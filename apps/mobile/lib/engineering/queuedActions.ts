/* ─── Queued work-order actions: duplicate guard ────────────────────────────
   An intentional claim or completion is queued ONCE. A second tap, a re-opened sheet or a retry after a screen
   reload must not add another row, because each row would replay (and a refused first one would be followed by a
   second try). The check reads the real queue, so it also holds across a restart. A row the server already refused
   does not count: the person may deliberately redo the action once the cause is resolved. */

import { getSyncQueueSummary, type SyncQueueSummaryRow } from "@/lib/offline/db";

export type QueuedWorkOrderAction = "claim" | "complete";

export function hasLiveQueuedAction(rows: readonly SyncQueueSummaryRow[], woId: string, action: QueuedWorkOrderAction): boolean {
  return rows.some((r) => r.entity_type === "work_order" && r.action === action && r.entity_id === woId && !r.last_error);
}

/** True when this person already has that action waiting for this order. An unreadable queue answers false (the caller then queues). */
export async function isActionAlreadyQueued(woId: string, action: QueuedWorkOrderAction): Promise<boolean> {
  try {
    return hasLiveQueuedAction(await getSyncQueueSummary(), woId, action);
  } catch {
    return false;
  }
}
