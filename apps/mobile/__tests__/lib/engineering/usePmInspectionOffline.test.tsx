import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/pm", () => ({
  listPmTemplates: jest.fn(),
  listAssetMeters: jest.fn(),
  submitPmCompletion: jest.fn(),
  uploadPmEvidence: jest.fn(),
  deletePmEvidence: jest.fn().mockResolvedValue(undefined),
}));
let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "user-1", tenant_id: "hotel-1", role: "engineer" } })) };
});
const mockRows: Array<{ id: number; entity_type: string; action: string; entity_id: string | null; payload: string; attempts: number; created_at: string; label: string | null; last_error: string | null }> = [];
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: async (entity_type: string, action: string, payload: unknown, entity_id?: string, label?: string | null) => {
    mockRows.push({ id: mockRows.length + 1, entity_type, action, entity_id: entity_id ?? null, payload: JSON.stringify(payload), attempts: 0, created_at: new Date().toISOString(), label: label ?? null, last_error: null });
  },
  getSyncQueueRows: async (entity_type: string, action: string, entity_id?: string) => mockRows.filter((r) => r.entity_type === entity_type && r.action === action && (!entity_id || r.entity_id === entity_id)),
  updateSyncQueuePayload: jest.fn(),
}));
const mockFlush = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/engineering/pmSyncRunner", () => ({ flushPmCompletions: () => mockFlush() }));
const mockPersist = jest.fn();
const mockRemove = jest.fn().mockResolvedValue(true);
const mockReadable = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/engineering/pmLocalEvidence", () => ({
  ...jest.requireActual("@/lib/engineering/pmLocalEvidence"),
  persistPmPhoto: (...a: unknown[]) => mockPersist(...a),
  removeLocalPhoto: (...a: unknown[]) => mockRemove(...a),
  localPhotoReadable: (...a: unknown[]) => mockReadable(...a),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { deletePmEvidence, listAssetMeters, listPmTemplates, submitPmCompletion, uploadPmEvidence } from "@/lib/api/pm";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { LocalPhotoError, usePmInspection } from "@/lib/engineering/usePmInspection";
import { loadPmDraft } from "@/lib/engineering/pmDraftStore";
import { adaptPmSchedule } from "@/lib/engineering/pmSchedules";

const tplRow = {
  id: "t1",
  name: "Boiler",
  version: 1,
  items: { checklist: [{ key: "a", label: "Relief valve", requires_evidence: true }, { key: "b", label: "Leaks" }] },
};
const schedule = adaptPmSchedule(
  { id: "s1", asset_id: "asset-1", name: "Boiler PM", interval_type: "monthly", next_due_at: "2026-11-04T18:00:00Z", assets: { name: "Boiler 1" } },
  "America/Chicago",
  new Date("2026-11-04T16:00:00Z"),
)!;
const photo = (n: string) => ({ ok: true, photo: { id: `local:${n}`, uri: `file:///docs/pm-evidence/hotel-1_user-1/${n}.jpg`, bytes: 100 } });

beforeEach(async () => {
  jest.clearAllMocks();
  mockOnline = true;
  mockRows.length = 0;
  mockReadable.mockResolvedValue(true);
  mockRemove.mockResolvedValue(true);
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
  (listPmTemplates as jest.Mock).mockResolvedValue([tplRow]);
  (listAssetMeters as jest.Mock).mockResolvedValue([]);
});

