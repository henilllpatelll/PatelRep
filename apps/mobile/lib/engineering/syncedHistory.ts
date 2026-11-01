/* ─── Recently synced ───────────────────────────────────────────────────────
   A short, bounded list of changes the SERVER confirmed after they had been saved on this phone (an offline claim
   or completion that replayed and was accepted, or whose earlier attempt was proven to have landed). It is written
   only from the sync's confirmed branch - never when something is merely queued or sent - and holds a work-order
   id, a short caption and a kind, never typed content. Per person + hotel; expires with the other engineering data. */

import { readScoped, writeScoped } from "@/lib/engineering/offlineStore";

export type SyncedKind = "claim" | "complete";

export interface SyncedEntry {
  woId: string;
  kind: SyncedKind;
  label: string | null;
  /** When the server confirmed it (ISO). */
  at: string;
}

export const MAX_SYNCED = 10;
export const SYNCED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NAME = "synced";

function parse(raw: unknown): SyncedEntry[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((e): e is SyncedEntry => {
      const x = e as Partial<SyncedEntry> | null;
      return !!x && typeof x.woId === "string" && (x.kind === "claim" || x.kind === "complete") && typeof x.at === "string" && !Number.isNaN(new Date(x.at).getTime());
    })
    .map((e) => ({ woId: e.woId, kind: e.kind, label: typeof e.label === "string" ? e.label.slice(0, 120) : null, at: e.at }));
}

/** Newest first, expired entries dropped, at most MAX_SYNCED. Pure, so the bound is testable. */
export function mergeSynced(existing: readonly SyncedEntry[], entry: SyncedEntry, now: number = Date.now()): SyncedEntry[] {
  return [entry, ...existing.filter((e) => !(e.woId === entry.woId && e.kind === entry.kind))]
    .filter((e) => now - new Date(e.at).getTime() <= SYNCED_MAX_AGE_MS)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_SYNCED);
}

export async function loadRecentlySynced(now: number = Date.now()): Promise<SyncedEntry[]> {
  const stored = await readScoped<SyncedEntry[]>(NAME, parse, { now });
  return (stored?.data ?? []).filter((e) => now - new Date(e.at).getTime() <= SYNCED_MAX_AGE_MS);
}

let chain: Promise<void> = Promise.resolve();

/** Call ONLY after the server confirmed the change. */
export function recordSynced(entry: Omit<SyncedEntry, "at"> & { at?: string }): Promise<void> {
  chain = chain
    .then(async () => {
      const now = Date.now();
      const existing = await loadRecentlySynced(now);
      await writeScoped(NAME, mergeSynced(existing, { ...entry, at: entry.at ?? new Date(now).toISOString() }, now), now);
    })
    .catch(() => undefined);
  return chain;
}
