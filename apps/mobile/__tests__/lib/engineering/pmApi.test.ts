jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    detail?: unknown;
    constructor(message: string, status: number, _code?: string, detail?: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn(), postForm: jest.fn(), delete: jest.fn(), patch: jest.fn() } };
});

import { ApiError, api } from "@/lib/api/client";
import { findLandedCompletion, listPmCompletions, submitPmCompletion, uploadPmEvidence } from "@/lib/api/pm";
import { PmCompletionBlockedError, type PmCompletionPayload } from "@/lib/engineering/pmCompletion";

const mocked = api as unknown as { get: jest.Mock; post: jest.Mock; postForm: jest.Mock; delete: jest.Mock };
const payload: PmCompletionPayload = { items: [{ label: "Filter replaced", result: "passed" }] };
const ctx = { userId: "u1", attemptStartedAt: Date.parse("2026-11-04T16:00:00Z") };
const landedRow = { id: "c1", technician_id: "u1", completed_at: "2026-11-04T16:00:03Z" };

beforeEach(() => jest.resetAllMocks());

describe("submitPmCompletion", () => {
  it("posts the real payload to the complete endpoint and returns the server's record", async () => {
    mocked.post.mockResolvedValue({ data: { id: "c1", pm_schedule_id: "s1", completed_at: "x", corrective_work_orders: [{ id: "wo1", title: "Corrective PM work: Belt" }] } });
    const result = await submitPmCompletion("s1", payload, ctx);
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith("/assets/pm-schedules/s1/complete", payload);
    expect(result.corrective_work_orders).toEqual([{ id: "wo1", title: "Corrective PM work: Belt" }]);
  });

  it("never sends an empty or item-less body", async () => {
    await expect(submitPmCompletion("s1", {} as never, ctx)).rejects.toBeInstanceOf(PmCompletionBlockedError);
    await expect(submitPmCompletion("s1", { items: [] }, ctx)).rejects.toBeInstanceOf(PmCompletionBlockedError);
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("surfaces a 422 as a refusal without re-reading or retrying", async () => {
    mocked.post.mockRejectedValue(new ApiError("Evidence required", 422, undefined, "Evidence is required for Relief valve"));
    await expect(submitPmCompletion("s1", payload, ctx)).rejects.toMatchObject({ status: 422 });
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it.each([[403], [404], [409]])("does not look for a duplicate after a definitive %s", async (status) => {
    mocked.post.mockRejectedValue(new ApiError("no", status));
    await expect(submitPmCompletion("s1", payload, ctx)).rejects.toMatchObject({ status });
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it("after a network failure, finds the completion that did land instead of reporting failure", async () => {
    mocked.post.mockRejectedValue(new Error("Network request failed"));
    mocked.get.mockResolvedValue({ data: [landedRow] });
    const result = await submitPmCompletion("s1", payload, ctx);
    expect(result).toMatchObject({ id: "c1", reconciled: true });
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it("after a 5xx with nothing recorded, rethrows the original error so the screen reports an unknown outcome", async () => {
    const boom = new ApiError("server", 502);
    mocked.post.mockRejectedValue(boom);
    mocked.get.mockResolvedValue({ data: [{ ...landedRow, technician_id: "someone-else" }, { ...landedRow, id: "old", completed_at: "2026-10-01T00:00:00Z" }] });
    await expect(submitPmCompletion("s1", payload, ctx)).rejects.toBe(boom);
  });

  it("if the re-read also fails, the outcome stays unknown (original error)", async () => {
    const down = new Error("Network request failed");
    mocked.post.mockRejectedValue(down);
    mocked.get.mockRejectedValue(new Error("Network request failed"));
    await expect(submitPmCompletion("s1", payload, ctx)).rejects.toBe(down);
  });

  it("checks an earlier unconfirmed attempt BEFORE posting again, so a retry cannot duplicate it", async () => {
    mocked.get.mockResolvedValue({ data: [landedRow] });
    const result = await submitPmCompletion("s1", payload, { ...ctx, attemptStartedAt: Date.now(), unknownSince: ctx.attemptStartedAt });
    expect(result).toMatchObject({ id: "c1", reconciled: true });
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("posts the retry only once the pre-check shows the earlier attempt did not land", async () => {
    mocked.get.mockResolvedValue({ data: [] });
    mocked.post.mockResolvedValue({ data: { id: "c2", pm_schedule_id: "s1", completed_at: "y" } });
    const result = await submitPmCompletion("s1", payload, { ...ctx, unknownSince: ctx.attemptStartedAt });
    expect(mocked.get).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("c2");
  });

  it("if the pre-check itself fails it does not post blind", async () => {
    mocked.get.mockRejectedValue(new Error("Network request failed"));
    await expect(submitPmCompletion("s1", payload, { ...ctx, unknownSince: ctx.attemptStartedAt })).rejects.toThrow("Network request failed");
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

describe("findLandedCompletion", () => {
  it("only counts this person's completion made at or after the attempt (small clock skew allowed)", async () => {
    mocked.get.mockResolvedValue({ data: [{ ...landedRow, completed_at: "2026-11-04T15:59:57Z" }] });
    expect(await findLandedCompletion("s1", "u1", ctx.attemptStartedAt)).toMatchObject({ id: "c1" });
    mocked.get.mockResolvedValue({ data: [{ ...landedRow, completed_at: "2026-11-04T15:59:50Z" }] });
    expect(await findLandedCompletion("s1", "u1", ctx.attemptStartedAt)).toBeNull();
  });
});

describe("uploadPmEvidence", () => {
  it("creates an evidence record, uploads the file to it, and returns only the record id", async () => {
    mocked.post.mockResolvedValue({ data: { id: "ev-1" } });
    mocked.postForm.mockResolvedValue({ data: {} });
    const id = await uploadPmEvidence({ assetId: "asset-1", uri: "file:///p.jpg", label: "HVAC: Filter" });
    expect(id).toBe("ev-1");
    expect(mocked.post).toHaveBeenCalledWith(
      "/evidence/records",
      { label: "HVAC: Filter", evidence_type: "photo", related_entity_type: "asset", related_entity_id: "asset-1" },
      { signal: undefined },
    );
    expect(mocked.postForm).toHaveBeenCalledWith("/evidence/records/ev-1/file", expect.anything(), { signal: undefined });
  });

  it("removes the empty record when the file upload fails, so nothing is left to mistake for proof", async () => {
    mocked.post.mockResolvedValue({ data: { id: "ev-2" } });
    mocked.postForm.mockRejectedValue(new ApiError("too large", 413));
    mocked.delete.mockResolvedValue(undefined);
    await expect(uploadPmEvidence({ assetId: "a", uri: "file:///p.jpg", label: "x" })).rejects.toMatchObject({ status: 413 });
    expect(mocked.delete).toHaveBeenCalledWith("/evidence/records/ev-2");
  });

  it("surfaces an authorization failure at record creation without uploading anything", async () => {
    mocked.post.mockRejectedValue(new ApiError("forbidden", 403));
    await expect(uploadPmEvidence({ assetId: "a", uri: "file:///p.jpg", label: "x" })).rejects.toMatchObject({ status: 403 });
    expect(mocked.postForm).not.toHaveBeenCalled();
  });
});

describe("listPmCompletions", () => {
  it("pages with limit/offset, optionally by asset, and reports has_more", async () => {
    mocked.get.mockResolvedValue({ data: [{ id: "c1" }], meta: { has_more: true } });
    const page = await listPmCompletions({ offset: 20, limit: 20, assetId: "a1" });
    expect(mocked.get).toHaveBeenCalledWith("/assets/pm-completions?limit=20&offset=20&asset_id=a1");
    expect(page).toEqual({ rows: [{ id: "c1" }], hasMore: true });
  });

  it("treats a missing list as empty, not an error", async () => {
    mocked.get.mockResolvedValue({ data: null });
    expect(await listPmCompletions()).toEqual({ rows: [], hasMore: false });
  });
});
