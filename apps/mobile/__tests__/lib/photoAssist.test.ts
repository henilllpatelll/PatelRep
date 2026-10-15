const mockSession = jest.fn();
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: () => mockSession() } } }));
jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { ApiError, API_BASE: "https://api.test/v1", api: { get: jest.fn(), post: jest.fn() } };
});
const mockPrepare = jest.fn(async (uri: string) => `file:///data/cache/resized-${uri.split("/").pop()}`);
jest.mock("@/lib/housekeeping/photo", () => ({ pickPhoto: jest.fn(), prepareForUpload: (uri: string) => mockPrepare(uri) }));
const mockDiscard = jest.fn();
jest.mock("@/lib/housekeeping/photoAsset", () => {
  const actual = jest.requireActual("@/lib/housekeeping/photoAsset");
  return { ...actual, discardLocalPhoto: (uri: string) => mockDiscard(uri) };
});

import { CopilotFailure } from "@/lib/ai/contract";
import { UNABLE_TO_DETERMINE, analyzeIssuePhoto, normalizePhotoAnalysis } from "@/lib/ai/photoAnalysis";
import { MAX_PICKED_PHOTO_BYTES, checkPickedAsset, isAppCacheUri } from "@/lib/housekeeping/photoAsset";

const reply = (data: unknown) => ({ data });

describe("photo files: what may be attached", () => {
  it("accepts ordinary phone photos, and does not refuse for a missing type or size", () => {
    for (const mimeType of ["image/jpeg", "image/JPG", "image/png", "image/webp", "image/heic", "image/heif"]) {
      expect(checkPickedAsset({ mimeType, fileSize: 2_000_000 })).toBeNull();
    }
    expect(checkPickedAsset({})).toBeNull();
    expect(checkPickedAsset({ mimeType: null, fileSize: null })).toBeNull();
  });

  it("refuses something that is not a supported photo, or is far too large", () => {
    for (const mimeType of ["application/pdf", "video/mp4", "image/gif", "image/svg+xml", "text/plain"]) {
      expect(checkPickedAsset({ mimeType })).toBe("unsupported");
    }
    expect(checkPickedAsset({ mimeType: "image/jpeg", fileSize: MAX_PICKED_PHOTO_BYTES + 1 })).toBe("too_large");
    expect(checkPickedAsset({ mimeType: "image/jpeg", fileSize: MAX_PICKED_PHOTO_BYTES })).toBeNull();
  });

  it("only ever treats the app's own cache as deletable", () => {
    expect(isAppCacheUri("file:///data/user/0/app/cache/ImagePicker/abc.jpg")).toBe(true);
    expect(isAppCacheUri("file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImageManipulator/a.jpg")).toBe(true);
    expect(isAppCacheUri("file:///storage/emulated/0/DCIM/Camera/original.jpg")).toBe(false);
    expect(isAppCacheUri("content://media/external/images/1")).toBe(false);
    expect(isAppCacheUri(null)).toBe(false);
    expect(isAppCacheUri("https://example.com/cache/x.jpg")).toBe(false);
  });
});

describe("normalizePhotoAnalysis — the reply is checked again here", () => {
  it("reads a suggestion", () => {
    expect(
      normalizePhotoAnalysis(reply({ outcome: "suggestion", observation: "  Moisture   under sink ", suggested_category: "Plumbing", question: "Is water actively leaking?" })),
    ).toEqual({ outcome: "suggestion", observation: "Moisture under sink", category: "plumbing", question: "Is water actively leaking?" });
  });

  it("drops an unknown category and a 'question' that is a statement", () => {
    const result = normalizePhotoAnalysis(reply({ outcome: "suggestion", observation: "A crack", suggested_category: "demolition", question: "Call someone now." }));
    expect(result).toMatchObject({ outcome: "suggestion", category: null, question: null });
  });

  it("a suggestion with nothing to say, or an 'unable' outcome, is unable-to-determine with nothing carried over", () => {
    expect(normalizePhotoAnalysis(reply({ outcome: "suggestion", observation: "  " }))).toEqual(UNABLE_TO_DETERMINE);
    expect(normalizePhotoAnalysis(reply({ outcome: "unable_to_determine", observation: "x", suggested_category: "hvac" }))).toEqual(UNABLE_TO_DETERMINE);
  });

  it.each([null, undefined, "text", {}, { data: null }, { data: [] }, { data: { outcome: "hazard!" } }])("rejects a malformed body: %p", (body) => {
    expect(() => normalizePhotoAnalysis(body)).toThrow(CopilotFailure);
    try {
      normalizePhotoAnalysis(body);
    } catch (error) {
      expect((error as CopilotFailure).kind).toBe("invalid_response");
    }
  });
});

