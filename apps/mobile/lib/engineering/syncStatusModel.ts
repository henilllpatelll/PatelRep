/* ─── Engineering sync presentation model ───────────────────────────────────
   Pure. Turns the counts the engineering queues already report (buildEngineeringSyncCounts) and the connection facts into
   (a) the one status line shown on More and (b) the ordered list of things that need the person in the Sync Center.
   It owns no queue and invents nothing: an unreadable queue is "unavailable", never "synced", and independent facts
   (offline, sending, how many need attention) are kept side by side instead of one hiding the other. */

import type { EngineeringSyncCounts } from "@/lib/engineering/homeModel";
import type { PendingAction, PendingActionKind } from "@/lib/engineering/offlineActions";
import type { ClaimConflict } from "@/lib/engineering/claimConflicts";
import type { ReportRecord } from "@/lib/engineering/pendingReports";
import type { PmQueuedItem } from "@/lib/engineering/pmSyncItems";
import type { EngineeringSyncState } from "@/lib/engineering/pmSyncState";

export type MoreSyncKind = "attention" | "offline" | "syncing" | "waiting" | "synced" | "unavailable";
export type SyncTone = "success" | "neutral" | "warning" | "danger";

export interface MoreSyncStatus {
  kind: MoreSyncKind;
  online: boolean;
  /** A sync run is sending changes right now. */
  sending: boolean;
  waiting: number;
  attention: number;
  /** i18n key (under `engineeringMore.sync`) and the numbers it needs; `count` selects the plural form. */
  textKey: string;
  count: number;
  /** Display form of `count`: anything above 99 reads "99+" so a badge-sized row never overflows. */
  shown: string;
  icon: "checkmark-circle" | "cloud-upload-outline" | "sync" | "alert-circle" | "cloud-offline-outline" | "help-circle-outline";
  tone: SyncTone;
}

export const MAX_SHOWN_COUNT = 99;

export function shownCount(n: number): string {
  return n > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : String(Math.max(0, Math.trunc(n)));
}

/**
 * Precedence (highest first): needs attention, offline, syncing, waiting, synced, unavailable. Attention is never hidden
 * by another state; offline and sending are folded into its wording instead. `synced` requires every queue to have been
 * read (`verified`) and to be empty; anything less is `unavailable`.
 */
export function buildMoreSyncStatus(input: { online: boolean; sending: boolean; counts: EngineeringSyncCounts }): MoreSyncStatus {
  const { online, sending, counts } = input;
  const base = { online, sending, waiting: counts.waiting, attention: counts.attention };
  const make = (kind: MoreSyncKind, textKey: string, count: number, icon: MoreSyncStatus["icon"], tone: SyncTone): MoreSyncStatus => ({
    ...base,
    kind,
    textKey,
    count,
    shown: shownCount(count),
    icon,
    tone,
  });

  if (counts.attention > 0) {
    const key = !online ? "attentionOffline" : sending ? "attentionSyncing" : "attention";
    return make("attention", key, counts.attention, "alert-circle", "danger");
  }
  if (!online) {
    // Offline never claims the server is up to date: with nothing known to be waiting it only says it is offline.
    if (counts.waiting > 0) return make("offline", "offlineSaved", counts.waiting, "cloud-offline-outline", "warning");
    return make("offline", counts.verified ? "offlineNone" : "offline", 0, "cloud-offline-outline", "warning");
  }
  if (sending) return make("syncing", counts.waiting > 0 ? "syncing" : "syncingNoCount", counts.waiting, "sync", "neutral");
  if (counts.waiting > 0) return make("waiting", "waiting", counts.waiting, "cloud-upload-outline", "warning");
  if (!counts.verified) return make("unavailable", "unavailable", 0, "help-circle-outline", "neutral");
  return make("synced", "synced", 0, "checkmark-circle", "success");
}

/* ─── Needs-attention list ──────────────────────────────────────────────────── */

