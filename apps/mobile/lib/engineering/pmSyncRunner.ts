/* ─── Running queued PM completions for real ────────────────────────────────
   Connects pmSyncWorker to the owner-scoped SQLite queue, the evidence/completion API and the phone's files, and turns
   each outcome into the one correct queue change:
     recorded -> the row goes, THEN its photos (nothing is removed before the server confirmed);
     retry    -> one more attempt counted, retried later with backoff;
     stopped  -> the row is marked refused with its reason and kept, with everything saved, for the person;
     paused   -> nothing changes (another account, signed out, or the session needs refreshing).
   One run at a time app-wide: a reconnect burst, a screen focus and a tap on Sync now all join the same run. */

import { create } from "zustand";
import { completePmSchedule } from "@/lib/api/assets";
import { createPmEvidenceRecord, deletePmEvidence, getPmEvidenceRecord, listScheduleCompletions, uploadPmEvidenceFile } from "@/lib/api/pm";
import { MAX_SYNC_ATTEMPTS } from "@/lib/housekeeping/syncDetails";
import { deleteSyncQueueItem, incrementSyncQueueAttempts, markSyncQueueItemRefused, reopenSyncQueueItem, retrySyncQueueItem } from "@/lib/offline/db";
import { getQueueOwner } from "@/lib/offline/queueOwner";
import { useAppStore } from "@/stores/appStore";
import { markAssetListStale } from "./useAssetBrowse";
import { resetPmScheduleCache } from "./usePmSchedules";
import { listQueuedCompletions, listQueuedCompletionsStrict, saveProgress, type QueuedPmRow } from "./pmCompletionQueue";
import { clearPmDraft, listPmDraftLocalUris } from "./pmDraftStore";
import { localPhotoReadable, removeLocalPhoto, sweepOrphanPhotos } from "./pmLocalEvidence";
import { createBackoff, replayCompletion, type PmSyncEvent, type SyncDeps } from "./pmSyncWorker";

/** Rows being replayed right now, so screens can say "Syncing" for exactly those. */
export const usePmSyncActivity = create<{ active: number[] }>(() => ({ active: [] }));

const backoff = createBackoff();
let current: Promise<void> | null = null;

/** The person pressed Sync now / Retry: forget any waiting period. */
export const clearPmBackoff = (rowId?: number): void => backoff.clear(rowId);

/** Safe operation ids and short codes only: never tokens, notes, signed URLs or file paths. */
function log(event: PmSyncEvent, data?: { op: string; code?: string }): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  console.info("[pm-sync]", event, data ?? {});
}

export function realSyncDeps(): SyncDeps {
  return {
    owner: getQueueOwner,
    online: () => useAppStore.getState().isOnline,
    currentUserId: () => useAppStore.getState().user?.id ?? null,
    createEvidence: (input) => createPmEvidenceRecord(input),
    uploadFile: (id, uri) => uploadPmEvidenceFile(id, uri),
    getEvidence: (id) => getPmEvidenceRecord(id),
    deleteEvidence: (id) => deletePmEvidence(id),
    complete: (scheduleId, payload) => completePmSchedule(scheduleId, payload),
    listCompletions: (scheduleId) => listScheduleCompletions(scheduleId),
    fileReadable: (uri) => localPhotoReadable(uri),
    save: (rowId, q, change) => saveProgress(rowId, q, change),
    log,
  };
}

/** What changed on the server because this completion was recorded: the screens that show it reload on next view. */
function invalidateAfterRecorded(): void {
  resetPmScheduleCache();
  markAssetListStale();
}

