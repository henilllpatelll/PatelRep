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

/** Writes and removals for one draft run strictly in the order they were asked for, so an older save that is still in
 * flight can never land after a newer one (or resurrect a draft that was just cleared). */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(storageKey: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(storageKey) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => undefined);
  queues.set(storageKey, tail);
  void tail.then(() => {
    if (queues.get(storageKey) === tail) queues.delete(storageKey);
  });
  return run;
}

/** Whether the draft is now on this phone. False means it exists only in memory (storage full or unavailable). */
export async function savePmDraft(draft: PmDraft): Promise<boolean> {
  const owner = getQueueOwner();
  if (!owner) return false;
  const storageKey = key(owner, draft.scheduleId);
  const body = JSON.stringify(draft);
  try {
    await enqueue(storageKey, () => AsyncStorage.setItem(storageKey, body));
    return true;
  } catch {
    return false;
  }
}

export async function clearPmDraft(scheduleId: string): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  const storageKey = key(owner, scheduleId);
  try {
    await enqueue(storageKey, () => AsyncStorage.removeItem(storageKey));
  } catch {
    // Nothing to do.
  }
}

export interface PmDraftSummary {
  scheduleId: string;
  /** Checklist items with a recorded result. */
  answered: number;
  total: number;
  updatedAt: string;
}

/** Real saved drafts for the signed-in person, with how far each got. A malformed record is skipped, never half-read. */
export async function listPmDraftSummaries(): Promise<PmDraftSummary[]> {
  const owner = getQueueOwner();
  if (!owner) return [];
  try {
    const prefix = `engineering.pmDraft.v1:${owner}:`;
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    const summaries: PmDraftSummary[] = [];
    for (const k of keys) {
      const draft = await loadPmDraft(k.slice(prefix.length));
      if (!draft) continue;
      const answered = Object.values(draft.items).filter((item) => item?.result != null).length;
      summaries.push({ scheduleId: draft.scheduleId, answered, total: draft.identities.length, updatedAt: draft.updatedAt });
    }
    return summaries;
  } catch {
    return [];
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
