import { lookupAsset, type AssetLookupResult } from "@/lib/api/assets";
import { classifyLoadFailure } from "@/lib/engineering/loadState";
import { parseAssetCode, type AssetCodeRejection } from "@/lib/engineering/assetQr";

/* ─── Resolving a scanned or typed equipment code ───────────────────────────
   The code is a lookup key, never a destination or a permission. Everything goes through parseAssetCode (which refuses
   web addresses and unknown payloads) and then an authenticated, property-scoped API call. Offline, only an asset the
   signed-in person already loaded in this hotel can be opened; anything else says a connection is needed. The "not
   found" answer is the same whether the id is unknown here or belongs to another property. */

export type LookupOutcome =
  | { kind: "found"; asset: AssetLookupResult; fromCache: boolean }
  | { kind: "invalid"; reason: AssetCodeRejection }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "forbidden" }
  | { kind: "offline" }
  | { kind: "failed" };

interface Deps {
  isOnline: boolean;
  /** An asset already loaded for this hotel + person (never another scope's), matched by id or exact tag. */
  findCached?: (code: { kind: "id" | "tag"; value: string }) => AssetLookupResult | null;
  lookup?: typeof lookupAsset;
}

export async function resolveAssetCode(raw: string, { isOnline, findCached, lookup = lookupAsset }: Deps): Promise<LookupOutcome> {
  const parsed = parseAssetCode(raw);
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };
  const code = { kind: parsed.kind, value: parsed.value };

  const fromCache = (): LookupOutcome => {
    const cached = findCached?.(code) ?? null;
    return cached ? { kind: "found", asset: cached, fromCache: true } : { kind: "offline" };
  };
  if (!isOnline) return fromCache();

  try {
    return { kind: "found", asset: await lookup(code), fromCache: false };
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 404) return { kind: "not_found" };
    if (status === 409) return { kind: "ambiguous" };
    if (status === 422) return { kind: "invalid", reason: "malformed" };
    const failure = classifyLoadFailure(err);
    if (failure === "forbidden") return { kind: "forbidden" };
    if (failure === "offline") return fromCache();
    return { kind: "failed" };
  }
}
