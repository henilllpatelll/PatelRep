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
import { listAssetMeters, listPmTemplates, submitPmCompletion, uploadPmEvidence } from "@/lib/api/pm";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { usePmInspection } from "@/lib/engineering/usePmInspection";
import { loadPmDraft } from "@/lib/engineering/pmDraftStore";
import { adaptPmSchedule } from "@/lib/engineering/pmSchedules";

const templatesApi = listPmTemplates as jest.Mock;
const metersApi = listAssetMeters as jest.Mock;
const submitApi = submitPmCompletion as jest.Mock;
const uploadApi = uploadPmEvidence as jest.Mock;

const tplRow = (extra: object = {}) => ({
  id: "t1",
  name: "Chiller",
  version: 1,
  items: { checklist: [{ key: "a", label: "Belt", requires_evidence: true }, { key: "b", label: "Leaks" }] },
  ...extra,
});

function scheduleWith(checklist?: object) {
  return adaptPmSchedule(
    { id: "s1", asset_id: "asset-1", name: "Chiller PM", interval_type: "monthly", next_due_at: "2026-11-04T18:00:00Z", assets: { name: "Chiller 1" }, ...(checklist ? { checklist } : {}) },
    "America/Chicago",
    new Date("2026-11-04T16:00:00Z"),
  )!;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
  metersApi.mockResolvedValue([]);
});

async function mount(checklist?: object) {
  const hook = renderHook(() => usePmInspection(scheduleWith(checklist)));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("a schedule bound to a checklist", () => {
  it("opens its own procedure even when several checklists exist, and the technician cannot swap it", async () => {
    templatesApi.mockResolvedValue([tplRow(), tplRow({ id: "t2", name: "Pump" })]);
    const { result } = await mount({ state: "ready", template_id: "t2", template_code: "pump", template_name: "Pump", template_version: 1 });
    expect(result.current.draft?.templateId).toBe("t2");
    expect(result.current.checklistIssue).toBeNull();
    await act(async () => result.current.chooseTemplate("t1"));
    expect(result.current.draft?.templateId).toBe("t2");
  });

  it.each(["missing", "inactive", "incompatible"])("a %s checklist is an actionable issue, never a guessed checklist", async (state) => {
    templatesApi.mockResolvedValue([tplRow()]);
    const { result } = await mount({ state, template_id: "tx", template_code: "chiller" });
    expect(result.current.draft).toBeNull();
    expect(result.current.checklistIssue).toMatchObject({ state });
  });

  it("treats a 'ready' checklist that is no longer among the active ones as missing", async () => {
    templatesApi.mockResolvedValue([tplRow()]);
    const { result } = await mount({ state: "ready", template_id: "retired-since", template_code: "chiller" });
    expect(result.current.draft).toBeNull();
    expect(result.current.checklistIssue).toMatchObject({ state: "missing" });
  });

  it("an unconfigured legacy schedule still lets the technician choose, as before", async () => {
    templatesApi.mockResolvedValue([tplRow(), tplRow({ id: "t2", name: "Pump" })]);
    const { result } = await mount();
    expect(result.current.draft).toBeNull();
    expect(result.current.checklistIssue).toBeNull();
    await act(async () => result.current.chooseTemplate("t2"));
    expect(result.current.draft?.templateId).toBe("t2");
  });
});

describe("completion submission id", () => {
  async function ready() {
    templatesApi.mockResolvedValue([tplRow()]);
    const hook = await mount();
    await act(async () => {
      hook.result.current.setResult("i0", "passed");
      hook.result.current.setResult("i1", "passed");
    });
    await act(async () => {
      uploadApi.mockResolvedValueOnce("ev-1");
      await hook.result.current.attachPhoto("i0", "file:///p.jpg", "label");
    });
    return hook;
  }

  it("sends a submission id and reuses it when the same inspection is retried after an unknown outcome", async () => {
    const { result } = await ready();
    submitApi.mockRejectedValueOnce(new Error("Network request failed"));
    let first: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      first = await result.current.submit();
    });
    expect(first?.kind).toBe("unknown");
    const firstId = submitApi.mock.calls[0][1].submission_id;
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await loadPmDraft("s1"))?.submission?.id).toBe(firstId); // survives an app restart

    submitApi.mockResolvedValueOnce({ id: "c1", pm_schedule_id: "s1", completed_at: "x", replayed: true });
    await act(async () => {
      await result.current.submit();
    });
    expect(submitApi.mock.calls[1][1].submission_id).toBe(firstId);
  });

  it("uses a new id once the technician has changed the inspection", async () => {
    const { result } = await ready();
    submitApi.mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => {
      await result.current.submit();
    });
    const firstId = submitApi.mock.calls[0][1].submission_id;
    await act(async () => result.current.patchItem("i1", { note: "actually, slight leak" }));
    submitApi.mockResolvedValueOnce({ id: "c2", pm_schedule_id: "s1", completed_at: "x" });
    await act(async () => {
      await result.current.submit();
    });
    expect(submitApi.mock.calls[1][1].submission_id).not.toBe(firstId);
  });
});
