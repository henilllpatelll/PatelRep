/* ─── What may be attached, and tidying up afterwards ───────────────────────
   A picked photo is checked before it is shown or sent anywhere: it must look like a photo the phone can
   re-encode, and not be absurdly large (a 30 MB original is shrunk to ~1024 px before upload, but we do
   not start work on something the phone will struggle to open). The server checks the bytes again; this
   is only the first, friendly gate.

   Photos picked or resized by the app live in the system cache. Once a report is sent or discarded the
   app deletes its own cached copies so a photo is not left on the phone longer than the report needs it.
   It never touches a file outside the cache (the person's own library original). */

export const MAX_PICKED_PHOTO_BYTES = 30 * 1024 * 1024;

const ACCEPTED_TYPE = /^image\/(jpe?g|png|webp|heic|heif)$/i;

export type AssetProblem = "unsupported" | "too_large";

/** `null` when the asset may be used. A missing mime type or size is not a reason to refuse. */
export function checkPickedAsset(asset: { mimeType?: string | null; fileSize?: number | null }): AssetProblem | null {
  const type = typeof asset.mimeType === "string" ? asset.mimeType.trim() : "";
  if (type && !ACCEPTED_TYPE.test(type)) return "unsupported";
  if (typeof asset.fileSize === "number" && asset.fileSize > MAX_PICKED_PHOTO_BYTES) return "too_large";
  return null;
}

/** True only for a file in the app's own cache folders, which is the only place the app may delete from. */
export function isAppCacheUri(uri: string | null | undefined): boolean {
  if (!uri || !/^file:\/\//i.test(uri)) return false;
  return /\/(cache|caches)\//i.test(uri);
}

/** Best effort: remove a cached photo copy. Never throws, never touches anything outside the cache. */
export function discardLocalPhoto(uri: string | null | undefined): void {
  if (!isAppCacheUri(uri)) return;
  void import("expo-file-system")
    .then(({ File }) => {
      const file = new File(uri as string);
      if (file.exists) file.delete();
    })
    .catch(() => undefined);
}
