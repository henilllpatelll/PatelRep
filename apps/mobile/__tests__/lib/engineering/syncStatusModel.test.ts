import { buildMoreSyncStatus, buildSyncIssues, isPmIssue, issueKeepsWork, resolvePrimaryAction, shownCount, summarizeRun } from "@/lib/engineering/syncStatusModel";
import type { PendingAction } from "@/lib/engineering/offlineActions";
import type { PmQueuedItem } from "@/lib/engineering/pmSyncItems";

const counts = (over: Partial<{ waiting: number; attention: number; verified: boolean }> = {}) => ({ waiting: 0, attention: 0, verified: true, ...over });
const status = (over: { online?: boolean; sending?: boolean } & Partial<ReturnType<typeof counts>> = {}) =>
  buildMoreSyncStatus({ online: over.online ?? true, sending: over.sending ?? false, counts: counts(over) });

describe("buildMoreSyncStatus", () => {
  it("is synced only when every queue was read and all are empty", () => {
    expect(status().kind).toBe("synced");
    expect(status({ verified: false }).kind).toBe("unavailable");
  });

  it("reports waiting, syncing and counts above 99", () => {
    expect(status({ waiting: 3 })).toMatchObject({ kind: "waiting", count: 3, shown: "3" });
    expect(status({ waiting: 3, sending: true })).toMatchObject({ kind: "syncing", textKey: "syncing" });
    expect(status({ sending: true }).textKey).toBe("syncingNoCount");
    expect(status({ waiting: 240 }).shown).toBe("99+");
    expect(shownCount(99)).toBe("99");
  });

  it("keeps attention on top and folds offline / syncing into its wording", () => {
    expect(status({ attention: 2 })).toMatchObject({ kind: "attention", textKey: "attention", tone: "danger" });
    expect(status({ attention: 2, online: false }).textKey).toBe("attentionOffline");
    expect(status({ attention: 1, sending: true }).textKey).toBe("attentionSyncing");
    expect(status({ attention: 1, waiting: 4, online: false })).toMatchObject({ waiting: 4, attention: 1 });
  });

  it("offline never claims the server is current", () => {
    expect(status({ online: false, waiting: 3 })).toMatchObject({ kind: "offline", textKey: "offlineSaved", count: 3 });
    expect(status({ online: false })).toMatchObject({ kind: "offline", textKey: "offlineNone" });
    expect(status({ online: false, verified: false }).textKey).toBe("offline");
  });

  it("moves from waiting to synced once the queue is confirmed empty", () => {
    expect(status({ waiting: 2 }).kind).toBe("waiting");
    expect(status({ waiting: 0 }).kind).toBe("synced");
  });
});

const act = (over: Partial<PendingAction>): PendingAction => ({ key: "k", queueId: 1, kind: "complete", state: "refused", woId: "wo-1", label: "WO-1", savedAt: null, reason: "conflict", canRetry: false, canDiscard: true, ...over });
const pmItem = (over: Partial<PmQueuedItem>): PmQueuedItem => ({ rowId: 9, scheduleId: "s1", label: "AC filter", state: "needs_review", stop: "conflict_completed", photos: 0, photosUploaded: 0, savedAt: null, unknownOutcome: false, canRetry: false, canSubmitAnyway: false, canOpen: true, ...over });

describe("buildSyncIssues", () => {
  it("lists only changes that need the person, one per record", () => {
    const issues = buildSyncIssues({
      actions: [act({ queueId: 1 }), act({ queueId: 2, state: "stuck", canRetry: true }), act({ queueId: 3, state: "waiting" })],
      claimConflicts: [{ woId: "wo-9", label: null, reason: "conflict", at: "" }],
      reports: [
        { requestId: "r1", kind: "refused", title: "Leak", at: "" },
        { requestId: "r2", kind: "synced", title: "Ok", at: "" },
      ],
      pmItems: [pmItem({}), pmItem({ rowId: 10, state: "queued", stop: null }), pmItem({ rowId: 11, state: "unknown_outcome", stop: null })],
    });
    expect(issues.map((i) => i.id)).toEqual(["action:1", "action:2", "claim:wo-9", "report:r1", "pm:9"]);
  });

  it("treats an unknown PM outcome as waiting, matching the counts", () => {
    expect(isPmIssue("unknown_outcome")).toBe(false);
    expect(isPmIssue("rejected")).toBe(true);
  });

  it("knows which issues still hold the person's work", () => {
    const [a, c, r, p, u] = buildSyncIssues({
      actions: [act({})],
      claimConflicts: [{ woId: "w", label: null, reason: "not_found", at: "" }],
      reports: [{ requestId: "r", kind: "refused", title: "t", at: "" }],
      pmItems: [pmItem({}), pmItem({ rowId: 2, stop: "unreadable" })],
    });
    expect([a, c, r, p, u].map(issueKeepsWork)).toEqual([true, false, false, true, false]);
  });
});

describe("summarizeRun / resolvePrimaryAction", () => {
  it("only says done when nothing remains, failed or conflicted and the read was verified", () => {
    expect(summarizeRun({ ran: true, remaining: 0, failed: 0, conflicts: 0, verified: true })).toEqual({ kind: "done" });
    expect(summarizeRun({ ran: true, remaining: 0, failed: 0, conflicts: 0, verified: false })).toEqual({ kind: "partial", count: 0 });
    expect(summarizeRun({ ran: true, remaining: 2, failed: 0, conflicts: 0, verified: true })).toEqual({ kind: "partial", count: 2 });
    expect(summarizeRun({ ran: true, remaining: 0, failed: 1, conflicts: 2, verified: true })).toEqual({ kind: "conflicts", count: 2 });
    expect(summarizeRun({ ran: false, reason: "offline" })).toEqual({ kind: "offline" });
  });

  it("picks one context-sensitive primary action", () => {
    expect(resolvePrimaryAction({ online: false, syncing: false, attention: 0 })).toBe("connect");
    expect(resolvePrimaryAction({ online: true, syncing: true, attention: 3 })).toBe("syncing");
    expect(resolvePrimaryAction({ online: true, syncing: false, attention: 1 })).toBe("retry");
    expect(resolvePrimaryAction({ online: true, syncing: false, attention: 0 })).toBe("sync");
  });
});
