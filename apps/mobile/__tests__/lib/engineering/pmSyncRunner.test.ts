/* The queued-completion runner against an in-memory copy of the real owner-scoped queue mockTable. */

type Row = { id: number; entity_type: string; action: string; entity_id: string | null; payload: string; attempts: number; created_at: string; label: string | null; last_error: string | null; owner_scope: string };
const mockTable: Row[] = [];
let mockNextId = 1;
let mockOwner: string | null = "t1:u1";

jest.mock("@/lib/offline/queueOwner", () => ({ getQueueOwner: () => mockOwner, setQueueOwner: jest.fn() }));
jest.mock("@/lib/offline/db", () => {
  const mine = () => mockTable.filter((r) => r.owner_scope === mockOwner);
  return {
    enqueueAction: async (entity_type: string, action: string, payload: unknown, entity_id?: string, label?: string | null) => {
      if (!mockOwner) throw new Error("no owner");
      mockTable.push({ id: mockNextId++, entity_type, action, entity_id: entity_id ?? null, payload: JSON.stringify(payload), attempts: 0, created_at: new Date().toISOString(), label: label ?? null, last_error: null, owner_scope: mockOwner });
    },
    getSyncQueueRows: async (entity_type: string, action: string, entity_id?: string) => mine().filter((r) => r.entity_type === entity_type && r.action === action && (!entity_id || r.entity_id === entity_id)),
    updateSyncQueuePayload: async (id: number, payload: unknown) => void mine().filter((r) => r.id === id).forEach((r) => (r.payload = JSON.stringify(payload))),
    deleteSyncQueueItem: async (id: number) => void mockTable.splice(0, mockTable.length, ...mockTable.filter((r) => !(r.id === id && r.owner_scope === mockOwner))),
    incrementSyncQueueAttempts: async (id: number) => void mine().filter((r) => r.id === id).forEach((r) => (r.attempts += 1)),
    markSyncQueueItemRefused: async (id: number, code: string) => void mine().filter((r) => r.id === id).forEach((r) => ((r.attempts = 5), (r.last_error = code))),
    reopenSyncQueueItem: async (id: number) => void mine().filter((r) => r.id === id).forEach((r) => ((r.attempts = 0), (r.last_error = null))),
    retrySyncQueueItem: async (id: number) => void mine().filter((r) => r.id === id && !r.last_error).forEach((r) => (r.attempts = 0)),
  };
});
jest.mock("@/lib/api/assets", () => ({ completePmSchedule: jest.fn() }));
jest.mock("@/lib/api/pm", () => ({ createPmEvidenceRecord: jest.fn(), deletePmEvidence: jest.fn(), getPmEvidenceRecord: jest.fn(), listScheduleCompletions: jest.fn(), uploadPmEvidenceFile: jest.fn() }));
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", tenant_id: "t1" } })) };
});
let mockOnline = true;
jest.mock("@/lib/engineering/useAssetBrowse", () => ({ markAssetListStale: jest.fn() }));
jest.mock("@/lib/engineering/usePmSchedules", () => ({ resetPmScheduleCache: jest.fn() }));
const mockRemoveLocalPhoto = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/engineering/pmLocalEvidence", () => ({
  ...jest.requireActual("@/lib/engineering/pmLocalEvidence"),
  removeLocalPhoto: (...a: unknown[]) => mockRemoveLocalPhoto(...a),
  localPhotoReadable: jest.fn().mockResolvedValue(true),
  sweepOrphanPhotos: jest.fn().mockResolvedValue(3),
}));
jest.mock("@/lib/engineering/pmDraftStore", () => ({ clearPmDraft: jest.fn().mockResolvedValue(undefined), listPmDraftLocalUris: jest.fn().mockResolvedValue([]) }));

import { adaptPmTemplates, newDraft } from "@/lib/engineering/pmChecklist";
import { enqueueCompletion, freezeCompletion, listQueuedCompletions, queuedCompletionFor } from "@/lib/engineering/pmCompletionQueue";
import { clearPmBackoff, discardQueued, flushPmCompletions, realSyncDeps, submitAnyway, sweepPmPhotos } from "@/lib/engineering/pmSyncRunner";
import { listPmDraftLocalUris, clearPmDraft } from "@/lib/engineering/pmDraftStore";
import { sweepOrphanPhotos } from "@/lib/engineering/pmLocalEvidence";
import { completePmSchedule } from "@/lib/api/assets";
import { createPmEvidenceRecord, deletePmEvidence, getPmEvidenceRecord, listScheduleCompletions, uploadPmEvidenceFile } from "@/lib/api/pm";

