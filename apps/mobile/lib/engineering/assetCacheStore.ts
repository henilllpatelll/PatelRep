/* ─── Durable lookup cache for equipment this person already opened ─────────
   So a scan or a typed tag still resolves in a basement with no signal - for equipment this person already loaded
   online in THIS hotel. It is a small lookup index, not an inventory: id, name, tag, a short location and when the
   server last confirmed it. Nothing else (no history, readings or downtime) is copied to the phone.

   - Owner-scoped through offlineStore (`tenant:user`), so another account or hotel never reads it.
   - Bounded: at most MAX_CACHED_ASSETS entries (oldest-verified evicted first) and a 30 day age limit.
   - Honest: a cached hit is always reported with its last-verified time and is never proof the equipment is still
     in service; an unknown code stays unknown ("not found on this phone"), never guessed.
   - Safe to lose: reproducible read-only data, so it is the first thing to go when space is short and an unreadable
     record is simply dropped.
   Writes run strictly one after another, so two quick updates cannot overwrite each other. */

import { readScoped, removeScoped, writeScoped } from "./offlineStore";

const NAME = "assets/known";
export const MAX_CACHED_ASSETS = 300;
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedAsset {
  id: string;
  name: string;
  asset_tag: string | null;
  /** Short place text ("Room 214", "Boiler room"), when the list had one. */
  location: string | null;
  /** False once the server reported it retired. */
  is_active: boolean;
  /** When the server last confirmed this record (ISO). */
  verifiedAt: string;
}

type Known = Record<string, CachedAsset>;

function parse(raw: unknown): Known | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Known = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<CachedAsset> | null;
    if (!v || typeof v.id !== "string" || v.id !== id || typeof v.name !== "string" || typeof v.verifiedAt !== "string" || Number.isNaN(Date.parse(v.verifiedAt))) continue; // a bad entry is dropped, not half-trusted
    out[id] = {
      id: v.id,
      name: v.name,
      asset_tag: typeof v.asset_tag === "string" ? v.asset_tag : null,
      location: typeof v.location === "string" ? v.location : null,
      is_active: v.is_active !== false,
      verifiedAt: v.verifiedAt,
    };
  }
  return out;
}

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
};

async function load(now: number): Promise<Known> {
  const stored = await readScoped(NAME, parse, { maxAgeMs: CACHE_MAX_AGE_MS * 2, now });
  const known = stored?.data ?? {};
  // Individual entries expire too, so one old asset does not outlive the age limit just because the file was rewritten.
  return Object.fromEntries(Object.entries(known).filter(([, a]) => now - Date.parse(a.verifiedAt) <= CACHE_MAX_AGE_MS));
}

function bounded(known: Known): Known {
  const entries = Object.values(known);
  if (entries.length <= MAX_CACHED_ASSETS) return known;
  entries.sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt));
  return Object.fromEntries(entries.slice(0, MAX_CACHED_ASSETS).map((a) => [a.id, a]));
}

export type AssetSeen = { id: string; name: string; asset_tag?: string | null; location?: string | null; is_active?: boolean };

/** Record what the server just told us. Replaces any older entry for the same id, so a changed tag stops matching the old one. */
export function rememberAssets(assets: readonly AssetSeen[], now: number = Date.now()): Promise<boolean> {
  if (assets.length === 0) return Promise.resolve(true);
  return serial(async () => {
    const known = await load(now);
    const stamp = new Date(now).toISOString();
    for (const a of assets) {
      if (!a?.id || !a.name) continue;
      known[a.id] = { id: a.id, name: a.name, asset_tag: a.asset_tag?.trim() || null, location: a.location?.trim() || known[a.id]?.location || null, is_active: a.is_active !== false, verifiedAt: stamp };
    }
    return writeScoped(NAME, bounded(known), now);
  }).catch(() => false);
}

export interface CacheHit {
  asset: CachedAsset;
}

/** Exact id or exact tag, in this person's own cache only. Null means "not on this phone", never "does not exist". */
export async function findDurableAsset(code: { kind: "id" | "tag"; value: string }, now: number = Date.now()): Promise<CachedAsset | null> {
  try {
    const known = await serial(() => load(now));
    const wanted = code.value.trim();
    return Object.values(known).find((a) => (code.kind === "id" ? a.id.toLowerCase() === wanted.toLowerCase() : a.asset_tag?.trim() === wanted)) ?? null;
  } catch {
    return null;
  }
}

/** The server said this id/tag does not exist here (or no longer does): stop offering it. */
export function forgetAsset(code: { kind: "id" | "tag"; value: string }, now: number = Date.now()): Promise<void> {
  return serial(async () => {
    const known = await load(now);
    const wanted = code.value.trim();
    const keep = Object.fromEntries(Object.entries(known).filter(([, a]) => !(code.kind === "id" ? a.id.toLowerCase() === wanted.toLowerCase() : a.asset_tag?.trim() === wanted)));
    await writeScoped(NAME, keep, now);
  }).catch(() => undefined);
}

/** Sign-out / hotel switch cleanup for the person who is leaving. */
export function clearAssetCache(): Promise<void> {
  return serial(() => removeScoped(NAME)).catch(() => undefined);
}