async function runRow(row: QueuedPmRow, deps: SyncDeps): Promise<void> {
  if (!row.data) {
    // Unreadable: never replayed, never silently dropped.
    await markSyncQueueItemRefused(row.rowId, "invalid");
    return;
  }
  const data = row.data;
  usePmSyncActivity.setState((s) => ({ active: [...s.active, row.rowId] }));
  try {
    const outcome = await replayCompletion(row.rowId, data, deps);
    if (outcome.kind === "recorded") {
      await deleteSyncQueueItem(row.rowId);
      backoff.clear(row.rowId);
      await clearPmDraft(data.scheduleId); // a draft left behind by a crash between "queued" and "draft cleared"
      invalidateAfterRecorded();
      for (const ev of data.evidence) await removeLocalPhoto(ev.file); // only after the server confirmed
    } else if (outcome.kind === "retry") {
      await incrementSyncQueueAttempts(row.rowId);
      backoff.failed(row.rowId, row.attempts);
    } else if (outcome.kind === "stopped") {
      await markSyncQueueItemRefused(row.rowId, outcome.code);
    }
  } finally {
    usePmSyncActivity.setState((s) => ({ active: s.active.filter((id) => id !== row.rowId) }));
  }
}

/** Replays every waiting completion for the signed-in person, one at a time, oldest first. */
export function flushPmCompletions(deps: SyncDeps = realSyncDeps()): Promise<void> {
  if (current) return current;
  current = (async () => {
    const owner = deps.owner();
    if (!owner || deps.online?.() === false) return;
    for (const row of await listQueuedCompletions()) {
      if (deps.owner() !== owner) break; // someone else signed in: stop, replay nothing under the new identity
      if (row.lastError || row.attempts >= MAX_SYNC_ATTEMPTS) continue; // refused or out of tries: waits for the person
      if (!backoff.due(row.rowId)) continue;
      try {
        await runRow(row, deps);
      } catch (error) {
        // A local failure (SQLite, storage): leave the row as it is; the next run tries again.
        console.warn("PM sync row failed:", row.rowId, (error as { message?: string } | null)?.message);
      }
    }
  })().finally(() => {
    current = null;
  });
  return current;
}

/* ─── What the person can do with a waiting inspection ─────────────────── */

/** Stops that mean "someone else got there first / the world changed": submitting anyway is a deliberate choice. */
export const CAN_SUBMIT_ANYWAY: ReadonlySet<string> = new Set(["conflict_completed", "conflict_changed"]);

/** Try again now. A refused row is never reset by this: its cause has to be resolved first. */
export async function retryQueued(rowId: number): Promise<void> {
  await retrySyncQueueItem(rowId);
  clearPmBackoff(rowId);
}

/** The person saw that another technician already recorded this round and chose to submit theirs as well. */
export async function submitAnyway(row: QueuedPmRow): Promise<boolean> {
  if (!row.data || !row.lastError || !CAN_SUBMIT_ANYWAY.has(row.lastError)) return false;
  await saveProgress(row.rowId, row.data, { stop: null, conflictAcknowledged: true });
  await reopenSyncQueueItem(row.rowId);
  clearPmBackoff(row.rowId);
  return true;
}

/**
 * Removes an UNSENT inspection and its photos from this phone. It never reverses anything the server recorded; photos
 * that already have an empty record on the server are released best-effort.
 */
export async function discardQueued(row: QueuedPmRow): Promise<void> {
  await deleteSyncQueueItem(row.rowId);
  backoff.clear(row.rowId);
  for (const ev of row.data?.evidence ?? []) {
    if (ev.serverId) await deletePmEvidence(ev.serverId);
    await removeLocalPhoto(ev.file);
  }
}

/** Housekeeping on app start: photo files no draft and no queued inspection refers to any more. */
export async function sweepPmPhotos(): Promise<number> {
  try {
    const drafts = await listPmDraftLocalUris();
    if (drafts == null) return 0; // a draft could not be read: keep every file
    const referenced = new Set<string>(drafts);
    for (const row of await listQueuedCompletionsStrict()) {
      if (!row.data) return 0; // an unreadable queued inspection may still need its photos
      for (const ev of row.data.evidence) referenced.add(ev.file);
    }
    return await sweepOrphanPhotos(referenced);
  } catch {
    return 0;
  }
}