const template = adaptPmTemplates([{ id: "t1", name: "Boiler", version: 1, items: { checklist: [{ key: "leak", label: "Leaks", requires_evidence: true }] } }])[0];
const err = (status: number, detail?: unknown) => Object.assign(new Error(`HTTP ${status}`), { status, detail });

function frozen(scheduleId = "s1") {
  const draft = newDraft(scheduleId, template, new Date("2026-03-01T08:00:00Z"));
  draft.items.i0 = { result: "passed", note: "", evidence: [{ id: "local:aa", uri: "file:///docs/pm-evidence/t1_u1/aa.jpg", local: { bytes: 10 } }] };
  return freezeCompletion({ draft, template, meters: [], schedule: { id: scheduleId, assetId: "a1", name: "Boiler PM" }, submissionId: `sub-${scheduleId}`, now: new Date("2026-03-01T09:00:00Z") });
}

const complete = completePmSchedule as jest.Mock;
beforeEach(() => {
  mockTable.length = 0;
  mockNextId = 1;
  mockOwner = "t1:u1";
  mockOnline = true;
  jest.clearAllMocks();
  mockRemoveLocalPhoto.mockReset().mockResolvedValue(true);
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  clearPmBackoff();
  let evidence = 0;
  (createPmEvidenceRecord as jest.Mock).mockImplementation(async () => `ev${++evidence}`);
  (uploadPmEvidenceFile as jest.Mock).mockResolvedValue(undefined);
  (getPmEvidenceRecord as jest.Mock).mockResolvedValue({ storage_path: null, related_entity_id: "a1" });
  (listScheduleCompletions as jest.Mock).mockResolvedValue([]);
  complete.mockResolvedValue({ id: "c1", pm_schedule_id: "s1", completed_at: "2026-03-01T10:00:00Z" });
});

describe("queued PM completions", () => {
  it("keeps one outstanding completion per schedule (a second would be a second logical inspection)", async () => {
    expect(await enqueueCompletion(frozen())).toEqual({ ok: true });
    expect(await enqueueCompletion(frozen())).toEqual({ ok: false, reason: "already_queued" });
    expect(await listQueuedCompletions()).toHaveLength(1);
    expect((await queuedCompletionFor("s1"))?.data?.submissionId).toBe("sub-s1");
  });

  it("an unreadable stored row is listed (data null), not skipped", async () => {
    await enqueueCompletion(frozen());
    mockTable[0].payload = "{broken";
    const rows = await listQueuedCompletions();
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toBeNull();
  });

  it("another account never sees or replays this person's rows", async () => {
    await enqueueCompletion(frozen());
    mockOwner = "t1:u2";
    expect(await listQueuedCompletions()).toEqual([]);
    await flushPmCompletions(realSyncDeps());
    expect(complete).not.toHaveBeenCalled();
    expect(mockTable).toHaveLength(1);
  });
});

describe("flushing the queue", () => {
  it("records, then removes the row and only then the photo files", async () => {
    await enqueueCompletion(frozen());
    mockRemoveLocalPhoto.mockImplementation(async () => {
      expect(mockTable).toHaveLength(0); // the row was already gone when the file went
      return true;
    });
    await flushPmCompletions(realSyncDeps());
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1].submission_id).toBe("sub-s1");
    expect(mockTable).toHaveLength(0);
    expect(mockRemoveLocalPhoto).toHaveBeenCalledWith("file:///docs/pm-evidence/t1_u1/aa.jpg");
    expect(clearPmDraft).toHaveBeenCalledWith("s1");
  });

  it("does nothing - and burns no retry - while offline", async () => {
    await enqueueCompletion(frozen());
    mockOnline = false;
    await flushPmCompletions(realSyncDeps());
    expect(complete).not.toHaveBeenCalled();
    expect(mockTable[0].attempts).toBe(0);
  });

  it("a lost reply keeps the row, counts one attempt and holds off the next try", async () => {
    await enqueueCompletion(frozen());
    complete.mockRejectedValueOnce(new TypeError("Network request failed"));
    await flushPmCompletions(realSyncDeps());
    expect(mockTable).toHaveLength(1);
    expect(mockTable[0].attempts).toBe(1);
    expect(JSON.parse(mockTable[0].payload).phase).toBe("unknown");
    complete.mockClear();
    await flushPmCompletions(realSyncDeps()); // a reconnect burst finds it not yet due
    expect(complete).not.toHaveBeenCalled();
    clearPmBackoff(); // Sync now
    await flushPmCompletions(realSyncDeps());
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1].submission_id).toBe("sub-s1");
    expect(mockTable).toHaveLength(0);
  });

  it("a definitive refusal keeps everything, is marked for the person, and is never replayed on its own", async () => {
    await enqueueCompletion(frozen());
    complete.mockRejectedValue(err(409, { code: "checklist_unavailable" }));
    await flushPmCompletions(realSyncDeps());
    expect(mockTable[0].last_error).toBe("checklist_unavailable");
    expect(JSON.parse(mockTable[0].payload).evidence).toHaveLength(1);
    complete.mockClear();
    await flushPmCompletions(realSyncDeps());
    expect(complete).not.toHaveBeenCalled();
    expect(mockRemoveLocalPhoto).not.toHaveBeenCalled();
  });

  it("two overlapping runs share one pass (no duplicate requests)", async () => {
    await enqueueCompletion(frozen());
    await Promise.all([flushPmCompletions(realSyncDeps()), flushPmCompletions(realSyncDeps()), flushPmCompletions(realSyncDeps())]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(createPmEvidenceRecord).toHaveBeenCalledTimes(1);
  });

  it("stops the moment a different account signs in mid-run", async () => {
    await enqueueCompletion(frozen("s1"));
    await enqueueCompletion(frozen("s2"));
    (createPmEvidenceRecord as jest.Mock).mockImplementation(async () => {
      mockOwner = "t1:u2";
      return "ev1";
    });
    await flushPmCompletions(realSyncDeps());
    expect(complete).not.toHaveBeenCalled();
    mockOwner = "t1:u1";
    expect(mockTable.every((r) => !r.last_error)).toBe(true);
  });
});

