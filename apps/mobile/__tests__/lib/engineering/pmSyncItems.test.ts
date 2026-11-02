import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { adaptPmTemplates, newDraft } from "@/lib/engineering/pmChecklist";
import { listPmDraftLocalUris, savePmDraft } from "@/lib/engineering/pmDraftStore";
import { buildPmQueuedItems, countPmSync } from "@/lib/engineering/pmSyncItems";
import type { QueuedPmCompletion, QueuedPmRow } from "@/lib/engineering/pmCompletionQueue";
import { buildSyncRows } from "@/lib/housekeeping/syncDetails";
import { summarizePendingWork } from "@/lib/auth/pendingWork";

const template = adaptPmTemplates([{ id: "t1", name: "Boiler", version: 1, items: { checklist: [{ label: "Leaks" }] } }])[0];

const data = (over: Partial<QueuedPmCompletion> = {}): QueuedPmCompletion => ({
  v: 1,
  submissionId: "sub",
  scheduleId: "s1",
  assetId: "a1",
  scheduleName: "Boiler 2 - Monthly",
  templateId: "t1",
  templateVersion: 1,
  startedAt: "2026-03-01T08:00:00Z",
  confirmedAt: "2026-03-01T09:00:00Z",
  fingerprint: "{}",
  body: { items: [] },
  evidence: [
    { localId: "local:a", file: "file:///a.jpg", bytes: 1, label: "x", serverId: "ev1", uploaded: true },
    { localId: "local:b", file: "file:///b.jpg", bytes: 1, label: "x" },
  ],
  phase: "queued",
  ...over,
});
const row = (rowId: number, over: Partial<QueuedPmRow> = {}): QueuedPmRow => ({ rowId, attempts: 0, lastError: null, createdAt: "2026-03-01T09:00:00Z", data: data(), ...over });

describe("Engineering sync items", () => {
  it("lists real rows with an honest state, never as recorded", () => {
    const items = buildPmQueuedItems(
      [row(1), row(2, { data: data({ phase: "unknown" }) }), row(3, { lastError: "conflict_completed" }), row(4, { lastError: "forbidden" }), row(5, { attempts: 5 }), row(6, { data: null })],
      [1],
      "Inspection",
    );
    expect(items.map((i) => i.state)).toEqual(["syncing", "unknown_outcome", "needs_review", "rejected", "queued", "needs_review"]);
    expect(items[2]).toMatchObject({ canSubmitAnyway: true, canRetry: false, stop: "conflict_completed" });
    expect(items[3]).toMatchObject({ canSubmitAnyway: false, canRetry: false });
    expect(items[4]).toMatchObject({ canRetry: true });
    expect(items[0]).toMatchObject({ label: "Boiler 2 - Monthly", photos: 2, photosUploaded: 1, unknownOutcome: false });
    expect(items[1].unknownOutcome).toBe(true);
    expect(items[5]).toMatchObject({ label: "Inspection", stop: "unreadable", canOpen: false }); // unreadable: listed for review, not dropped
  });

  it("counts only what is really there", () => {
    const items = buildPmQueuedItems([row(1), row(2, { lastError: "conflict_completed" }), row(3, { lastError: "invalid" })], [], "x");
    expect(countPmSync(items, [{ scheduleId: "s9", label: null, answered: 0, total: 1, updatedAt: "x" }])).toEqual({
      drafts: 1,
      waiting: 1,
      syncing: 0,
      needsReview: 1,
      failed: 1,
      photosPending: 3,
    });
    expect(countPmSync([], [])).toEqual({ drafts: 0, waiting: 0, syncing: 0, needsReview: 0, failed: 0, photosPending: 0 });
  });
});

describe("shared sync + sign-out summaries", () => {
  const queueRow = { id: 1, entity_type: "pm_schedule", action: "complete", entity_id: "s1", room_id: null, attempts: 0, created_at: "2026-03-01T09:00:00Z", label: "Boiler", last_error: null };

  it("the shared sync list shows a saved PM inspection as its own kind", () => {
    const rows = buildSyncRows({ sessions: {}, actions: [], queue: [queueRow] });
    expect(rows[0]).toMatchObject({ kind: "pm_completion", state: "pending" });
    expect(buildSyncRows({ sessions: {}, actions: [], queue: [{ ...queueRow, last_error: "conflict_completed" }] })[0].state).toBe("conflict");
  });

  it("signing out warns about saved PM inspections, counting a stopped one as needing attention", () => {
    const base = { userScope: "t1:u1", actions: [], outboxScope: null, outbox: {}, sessionScope: null, sessions: {} };
    expect(summarizePendingWork({ ...base, queue: [queueRow] })).toEqual([{ key: "pmInspections", count: 1, oldestAt: "2026-03-01T09:00:00Z", needsAttention: 0 }]);
    expect(summarizePendingWork({ ...base, queue: [{ ...queueRow, last_error: "forbidden" }] })[0].needsAttention).toBe(1);
  });
});

describe("photo files a draft refers to", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setQueueOwner("t1:u1");
  });

  it("lists the phone-only photos of every saved draft", async () => {
    const draft = newDraft("s1", template);
    draft.items.i0 = { result: "passed", note: "", evidence: [{ id: "local:a", uri: "file:///docs/a.jpg", local: { bytes: 1 } }, { id: "ev-1", uri: "file:///cache/x.jpg" }] };
    draft.photos = [{ id: "local:b", uri: "file:///docs/b.jpg", local: { bytes: 1 } }];
    await savePmDraft(draft);
    expect((await listPmDraftLocalUris())?.sort()).toEqual(["file:///docs/a.jpg", "file:///docs/b.jpg"]);
  });

  it("answers null - keep everything - when a draft cannot be read, or nobody is signed in", async () => {
    await AsyncStorage.setItem("engineering.pmDraft.v1:t1:u1:broken", "{not json");
    expect(await listPmDraftLocalUris()).toBeNull();
    setQueueOwner(null);
    expect(await listPmDraftLocalUris()).toBeNull();
  });
});
