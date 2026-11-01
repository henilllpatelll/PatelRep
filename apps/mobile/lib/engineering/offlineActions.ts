/* ─── Engineering offline actions - pure rules ──────────────────────────────
   What the shared sync queue holds for an engineer, in plain terms, and how a failed replay is judged. The queue
   stays the one source of truth: nothing here stores or invents a row. A change the server refused for good keeps
   its saved content (`last_error` set) but is never replayed on its own; only the person can discard it. */

import type { SyncQueueSummaryRow } from "@/lib/offline/db";
import { MAX_SYNC_ATTEMPTS } from "@/lib/housekeeping/syncDetails";

export type ReplayFailure = "retry" | "conflict" | "forbidden" | "not_found" | "invalid";

/** Network trouble, timeouts, 401 (session) and 5xx are worth another bounded try; the rest can never succeed unchanged. */
export function classifyReplayFailure(error: unknown): ReplayFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 409) return "conflict";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "invalid";
  if (typeof status === "number") return "retry";
  return "retry";
}

/**
 * A completion replay answered 409. It may be our own earlier attempt whose reply was lost, so the order is re-read:
 * completed and assigned to this person = confirmed (the queue row can go); anything else is a real conflict.
 */
export function reconcileCompletion(order: { status?: string | null; assigned_to?: string | null } | null, userId: string | null): "confirmed" | "conflict" {
  return order?.status === "completed" && userId != null && order.assigned_to === userId ? "confirmed" : "conflict";
}

export type PendingActionKind = "claim" | "complete" | "report" | "update" | "other";
export type PendingActionState = "waiting" | "retrying" | "stuck" | "refused";

export interface PendingAction {
  key: string;
  queueId: number;
  kind: PendingActionKind;
  state: PendingActionState;
  woId: string | null;
  label: string | null;
  savedAt: string | null;
  /** Refusal code for `refused`. */
  reason: string | null;
  /** Another automatic-style try is meaningful (stuck, not refused). */
  canRetry: boolean;
  /** Always true: an unsent change can be discarded by the person (never a server-confirmed one). */
  canDiscard: boolean;
}

const REPORT_MARK = "eng-report:";

function kindOf(row: SyncQueueSummaryRow): PendingActionKind | null {
  if (row.entity_type !== "work_order") return null;
  if (row.action === "claim") return "claim";
  if (row.action === "complete") return "complete";
  if (row.action === "create") return "report";
  if (row.action === "update") return "update";
  return "other";
}

/** Only work-order rows: other entities have their own wording in Settings > Sync. */
export function buildPendingActions(rows: readonly SyncQueueSummaryRow[]): PendingAction[] {
  const out: PendingAction[] = [];
  for (const row of rows) {
    const kind = kindOf(row);
    if (!kind) continue;
    const refused = Boolean(row.last_error);
    const state: PendingActionState = refused ? "refused" : row.attempts >= MAX_SYNC_ATTEMPTS ? "stuck" : row.attempts > 0 ? "retrying" : "waiting";
    const isReport = row.entity_id?.startsWith(REPORT_MARK) ?? false;
    out.push({
      key: `queue-${row.id}`,
      queueId: row.id,
      kind: isReport ? "report" : kind,
      state,
      woId: isReport ? null : row.entity_id,
      label: row.label ?? null,
      savedAt: row.created_at ?? null,
      reason: row.last_error ?? null,
      canRetry: state === "stuck",
      canDiscard: true,
    });
  }
  return out;
}

export interface PendingSummary {
  waiting: number;
  needsAttention: number;
}

export function summarizePending(actions: readonly PendingAction[]): PendingSummary {
  let needsAttention = 0;
  let waiting = 0;
  for (const a of actions) {
    if (a.state === "refused" || a.state === "stuck") needsAttention += 1;
    else waiting += 1;
  }
  return { waiting, needsAttention };
}