describe("what the person can do with a stopped inspection", () => {
  it("submit anyway is only for a conflict, keeps the frozen content, and replays under the same id", async () => {
    await enqueueCompletion(frozen());
    (listScheduleCompletions as jest.Mock).mockResolvedValue([{ id: "c0", technician_id: "other", completed_at: "2026-03-01T08:30:00Z" }]);
    await flushPmCompletions(realSyncDeps());
    expect(mockTable[0].last_error).toBe("conflict_completed");
    expect(complete).not.toHaveBeenCalled();
    const before = JSON.parse(mockTable[0].payload);

    const [row] = await listQueuedCompletions();
    expect(await submitAnyway(row)).toBe(true);
    expect(mockTable[0].last_error).toBeNull();
    await flushPmCompletions(realSyncDeps());
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1].submission_id).toBe(before.submissionId);
    expect(mockTable).toHaveLength(0);
  });

  it("submit anyway is refused for a stop that is not a conflict", async () => {
    await enqueueCompletion(frozen());
    complete.mockRejectedValue(err(403));
    await flushPmCompletions(realSyncDeps());
    const [row] = await listQueuedCompletions();
    expect(await submitAnyway(row)).toBe(false);
    expect(mockTable[0].last_error).toBe("forbidden");
  });

  it("discarding removes the unsent inspection, its photos and any empty server record - and nothing else", async () => {
    await enqueueCompletion(frozen("s1"));
    await enqueueCompletion(frozen("s2"));
    (uploadPmEvidenceFile as jest.Mock).mockRejectedValueOnce(err(500)); // leaves ev1 created, not uploaded
    complete.mockRejectedValue(err(500)); // s2 stays queued too
    await flushPmCompletions(realSyncDeps());
    const rows = await listQueuedCompletions();
    await discardQueued(rows[0]);
    expect(mockTable).toHaveLength(1);
    expect(mockTable[0].entity_id).toBe("s2");
    expect(mockRemoveLocalPhoto).toHaveBeenCalledWith("file:///docs/pm-evidence/t1_u1/aa.jpg");
    expect(deletePmEvidence).toHaveBeenCalledWith("ev1");
  });
});

describe("cleaning up photo files", () => {
  it("sweeps only when every draft and queued row could be read", async () => {
    await enqueueCompletion(frozen());
    expect(await sweepPmPhotos()).toBe(3);
    const referenced = (sweepOrphanPhotos as jest.Mock).mock.calls[0][0] as Set<string>;
    expect(referenced.has("file:///docs/pm-evidence/t1_u1/aa.jpg")).toBe(true);
  });

  it("keeps every file when a draft or a queued row cannot be read", async () => {
    (sweepOrphanPhotos as jest.Mock).mockClear();
    (listPmDraftLocalUris as jest.Mock).mockResolvedValueOnce(null);
    expect(await sweepPmPhotos()).toBe(0);
    await enqueueCompletion(frozen());
    mockTable[0].payload = "{broken";
    expect(await sweepPmPhotos()).toBe(0);
    expect(sweepOrphanPhotos).not.toHaveBeenCalled();
  });
});
