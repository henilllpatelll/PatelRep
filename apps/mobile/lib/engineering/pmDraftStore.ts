/* ─── Local PM inspection drafts ────────────────────────────────────────────
   The API has no inspection-draft endpoint, so work in progress lives on this phone only. A draft is filed under
   `${tenant}:${user}` (the offline queue owner) plus the schedule id, so another person - or the same person at another
   property - never sees it. It is labelled "local draft" everywhere and is never treated as a recorded inspection: the
   completion itself needs a connection (see submitPmCompletion). Evidence is already uploaded and referenced by id. */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getQueueOwner } from "@/lib/offline/queueOwner";
import type { PmDraft } from "./pmChecklist";

const key = (owner: string, scheduleId: string) => `engineering.pmDraft.v1:${owner}:${scheduleId}`;

export async function loadPmDraft(scheduleId: string): Promise<PmDraft | null> {
  const owner = getQueueOwner();
  if (!owner) return null;
  try {
    const raw = await AsyncStorage.getItem(key(owner, scheduleId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as PmDraft;
    // A malformed or foreign record is ignored, never half-restored.
    if (draft?.v !== 1 || draft.scheduleId !== scheduleId || typeof draft.items !== "object" || !Array.isArray(draft.identities)) return null;
    return draft;
  } catch {
    return null;
  }
}

export async function savePmDraft(draft: PmDraft): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  try {
    await AsyncStorage.setItem(key(owner, draft.scheduleId), JSON.stringify(draft));
  } catch {
    // Saving is best effort; the screen still holds the draft in memory.
  }
}

export async function clearPmDraft(scheduleId: string): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  try {
    await AsyncStorage.removeItem(key(owner, scheduleId));
  } catch {
    // Nothing to do.
  }
}

/** Schedule ids that have a saved draft for the signed-in person, so lists can say "Continue". */
export async function listPmDraftIds(): Promise<string[]> {
  const owner = getQueueOwner();
  if (!owner) return [];
  try {
    const prefix = `engineering.pmDraft.v1:${owner}:`;
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  } catch {
    return [];
  }
}
