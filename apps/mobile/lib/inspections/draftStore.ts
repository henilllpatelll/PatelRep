import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseDraft, type InspectionDraft } from "@/lib/inspections/draft";

/* ─── Where inspection drafts live on this phone ────────────────────────────
   One AsyncStorage entry per hotel + person + room, so a draft can only ever be found by the account that wrote it
   and is never applied to another room. The draft's own identity fields are checked again by `judgeDraft` before it
   is used; the key is the first fence, not the only one.

   Every call reports what really happened. "Saved" is only ever claimed from a write that resolved; a storage
   failure is a result the screen must show, never a silent no-op (unlike a convenience cache). */

export const DRAFT_KEY_PREFIX = "@patelrep/mobile/inspection-draft:";

export function draftKey(hotelId: string, userId: string, roomId: string): string {
  return `${DRAFT_KEY_PREFIX}${hotelId}:${userId}:${roomId}`;
}

export type DraftRead =
  | { status: "none" }
  | { status: "found"; draft: InspectionDraft }
  /** Something is stored but it is not a draft this app can read. It is removed, never half-trusted. */
  | { status: "corrupt" }
  /** Storage could not be read: whether a draft exists is unknown. */
  | { status: "error" };

export async function readDraft(hotelId: string, userId: string, roomId: string): Promise<DraftRead> {
  const key = draftKey(hotelId, userId, roomId);
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return { status: "error" };
  }
  if (raw === null) return { status: "none" };
  try {
    const draft = parseDraft(JSON.parse(raw));
    if (draft) return { status: "found", draft };
  } catch {
    // fall through: unreadable JSON is corrupt
  }
  await removeKey(key);
  return { status: "corrupt" };
}

/** True only when the write completed. */
export async function writeDraft(draft: InspectionDraft): Promise<boolean> {
  try {
    await AsyncStorage.setItem(draftKey(draft.hotelId, draft.userId, draft.roomId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

async function removeKey(key: string): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Delete exactly this account's draft for this room; no other key is touched. True when it is gone. */
export function removeDraft(hotelId: string, userId: string, roomId: string): Promise<boolean> {
  return removeKey(draftKey(hotelId, userId, roomId));
}

/**
 * Drop this account's drafts that belong to an earlier hotel day (or cannot be read). Best effort and silent: it only
 * ever removes what could never be resumed, and never touches another account's entries.
 */
export async function sweepStaleDrafts(hotelId: string, userId: string, businessDate: string): Promise<number> {
  const prefix = `${DRAFT_KEY_PREFIX}${hotelId}:${userId}:`;
  let removed = 0;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
    for (const key of keys) {
      let keep = false;
      try {
        const raw = await AsyncStorage.getItem(key);
        const draft = raw === null ? null : parseDraft(JSON.parse(raw));
        keep = draft !== null && draft.businessDate === businessDate;
      } catch {
        keep = false;
      }
      if (!keep && (await removeKey(key))) removed += 1;
    }
  } catch {
    // nothing to sweep
  }
  return removed;
}
