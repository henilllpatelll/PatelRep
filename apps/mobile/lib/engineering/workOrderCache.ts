/* ─── Saved work (durable cache of confirmed server reads) ──────────────────
   What lets Work and a work order open without a connection: the last good first pages of a few queue views and
   the last good copy of recently opened orders.

   Policy:
   * only confirmed server reads are saved; a draft or a queued action is never mixed in;
   * comments, photos and free notes are NOT saved (only the operational order row);
   * every record expires after CACHE_MAX_AGE_MS and is then ignored and removed;
   * bounded: MAX_SNAPSHOTS queue views of at most MAX_SNAPSHOT_ORDERS orders, and MAX_DETAILS order copies;
   * a copy is shown only when a live read FAILED because there is no connection - never instead of a live answer,
     and never as a "forbidden" or server error. The screen labels it as saved work with its age. */

import { clearOwnerFamily, pruneScoped, readScoped, writeScoped } from "@/lib/engineering/offlineStore";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const MAX_SNAPSHOTS = 6;
export const MAX_SNAPSHOT_ORDERS = 60;
export const MAX_DETAILS = 15;

const SNAPSHOT_NAME = "cache/queue";
const detailName = (woId: string) => `cache/wo/${woId}`;

/** The operational row only: no comments, photos or free notes. */
export function slimWorkOrder(wo: WorkOrder): WorkOrder {
  const { work_order_comments: _comments, work_order_photos: _photos, notes: _notes, ...rest } = wo;
  return rest as WorkOrder;
}

function isOrder(value: unknown): value is WorkOrder {
  const wo = value as Partial<WorkOrder> | null;
  return !!wo && typeof wo === "object" && typeof wo.id === "string" && typeof wo.title === "string" && typeof wo.status === "string";
}

export interface SavedOrder {
  order: WorkOrder;
  savedAt: string;
}

export async function saveWorkOrderCopy(wo: WorkOrder, now: number = Date.now()): Promise<void> {
  const ok = await writeScoped(detailName(wo.id), slimWorkOrder(wo), now);
  if (ok) await pruneScoped("cache/wo/", MAX_DETAILS);
}

export async function loadWorkOrderCopy(woId: string, now: number = Date.now()): Promise<SavedOrder | null> {
  const stored = await readScoped<WorkOrder>(detailName(woId), (raw) => (isOrder(raw) && raw.id === woId ? raw : null), { maxAgeMs: CACHE_MAX_AGE_MS, now });
  return stored ? { order: stored.data, savedAt: stored.savedAt } : null;
}

interface Snapshot {
  orders: WorkOrder[];
  savedAt: string;
}

type SnapshotMap = Record<string, Snapshot>;

function parseSnapshots(raw: unknown, now: number): SnapshotMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SnapshotMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const snap = value as Partial<Snapshot> | null;
    const at = typeof snap?.savedAt === "string" ? new Date(snap.savedAt).getTime() : NaN;
    if (!snap || !Array.isArray(snap.orders) || Number.isNaN(at) || now - at > CACHE_MAX_AGE_MS) continue;
    const orders = snap.orders.filter(isOrder).slice(0, MAX_SNAPSHOT_ORDERS);
    out[key] = { orders, savedAt: snap.savedAt as string };
  }
  return out;
}

async function readSnapshots(now: number): Promise<SnapshotMap> {
  const stored = await readScoped<SnapshotMap>(SNAPSHOT_NAME, (raw) => parseSnapshots(raw, now), { maxAgeMs: CACHE_MAX_AGE_MS * 4, now });
  return stored?.data ?? {};
}

/** Serialises writes so two views finishing together cannot overwrite each other's snapshot. */
let writeChain: Promise<void> = Promise.resolve();

/** Saves the first page(s) of one queue view. Search text results are not worth keeping; the caller skips them. */
export function saveQueueSnapshot(key: string, orders: readonly WorkOrder[], now: number = Date.now()): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const all = await readSnapshots(now);
      all[key] = { orders: orders.slice(0, MAX_SNAPSHOT_ORDERS).map(slimWorkOrder), savedAt: new Date(now).toISOString() };
      const keys = Object.keys(all);
      if (keys.length > MAX_SNAPSHOTS) {
        keys
          .sort((a, b) => all[a].savedAt.localeCompare(all[b].savedAt))
          .slice(0, keys.length - MAX_SNAPSHOTS)
          .forEach((old) => delete all[old]);
      }
      await writeScoped(SNAPSHOT_NAME, all, now);
    })
    .catch(() => undefined);
  return writeChain;
}

export async function loadQueueSnapshot(key: string, now: number = Date.now()): Promise<{ orders: WorkOrder[]; savedAt: string } | null> {
  const snap = (await readSnapshots(now))[key];
  return snap ? { orders: snap.orders, savedAt: snap.savedAt } : null;
}

/** Removes every saved copy for one person (used when that person's hotel or account is no longer the signed-in one). */
export async function clearEngineeringCache(owner: string): Promise<void> {
  await clearOwnerFamily(owner, "cache/");
}
