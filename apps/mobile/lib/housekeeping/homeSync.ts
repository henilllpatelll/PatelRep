import type { Freshness } from "@/lib/housekeeping/roomsFreshness";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";

/**
 * Home-facing summary of what the device is holding. Built only from the rows
 * the real queues report (clean sessions, the action queue, the work-order
 * queue, the task outbox) — there is no second queue behind it. Nothing here
 * says "saved" for something the server has not confirmed.
 */

export type SyncStatus =
  /** Something failed or conflicts and needs the person. */
  | "attention"
  | "offline"
  /** Changes are saved on this device and will go up when possible. */
  | "pending"
  /** Everything sent, but the room list is old or only from the device cache. */
  | "stale"
  /** No authoritative refresh yet. */
  | "unknown"
  | "synced";

export interface SyncSummary {
  online: boolean;
  freshness: Freshness;
  /** ISO time of the last authoritative room refresh; null if none since opening. */
  lastRefreshAt: string | null;
  /** The most recent room refresh failed. */
  refreshFailed: boolean;
  /** Changes waiting to be sent (pending + retrying), each checklist edit counted. */
  pending: number;
  /** Still unsent after the retry ceiling. */
  failed: number;
  /** Refused by the server; local work is kept for the person to resolve. */
  conflicts: number;
  /** Room completions finished on this device that the server has not confirmed. */
  completionsAwaitingConfirmation: number;
  /** False when a queue could not be read: "nothing waiting" would be a guess. */
  complete: boolean;
  status: SyncStatus;
  rows: SyncRow[];
}

const weight = (row: SyncRow) => row.count ?? 1;

export function buildSyncSummary(input: {
  isOnline: boolean;
  freshness: Freshness;
  lastRefreshAt: number | null;
  fetchFailed: boolean;
  rows: SyncRow[];
  rowsComplete: boolean;
}): SyncSummary {
  const { isOnline, freshness, lastRefreshAt, fetchFailed, rows, rowsComplete } = input;
  const waiting = rows.filter((row) => row.state === "pending" || row.state === "retrying");
  const pending = waiting.reduce((sum, row) => sum + weight(row), 0);
  const failed = rows.filter((row) => row.state === "failed").reduce((sum, row) => sum + weight(row), 0);
  const conflicts = rows.filter((row) => row.state === "conflict").reduce((sum, row) => sum + weight(row), 0);
  const completionsAwaitingConfirmation = waiting.filter((row) => row.kind === "completion").length;

  let status: SyncStatus;
  if (failed > 0 || conflicts > 0) status = "attention";
  else if (!isOnline) status = "offline";
  else if (pending > 0 || !rowsComplete) status = "pending";
  else if (freshness === "stale" || freshness === "cached") status = "stale";
  else if (freshness === "never") status = "unknown";
  else status = "synced";

  return {
    online: isOnline,
    freshness,
    lastRefreshAt: lastRefreshAt === null ? null : new Date(lastRefreshAt).toISOString(),
    refreshFailed: fetchFailed,
    pending,
    failed,
    conflicts,
    completionsAwaitingConfirmation,
    complete: rowsComplete,
    status,
    rows,
  };
}
