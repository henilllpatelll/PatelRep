/* ─── Replaying a queued PM completion ──────────────────────────────────────
   Runs one frozen completion (pmCompletionQueue) against the server in a fixed order, and writes its progress back to
   the queue row after every step so a crash, a lost reply or a restart resumes instead of repeating:

     1. same person + hotel?        -> otherwise pause and touch nothing
     2. body still intact?          -> otherwise stop (never replay a corrupted row)
     3. someone else finished it?   -> stop for review BEFORE uploading anything
     4. photos: record -> file      -> the record id is saved before the file is sent; a lost reply is reconciled by
                                       reading the record back, never by blindly creating a second one
     5. swap local ids for record ids, then POST the completion with the SAME submission id every time
     6. report what really happened

   The server records a completion once per submission id, so step 5 is the safe retry for every unknown outcome. This
   module never deletes the queue row or a photo before the server confirmed the completion - the caller does that from
   the outcome returned here. All network and storage access is injected so each failure path is testable. */

import { isIntact, type QueuedEvidence, type QueuedPmCompletion } from "./pmCompletionQueue";
import { assertPmCompletionAllowed, type PmCompletionPayload, type PmCompletionResult } from "./pmCompletion";
import type { QueuedStop } from "./pmSyncState";

export type ReplayOutcome =
  | { kind: "recorded"; result: PmCompletionResult }
  /** Transient trouble: leave it queued and try again later. */
  | { kind: "retry"; error: unknown }
  /** Cannot be replayed as saved. Everything saved stays; the person decides. */
  | { kind: "stopped"; code: QueuedStop }
  /** Not this person / hotel, or the session needs refreshing: nothing was touched and nothing counts as an attempt. */
  | { kind: "paused"; reason: "owner_changed" | "signed_out" | "session" };

export interface SyncDeps {
  owner(): string | null;
  /** The app's own connectivity flag. Absent = assume online. Offline attempts would only burn the retry budget. */
  online?(): boolean;
  createEvidence(input: { assetId: string; label: string }): Promise<string>;
  uploadFile(evidenceId: string, uri: string): Promise<void>;
  getEvidence(evidenceId: string): Promise<{ storage_path?: string | null; related_entity_id?: string | null }>;
  deleteEvidence(evidenceId: string): Promise<void>;
  complete(scheduleId: string, payload: PmCompletionPayload): Promise<PmCompletionResult>;
  listCompletions(scheduleId: string): Promise<Array<{ id: string; technician_id: string | null; completed_at: string }>>;
  fileReadable(uri: string): Promise<boolean>;
  save(rowId: number, current: QueuedPmCompletion, change: Partial<Pick<QueuedPmCompletion, "phase" | "stop" | "evidence" | "conflictAcknowledged">>): Promise<QueuedPmCompletion>;
  currentUserId(): string | null;
  log(event: PmSyncEvent, data?: { op: string; code?: string }): void;
}

export type PmSyncEvent =
  | "evidence_upload_started"
  | "evidence_upload_confirmed"
  | "completion_submitted"
  | "completion_outcome_unknown"
  | "completion_reconciled"
  | "conflict_detected"
  | "permanent_rejection"
  | "queue_item_resolved";

/** After this many failed file uploads to one record, a fresh record is made (the old one may hold a half-written file). */
export const MAX_UPLOAD_FAILURES = 2;

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

