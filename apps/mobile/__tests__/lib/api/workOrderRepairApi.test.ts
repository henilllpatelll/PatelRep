import { api } from "@/lib/api/client";
import {
  acknowledgeWorkOrder,
  arriveAtWorkOrder,
  completeWorkOrder,
  getPartStock,
  getWorkOrderChecklist,
  setWorkOrderChecklistItem,
  getWorkOrderAudit,
  getWorkOrderLabor,
  listAssetRepairs,
  listInventoryParts,
  listRepairCodes,
  pauseWorkOrderLabor,
  saveDiagnosis,
  startWorkOrderLabor,
  transitionWorkOrder,
  uploadWorkOrderPhoto,
} from "@/lib/api/workOrders";

jest.mock("@/lib/api/client", () => ({
  API_BASE: "https://api.test/v1",
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  toApiError: jest.fn(async (response: { status: number }) => Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: "tok" } } }) }, storage: { from: jest.fn() } },
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("structured timing and labor endpoints", () => {
  it("arrival is a real POST /arrive, not a comment", async () => {
    post.mockResolvedValue({ data: { action: "arrived" } });
    await arriveAtWorkOrder("wo-1");
    expect(post).toHaveBeenCalledWith("/work-orders/wo-1/arrive", {});
    expect(post).not.toHaveBeenCalledWith(expect.stringContaining("/comments"), expect.anything());
  });

  it("acknowledge, labor start and labor pause each hit their own endpoint", async () => {
    post.mockResolvedValue({});
    await acknowledgeWorkOrder("wo-1");
    await startWorkOrderLabor("wo-1");
    await pauseWorkOrderLabor("wo-1");
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/work-orders/wo-1/acknowledge", "/work-orders/wo-1/labor/start", "/work-orders/wo-1/labor/pause"]);
  });

  it("reads labor and audit with the caller's abort signal and falls back to an empty list", async () => {
    const signal = new AbortController().signal;
    get.mockResolvedValueOnce({ data: [{ id: "s1" }] }).mockResolvedValueOnce({ data: null });
    expect(await getWorkOrderLabor("wo-1", signal)).toEqual([{ id: "s1" }]);
    expect(await getWorkOrderAudit("wo-1", signal)).toEqual([]);
    expect(get).toHaveBeenNthCalledWith(1, "/work-orders/wo-1/labor", { signal });
    expect(get).toHaveBeenNthCalledWith(2, "/work-orders/wo-1/audit", { signal });
  });

  it("surfaces a refusal (e.g. a timer already running elsewhere) instead of swallowing it", async () => {
    post.mockRejectedValue(Object.assign(new Error("You already have a running labor timer on another work order"), { status: 409 }));
    await expect(startWorkOrderLabor("wo-1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("transitions", () => {
  it("hold carries the structured reason and optional note, tagged as mobile", async () => {
    post.mockResolvedValue({});
    await transitionWorkOrder("wo-1", { status: "on_hold", reason_code: "awaiting_parts", reason_note: "Compressor ordered" });
    expect(post).toHaveBeenCalledWith("/work-orders/wo-1/transition", { status: "on_hold", reason_code: "awaiting_parts", reason_note: "Compressor ordered", source: "mobile" });
  });

  it("escalation is the escalated status with a note — never a priority patch", async () => {
    post.mockResolvedValue({});
    await transitionWorkOrder("wo-1", { status: "escalated", reason_note: "Needs the vendor" });
    expect(post).toHaveBeenCalledWith("/work-orders/wo-1/transition", { status: "escalated", reason_note: "Needs the vendor", source: "mobile" });
    expect(patch).not.toHaveBeenCalled();
  });

  it("resume is a plain in_progress transition", async () => {
    post.mockResolvedValue({});
    await transitionWorkOrder("wo-1", { status: "in_progress" });
    expect(post).toHaveBeenCalledWith("/work-orders/wo-1/transition", { status: "in_progress", source: "mobile" });
  });
});

describe("diagnosis and repair codes", () => {
  it("loads codes for the order's trade from the API", async () => {
    get.mockResolvedValue({ data: [{ id: "c1", code_type: "problem", code: "no_cooling", label: "No cooling" }] });
    expect(await listRepairCodes("hvac")).toHaveLength(1);
    expect(get).toHaveBeenCalledWith("/work-orders/repair-codes?category=hvac", { signal: undefined });
  });

  it("saves only the diagnosis fields the schema defines", async () => {
    patch.mockResolvedValue({ data: { id: "wo-1" } });
    await saveDiagnosis("wo-1", { problem_code_id: "c1", cause_code_id: "k1" });
    expect(patch).toHaveBeenCalledWith("/work-orders/wo-1/diagnosis", { problem_code_id: "c1", cause_code_id: "k1" });
  });

  it("a permission refusal reaches the caller", async () => {
    patch.mockRejectedValue(Object.assign(new Error("Engineers can only update assigned or unassigned open work orders"), { status: 403 }));
    await expect(saveDiagnosis("wo-1", { problem_code_id: "c1" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("completion", () => {
  it("posts the structured body unchanged", async () => {
    post.mockResolvedValue({ data: { id: "wo-1" }, asset_downtime: null });
    const body = {
      verification_result: "passed" as const,
      resolution_code_id: "c1",
      parts_consumed: [{ part_id: "p1", location_id: "l1", quantity: 2 }],
    };
    await completeWorkOrder("wo-1", body);
    expect(post).toHaveBeenCalledWith("/work-orders/wo-1/complete", body);
  });

  it("rejects when the server rejects — there is no local success path", async () => {
    post.mockRejectedValue(Object.assign(new Error("Insufficient stock"), { status: 422 }));
    await expect(completeWorkOrder("wo-1", {})).rejects.toMatchObject({ status: 422 });
  });
});

describe("inventory and related repairs", () => {
  it("reads property inventory and per-location stock", async () => {
    get.mockResolvedValueOnce({ data: [{ id: "p1", name: "Capacitor", total_on_hand: 6 }] }).mockResolvedValueOnce({ data: { stock_by_location: [{ location_id: "l1", quantity: 6 }] } });
    expect((await listInventoryParts())[0].name).toBe("Capacitor");
    expect(await getPartStock("p1")).toEqual([{ location_id: "l1", quantity: 6 }]);
    expect(get).toHaveBeenNthCalledWith(2, "/inventory/parts/p1", { signal: undefined });
  });

  it("asks for completed repairs on the same asset only", async () => {
    get.mockResolvedValue({ data: [] });
    await listAssetRepairs("asset-9");
    expect(get.mock.calls[0][0]).toBe("/work-orders?asset_id=asset-9&statuses=completed&per_page=5");
  });
});

/** Records what the upload appends; the real FormData does not expose its fields under jest. */
class RecordingForm {
  fields: [string, unknown][] = [];
  append(key: string, value: unknown) {
    this.fields.push([key, value]);
  }
}
const sentFields = (init: { body: unknown }) => Object.fromEntries((init.body as RecordingForm).fields);

describe("evidence upload", () => {
  const originalFetch = global.fetch;
  const originalForm = global.FormData;
  beforeEach(() => {
    global.FormData = RecordingForm as unknown as typeof FormData;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    global.FormData = originalForm;
  });

  it("sends the photo type and caption as the API's form fields", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "ph-1", storage_path: "t/wo/1.jpg" } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const photo = await uploadWorkOrderPhoto("wo-1", "file:///a.jpg", { photoType: "after", caption: "  Clean coil " });
    expect(photo?.id).toBe("ph-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/v1/work-orders/wo-1/photos");
    const entries = sentFields(init);
    expect(entries.photo_type).toBe("after");
    expect(entries.caption).toBe("Clean coil");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("defaults to 'progress' with no caption and rejects on a server error", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({ detail: "Photo must be 5 MB or smaller" }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(uploadWorkOrderPhoto("wo-1", "file:///a.jpg")).rejects.toMatchObject({ status: 413 });
    const entries = sentFields(fetchMock.mock.calls[0][1]);
    expect(entries.photo_type).toBe("progress");
    expect(entries).not.toHaveProperty("caption");
  });

  it("passes the abort signal so Cancel really stops the upload", async () => {
    const ctl = new AbortController();
    const fetchMock = jest.fn().mockRejectedValue(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(uploadWorkOrderPhoto("wo-1", "file:///a.jpg", { signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0][1].signal).toBe(ctl.signal);
  });
});

describe("work-order checklist endpoints", () => {
  const summary = { total: 1, completed: 0, required_total: 1, required_completed: 0, required_remaining: [{ id: "i1", label: "Lock out" }], ready: false };
  const row = { id: "i1", label: "Lock out", is_required: true, is_done: false, done_by: null, done_at: null, sort_order: 1, estimated_minutes: null };

  it("reads the steps and the server's readiness summary from GET /checklist", async () => {
    get.mockResolvedValue({ data: [row], summary, meta: { editable: true } });
    const signal = new AbortController().signal;
    const snapshot = await getWorkOrderChecklist("wo-1", signal);
    expect(get).toHaveBeenCalledWith("/work-orders/wo-1/checklist", { signal });
    expect(snapshot.items[0]).toMatchObject({ id: "i1", is_required: true });
    expect(snapshot.summary.required_remaining).toEqual([{ id: "i1", label: "Lock out" }]);
  });

  it("throws on a malformed answer instead of returning an empty checklist", async () => {
    get.mockResolvedValue({ data: "oops" });
    await expect(getWorkOrderChecklist("wo-1")).rejects.toThrow();
    get.mockResolvedValue(undefined);
    await expect(getWorkOrderChecklist("wo-1")).rejects.toThrow();
  });

  it("ticks a step with PATCH and returns only what the server confirmed", async () => {
    patch.mockResolvedValue({ data: { ...row, is_done: true, done_by: "u1", done_at: "2026-10-31T10:00:00Z" }, summary: { ...summary, completed: 1, required_remaining: [], ready: true } });
    const out = await setWorkOrderChecklistItem("wo-1", "i1", true);
    expect(patch).toHaveBeenCalledWith("/work-orders/wo-1/checklist/i1", { is_done: true });
    expect(out.item.is_done).toBe(true);
    expect(out.summary.ready).toBe(true);
  });

  it("propagates a refusal so the caller never shows the change", async () => {
    patch.mockRejectedValue(Object.assign(new Error("closed"), { status: 409 }));
    await expect(setWorkOrderChecklistItem("wo-1", "i1", true)).rejects.toMatchObject({ status: 409 });
  });
});
