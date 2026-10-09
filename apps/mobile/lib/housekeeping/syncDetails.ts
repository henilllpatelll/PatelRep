import { getSyncQueueSummary, type SyncQueueSummaryRow } from "@/lib/offline/db";
import { useAppStore, type OfflineAction } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import { hasPendingSync, pendingChangeCount, type LocalCleanSession } from "@/lib/housekeeping/cleanSession";

/**
 * What is actually waiting to reach the server, built only from the three real
 * queues (clean sessions, the app action queue, the work-order SQLite queue).
 * It lists a kind of change and a room — never what the person typed — and nothing
 * the app cannot really replay.
 *
 * Items leave this list only when the server confirmed them (the owning queue
 * deletes them then); this module never clears anything itself.
 */

export type SyncKind =
  | "start"
  | "checklist"
  | "linen"
  | "completion"
  | "work_order"
  | "work_order_update"
  | "room_status"
  | "task"
  | "logbook"
  | "other";

/** pending: waiting for a connection or turn. retrying: tried and will try again. failed: out of retries. conflict: the server refused it. */
export type SyncState = "pending" | "retrying" | "failed" | "conflict";

export interface SyncRow {
  key: string;
  roomId: string | null;
  kind: SyncKind;
  state: SyncState;
  /** Checklist edits batched into one row. */
  count?: number;
}

/** Mirrors the queue's own retry ceiling (lib/offline/db.ts). */
export const MAX_SYNC_ATTEMPTS = 5;

function sessionRows(sessions: Record<string, LocalCleanSession>): SyncRow[] {
  const rows: SyncRow[] = [];
  for (const [roomId, session] of Object.entries(sessions)) {
    if (session.completionConfirmed) continue;
    if (session.conflict) {
      rows.push({ key: `session-${roomId}-conflict`, roomId, kind: session.completeRequestedAt ? "completion" : "checklist", state: "conflict" });
      continue;
    }
    if (!hasPendingSync(session)) continue;
    const retrying = Boolean(session.lastError);
    if (!session.startConfirmed) rows.push({ key: `session-${roomId}-start`, roomId, kind: "start", state: retrying ? "retrying" : "pending" });
    const edits = Object.keys(session.pendingItems).length;
    if (edits > 0) rows.push({ key: `session-${roomId}-checklist`, roomId, kind: "checklist", state: retrying ? "retrying" : "pending", count: edits });
    if (session.linen?.pending) rows.push({ key: `session-${roomId}-linen`, roomId, kind: "linen", state: session.linen.failed ? "failed" : "pending" });
    if (session.completeRequestedAt) {
      rows.push({ key: `session-${roomId}-complete`, roomId, kind: "completion", state: session.completionUnsure || retrying ? "retrying" : "pending" });
    }
  }
  return rows;
}

const ACTION_KIND: Record<OfflineAction["type"], SyncKind> = {
  task_complete: "task",
  room_status: "room_status",
  work_order_update: "work_order_update",
  logbook_create: "logbook",
};

function actionRows(actions: OfflineAction[]): SyncRow[] {
  return actions.map((action) => ({
    key: `action-${action.id}`,
    roomId: action.type === "room_status" ? action.entityId : null,
    kind: ACTION_KIND[action.type] ?? "other",
    state: "pending" as SyncState,
  }));
}

function queueRows(rows: SyncQueueSummaryRow[]): SyncRow[] {
  return rows.map((row) => ({
    key: `queue-${row.id}`,
    roomId: row.room_id,
    kind: row.entity_type === "work_order" ? (row.action === "create" ? "work_order" : "work_order_update") : row.entity_type === "task" ? "task" : "other",
    state: row.attempts >= MAX_SYNC_ATTEMPTS ? "failed" : row.attempts > 0 ? "retrying" : "pending",
  }));
}

export function buildSyncRows(input: {
  sessions: Record<string, LocalCleanSession>;
  actions: OfflineAction[];
  queue: SyncQueueSummaryRow[];
}): SyncRow[] {
  return [...sessionRows(input.sessions), ...actionRows(input.actions), ...queueRows(input.queue)];
}

const QUEUE_READ_TIMEOUT_MS = 4000;

export interface LoadedSyncRows {
  rows: SyncRow[];
  /** False when the work-order queue could not be read: "nothing waiting" would be a guess. */
  complete: boolean;
}

/** Read the live queues. A failed SQLite read must not hide the in-memory ones — or pass for "all saved". */
export async function loadSyncRows(): Promise<LoadedSyncRows> {
  let queue: SyncQueueSummaryRow[] = [];
  let complete = true;
  try {
    queue = await Promise.race([
      getSyncQueueSummary(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("queue read timed out")), QUEUE_READ_TIMEOUT_MS)),
    ]);
  } catch {
    complete = false;
  }
  return {
    complete,
    rows: buildSyncRows({
      sessions: useCleanSessionStore.getState().sessions,
      actions: useAppStore.getState().pendingActions,
      queue,
    }),
  };
}

/** Changes still waiting, counting each checklist edit. Failed items count; an unreadable queue counts as one unknown. */
export async function countPendingChanges(): Promise<number> {
  const { rows, complete } = await loadSyncRows();
  return rows.reduce((sum, row) => sum + (row.count ?? 1), 0) + (complete ? 0 : 1);
}

/** Cheap, synchronous count of what the device is holding (queues + sessions) for the hub badge. */
export function countPendingSync(sessions: Record<string, LocalCleanSession>, actions: OfflineAction[]): number {
  let total = actions.length;
  for (const session of Object.values(sessions)) {
    if (session.completionConfirmed) continue;
    if (session.conflict) total += 1;
    else if (hasPendingSync(session)) total += Math.max(1, pendingChangeCount(session)) + (session.completeRequestedAt ? 1 : 0);
  }
  return total;
}
