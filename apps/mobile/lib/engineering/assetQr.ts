/* ─── Equipment code parsing ────────────────────────────────────────────────
   A scanned or typed code is only a LOOKUP KEY. It never authorises anything and it never becomes a destination: a QR
   that holds a web address, a deep link or free text is refused here, and the accepted forms are resolved by an
   authenticated, property-scoped API call.

   Accepted:
   - `patelrep:asset:v1:<asset-uuid>`   the versioned payload for labels PatelRep prints (no credentials, no details)
   - `<asset-uuid>`                     a bare id
   - `<asset tag>`                      the existing physical label text (assets.asset_tag), e.g. `AC-312` */

export const ASSET_QR_PREFIX = "patelrep:asset:";
export const ASSET_QR_VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG = /^[A-Za-z0-9][A-Za-z0-9._\-/#]{0,63}$/;
const MAX_CODE_LENGTH = 200;

export type AssetCodeRejection = "empty" | "too_long" | "not_an_asset_code" | "unsupported_version" | "malformed";

export type ParsedAssetCode =
  | { ok: true; kind: "id"; value: string }
  | { ok: true; kind: "tag"; value: string }
  | { ok: false; reason: AssetCodeRejection };

export function buildAssetQrPayload(assetId: string): string {
  return `${ASSET_QR_PREFIX}${ASSET_QR_VERSION}:${assetId.toLowerCase()}`;
}

export function parseAssetCode(raw: string | null | undefined): ParsedAssetCode {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_CODE_LENGTH) return { ok: false, reason: "too_long" };

  const lower = text.toLowerCase();
  if (lower.startsWith(ASSET_QR_PREFIX)) {
    const [version, ...rest] = text.slice(ASSET_QR_PREFIX.length).split(":");
    if (version?.toLowerCase() !== ASSET_QR_VERSION) return { ok: false, reason: "unsupported_version" };
    const id = rest.join(":");
    return UUID.test(id) ? { ok: true, kind: "id", value: id.toLowerCase() } : { ok: false, reason: "malformed" };
  }
  // Anything with a scheme or that looks like a web address is somebody else's QR code.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || lower.startsWith("www.") || /\s/.test(text)) {
    return { ok: false, reason: "not_an_asset_code" };
  }
  if (UUID.test(text)) return { ok: true, kind: "id", value: text.toLowerCase() };
  if (TAG.test(text)) return { ok: true, kind: "tag", value: text };
  return { ok: false, reason: "not_an_asset_code" };
}
