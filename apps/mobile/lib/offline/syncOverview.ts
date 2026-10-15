import type { SyncKind, SyncRow, SyncState } from "@/lib/housekeeping/syncDetails";

/**
 * One plain-language picture of everything this phone is holding for the server, built only from the
 * rows the real queues report (lib/housekeeping/syncDetails). It owns no queue and stores nothing.
 */

export type OverviewStatus = "unavailable" | "attention" | "syncing" | "offline" | "waiting" | "saved";

export type CategoryKey = "rooms" | "tasks" | "sessions" | "other";

export interface OverviewCategory {
  key: CategoryKey;
  /** Changes waiting or retrying (not counting those needing attention). */
  pending: number;
  /** Changes that failed or were refused and need the person. */
  attention: number;
  rows: SyncRow[];
}

export interface SyncOverview {
  status: OverviewStatus;
  online: boolean;
  syncing: boolean;
  pending: number;
  attention: number;
  total: number;
  /** False until the queues were read at least once, or when one could not be read. */
  reliable: boolean;
  categories: OverviewCategory[];
  rows: SyncRow[];
  lastSyncedAt: string | null;
}

const KIND_CATEGORY: Record<SyncKind, CategoryKey> = {
  room_status: "rooms",
  task: "tasks",
  work_order: "tasks",
  work_order_update: "tasks",
  start: "sessions",
  checklist: "sessions",
  linen: "sessions",
  completion: "sessions",
  logbook: "other",
  other: "other",
};

const NEEDS_PERSON: ReadonlySet<SyncState> = new Set(["failed", "conflict"]);
const weight = (row: SyncRow) => row.count ?? 1;

export const categoryOf = (kind: SyncKind): CategoryKey => KIND_CATEGORY[kind] ?? "other";

/** Which categories are listed even when empty, so "Rooms - All synced" is shown where it applies. */
export function relevantCategories(role: string | null | undefined): CategoryKey[] {
  const floor = role === "housekeeper" || role === "inspector" || role === "housekeeping_supervisor";
  return floor ? ["rooms", "tasks", "sessions"] : ["tasks"];
}

export function buildOverview(input: {
  rows: SyncRow[];
  /** Every queue was read. */
  complete: boolean;
  /** The first read has finished. */
  loaded: boolean;
  online: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  role?: string | null;
}): SyncOverview {
  const byKey = new Map<CategoryKey, OverviewCategory>();
  for (const key of relevantCategories(input.role)) byKey.set(key, { key, pending: 0, attention: 0, rows: [] });
  let pending = 0;
  let attention = 0;
  for (const row of input.rows) {
    const key = categoryOf(row.kind);
    const category = byKey.get(key) ?? { key, pending: 0, attention: 0, rows: [] };
    category.rows.push(row);
    if (NEEDS_PERSON.has(row.state)) {
      category.attention += weight(row);
      attention += weight(row);
    } else {
      category.pending += weight(row);
      pending += weight(row);
    }
    byKey.set(key, category);
  }
  const order: CategoryKey[] = ["rooms", "tasks", "sessions", "other"];
  const categories = order.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  const reliable = input.loaded && input.complete;

  let status: OverviewStatus;
  if (attention > 0) status = "attention";
  else if (input.syncing && pending > 0) status = "syncing";
  else if (!input.online) status = "offline";
  else if (pending > 0) status = "waiting";
  // "All saved" is only claimed when every queue was actually read.
  else if (!reliable) status = "unavailable";
  else status = "saved";

  return {
    status,
    online: input.online,
    syncing: input.syncing,
    pending,
    attention,
    total: pending + attention,
    reliable,
    categories,
    rows: input.rows,
    lastSyncedAt: input.lastSyncedAt,
  };
}
