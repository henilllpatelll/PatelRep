/* ─── Durable PM photos for work done without a connection ──────────────────
   A photo taken or picked while offline is copied out of the picker's temporary folder (which the system may empty at
   any time) into the app's own document folder, under this hotel + person. The draft stores only that file's address
   and a local id (`local:<token>`); the id can never pass the completion validator, so a local photo cannot be sent as
   if it were server evidence. Nothing here uploads: pmSyncWorker turns each local photo into a real evidence record.

   Storage is the app sandbox (NOT claimed encrypted). A file is deleted only if its address is inside THIS person's
   folder, and only when nothing (a draft or a queued completion) still refers to it. Every call reports what really
   happened and never throws at the screen. */

import { getQueueOwner } from "@/lib/offline/queueOwner";

export const PM_EVIDENCE_FOLDER = "pm-evidence";
export const LOCAL_ID_PREFIX = "local:";
/** The server rejects evidence over 10 MB; no point keeping a file that can never be accepted. */
export const MAX_PM_PHOTO_BYTES = 10 * 1024 * 1024;
/** A ceiling for unsynced photos per person, so a long outage cannot fill the phone silently. */
export const MAX_PM_LOCAL_BYTES = 150 * 1024 * 1024;
/** Unreferenced files younger than this are never swept: they may belong to a save that is still in flight. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface LocalPhotoFs {
  exists(uri: string): Promise<boolean>;
  /** 0 when the file is missing or unreadable. */
  size(uri: string): Promise<number>;
  remove(uri: string): Promise<void>;
  /** Copy `source` into `<documents>/<dir>/<name>` (creating folders) and return the new address. */
  importFile(source: string, dir: string[], name: string): Promise<string>;
  listFiles(dir: string[]): Promise<string[]>;
  dirUri(dir: string[]): Promise<string>;
}

export interface LocalPhotoDeps {
  fs: LocalPhotoFs;
  owner(): string | null;
  now(): number;
  token(): string;
}

export type LocalPhotoFailure = "no_owner" | "missing_source" | "too_large" | "quota" | "storage_full" | "save_failed";

export interface LocalPhotoRef {
  /** `local:<token>` - not an evidence record id. */
  id: string;
  /** The durable file address. */
  uri: string;
  bytes: number;
}

export type PersistResult = { ok: true; photo: LocalPhotoRef } | { ok: false; reason: LocalPhotoFailure };

export const isLocalEvidenceId = (id: string | null | undefined): boolean => typeof id === "string" && id.startsWith(LOCAL_ID_PREFIX);

/** A folder-safe name for the owner scope (`tenant:user`). Distinct owners stay distinct. */
export function ownerFolder(owner: string): string {
  return owner.replace(/[^A-Za-z0-9_-]/g, "_");
}

const dirFor = (owner: string): string[] => [PM_EVIDENCE_FOLDER, ownerFolder(owner)];

/** Token = base36 clock + random, so the age of a file is readable from its name without trusting file times. */
export function newPhotoToken(now: number = Date.now(), random: () => number = Math.random): string {
  return `${now.toString(36)}-${Math.floor(random() * 0xffffff).toString(36).padStart(5, "0")}`;
}

function tokenAgeMs(fileName: string, now: number): number | null {
  const first = fileName.split("-")[0];
  const ms = parseInt(first, 36);
  return Number.isFinite(ms) && ms > 0 ? now - ms : null;
}

const fileNameOf = (uri: string): string => decodeURIComponent(uri.split("/").pop() ?? "");

/** Whether a storage error means the phone is out of room (so the person can be told to free space, not "try again"). */
export function isStorageFull(error: unknown): boolean {
  const text = `${(error as { code?: unknown } | null)?.code ?? ""} ${(error as { message?: unknown } | null)?.message ?? ""}`;
  return /ENOSPC|no space left|disk (is )?full|not enough (storage|space)|storage (is )?full/i.test(text);
}

/** Bytes this person's unsynced photos use now. */
export async function localPhotoBytes(deps: LocalPhotoDeps = realDeps()): Promise<number> {
  const owner = deps.owner();
  if (!owner) return 0;
  try {
    const files = await deps.fs.listFiles(dirFor(owner));
    const sizes = await Promise.all(files.map((uri) => deps.fs.size(uri)));
    return sizes.reduce((sum, n) => sum + n, 0);
  } catch {
    return 0;
  }
}

