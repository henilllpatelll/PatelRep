import { checkPickedAsset } from "@/lib/housekeeping/photoAsset";
import { newSubmissionId } from "@/lib/inspections/submission";

/* ─── Photo evidence for failed inspection items ────────────────────────────
   A supervisor photographs what failed. The photo is taken (or chosen), re-encoded as a JPEG of a sensible size, and
   KEPT in the app's own document folder under hotel / person / room — never in the picker's temporary cache, which the
   system may empty at any time. The draft stores only that file's address. Nothing is uploaded from here.

   What this module promises:
   • What is stored really is what it says: every photo is re-encoded (orientation applied, HEIC/PNG/WebP converted),
     so its bytes, its `.jpg` name and the `image/jpeg` it is later sent as always agree. A file is never merely renamed.
   • No photo larger than the server accepts (5 MB) is ever kept; if the first encode is too big it is retried smaller.
   • A file is only ever deleted when its address is inside THIS hotel + person + room's evidence folder.
   • A photo "exists" only if its file is readable now. A draft that points at a missing file has no photo.
   • Every call reports what really happened; nothing throws at the screen. */

/** Mirrors the server's `MAX_INSPECTION_PHOTO_BYTES`. The server remains the authority. */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_FOLDER = "inspection-evidence";
export const EVIDENCE_MIME = "image/jpeg";

/** Longest edge and JPEG quality to try, best first. Each rung is smaller, so a photo that fits one stops there. */
export const ENCODE_LADDER: readonly { edge: number; quality: number }[] = [
  { edge: 1600, quality: 0.8 },
  { edge: 1280, quality: 0.7 },
  { edge: 1024, quality: 0.6 },
];

export interface EvidenceScope {
  hotelId: string;
  userId: string;
  roomId: string;
}

export type CaptureSource = "camera" | "library";

export type CaptureFailure =
  /** The supervisor backed out. Not an error. */
  | "cancelled"
  /** Camera permission was refused; asking again is still possible. */
  | "permission_denied"
  /** Camera permission was refused for good; only the system settings can change it. */
  | "permission_blocked"
  | "camera_unavailable"
  | "picker_failed"
  | "unsupported"
  | "too_large"
  | "convert_failed"
  | "save_failed";

