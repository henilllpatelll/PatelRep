/* ─── Queued PM completions ─────────────────────────────────────────────────
   "Save for sync" freezes an inspection into one row of the EXISTING owner-scoped SQLite queue (lib/offline/db). It is
   not a second queue and it is not a completion: the server still validates and records it, and until it does the app
   calls it "waiting to sync".

   Frozen means frozen: the body, the submission id and the list of photos are fixed when the technician confirms. The
   only fields that change afterwards are replay progress (which photos already have a server record, the phase) - never
   the content. Editing the inspection afterwards is a new attempt, which cannot be queued while this one is outstanding
   for the same schedule, so one logical inspection cannot be recorded twice. */

import { enqueueAction, getSyncQueueRows, updateSyncQueuePayload, type SyncQueueRow } from "@/lib/offline/db";
import { buildCompletionPayload, draftPhotoRefs, isLocalPhoto, type PmDraft, type PmTemplate } from "./pmChecklist";
import type { PmCompletionPayload } from "./pmCompletion";
import { completionFingerprint } from "./pmSubmission";
import type { PmMeter } from "./pmReadings";
import type { QueuedPhase, QueuedStop } from "./pmSyncState";

export const PM_QUEUE_ENTITY = "pm_schedule";
export const PM_QUEUE_ACTION = "complete";

export interface QueuedEvidence {
  /** `local:<token>` as it appears in the frozen body. */
  localId: string;
  /** The durable file on this phone. */
  file: string;
  bytes: number;
  label: string;
  /** The server's evidence record, once it exists. */
  serverId?: string;
  /** The server confirmed the file for that record. */
  uploaded?: boolean;
  /** Server errors seen sending this file to the current record (see MAX_UPLOAD_FAILURES). */
  failures?: number;
}

export interface QueuedPmCompletion {
  v: 1;
  submissionId: string;
  scheduleId: string;
  assetId: string;
  /** Caption only (never used for a decision). */
  scheduleName: string;
  templateId: string;
  templateVersion: number | null;
  /** When the draft was started: another person's completion after this is a conflict. */
  startedAt: string;
  /** When the technician confirmed "save for sync". */
  confirmedAt: string;
  /** Fingerprint of `body`, checked before every replay. */
  fingerprint: string;
  body: Omit<PmCompletionPayload, "submission_id">;
  evidence: QueuedEvidence[];
  phase: QueuedPhase;
  stop?: QueuedStop | null;
  /** The person saw the conflict and chose to submit anyway. */
  conflictAcknowledged?: boolean;
}

export interface QueuedPmRow {
  rowId: number;
  attempts: number;
  lastError: string | null;
  createdAt: string | null;
  /** Null when the stored record is unreadable; it is shown as needing review, never dropped. */
  data: QueuedPmCompletion | null;
}

export type FreezeInput = {
  draft: PmDraft;
  template: PmTemplate;
  meters: readonly PmMeter[];
  schedule: { id: string; assetId: string; name: string };
  submissionId: string;
  now?: Date;
};

/** The frozen record for a validated inspection. Throws PmCompletionBlockedError exactly as an online submit would. */
export function freezeCompletion(input: FreezeInput): QueuedPmCompletion {
  const { draft, template, meters, schedule } = input;
  const built = buildCompletionPayload(template, draft, meters, { allowLocalEvidence: true });
  const { submission_id: _ignored, ...body } = built;
  const evidence: QueuedEvidence[] = [];
  const seen = new Set<string>();
  for (const ref of draftPhotoRefs(draft)) {
    if (!isLocalPhoto(ref) || seen.has(ref.id) || !ref.uri) continue;
    seen.add(ref.id);
    evidence.push({ localId: ref.id, file: ref.uri, bytes: ref.local?.bytes ?? 0, label: schedule.name });
  }
  return {
    v: 1,
    submissionId: input.submissionId,
    scheduleId: schedule.id,
    assetId: schedule.assetId,
    scheduleName: schedule.name,
    templateId: template.id,
    templateVersion: template.version,
    startedAt: draft.startedAt,
    confirmedAt: (input.now ?? new Date()).toISOString(),
    fingerprint: completionFingerprint(body),
    body,
    evidence,
    phase: "queued",
    stop: null,
  };
}

/** The frozen body still matches its fingerprint (a corrupted or tampered row is never replayed). */
export const isIntact = (q: QueuedPmCompletion): boolean => completionFingerprint(q.body) === q.fingerprint;

export function parseQueueRow(row: SyncQueueRow): QueuedPmRow {
  let data: QueuedPmCompletion | null = null;
  try {
    const raw = JSON.parse(row.payload) as QueuedPmCompletion;
    if (raw?.v === 1 && typeof raw.submissionId === "string" && typeof raw.scheduleId === "string" && Array.isArray(raw.evidence) && raw.body && typeof raw.fingerprint === "string") data = raw;
  } catch {
    data = null;
  }
  return { rowId: row.id, attempts: row.attempts, lastError: row.last_error ?? null, createdAt: row.created_at ?? null, data };
}

export async function listQueuedCompletions(): Promise<QueuedPmRow[]> {
  try {
    return (await getSyncQueueRows(PM_QUEUE_ENTITY, PM_QUEUE_ACTION)).map(parseQueueRow);
  } catch {
    return [];
  }
}

/** Like listQueuedCompletions, but a read failure throws: cleanup must never mistake "could not read" for "nothing queued". */
export async function listQueuedCompletionsStrict(): Promise<QueuedPmRow[]> {
  return (await getSyncQueueRows(PM_QUEUE_ENTITY, PM_QUEUE_ACTION)).map(parseQueueRow);
}

export async function queuedCompletionFor(scheduleId: string): Promise<QueuedPmRow | null> {
  try {
    const rows = await getSyncQueueRows(PM_QUEUE_ENTITY, PM_QUEUE_ACTION, scheduleId);
    return rows.length ? parseQueueRow(rows[0]) : null;
  } catch {
    return null;
  }
}

export type EnqueueResult = { ok: true } | { ok: false; reason: "already_queued" | "failed" };

/** Saves the frozen completion. One outstanding completion per schedule: a second would be a second logical inspection. */
export async function enqueueCompletion(frozen: QueuedPmCompletion): Promise<EnqueueResult> {
  try {
    if (await queuedCompletionFor(frozen.scheduleId)) return { ok: false, reason: "already_queued" };
    await enqueueAction(PM_QUEUE_ENTITY, PM_QUEUE_ACTION, frozen, frozen.scheduleId, frozen.scheduleName);
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Persist replay progress only. The body, fingerprint and submission id are carried over untouched. */
export async function saveProgress(rowId: number, current: QueuedPmCompletion, change: Partial<Pick<QueuedPmCompletion, "phase" | "stop" | "evidence" | "conflictAcknowledged">>): Promise<QueuedPmCompletion> {
  const next: QueuedPmCompletion = { ...current, ...change };
  await updateSyncQueuePayload(rowId, next);
  return next;
}
