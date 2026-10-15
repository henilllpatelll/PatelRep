import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { SyncKind, SyncState } from "@/lib/housekeeping/syncDetails";

/**
 * The Sync Status drawer's view of the one sync truth (`model.sync`, built from
 * the real queues). It adds only what is happening on screen right now (a
 * retry in flight, a retry that just finished). Nothing is ever called
 * "completed" because it was saved on this phone.
 */

export type SyncViewStatus =
  /** The server refused a saved change; the work is kept and needs the person. */
  | "conflict"
  /** A saved change ran out of retries. */
  | "failed"
  /** No connection, rooms shown from the phone's last good copy. */
  | "offline_cached"
  /** No connection and no copy of today's rooms. */
  | "offline"
  /** A retry is running now. */
  | "syncing"
  | "pending"
  /** Everything sent, but the room list is older than it should be. */
  | "stale"
  | "unknown"
  | "synced";

export type SyncRowAction =
  /** Conflicts are fixed where the work happened. */
  | { type: "room"; roomId: string }
  | { type: "tasks" }
  | null;

export interface SyncStatusRow {
  key: string;
  roomId: string | null;
  roomNumber: string | null;
  kind: SyncKind;
  state: SyncState | "syncing";
  count: number;
  savedAt: string | null;
  reason: string | null;
  action: SyncRowAction;
}

export type RetryBlock = "offline" | "nothing" | "conflicts_only" | null;

export interface SyncStatusView {
  status: SyncViewStatus;
  online: boolean;
  /** ISO time of the last sync that left nothing waiting. */
  lastSyncedAt: string | null;
  /** The room list is old or comes only from the phone. */
  staleRooms: boolean;
  rows: SyncStatusRow[];
  pending: number;
  failed: number;
  conflicts: number;
  /** A queue could not be read, so "nothing waiting" would be a guess. */
  unreadable: boolean;
  canRetry: boolean;
  retryBlock: RetryBlock;
}

export interface SyncViewInput {
  model: HomeModel;
  /** From the app store: only moves when a sync leaves nothing waiting. */
  lastSyncedAt: string | null;
  /** A retry is in flight. */
  syncing: boolean;
}

export function buildSyncStatusView({ model, lastSyncedAt, syncing }: SyncViewInput): SyncStatusView {
  const { sync } = model;
  const roomNumbers = new Map(model.dashboard.all.map((entry) => [entry.room.id, entry.room.room_number]));

  const rows: SyncStatusRow[] = sync.rows.map((row) => ({
    key: row.key,
    roomId: row.roomId,
    roomNumber: row.roomId ? (roomNumbers.get(row.roomId) ?? null) : null,
    kind: row.kind,
    state: syncing && (row.state === "pending" || row.state === "retrying") ? "syncing" : row.state,
    count: row.count ?? 1,
    savedAt: row.savedAt ?? null,
    reason: row.reason ?? null,
    action:
      row.state === "conflict" || row.state === "failed"
        ? row.kind === "task"
          ? { type: "tasks" }
          : row.roomId
            ? { type: "room", roomId: row.roomId }
            : null
        : null,
  }));

  const hasRoomCopy = model.board.state === "ready" || model.board.state === "empty";
  const staleRooms = sync.freshness === "stale" || sync.freshness === "cached";

  let status: SyncViewStatus;
  if (sync.conflicts > 0) status = "conflict";
  else if (sync.failed > 0) status = "failed";
  else if (!sync.online) status = hasRoomCopy ? "offline_cached" : "offline";
  else if (syncing) status = "syncing";
  else if (sync.pending > 0 || !sync.complete) status = "pending";
  else if (staleRooms) status = "stale";
  else if (sync.freshness === "never") status = "unknown";
  else status = "synced";

  const retryable = rows.some((row) => row.state !== "conflict");
  let retryBlock: RetryBlock = null;
  if (!sync.online) retryBlock = "offline";
  else if (rows.length === 0 && sync.complete) retryBlock = "nothing";
  else if (rows.length > 0 && !retryable) retryBlock = "conflicts_only";

  return {
    status,
    online: sync.online,
    lastSyncedAt,
    staleRooms,
    rows,
    pending: sync.pending,
    failed: sync.failed,
    conflicts: sync.conflicts,
    unreadable: !sync.complete,
    canRetry: retryBlock === null && !syncing,
    retryBlock,
  };
}
