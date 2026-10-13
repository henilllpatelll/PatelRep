import type { OutboxEntry } from "@/lib/tasks/offline/outboxPolicy";

/* What the header chip and the Sync Status sheet say. Built only from the real outbox and the real
   connection / refresh state: connectivity alone never means "synced", and nothing is "delivered"
   until the server confirmed it (that is when the outbox drops the item). */

export type TaskSyncKey = "synced" | "syncing" | "offline" | "pending" | "stale" | "attention";
export type SyncRowState = "pending" | "sending" | "conflict" | "failed";

export interface SyncInput {
  isOnline: boolean;
  entries: Readonly<Record<string, OutboxEntry>>;
  sending: Readonly<Record<string, true>>;
  /** A list refresh is running. */
  refreshing: boolean;
  /** The last list refresh failed and older data is on screen. */
  stale: boolean;
}

export function attentionCount(entries: Readonly<Record<string, OutboxEntry>>): number {
  return Object.values(entries).filter((entry) => entry.state !== "pending").length;
}

export function pendingCount(entries: Readonly<Record<string, OutboxEntry>>): number {
  return Object.values(entries).filter((entry) => entry.state === "pending").length;
}

/** Priority: something needs a person > changes waiting > no connection > working > out of date > all synced. */
export function deriveSyncKey(input: SyncInput): TaskSyncKey {
  if (attentionCount(input.entries) > 0) return "attention";
  if (Object.keys(input.sending).length > 0) return "syncing";
  if (pendingCount(input.entries) > 0) return "pending";
  if (!input.isOnline) return "offline";
  if (input.refreshing) return "syncing";
  if (input.stale) return "stale";
  return "synced";
}

export interface SyncRow {
  key: string;
  taskId: string;
  entry: OutboxEntry;
  state: SyncRowState;
}

const ORDER: Record<SyncRowState, number> = { conflict: 0, failed: 1, sending: 2, pending: 3 };

/** One row per saved change: refused ones first, then what is being sent, then what is waiting. */
export function buildSyncRows(entries: Readonly<Record<string, OutboxEntry>>, sending: Readonly<Record<string, true>>): SyncRow[] {
  return Object.values(entries)
    .map<SyncRow>((entry) => ({
      key: entry.mutationId,
      taskId: entry.taskId,
      entry,
      state: entry.state === "pending" ? (sending[entry.taskId] ? "sending" : "pending") : entry.state,
    }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.entry.queuedAt < b.entry.queuedAt ? -1 : 1));
}
