import { ApiError } from "@/lib/api/client";
import {
  completeInspection,
  fetchInspectionDetail,
  fetchInspectionSubmission,
  fetchReadyForInspectionVerified,
  type CompletionBody,
} from "@/lib/api/inspections";
import { supabase } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockRefreshSession = supabase.auth.refreshSession as jest.Mock;

const body: CompletionBody = {
  room_id: "room-1",
  template_id: "tpl-1",
  overall_result: "failed",
  items: [{ template_item_id: "i1", result: "fail" }],
  client_submission_id: "sub-1",
};

function reply(status: number, payload: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

/** React Native's FormData accepts `{ uri, type, name }` file descriptors; Node's would stringify them, hiding what is sent. */
class RecordingFormData {
  parts: [string, unknown][] = [];
  append(key: string, value: unknown) {
    this.parts.push([key, value]);
  }
  get(key: string) {
    return this.parts.find(([k]) => k === key)?.[1] ?? null;
  }
  getAll(key: string) {
    return this.parts.filter(([k]) => k === key).map(([, v]) => v);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { FormData: unknown }).FormData = RecordingFormData;
  global.fetch = jest.fn();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "token-1" } } });
  mockRefreshSession.mockResolvedValue({ data: { session: { access_token: "token-2" } }, error: null });
});

describe("completeInspection", () => {
  it("posts multipart with the JSON body and photos paired with their item ids, in order", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, { data: { id: "sub-1" } }));
    await completeInspection(body, [
      { itemId: "i1", uri: "file:///1.jpg" },
      { itemId: "i7", uri: "file:///7.jpg" },
    ]);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/housekeeping\/inspections\/complete$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer token-1" }); // no Content-Type: fetch must set the multipart boundary
    const form = init.body as FormData;
    expect(JSON.parse(form.get("inspection") as string)).toEqual(body);
    // the server pairs photo_item_ids[i] with photos[i], so the parts must alternate in lock step
    expect((form as unknown as RecordingFormData).parts.map(([k]) => k)).toEqual(["inspection", "photo_item_ids", "photos", "photo_item_ids", "photos"]);
    expect(form.getAll("photo_item_ids")).toEqual(["i1", "i7"]);
    const files = form.getAll("photos") as unknown as { uri: string; type: string; name: string }[];
    expect(files.map((f) => f.uri)).toEqual(["file:///1.jpg", "file:///7.jpg"]);
    expect(files.map((f) => f.name)).toEqual(["i1.jpg", "i7.jpg"]);
  });

  it("sends no photo parts when there are none", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, { data: { id: "sub-1" } }));
    await completeInspection({ ...body, overall_result: "passed" });
    const form = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
    expect(form.getAll("photos")).toEqual([]);
    expect(form.getAll("photo_item_ids")).toEqual([]);
  });

  it("returns the raw body without deciding whether it is a success", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, { surprise: true }));
    await expect(completeInspection(body)).resolves.toEqual({ surprise: true });
  });

  it("surfaces the server's stable code, message and extras on a string-detail error", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      reply(409, { detail: "Room must be clean before it can be inspected", code: "room_not_awaiting_inspection", room_status: "INSPECTED" }),
    );
    const error = await completeInspection(body).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "room_not_awaiting_inspection",
      message: "Room must be clean before it can be inspected",
    });
    expect((error as ApiError).body).toMatchObject({ room_status: "INSPECTED" });
  });

  it("keeps working with the older structured-detail errors", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(409, { detail: { code: "ROOM_STATE_CHANGED", message: "moved" } }));
    const error = await completeInspection(body).catch((e) => e);
    expect(error).toMatchObject({ status: 409, code: "ROOM_STATE_CHANGED", message: "moved" });
  });

  it("refreshes an expired session once and retries", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { data: { id: "sub-1" } }));
    mockRefreshSession.mockImplementation(async () => {
      mockGetSession.mockResolvedValue({ data: { session: { access_token: "token-2" } } });
      return { data: { session: { access_token: "token-2" } }, error: null };
    });
    await completeInspection(body);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe("Bearer token-2");
  });

  it("a network failure is a plain Error with no status: the write may have landed", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
    const error = await completeInspection(body).catch((e) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as { status?: number }).status).toBeUndefined();
  });
});

describe("reads", () => {
  const detail = { id: "insp-1", room_id: "r", items: [], correction: null };

  it("reads an inspection and refuses a body that is not one", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(200, { data: detail }));
    await expect(fetchInspectionDetail("insp-1")).resolves.toMatchObject({ id: "insp-1" });
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(200, { data: { nope: 1 } }));
    await expect(fetchInspectionDetail("insp-1")).rejects.toThrow("Malformed");
  });

  it("read-back: found, definitively not found, or an error that leaves the caller uncertain", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(200, { data: detail }));
    await expect(fetchInspectionSubmission("sub-1")).resolves.toMatchObject({ status: "found" });
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(404, { detail: "Inspection submission not found" }));
    await expect(fetchInspectionSubmission("sub-1")).resolves.toEqual({ status: "not_found" });
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(500, { detail: "boom" }));
    await expect(fetchInspectionSubmission("sub-1")).rejects.toMatchObject({ status: 500 });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("offline"));
    await expect(fetchInspectionSubmission("sub-1")).rejects.toThrow("offline");
  });

  it("ids are encoded into the path", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(reply(200, { data: detail }));
    await fetchInspectionDetail("a/b");
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch(/inspections\/a%2Fb$/);
  });

  it("the strict queue read throws on a body that is not a list instead of reading as an empty queue", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(200, { data: null }));
    await expect(fetchReadyForInspectionVerified("2026-10-20")).rejects.toThrow("Malformed");
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply(200, { data: [] }));
    await expect(fetchReadyForInspectionVerified("2026-10-20")).resolves.toEqual([]);
  });
});
