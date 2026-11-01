/* ─── Engineering offline store ─────────────────────────────────────────────
   The one place engineering drafts, the cached work and the "recently synced" list touch AsyncStorage.

   Storage: AsyncStorage (plain, app-sandboxed; NOT encrypted - no stronger guarantee is claimed). Nothing secret is
   ever written here: no tokens, no guest names, only operational work-order content the person already typed or saw.
   Scope: every key carries the queue owner (`${tenant}:${user}`) and every envelope repeats it, so a record is only
   ever read for the exact person + hotel that wrote it, even if a key were somehow reused.
   Shape: `{ v, owner, savedAt, data }`. A record with another version, owner or shape - or one that is malformed or
   past its age limit - is removed and reported as missing, never half-trusted. */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getQueueOwner } from "@/lib/offline/queueOwner";

export const STORE_VERSION = 1;
const ROOT = "@patelrep/eng/v1";

interface Envelope<T> {
  v: number;
  owner: string;
  savedAt: string;
  data: T;
}

export interface Stored<T> {
  data: T;
  savedAt: string;
}

const ownerPrefix = (owner: string) => `${ROOT}/${owner}/`;
const keyFor = (owner: string, name: string) => `${ownerPrefix(owner)}${name}`;

export interface ReadOptions {
  /** Older than this (from `savedAt`) is treated as missing and removed. */
  maxAgeMs?: number;
  now?: number;
}

/** Reads one record for the signed-in person. `parse` validates the payload; returning null discards the record. */
export async function readScoped<T>(name: string, parse: (raw: unknown) => T | null, options: ReadOptions = {}): Promise<Stored<T> | null> {
  const owner = getQueueOwner();
  if (!owner) return null;
  const key = keyFor(owner, name);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    let envelope: Partial<Envelope<unknown>> | null = null;
    try {
      envelope = JSON.parse(raw) as Partial<Envelope<unknown>>;
    } catch {
      envelope = null;
    }
    const savedAtMs = typeof envelope?.savedAt === "string" ? new Date(envelope.savedAt).getTime() : NaN;
    const now = options.now ?? Date.now();
    const valid =
      envelope != null &&
      envelope.v === STORE_VERSION &&
      envelope.owner === owner &&
      !Number.isNaN(savedAtMs) &&
      savedAtMs <= now + 5 * 60 * 1000 &&
      (options.maxAgeMs == null || now - savedAtMs <= options.maxAgeMs);
    const data = valid ? parse(envelope!.data) : null;
    if (data == null) {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      return null;
    }
    return { data, savedAt: envelope!.savedAt as string };
  } catch {
    return null;
  }
}

/** Best effort: a full or unavailable disk must never break the screen, which still holds the data in memory. */
export async function writeScoped<T>(name: string, data: T, now: number = Date.now()): Promise<boolean> {
  const owner = getQueueOwner();
  if (!owner) return false;
  const envelope: Envelope<T> = { v: STORE_VERSION, owner, savedAt: new Date(now).toISOString(), data };
  try {
    await AsyncStorage.setItem(keyFor(owner, name), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export async function removeScoped(name: string): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  try {
    await AsyncStorage.removeItem(keyFor(owner, name));
  } catch {
    // Nothing to do.
  }
}

/** Names (without the owner prefix) of this person's records that start with `namePrefix`. */
export async function listScoped(namePrefix: string): Promise<string[]> {
  const owner = getQueueOwner();
  if (!owner) return [];
  try {
    const prefix = ownerPrefix(owner);
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((k) => k.startsWith(prefix + namePrefix)).map((k) => k.slice(prefix.length));
  } catch {
    return [];
  }
}

/**
 * Keeps a family of records bounded: when more than `limit` exist, the oldest (by `savedAt`) are removed. Unreadable
 * records count as oldest. Only ever touches the signed-in person's own keys.
 */
export async function pruneScoped(namePrefix: string, limit: number): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  try {
    const names = await listScoped(namePrefix);
    if (names.length <= limit) return;
    const rows = await AsyncStorage.multiGet(names.map((n) => keyFor(owner, n)));
    const dated = rows.map(([key, value], index) => {
      let at = 0;
      try {
        const parsed = value ? (JSON.parse(value) as { savedAt?: string }) : null;
        const ms = parsed?.savedAt ? new Date(parsed.savedAt).getTime() : NaN;
        at = Number.isNaN(ms) ? 0 : ms;
      } catch {
        at = 0;
      }
      return { key, at, index };
    });
    dated.sort((a, b) => a.at - b.at || a.index - b.index);
    const drop = dated.slice(0, dated.length - limit).map((d) => d.key);
    if (drop.length > 0) await AsyncStorage.multiRemove(drop);
  } catch {
    // Pruning is housekeeping; the next write tries again.
  }
}

/** Remove every record of one family for a specific owner (used when that person's cache must go). */
export async function clearOwnerFamily(owner: string, namePrefix: string): Promise<void> {
  try {
    const prefix = keyFor(owner, namePrefix);
    const keys = await AsyncStorage.getAllKeys();
    const drop = keys.filter((k) => k.startsWith(prefix));
    if (drop.length > 0) await AsyncStorage.multiRemove(drop);
  } catch {
    // Nothing to do.
  }
}