export interface StoredPhoto {
  /** Where the kept copy lives (inside the app's document folder). */
  uri: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export type CaptureResult = { ok: true; photo: StoredPhoto } | { ok: false; reason: CaptureFailure };

/* ─── Addresses (pure) ──────────────────────────────────────────────────── */

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function scopeParts(scope: EvidenceScope): string[] | null {
  return [scope.hotelId, scope.userId, scope.roomId].every((part) => SAFE_ID.test(part)) ? [EVIDENCE_FOLDER, scope.hotelId, scope.userId, scope.roomId] : null;
}

/** Folder segments (under the document folder) that hold one room's evidence for one person, or null for unsafe ids. */
export function evidenceDirFor(scope: EvidenceScope): string[] | null {
  return scopeParts(scope);
}

/** A file name that names the item but not the guest, the room or the person, and cannot be guessed. */
export function evidenceFileName(itemId: string, token: string): string | null {
  return SAFE_ID.test(itemId) && SAFE_ID.test(token) ? `${itemId}-${token}.jpg` : null;
}

/** True only for a `.jpg` directly inside this exact hotel + person + room evidence folder. */
export function isOwnedEvidenceUri(uri: string | null | undefined, scope: EvidenceScope): boolean {
  const parts = scopeParts(scope);
  if (!uri || !parts || !/^file:\/\//i.test(uri)) return false;
  let decoded: string;
  try {
    decoded = decodeURI(uri);
  } catch {
    return false;
  }
  if (decoded.includes("..") || decoded.includes("\\")) return false;
  const marker = `/${parts.join("/")}/`;
  const at = decoded.lastIndexOf(marker);
  if (at < 0) return false;
  const name = decoded.slice(at + marker.length);
  return /^[A-Za-z0-9_-]+\.jpg$/.test(name);
}

/* ─── What the phone provides, behind a small port so each rule can be tested ─ */

export interface PickedAsset {
  uri: string;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}
export interface PickerResult {
  canceled: boolean;
  assets?: PickedAsset[] | null;
}

export interface EvidenceFs {
  exists(uri: string): Promise<boolean>;
  /** 0 when the file is missing or unreadable. */
  size(uri: string): Promise<number>;
  /** Delete a file or folder. Idempotent. */
  remove(uri: string): Promise<void>;
  /** Copy `source` into `<documents>/<dir>/<name>` (creating folders) and return the new address. */
  importFile(source: string, dir: string[], name: string): Promise<string>;
  listFiles(dir: string[]): Promise<string[]>;
  listDirs(dir: string[]): Promise<string[]>;
  dirUri(dir: string[]): Promise<string>;
}

export interface EvidenceDeps {
  requestCamera(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  launchCamera(): Promise<PickerResult>;
  launchLibrary(): Promise<PickerResult>;
  /** Re-encode as JPEG (orientation applied), no larger than `edge` on the long side. */
  encode(asset: PickedAsset, rung: { edge: number; quality: number }): Promise<{ uri: string; width: number | null; height: number | null }>;
  /** Remove a temporary copy the picker or encoder left in the system cache. */
  discardTemp(uri: string): Promise<void>;
  fs: EvidenceFs;
  token(): string;
}

/* ─── Taking or choosing a photo ────────────────────────────────────────── */

export async function captureEvidence(source: CaptureSource, scope: EvidenceScope, itemId: string, deps: EvidenceDeps = realDeps()): Promise<CaptureResult> {
  const dir = evidenceDirFor(scope);
  const name = evidenceFileName(itemId, deps.token());
  if (!dir || !name) return { ok: false, reason: "save_failed" };

  if (source === "camera") {
    let permission: { granted: boolean; canAskAgain: boolean };
    try {
      permission = await deps.requestCamera();
    } catch {
      return { ok: false, reason: "camera_unavailable" };
    }
    if (!permission.granted) return { ok: false, reason: permission.canAskAgain ? "permission_denied" : "permission_blocked" };
  }

  let picked: PickerResult;
  try {
    picked = source === "camera" ? await deps.launchCamera() : await deps.launchLibrary();
  } catch {
    return { ok: false, reason: source === "camera" ? "camera_unavailable" : "picker_failed" };
  }
  const asset = picked.canceled ? null : (picked.assets?.[0] ?? null);
  if (!asset) return { ok: false, reason: "cancelled" };

  const temps: string[] = [asset.uri];
  try {
    const problem = checkPickedAsset(asset);
    if (problem) return { ok: false, reason: problem };

    for (const rung of ENCODE_LADDER) {
      let encoded: { uri: string; width: number | null; height: number | null };
      try {
        encoded = await deps.encode(asset, rung);
      } catch {
        return { ok: false, reason: "convert_failed" };
      }
      temps.push(encoded.uri);
      const bytes = await deps.fs.size(encoded.uri);
      if (bytes <= 0) return { ok: false, reason: "convert_failed" };
      if (bytes > MAX_EVIDENCE_BYTES) continue;
      try {
        const uri = await deps.fs.importFile(encoded.uri, dir, name);
        // Trust the copy only if it is really there and the size the server will see.
        const stored = await deps.fs.size(uri);
        if (stored <= 0 || stored > MAX_EVIDENCE_BYTES) {
          await deps.fs.remove(uri).catch(() => undefined);
          return { ok: false, reason: "save_failed" };
        }
        return { ok: true, photo: { uri, bytes: stored, width: encoded.width, height: encoded.height } };
      } catch {
        return { ok: false, reason: "save_failed" };
      }
    }
    return { ok: false, reason: "too_large" };
  } finally {
    // The picker's and encoder's temporary copies are never needed again, whatever happened.
    await Promise.all(temps.map((uri) => deps.discardTemp(uri).catch(() => undefined)));
  }
}

/* ─── Keeping, checking and cleaning up ─────────────────────────────────── */

/** Delete one kept photo. Does nothing for an address outside this scope's evidence folder. */
export async function deleteEvidence(uri: string | null | undefined, scope: EvidenceScope, fs: EvidenceFs = realFs()): Promise<boolean> {
  if (!uri || !isOwnedEvidenceUri(uri, scope)) return false;
  try {
    await fs.remove(uri);
    return true;
  } catch {
    return false;
  }
}

/** Delete everything kept for one room of one person (the inspection was discarded). */
export async function deleteRoomEvidence(scope: EvidenceScope, fs: EvidenceFs = realFs()): Promise<boolean> {
  const dir = evidenceDirFor(scope);
  if (!dir) return false;
  try {
    await fs.remove(await fs.dirUri(dir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Which of a draft's photos can no longer be used? A photo is usable only if it is one of OURS (right scope), still
 * exists, is not empty and is not over the server's limit. Anything else must read as "no photo".
 */
export async function findMissingEvidence(photos: Readonly<Record<string, string | undefined>>, scope: EvidenceScope, fs: EvidenceFs = realFs()): Promise<string[]> {
  const missing: string[] = [];
  for (const [itemId, uri] of Object.entries(photos)) {
    if (!uri) continue;
    let usable = false;
    if (isOwnedEvidenceUri(uri, scope)) {
      try {
        if (await fs.exists(uri)) {
          const bytes = await fs.size(uri);
          usable = bytes > 0 && bytes <= MAX_EVIDENCE_BYTES;
        }
      } catch {
        usable = false;
      }
    }
    if (!usable) missing.push(itemId);
  }
  return missing;
}

/** Remove files in this room's evidence folder that no draft photo refers to (an abandoned capture, a replaced photo). */
export async function pruneEvidence(scope: EvidenceScope, referenced: readonly string[], fs: EvidenceFs = realFs()): Promise<number> {
  const dir = evidenceDirFor(scope);
  if (!dir) return 0;
  let removed = 0;
  try {
    const keep = new Set(referenced);
    for (const uri of await fs.listFiles(dir)) {
      if (keep.has(uri) || !isOwnedEvidenceUri(uri, scope)) continue;
      await fs.remove(uri);
      removed += 1;
    }
  } catch {
    // best effort: leftovers are tidied on the next visit
  }
  return removed;
}

/** For one person: remove the evidence folders of rooms that have no draft any more. Never touches anyone else's. */
export async function sweepEvidence(hotelId: string, userId: string, roomsWithDrafts: ReadonlySet<string>, fs: EvidenceFs = realFs()): Promise<number> {
  if (!SAFE_ID.test(hotelId) || !SAFE_ID.test(userId)) return 0;
  let removed = 0;
  try {
    const base = [EVIDENCE_FOLDER, hotelId, userId];
    for (const room of await fs.listDirs(base)) {
      if (roomsWithDrafts.has(room) || !SAFE_ID.test(room)) continue;
      await fs.remove(await fs.dirUri([...base, room]));
      removed += 1;
    }
  } catch {
    // nothing to sweep
  }
  return removed;
}

/* ─── The real phone ────────────────────────────────────────────────────── */

function realFs(): EvidenceFs {
  const load = () => import("expo-file-system");
  return {
    async exists(uri) {
      const { File } = await load();
      return new File(uri).exists;
    },
    async size(uri) {
      const { File } = await load();
      const file = new File(uri);
      return file.exists ? file.size : 0;
    },
    async remove(uri) {
      const { File, Directory } = await load();
      const file = new File(uri);
      if (file.exists) {
        file.delete();
        return;
      }
      const directory = new Directory(uri);
      if (directory.exists) directory.delete();
    },
    async importFile(source, dir, name) {
      const { File, Directory, Paths } = await load();
      const folder = new Directory(Paths.document, ...dir);
      folder.create({ intermediates: true, idempotent: true });
      const target = new File(folder, name);
      await new File(source).copy(target);
      return target.uri;
    },
    async listFiles(dir) {
      const { File, Directory, Paths } = await load();
      const folder = new Directory(Paths.document, ...dir);
      return folder.exists ? folder.list().filter((entry) => entry instanceof File).map((entry) => entry.uri) : [];
    },
    async listDirs(dir) {
      const { Directory, Paths } = await load();
      const folder = new Directory(Paths.document, ...dir);
      return folder.exists ? folder.list().filter((entry) => entry instanceof Directory).map((entry) => entry.name) : [];
    },
    async dirUri(dir) {
      const { Directory, Paths } = await load();
      return new Directory(Paths.document, ...dir).uri;
    },
  };
}

function realDeps(): EvidenceDeps {
  return {
    async requestCamera() {
      const Picker = await import("expo-image-picker");
      const result = await Picker.requestCameraPermissionsAsync();
      return { granted: result.status === "granted", canAskAgain: result.canAskAgain !== false };
    },
    async launchCamera() {
      const Picker = await import("expo-image-picker");
      return Picker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
    },
    async launchLibrary() {
      // The system photo picker needs no library permission, so none is requested.
      const Picker = await import("expo-image-picker");
      return Picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, allowsMultipleSelection: false });
    },
    async encode(asset, rung) {
      const Manipulator = await import("expo-image-manipulator");
      const { width, height } = asset;
      // Shrink only: never enlarge a small photo. Unknown dimensions are bounded by width, the usual long edge.
      const actions: { resize: { width?: number; height?: number } }[] = [];
      if (typeof width === "number" && typeof height === "number") {
        if (Math.max(width, height) > rung.edge) actions.push({ resize: width >= height ? { width: rung.edge } : { height: rung.edge } });
      } else {
        actions.push({ resize: { width: rung.edge } });
      }
      const result = await Manipulator.manipulateAsync(asset.uri, actions, { compress: rung.quality, format: Manipulator.SaveFormat.JPEG });
      return { uri: result.uri, width: result.width ?? null, height: result.height ?? null };
    },
    async discardTemp(uri) {
      // Only the app's own cache copies; never a file in the person's library.
      const { discardLocalPhoto } = await import("@/lib/housekeeping/photoAsset");
      discardLocalPhoto(uri);
    },
    fs: realFs(),
    token: newSubmissionId,
  };
}

/** Open the system settings so a blocked camera permission can be turned on. */
export async function openCameraSettings(): Promise<void> {
  try {
    const { Linking } = await import("react-native");
    await Linking.openSettings();
  } catch {
    // nothing more can be done from here
  }
}
