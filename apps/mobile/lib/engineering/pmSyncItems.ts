/* ─── What the Engineering Sync Status shows about PM inspections ───────────
   Pure: turns the real queue rows and saved drafts into the lines the screen lists. Counts are the real number of rows;
   an unreadable stored record is listed as needing review (never skipped, never counted as zero). */

import { CAN_SUBMIT_ANYWAY } from "./pmSyncRunner";
import type { PmDraftSummary } from "./pmDraftStore";
import type { QueuedPmRow } from "./pmCompletionQueue";
import { needsPerson, queuedState, type EngineeringSyncState } from "./pmSyncState";
import { MAX_SYNC_ATTEMPTS } from "@/lib/housekeeping/syncDetails";

export interface PmQueuedItem {
  rowId: number;
  scheduleId: string | null;
  label: string;
  state: EngineeringSyncState;
  /** Machine code of the stop (`conflict_completed`, ...), when it stopped. */
  stop: string | null;
  /** Photos in this inspection. */
  photos: number;
  /** Photos the server already holds. */
  photosUploaded: number;
  savedAt: string | null;
  /** The last attempt may have reached the server (a reply never arrived). */
  unknownOutcome: boolean;
  canRetry: boolean;
  canSubmitAnyway: boolean;
  canOpen: boolean;
}

/** Saved inspections that need a person (review, rejected, unknown outcome). Shared by both Engineering Homes. */
export function countBlockedPmSync(rows: readonly QueuedPmRow[], activeRowIds: readonly number[]): number {
  return buildPmQueuedItems(rows, activeRowIds, "").filter((item) => needsPerson(item.state)).length;
}

export function buildPmQueuedItems(rows: readonly QueuedPmRow[], activeRowIds: readonly number[], fallbackLabel: string): PmQueuedItem[] {
  return rows.map((row) => {
    const data = row.data;
    const stop = data ? row.lastError : "unreadable";
    const state = queuedState({ phase: data?.phase ?? "queued", stop, attempts: row.attempts, active: activeRowIds.includes(row.rowId) });
    return {
      rowId: row.rowId,
      scheduleId: data?.scheduleId ?? null,
      label: data?.scheduleName || fallbackLabel,
      state,
      stop,
      photos: data?.evidence.length ?? 0,
      photosUploaded: data?.evidence.filter((e) => e.uploaded).length ?? 0,
      savedAt: data?.confirmedAt ?? row.createdAt,
      unknownOutcome: data?.phase === "unknown" || data?.phase === "submitting",
      // Out of automatic tries (not refused): another go is meaningful. A refused row needs its cause resolved first.
      canRetry: !stop && row.attempts >= MAX_SYNC_ATTEMPTS,
      canSubmitAnyway: !!stop && CAN_SUBMIT_ANYWAY.has(stop),
      canOpen: !!data?.scheduleId,
    };
  });
}

export interface PmSyncCounts {
  drafts: number;
  waiting: number;
  syncing: number;
  needsReview: number;
  failed: number;
  photosPending: number;
}

/** Real counts for the status area; a category with nothing in it is 0 only because the rows were actually read. */
export function countPmSync(items: readonly PmQueuedItem[], drafts: readonly PmDraftSummary[]): PmSyncCounts {
  const by = (s: EngineeringSyncState) => items.filter((i) => i.state === s).length;
  return {
    drafts: drafts.length,
    waiting: by("queued") + by("unknown_outcome"),
    syncing: by("syncing"),
    needsReview: by("needs_review"),
    failed: by("rejected"),
    photosPending: items.reduce((sum, i) => sum + (i.photos - i.photosUploaded), 0),
  };
}