async function mount() {
  const hook = renderHook(() => usePmInspection(schedule));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

async function answered(result: { current: ReturnType<typeof usePmInspection> }) {
  await act(async () => {
    result.current.setResult("i0", "passed");
    result.current.setResult("i1", "passed");
  });
}

describe("photos taken without a connection", () => {
  it("offline, the photo is kept on the phone and no upload is attempted", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("aa"));
    const { result } = await mount();
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    expect(uploadPmEvidence).not.toHaveBeenCalled();
    expect(result.current.draft?.items.i0.evidence).toEqual([{ id: "local:aa", uri: "file:///docs/pm-evidence/hotel-1_user-1/aa.jpg", local: { bytes: 100 } }]);
    await waitFor(async () => expect((await loadPmDraft("s1"))?.items.i0.evidence[0].id).toBe("local:aa"), { timeout: 2000 });
  });

  it("online but unreachable, the upload falls back to a phone-only copy", async () => {
    (uploadPmEvidence as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
    mockPersist.mockResolvedValue(photo("bb"));
    const { result } = await mount();
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    expect(result.current.draft?.items.i0.evidence[0].id).toBe("local:bb");
  });

  it("a refusal from the server is not an outage: nothing is kept locally and the draft is unchanged", async () => {
    (uploadPmEvidence as jest.Mock).mockRejectedValue(Object.assign(new Error("too big"), { status: 413 }));
    const { result } = await mount();
    await act(async () => {
      await expect(result.current.attachPhoto("i0", "file:///cache/p.jpg", "x")).rejects.toMatchObject({ status: 413 });
    });
    expect(mockPersist).not.toHaveBeenCalled();
    expect(result.current.draft?.items.i0.evidence).toEqual([]);
  });

  it("a photo that cannot be kept is reported, never attached", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue({ ok: false, reason: "storage_full" });
    const { result } = await mount();
    await act(async () => {
      await expect(result.current.attachPhoto("i0", "file:///cache/p.jpg", "x")).rejects.toBeInstanceOf(LocalPhotoError);
    });
    expect(result.current.draft?.items.i0.evidence).toEqual([]);
  });

  it("removing a phone-only photo deletes its file and never calls the server", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("cc"));
    const { result } = await mount();
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    await act(async () => result.current.removePhoto("i0", "local:cc"));
    expect(mockRemove).toHaveBeenCalledWith("file:///docs/pm-evidence/hotel-1_user-1/cc.jpg");
    expect(deletePmEvidence).not.toHaveBeenCalled();
    expect(result.current.draft?.items.i0.evidence).toEqual([]);
  });

  it("discarding a draft removes phone-only files and server records separately", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("dd"));
    const { result } = await mount();
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    await act(async () => result.current.discard());
    expect(mockRemove).toHaveBeenCalledWith("file:///docs/pm-evidence/hotel-1_user-1/dd.jpg");
    expect(deletePmEvidence).not.toHaveBeenCalled();
  });
});

describe("saving an inspection for sync", () => {
  it("offline, a finished inspection is frozen and queued - and is not submitted or called recorded", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("aa"));
    const { result } = await mount();
    await answered(result);
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit();
    });
    expect(outcome).toEqual({ kind: "queued" });
    expect(submitPmCompletion).not.toHaveBeenCalled();
    expect(mockRows).toHaveLength(1);
    const frozen = JSON.parse(mockRows[0].payload);
    expect(frozen.submissionId).toMatch(/[0-9a-f-]{36}/);
    expect(frozen.body.items[0].evidence).toEqual(["local:aa"]);
    expect(frozen.evidence[0]).toMatchObject({ localId: "local:aa", file: "file:///docs/pm-evidence/hotel-1_user-1/aa.jpg" });
    expect(frozen.phase).toBe("queued");
    expect(await loadPmDraft("s1")).toBeNull(); // the draft moved into the queue; the photo file stays
    expect(mockRemove).not.toHaveBeenCalled();
    expect(result.current.queued?.data?.scheduleId).toBe("s1");
    expect(mockFlush).toHaveBeenCalled();
  });

  it("reopening the schedule shows the saved inspection, so a second one cannot be started", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("aa"));
    const first = await mount();
    await answered(first.result);
    await act(async () => first.result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    await act(async () => void (await first.result.current.submit()));
    first.unmount();
    const again = await mount();
    expect(again.result.current.queued).not.toBeNull();
  });

  it("online, a draft holding a phone-only photo is queued instead of posted with an unusable id", async () => {
    (uploadPmEvidence as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
    mockPersist.mockResolvedValue(photo("ee"));
    const { result } = await mount();
    await answered(result);
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit();
    });
    expect(outcome).toEqual({ kind: "queued" });
    expect(submitPmCompletion).not.toHaveBeenCalled();
  });

  it("a missing photo file blocks saving and queues nothing", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("ff"));
    const { result } = await mount();
    await answered(result);
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    mockReadable.mockResolvedValue(false);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit();
    });
    expect(outcome).toEqual({ kind: "photo_missing" });
    expect(mockRows).toHaveLength(0);
    expect(result.current.draft).not.toBeNull(); // nothing the person did is lost
  });

  it("an incomplete inspection cannot be saved for sync either", async () => {
    mockOnline = false;
    const { result } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit();
    });
    expect(outcome).toMatchObject({ kind: "blocked" });
    expect(mockRows).toHaveLength(0);
  });

  it("an already-queued schedule cannot queue a second inspection", async () => {
    mockOnline = false;
    mockPersist.mockResolvedValue(photo("aa"));
    const { result } = await mount();
    await answered(result);
    await act(async () => result.current.attachPhoto("i0", "file:///cache/p.jpg", "x"));
    mockRows.push({ id: 99, entity_type: "pm_schedule", action: "complete", entity_id: "s1", payload: "{}", attempts: 0, created_at: "x", label: null, last_error: null });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit();
    });
    expect(outcome).toEqual({ kind: "already_queued" });
    expect(mockRows).toHaveLength(1);
  });
});
