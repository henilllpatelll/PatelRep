import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/pm", () => ({
  listPmTemplates: jest.fn(),
  listAssetMeters: jest.fn(),
  submitPmCompletion: jest.fn(),
  uploadPmEvidence: jest.fn(),
  deletePmEvidence: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ user: { id: "user-1", tenant_id: "hotel-1", role: "engineer" } })) };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { deletePmEvidence, listAssetMeters, listPmTemplates, submitPmCompletion, uploadPmEvidence } from "@/lib/api/pm";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { usePmInspection } from "@/lib/engineering/usePmInspection";
import { loadPmDraft, savePmDraft } from "@/lib/engineering/pmDraftStore";
import { adaptPmTemplates, newDraft } from "@/lib/engineering/pmChecklist";
import { adaptPmSchedule } from "@/lib/engineering/pmSchedules";

const templatesApi = listPmTemplates as jest.Mock;
const metersApi = listAssetMeters as jest.Mock;
const submitApi = submitPmCompletion as jest.Mock;
const uploadApi = uploadPmEvidence as jest.Mock;
const deleteApi = deletePmEvidence as jest.Mock;

const tplRow = (extra: object = {}) => ({
  id: "t1",
  name: "Boiler",
  version: 1,
  items: { checklist: [{ key: "a", label: "Relief valve", requires_evidence: true }, { key: "b", label: "Leaks" }] },
  ...extra,
});
const schedule = adaptPmSchedule(
  { id: "s1", asset_id: "asset-1", name: "Boiler PM", interval_type: "monthly", next_due_at: "2026-11-04T18:00:00Z", assets: { name: "Boiler 1" } },
  "America/Chicago",
  new Date("2026-11-04T16:00:00Z"),
)!;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
  templatesApi.mockResolvedValue([tplRow()]);
  metersApi.mockResolvedValue([{ id: "m1", name: "Pressure", unit: "psi" }]);
  deleteApi.mockResolvedValue(undefined);
});

async function mount() {
  const hook = renderHook(() => usePmInspection(schedule));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

async function answerAll(result: { current: ReturnType<typeof usePmInspection> }) {
  await act(async () => {
    result.current.setResult("i0", "passed");
    result.current.setResult("i1", "failed");
  });
  await act(async () => {
    uploadApi.mockResolvedValueOnce("ev-1");
    await result.current.attachPhoto("i0", "file:///p.jpg", "label");
  });
}

describe("starting an inspection", () => {
  it("starts a blank draft against the only checklist and loads the asset's meters", async () => {
    const { result } = await mount();
    expect(result.current.template?.id).toBe("t1");
    expect(result.current.progress).toMatchObject({ total: 2, answered: 0 });
    expect(result.current.meters.map((m) => m.id)).toEqual(["m1"]);
  });

  it("waits for a choice when several checklists exist, and starts blank when one is chosen", async () => {
    templatesApi.mockResolvedValue([tplRow(), tplRow({ id: "t2", name: "Pump" })]);
    const { result } = await mount();
    expect(result.current.draft).toBeNull();
    await act(async () => result.current.chooseTemplate("t2"));
    expect(result.current.draft?.templateId).toBe("t2");
  });

  it("reports a failed checklist load as a failure - never as 'no checklist'", async () => {
    templatesApi.mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    const { result } = await mount();
    expect(result.current.failure).toBe("failed");
    expect(result.current.templates).toEqual([]);
  });

  it("still opens when only the meters fail to load", async () => {
    metersApi.mockRejectedValue(new Error("Network request failed"));
    const { result } = await mount();
    expect(result.current.failure).toBeNull();
    expect(result.current.meters).toEqual([]);
    expect(result.current.draft).not.toBeNull();
  });

  it("restores a saved draft instead of starting over", async () => {
    const saved = newDraft("s1", adaptPmTemplates([tplRow()])[0]);
    saved.items.i0 = { result: "passed", note: "ok", evidence: [{ id: "ev-9" }] };
    await savePmDraft(saved);
    const { result } = await mount();
    expect(result.current.draft?.items.i0).toEqual({ result: "passed", note: "ok", evidence: [{ id: "ev-9" }] });
    expect(result.current.compatibility).toBe("ok");
  });

  it("blocks a restored draft whose checklist has since changed", async () => {
    const saved = newDraft("s1", adaptPmTemplates([tplRow()])[0]);
    await savePmDraft(saved);
    templatesApi.mockResolvedValue([tplRow({ version: 2 })]);
    const { result } = await mount();
    expect(result.current.compatibility).toBe("template_changed");
    const out = await act(async () => result.current.submit());
    expect(submitApi).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "blocked" });
  });
});

describe("autosave", () => {
  it("saves answers shortly after they change, and drops an untouched draft", async () => {
    const { result } = await mount();
    await act(async () => result.current.setResult("i1", "passed"));
    await waitFor(async () => expect((await loadPmDraft("s1"))?.items.i1.result).toBe("passed"), { timeout: 2000 });
    await act(async () => result.current.setResult("i1", null));
    await waitFor(async () => expect(await loadPmDraft("s1")).toBeNull(), { timeout: 2000 });
  });
});

