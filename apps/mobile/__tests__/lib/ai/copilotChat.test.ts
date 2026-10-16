const mockPost = jest.fn();

jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { ApiError, api: { post: (...args: unknown[]) => mockPost(...args) } };
});

import { ApiError } from "@/lib/api/client";
import { confirmAction, newRequestKey, sendCopilotMessage } from "@/lib/ai/copilotChat";
import { CopilotFailure } from "@/lib/ai/contract";
import { taskDraftFromRaw, workOrderDraftFromRaw, guestRequestDraftFromRaw } from "@/lib/ai/drafts";

beforeEach(() => mockPost.mockReset());

describe("sendCopilotMessage", () => {
  it("posts the message with an object context, never a role", async () => {
    mockPost.mockResolvedValue({ data: { response_type: "answer", message: "Hello" } });
    const out = await sendCopilotMessage("hi");
    expect(mockPost).toHaveBeenCalledWith("/ai/copilot/chat", { message: "hi", context: { source: "mobile" } });
    expect(out).toMatchObject({ kind: "answer", message: "Hello" });
  });

  it("sends the intent hint and trusted context ids for the server to verify", async () => {
    mockPost.mockResolvedValue({ data: { response_type: "answer", message: "ok" } });
    await sendCopilotMessage("How do I strip a bed", { intentHint: "sop_query", context: { documentId: "doc-1", roomId: "r-1" } });
    expect(mockPost.mock.calls[0][1].context).toEqual({
      source: "mobile",
      intent_hint: "sop_query",
      room_id: "r-1",
      document_id: "doc-1",
    });
  });

  it("turns HTTP errors into typed failures", async () => {
    mockPost.mockRejectedValue(new ApiError("Monthly AI credit cap reached.", 402));
    await expect(sendCopilotMessage("x")).rejects.toMatchObject({ kind: "credit_limit" });
    mockPost.mockRejectedValue(new ApiError("AI service temporarily unavailable.", 503));
    await expect(sendCopilotMessage("x")).rejects.toMatchObject({ kind: "unavailable" });
    mockPost.mockRejectedValue(new ApiError("nope", 403));
    await expect(sendCopilotMessage("x")).rejects.toMatchObject({ kind: "permission" });
    mockPost.mockRejectedValue(new Error("Network request failed"));
    await expect(sendCopilotMessage("x")).rejects.toMatchObject({ kind: "offline" });
  });

  it("refuses a reply it cannot read", async () => {
    mockPost.mockResolvedValue({ message: "legacy flat shape" });
    await expect(sendCopilotMessage("x")).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("confirmAction — the three existing endpoints take arrays", () => {
  const key = "22222222-2222-4222-8222-222222222222";

  it("posts a task to /ai/tasks/confirm", async () => {
    mockPost.mockResolvedValue({ data: { created_count: 1, tasks: [{}] }, meta: { deduplicated: 0 } });
    const preview = taskDraftFromRaw({ title: "Towels", room_id: "r1", room_number_display: "214" })!;
    const result = await confirmAction(preview, key);
    expect(mockPost).toHaveBeenCalledWith("/ai/tasks/confirm", [
      { title: "Towels", task_type: "general", priority: "normal", room_id: "r1" },
    ]);
    expect(result).toEqual({ createdCount: 1, deduplicated: false });
  });

  it("posts a work order to /ai/work-orders/confirm with its idempotency key", async () => {
    mockPost.mockResolvedValue({ data: { created_count: 1 }, meta: { deduplicated: 0 } });
    const preview = workOrderDraftFromRaw({ title: "Leak", category: "plumbing", priority: "urgent", room_number: "305" })!;
    await confirmAction(preview, key);
    expect(mockPost.mock.calls[0][0]).toBe("/ai/work-orders/confirm");
    expect(mockPost.mock.calls[0][1]).toEqual([
      { title: "Leak", category: "plumbing", priority: "urgent", room_number: "305", client_request_id: key },
    ]);
  });

  it("posts a guest request to /ai/guest-requests/confirm and reports a server-side duplicate", async () => {
    mockPost.mockResolvedValue({ data: { created_count: 1 }, meta: { deduplicated: 1 } });
    const preview = guestRequestDraftFromRaw({ title: "Crib", room_number: "412" })!;
    const result = await confirmAction(preview, key);
    expect(mockPost.mock.calls[0][0]).toBe("/ai/guest-requests/confirm");
    expect(result.deduplicated).toBe(true);
  });

  it("rejects an invalid draft before sending anything", async () => {
    const preview = workOrderDraftFromRaw({ title: "Leak", category: "plumbing", priority: "urgent" })!; // no place
    await expect(confirmAction(preview, key)).rejects.toMatchObject({ kind: "invalid_request" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("is not a success unless the server says it created something", async () => {
    const preview = taskDraftFromRaw({ title: "Towels" })!;
    for (const body of [{}, { data: {} }, { data: { created_count: 0 } }, { data: { created_count: "1" } }, null]) {
      mockPost.mockResolvedValueOnce(body);
      await expect(confirmAction(preview, key)).rejects.toBeInstanceOf(CopilotFailure);
    }
    mockPost.mockResolvedValueOnce({});
    await expect(confirmAction(preview, key)).rejects.toMatchObject({ kind: "unconfirmed" });
  });

  it("maps the server's refusals to typed failures", async () => {
    const preview = guestRequestDraftFromRaw({ title: "Crib", room_number: "9999" })!;
    mockPost.mockRejectedValue(new ApiError("Room 9999 was not found in your hotel", 400));
    await expect(confirmAction(preview, key)).rejects.toMatchObject({ kind: "invalid_request", message: "Room 9999 was not found in your hotel" });
    mockPost.mockRejectedValue(new ApiError("Your role can't use that assistant action.", 403));
    await expect(confirmAction(preview, key)).rejects.toMatchObject({ kind: "permission" });
  });
});

describe("newRequestKey", () => {
  it("is a v4 UUID, and different each time", () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