export type SyncIssue =
  | { source: "action"; id: string; kind: PendingActionKind; queueId: number; woId: string | null; label: string | null; reason: string | null; stuck: boolean; canRetry: boolean }
  | { source: "claim"; id: string; woId: string; label: string | null; reason: ClaimConflict["reason"] }
  | { source: "report"; id: string; requestId: string; title: string; message: string | null }
  | { source: "pm"; id: string; rowId: number; scheduleId: string | null; label: string; stop: string | null; unknownOutcome: boolean; canRetry: boolean; canSubmitAnyway: boolean; canOpen: boolean };

/**
 * A saved inspection needs the person only when it stopped for review or was refused. "Unknown outcome" (a reply never
 * arrived) is counted as waiting by countPmSync - it is checked against the server before anything is sent again - so it is
 * listed under Waiting, and the count on More and this list can never disagree.
 */
export const isPmIssue = (state: EngineeringSyncState): boolean => state === "needs_review" || state === "rejected";

/**
 * Everything that needs the person, one entry per underlying record (queue row id, work-order id, request id, PM row id), so
 * the list and the count on More can never disagree. Order: work-order changes, refused claims, refused reports, inspections.
 */
export function buildSyncIssues(input: {
  actions: readonly PendingAction[];
  claimConflicts: readonly ClaimConflict[];
  reports: readonly ReportRecord[];
  pmItems: readonly PmQueuedItem[];
}): SyncIssue[] {
  const out: SyncIssue[] = [];
  for (const a of input.actions) {
    if (a.state !== "refused" && a.state !== "stuck") continue;
    out.push({ source: "action", id: `action:${a.queueId}`, kind: a.kind, queueId: a.queueId, woId: a.woId, label: a.label, reason: a.reason, stuck: a.state === "stuck", canRetry: a.canRetry });
  }
  for (const c of input.claimConflicts) out.push({ source: "claim", id: `claim:${c.woId}`, woId: c.woId, label: c.label, reason: c.reason });
  for (const r of input.reports) {
    if (r.kind === "refused") out.push({ source: "report", id: `report:${r.requestId}`, requestId: r.requestId, title: r.title, message: r.message ?? null });
  }
  for (const p of input.pmItems) {
    if (!isPmIssue(p.state)) continue;
    out.push({ source: "pm", id: `pm:${p.rowId}`, rowId: p.rowId, scheduleId: p.scheduleId, label: p.label, stop: p.stop, unknownOutcome: p.unknownOutcome, canRetry: p.canRetry, canSubmitAnyway: p.canSubmitAnyway, canOpen: p.canOpen });
  }
  return out;
}

/**
 * Whether the person's typed content is still stored on this phone for the issue. A refused/stuck work-order change and a
 * saved PM inspection stay in the queue; a refused claim or report was dropped from it (only a record of the refusal is
 * kept), and an inspection whose stored record cannot be read has nothing readable left.
 */
export function issueKeepsWork(issue: SyncIssue): boolean {
  if (issue.source === "action") return true;
  if (issue.source === "pm") return issue.stop !== "unreadable";
  return false;
}

/** What a finished manual sync may truthfully say. Counts come from the sync runner's own post-sync read. */
export type SyncRunSummary =
  | { kind: "offline" | "failed" }
  | { kind: "done" }
  | { kind: "conflicts" | "failed_items" | "partial"; count: number };

export function summarizeRun(run: { ran: false; reason: "offline" | "failed" } | { ran: true; remaining: number; failed: number; conflicts: number; verified: boolean }): SyncRunSummary {
  if (!run.ran) return { kind: run.reason };
  if (run.conflicts > 0) return { kind: "conflicts", count: run.conflicts };
  if (run.failed > 0) return { kind: "failed_items", count: run.failed };
  if (run.remaining > 0 || !run.verified) return { kind: "partial", count: run.remaining };
  return { kind: "done" };
}

/** The Sync Center's single primary action. */
export type SyncPrimary = "connect" | "syncing" | "retry" | "sync";

export function resolvePrimaryAction(input: { online: boolean; syncing: boolean; attention: number }): SyncPrimary {
  if (input.syncing) return "syncing";
  if (!input.online) return "connect";
  return input.attention > 0 ? "retry" : "sync";
}