describe("evidence", () => {
  it("attaches the evidence record id, not the local file", async () => {
    const { result } = await mount();
    await answerAll(result);
    expect(result.current.draft?.items.i0.evidence).toEqual([{ id: "ev-1", uri: "file:///p.jpg" }]);
  });

  it("ignores a second tap on the same slot while an upload is running", async () => {
    const { result } = await mount();
    let release!: (id: string) => void;
    uploadApi.mockReturnValueOnce(new Promise<string>((resolve) => (release = resolve)));
    let first!: Promise<void>;
    act(() => {
      first = result.current.attachPhoto("i0", "file:///a.jpg", "x");
    });
    await act(async () => {
      await result.current.attachPhoto("i0", "file:///b.jpg", "x");
    });
    expect(uploadApi).toHaveBeenCalledTimes(1);
    await act(async () => {
      release("ev-1");
      await first;
    });
    expect(result.current.draft?.items.i0.evidence).toHaveLength(1);
  });

  it("attaches nothing when the upload fails, and the error reaches the caller for display", async () => {
    const { result } = await mount();
    uploadApi.mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => {
      await expect(result.current.attachPhoto("i0", "file:///p.jpg", "x")).rejects.toThrow();
    });
    expect(result.current.draft?.items.i0.evidence).toEqual([]);
    expect(result.current.uploading.size).toBe(0);
  });

  it("removing a photo detaches it and deletes the uploaded record", async () => {
    const { result } = await mount();
    await answerAll(result);
    await act(async () => result.current.removePhoto("i0", "ev-1"));
    expect(result.current.draft?.items.i0.evidence).toEqual([]);
    expect(deleteApi).toHaveBeenCalledWith("ev-1");
  });
});

describe("submitting", () => {
  it("is blocked, with the reasons, while steps are unanswered - and sends nothing", async () => {
    const { result } = await mount();
    let out: unknown;
    await act(async () => {
      out = await result.current.submit();
    });
    expect(submitApi).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "blocked" });
    expect((out as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it("sends the real payload once, then clears the draft and reports the server's record", async () => {
    submitApi.mockResolvedValue({ id: "c1", pm_schedule_id: "s1", completed_at: "x", corrective_work_orders: [{ id: "wo1", title: "t" }] });
    const { result } = await mount();
    await answerAll(result);
    let out: unknown;
    await act(async () => {
      out = await result.current.submit();
    });
    expect(submitApi).toHaveBeenCalledTimes(1);
    const [scheduleId, payload, context] = submitApi.mock.calls[0];
    expect(scheduleId).toBe("s1");
    expect(payload.checklist_template_id).toBe("t1");
    expect(payload.checklist_version).toBe(1);
    expect(payload.items).toEqual([
      { key: "a", label: "Relief valve", result: "passed", requires_evidence: true, evidence: ["ev-1"] },
      { key: "b", label: "Leaks", result: "failed", requires_evidence: false, evidence: [] },
    ]);
    expect(context).toMatchObject({ userId: "user-1", unknownSince: null });
    expect(out).toMatchObject({ kind: "recorded", result: { id: "c1" } });
    expect(await loadPmDraft("s1")).toBeNull();
  });

  it("does not re-save the finished draft when the screen unmounts afterwards", async () => {
    submitApi.mockResolvedValue({ id: "c1", pm_schedule_id: "s1", completed_at: "x" });
    const { result, unmount } = await mount();
    await answerAll(result);
    await act(async () => {
      await result.current.submit();
    });
    unmount();
    await new Promise((r) => setTimeout(r, 600));
    expect(await loadPmDraft("s1")).toBeNull();
  });

  it("lets only one submit through when pressed twice in the same tick", async () => {
    let release!: (v: unknown) => void;
    submitApi.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = await mount();
    await answerAll(result);
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.submit();
      second = result.current.submit();
      await Promise.resolve();
    });
    expect(submitApi).toHaveBeenCalledTimes(1);
    expect(await second).toMatchObject({ kind: "blocked" });
    await act(async () => {
      release({ id: "c1", pm_schedule_id: "s1", completed_at: "x" });
      await first;
    });
  });

  it("keeps the draft and reports a refusal for a 4xx", async () => {
    submitApi.mockRejectedValue(Object.assign(new Error("Evidence required"), { status: 422 }));
    const { result } = await mount();
    await answerAll(result);
    let out: unknown;
    await act(async () => {
      out = await result.current.submit();
    });
    expect(out).toMatchObject({ kind: "refused" });
    expect(result.current.draft?.items.i0.result).toBe("passed");
  });

  it("reports an unknown outcome for a network failure, keeps the draft, and checks before posting on the retry", async () => {
    submitApi.mockRejectedValueOnce(new Error("Network request failed"));
    const { result } = await mount();
    await answerAll(result);
    let out: unknown;
    await act(async () => {
      out = await result.current.submit();
    });
    expect(out).toMatchObject({ kind: "unknown" });
    expect(result.current.draft).not.toBeNull();

    submitApi.mockResolvedValueOnce({ id: "c1", pm_schedule_id: "s1", completed_at: "x", reconciled: true });
    await act(async () => {
      out = await result.current.submit();
    });
    const retryContext = submitApi.mock.calls[1][2];
    expect(typeof retryContext.unknownSince).toBe("number");
    expect(out).toMatchObject({ kind: "recorded" });
  });
});