describe("analyzeIssuePhoto", () => {
  const fetchMock = jest.fn();
  const OK = { ok: true, status: 200, json: async () => reply({ outcome: "suggestion", observation: "Moisture under sink", suggested_category: "plumbing" }) };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    fetchMock.mockResolvedValue(OK);
  });

  it("sends one resized copy to the authenticated backend with the verified room, and removes the copy afterwards", async () => {
    const result = await analyzeIssuePhoto({ uri: "file:///data/cache/ImagePicker/photo.jpg", description: "  sink drips ", roomId: "room-1" });

    expect(result).toEqual({ outcome: "suggestion", observation: "Moisture under sink", category: "plumbing", question: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/v1/ai/photo-analysis");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer jwt" });
    const form = init.body as FormData;
    expect(form.get("description")).toBe("sink drips");
    expect(form.get("room_id")).toBe("room-1");
    expect(mockPrepare).toHaveBeenCalledWith("file:///data/cache/ImagePicker/photo.jpg");
    // The smaller copy is deleted; the picked original is left for the report to use.
    expect(mockDiscard).toHaveBeenCalledWith("file:///data/cache/resized-photo.jpg");
    expect(mockDiscard).not.toHaveBeenCalledWith("file:///data/cache/ImagePicker/photo.jpg");
  });

  it("does not send anything when signed out", async () => {
    mockSession.mockResolvedValue({ data: { session: null } });
    await expect(analyzeIssuePhoto({ uri: "file:///data/cache/p.jpg" })).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it.each([
    [402, "credit_limit"],
    [429, "rate_limited"],
    [403, "permission"],
    [404, "not_found"],
    [503, "unavailable"],
    [500, "unavailable"],
  ])("maps HTTP %i to %s and still cleans up", async (status, kind) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ detail: "no" }) });
    await expect(analyzeIssuePhoto({ uri: "file:///data/cache/p.jpg" })).rejects.toMatchObject({ kind });
    expect(mockDiscard).toHaveBeenCalledWith("file:///data/cache/resized-p.jpg");
  });

  it("a rejected image (400/415) is an invalid request the person can act on", async () => {
    for (const status of [400, 413, 415, 422]) {
      fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ detail: "Only JPEG, PNG, or WebP images can be analysed." }) });
      await expect(analyzeIssuePhoto({ uri: "file:///data/cache/p.jpg" })).rejects.toMatchObject({ kind: "invalid_request" });
    }
  });

  it("a network failure is 'offline' and a malformed 200 is an invalid response", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(analyzeIssuePhoto({ uri: "file:///data/cache/p.jpg" })).rejects.toMatchObject({ kind: "offline" });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { outcome: "diagnosis" } }) });
    await expect(analyzeIssuePhoto({ uri: "file:///data/cache/p.jpg" })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("cancelling rejects with an AbortError, not a failure the person sees", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    const pending = analyzeIssuePhoto({ uri: "file:///data/cache/p.jpg", signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mockDiscard).toHaveBeenCalled();

    const already = new AbortController();
    already.abort();
    await expect(analyzeIssuePhoto({ uri: "file:///data/cache/q.jpg", signal: already.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
