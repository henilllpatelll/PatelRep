import { lookupAsset, type AssetLookupResult } from "@/lib/api/assets";
import { classifyLoadFailure } from "@/lib/engineering/loadState";
import { parseAssetCode, type AssetCodeRejection } from "@/lib/engineering/assetQr";

/* ─── Resolving a scanned or typed equipment code ───────────────────────────
   The code is a lookup key, never a destination or a permission. Everything goes through parseAssetCode (which refuses
   web addresses and unknown payloads) and then an authenticated, property-scoped API call. Offline, only an asset the
   signed-in person already loaded in this hotel can be opened; anything else says a connection is needed. The "not
   found" answer is the same whether the id is unknown here or belongs to another property. */

export type LookupOutcome =
  | { kind: "found"; asset: AssetLookupResult; fromCache: boolean; verifiedAt?: string | null; location?: string | null }
  /** The label belongs to equipment that has been retired: it exists, but is no longer in service. */
  | { kind: "retired"; asset: AssetLookupResult }
  | { kind: "invalid"; reason: AssetCodeRejection }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "forbidden" }
  | { kind: "offline" }
  | { kind: "failed" };

/** A saved copy of equipment this person already opened, with when the server last confirmed it. */
export type CachedHit = AssetLookupResult & { verifiedAt?: string | null; location?: string | null };

interface Deps {
  isOnline: boolean;
  /** An asset already loaded for this hotel + person (never another scope's), matched by id or exact tag. */
  findCached?: (code: { kind: "id" | "tag"; value: string }) => CachedHit | null | Promise<CachedHit | null>;
  lookup?: typeof lookupAsset;
  /** Called with what the server just confirmed, so a later offline lookup can find it. */
  remember?: (asset: AssetLookupResult) => void;
  /** Called when the server says this code does not exist here, so it is no longer offered offline. */
  forget?: (code: { kind: "id" | "tag"; value: string }) => void;
}

export async function resolveAssetCode(raw: string, { isOnline, findCached, lookup = lookupAsset, remember, forget }: Deps): Promise<LookupOutcome> {
  const parsed = parseAssetCode(raw);
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };
  const code = { kind: parsed.kind, value: parsed.value };

  const fromCache = async (): Promise<LookupOutcome> => {
    const hit = (await findCached?.(code)) ?? null;
    if (!hit) return { kind: "offline" };
    const { verifiedAt, location, ...asset } = hit;
    // A saved copy that the server last called retired is still retired; it is never offered as working equipment.
    if (asset.is_active === false) return { kind: "retired", asset };
    return { kind: "found", asset, fromCache: true, ...(verifiedAt !== undefined ? { verifiedAt } : {}), ...(location !== undefined ? { location } : {}) };
  };
  if (!isOnline) return fromCache();

  try {
    const asset = await lookup(code);
    remember?.(asset);
    return asset.is_active === false ? { kind: "retired", asset } : { kind: "found", asset, fromCache: false };
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 404) {
      forget?.(code);
      return { kind: "not_found" };
    }
    if (status === 409) return { kind: "ambiguous" };
    if (status === 422) return { kind: "invalid", reason: "malformed" };
    const failure = classifyLoadFailure(err);
    if (failure === "forbidden") return { kind: "forbidden" };
    if (failure === "offline") return fromCache();
    return { kind: "failed" };
  }
}