/** The server's machine code for a refusal (`detail.code`), when it gave one. */
export function refusalCode(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null)?.detail;
  const code = (detail as { code?: unknown } | null)?.code ?? (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** How a refused POST /complete maps to a stop. 5xx and network trouble are never a stop. */
export function stopForCompletionError(error: unknown): QueuedStop | "session" | null {
  const status = statusOf(error);
  if (status == null || status >= 500) return null;
  if (status === 401) return "session";
  if (status === 403) return "forbidden";
  if (status === 404) return "schedule_gone";
  if (status === 409) {
    const code = refusalCode(error);
    if (code === "checklist_unavailable") return "checklist_unavailable";
    if (code === "schedule_inactive" || code === "asset_inactive") return "schedule_gone";
    if (code === "submission_conflict") return "invalid";
    return "conflict_changed";
  }
  return "invalid";
}

const swap = (ids: string[] | undefined, map: Map<string, string>): string[] | undefined => ids?.map((id) => map.get(id) ?? id);

/** The body that is actually sent: the frozen body with every local id replaced by its record id. */
export function buildReplayPayload(q: QueuedPmCompletion): PmCompletionPayload {
  const map = new Map(q.evidence.filter((e) => e.serverId && e.uploaded).map((e) => [e.localId, e.serverId as string]));
  const body = q.body;
  const payload: PmCompletionPayload = {
    ...body,
    ...(body.photos ? { photos: swap(body.photos, map) } : {}),
    items: body.items.map((item) => (item.evidence ? { ...item, evidence: swap(item.evidence, map) } : item)),
    submission_id: q.submissionId,
  };
  assertPmCompletionAllowed(payload);
  return payload;
}

export async function replayCompletion(rowId: number, input: QueuedPmCompletion, deps: SyncDeps): Promise<ReplayOutcome> {
  const owner = deps.owner();
  if (!owner) return { kind: "paused", reason: "signed_out" };
  const sameOwner = () => deps.owner() === owner;
  const op = input.submissionId.slice(0, 8);
  let q = input;

  const stop = async (code: QueuedStop): Promise<ReplayOutcome> => {
    deps.log(code === "conflict_completed" ? "conflict_detected" : "permanent_rejection", { op, code });
    await deps.save(rowId, q, { stop: code }).catch(() => undefined);
    return { kind: "stopped", code };
  };

  if (!isIntact(q)) return stop("invalid");

  // 3. Another technician already recorded this round: stop before uploading anything. A lost reply to OUR earlier
  //    attempt is not a conflict - once a POST was sent the phase is submitting/unknown and the submission id decides.
  if ((q.phase === "queued" || q.phase === "uploading") && !q.conflictAcknowledged) {
    try {
      const recent = await deps.listCompletions(q.scheduleId);
      const me = deps.currentUserId();
      const started = Date.parse(q.startedAt);
      const other = recent.find((c) => c.technician_id !== me && Date.parse(c.completed_at) >= started);
      if (other) return stop("conflict_completed");
    } catch (error) {
      const status = statusOf(error);
      if (status === 404) return stop("schedule_gone");
      if (status === 403) return stop("forbidden");
      if (status === 401) return { kind: "paused", reason: "session" };
      return { kind: "retry", error };
    }
  }

  // 4. Photos, one at a time and in the order they were taken.
  if (q.evidence.some((e) => !e.uploaded)) q = await deps.save(rowId, q, { phase: "uploading" });
  for (const ev of q.evidence) {
    if (ev.uploaded) continue;
    if (!sameOwner()) return { kind: "paused", reason: "owner_changed" };
    if (!(await deps.fileReadable(ev.file))) return stop("evidence_missing");

    let current: QueuedEvidence = ev;
    const persist = async (change: Partial<QueuedEvidence>) => {
      current = { ...current, ...change };
      q = await deps.save(rowId, q, { evidence: q.evidence.map((e) => (e.localId === current.localId ? current : e)) });
    };

    try {
      // A record id from an earlier attempt: learn what the server really holds before doing anything else.
      if (current.serverId) {
        try {
          const record = await deps.getEvidence(current.serverId);
          if (record.related_entity_id && record.related_entity_id !== q.assetId) await persist({ serverId: undefined }); // never reuse a foreign record
          else if (record.storage_path) {
            await persist({ uploaded: true });
            deps.log("evidence_upload_confirmed", { op });
            continue;
          }
        } catch (error) {
          if (statusOf(error) === 404) await persist({ serverId: undefined });
          else throw error;
        }
      }
      if (!current.serverId) {
        const id = await deps.createEvidence({ assetId: q.assetId, label: current.label });
        await persist({ serverId: id }); // saved BEFORE the file is sent
      }
      deps.log("evidence_upload_started", { op });
      try {
        await deps.uploadFile(current.serverId as string, current.file);
      } catch (error) {
        const status = statusOf(error);
        if (status === 400 || status === 413) {
          await deps.deleteEvidence(current.serverId as string).catch(() => undefined);
          return stop("evidence_rejected");
        }
        const failures = current.failures ?? 0;
        if (status != null && status >= 500 && failures + 1 >= MAX_UPLOAD_FAILURES) {
          // Possibly a half-written file: start this photo over on a new record next time.
          await deps.deleteEvidence(current.serverId as string).catch(() => undefined);
          await persist({ serverId: undefined, failures: 0 });
        } else if (status != null && status >= 500) {
          await persist({ failures: failures + 1 });
        }
        throw error;
      }
      await persist({ uploaded: true });
      deps.log("evidence_upload_confirmed", { op });
    } catch (error) {
      const status = statusOf(error);
      if (status === 401) return { kind: "paused", reason: "session" };
      if (status === 403) return stop("forbidden");
      if (status === 404) return stop("schedule_gone");
      return { kind: "retry", error };
    }
  }

  // 5. The completion itself, always under the same submission id.
  if (!sameOwner()) return { kind: "paused", reason: "owner_changed" };
  let payload: PmCompletionPayload;
  try {
    payload = buildReplayPayload(q);
  } catch {
    return stop("evidence_missing");
  }
  // A POST that may already have been sent (a crash or a lost reply) is re-sent under the same id, never as a new attempt.
  const wasUnknown = q.phase === "unknown" || q.phase === "submitting";
  if (q.phase !== "unknown") q = await deps.save(rowId, q, { phase: "submitting" });
  try {
    deps.log("completion_submitted", { op });
    const result = await deps.complete(q.scheduleId, payload);
    if (wasUnknown || result.replayed) deps.log("completion_reconciled", { op });
    deps.log("queue_item_resolved", { op });
    return { kind: "recorded", result };
  } catch (error) {
    const verdict = stopForCompletionError(error);
    if (verdict === "session") return { kind: "paused", reason: "session" };
    if (verdict) return stop(verdict);
    // The request may or may not have landed: remember that, so the person is never told "failed" or "done" falsely.
    deps.log("completion_outcome_unknown", { op });
    await deps.save(rowId, q, { phase: "unknown" }).catch(() => undefined);
    return { kind: "retry", error };
  }
}

/* ─── Retry timing ──────────────────────────────────────────────────────── */

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;

/** Exponential backoff with +/-20% jitter, so a roomful of phones coming back online do not hit the API together. */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** In-memory (per app run) "not before" times, so reconnect bursts and screen focus do not hammer a struggling server. */
export function createBackoff(now: () => number = Date.now, random: () => number = Math.random) {
  const notBefore = new Map<number, number>();
  return {
    due: (rowId: number) => (notBefore.get(rowId) ?? 0) <= now(),
    failed: (rowId: number, attempts: number) => void notBefore.set(rowId, now() + retryDelayMs(attempts, random)),
    clear: (rowId?: number) => (rowId == null ? notBefore.clear() : void notBefore.delete(rowId)),
  };
}