/**
 * Keeps a photo on this phone for later upload. `sourceUri` is the (already re-encoded) picker copy. The copy is only
 * reported as saved after it is read back at a size the server can accept.
 */
export async function persistPmPhoto(sourceUri: string, deps: LocalPhotoDeps = realDeps()): Promise<PersistResult> {
  const owner = deps.owner();
  if (!owner) return { ok: false, reason: "no_owner" };
  const sourceBytes = await deps.fs.size(sourceUri).catch(() => 0);
  if (sourceBytes <= 0) return { ok: false, reason: "missing_source" };
  if (sourceBytes > MAX_PM_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  if ((await localPhotoBytes(deps)) + sourceBytes > MAX_PM_LOCAL_BYTES) return { ok: false, reason: "quota" };

  const token = deps.token();
  let uri: string;
  try {
    uri = await deps.fs.importFile(sourceUri, dirFor(owner), `${token}.jpg`);
  } catch (error) {
    return { ok: false, reason: isStorageFull(error) ? "storage_full" : "save_failed" };
  }
  const stored = await deps.fs.size(uri).catch(() => 0);
  if (stored <= 0 || stored > MAX_PM_PHOTO_BYTES) {
    await deps.fs.remove(uri).catch(() => undefined);
    return { ok: false, reason: "save_failed" };
  }
  return { ok: true, photo: { id: `${LOCAL_ID_PREFIX}${token}`, uri, bytes: stored } };
}

/** A kept photo counts only if its file is readable now. */
export async function localPhotoReadable(uri: string, deps: LocalPhotoDeps = realDeps()): Promise<boolean> {
  try {
    return (await deps.fs.exists(uri)) && (await deps.fs.size(uri)) > 0;
  } catch {
    return false;
  }
}

/** True only for a file inside this person's own evidence folder (the only place the app may delete from). */
export async function isOwnLocalPhoto(uri: string, deps: LocalPhotoDeps = realDeps()): Promise<boolean> {
  const owner = deps.owner();
  if (!owner || !uri) return false;
  try {
    const base = await deps.fs.dirUri(dirFor(owner));
    const prefix = base.endsWith("/") ? base : `${base}/`;
    return uri.startsWith(prefix) && !uri.slice(prefix.length).includes("/") && !uri.includes("..");
  } catch {
    return false;
  }
}

/** Deletes one kept photo. A file outside this person's folder is left alone. */
export async function removeLocalPhoto(uri: string, deps: LocalPhotoDeps = realDeps()): Promise<boolean> {
  if (!(await isOwnLocalPhoto(uri, deps))) return false;
  try {
    await deps.fs.remove(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes files nothing refers to any more (a save that never landed, a discarded draft whose cleanup was interrupted).
 * `referenced` must be every address any draft or queued completion still holds; recent files are never touched.
 */
export async function sweepOrphanPhotos(referenced: ReadonlySet<string>, deps: LocalPhotoDeps = realDeps()): Promise<number> {
  const owner = deps.owner();
  if (!owner) return 0;
  let removed = 0;
  try {
    const now = deps.now();
    for (const uri of await deps.fs.listFiles(dirFor(owner))) {
      if (referenced.has(uri)) continue;
      const age = tokenAgeMs(fileNameOf(uri), now);
      if (age == null || age < ORPHAN_GRACE_MS) continue;
      if (await removeLocalPhoto(uri, deps)) removed += 1;
    }
  } catch {
    // Sweeping is housekeeping; the next run tries again.
  }
  return removed;
}

/* ─── The real phone ────────────────────────────────────────────────────── */

export function realFs(): LocalPhotoFs {
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
      const { File } = await load();
      const file = new File(uri);
      if (file.exists) file.delete();
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
    async dirUri(dir) {
      const { Directory, Paths } = await load();
      return new Directory(Paths.document, ...dir).uri;
    },
  };
}

export function realDeps(): LocalPhotoDeps {
  return { fs: realFs(), owner: getQueueOwner, now: Date.now, token: () => newPhotoToken() };
}
