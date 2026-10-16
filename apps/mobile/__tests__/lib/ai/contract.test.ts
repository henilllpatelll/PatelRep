const mockPost = jest.fn();

jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    detail?: unknown;
    constructor(message: string, status: number, code?: string, detail?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.detail = detail;
    }
  }
  return { ApiError, api: { post: (...args: unknown[]) => mockPost(...args) } };
});

import { ApiError } from "@/lib/api/client";
import { CopilotFailure, normalizeCopilotResponse, toCopilotFailure } from "@/lib/ai/contract";

const envelope = (data: Record<string, unknown>) => ({ data });

describe("normalizeCopilotResponse — the backend envelope", () => {
  it("reads a general answer produced by the rule engine as deterministic, with no sources", () => {
    const out = normalizeCopilotResponse(
      envelope({ response_type: "answer", message: "I can help.", model_used: null, credits_used: 0, intent: "general" }),
    );
    expect(out).toMatchObject({ kind: "answer", message: "I can help.", provenance: "deterministic", intent: "general", sources: [] });
  });

  it("reads a model-written answer as AI provenance", () => {
    const out = normalizeCopilotResponse(envelope({ response_type: "answer", message: "Hi", model_used: "claude-sonnet-4-6" }));
    expect(out.provenance).toBe("ai");
  });

  it("reads SOP answers with sources (title, page, document id) and de-duplicates them", () => {
    const out = normalizeCopilotResponse(
      envelope({
        response_type: "answer",
        message: "Strip the bed first.",
        model_used: "claude-sonnet-4-6",
        sources: [
          { content: "Strip linen.", similarity: 0.9, metadata: { page_number: 3 }, document_id: "d0000000-0000-4000-8000-0000000000d1", title: "Linen SOP" },
          { content: "Strip linen again.", similarity: 0.8, metadata: { page_number: 3 }, document_id: "d0000000-0000-4000-8000-0000000000d1", title: "Linen SOP" },
          { content: "Other", similarity: 0.7, metadata: {}, document_id: "d0000000-0000-4000-8000-0000000000d2", title: "Safety SOP" },
          "garbage",
        ],
      }),
    );
    expect(out.kind).toBe("answer");
    if (out.kind !== "answer") return;
    expect(out.sources).toEqual([
      { title: "Linen SOP", excerpt: "Strip linen.", page: 3, documentId: "d0000000-0000-4000-8000-0000000000d1", version: null, section: null },
      { title: "Safety SOP", excerpt: "Other", page: null, documentId: "d0000000-0000-4000-8000-0000000000d2", version: null, section: null },
    ]);
  });

  it("reads task previews, normalising priority and keeping only server-verified rooms linked", () => {
    const out = normalizeCopilotResponse(
      envelope({
        response_type: "task_preview",
        message: "I found 2 tasks.",
        model_used: "gpt-4o-mini",
        tasks: [
          { title: "Bring towels", task_type: "guest_request", priority: "high", room_id: "room-1", room_number_display: "214" },
          { title: "Restock cart", task_type: "housekeeping", priority: "low", room_id: null, room_number_display: "999" },
        ],
      }),
    );
    expect(out.kind).toBe("actions");
    if (out.kind !== "actions") return;
    expect(out.actions).toHaveLength(2);
    expect(out.actions[0]).toEqual({
      kind: "task",
      draft: { title: "Bring towels", description: "", taskType: "guest_request", priority: "urgent", roomNumber: "214", roomId: "room-1" },
    });
    // A number the server could not link stays unverified (no roomId).
    expect(out.actions[1].draft).toMatchObject({ roomNumber: "999", roomId: null, priority: "low" });
  });

  it("reads work-order previews and falls back to general for an unknown category", () => {
    const out = normalizeCopilotResponse(
      envelope({
        response_type: "work_order_preview",
        message: "ok",
        work_orders: [{ title: "Leak", category: "mystery", priority: "urgent", room_number: "305", room_id: "room-9" }],
      }),
    );
    if (out.kind !== "actions") throw new Error("expected actions");
    expect(out.actions[0]).toMatchObject({
      kind: "work_order",
      draft: { title: "Leak", category: "general", priority: "urgent", roomNumber: "305", roomId: "room-9" },
    });
  });

  it("reads guest-request previews and forces accessibility requests to urgent", () => {
    const out = normalizeCopilotResponse(
      envelope({
        response_type: "guest_request_preview",
        message: "ok",
        requests: [{ title: "Grab bar", category: "accessibility", priority: "normal", room_number: "412", guest_name: "Smith" }],
      }),
    );
    if (out.kind !== "actions") throw new Error("expected actions");
    expect(out.actions[0].draft).toMatchObject({ category: "accessibility", priority: "urgent", guestName: "Smith" });
  });

  it("supports multiple generated actions in one reply", () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({ title: `Task ${i}` }));
    const out = normalizeCopilotResponse(envelope({ response_type: "task_preview", message: "3", tasks }));
    expect(out.kind === "actions" && out.actions.length).toBe(3);
  });

  it("reads ambiguity as clarification options and drops options it does not recognise", () => {
    const out = normalizeCopilotResponse(
      envelope({
        response_type: "ambiguous",
        message: "What do you need?",
        options: [
          { label: "Work Order", intent_hint: "work_order_creation" },
          { label: "Hack", intent_hint: "insight_query" },
          { label: "Guest Request", intent_hint: "guest_request_creation" },
        ],
      }),
    );
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.options.map((o) => o.intentHint)).toEqual(["work_order_creation", "guest_request_creation"]);
  });

  it("surfaces the server-verified context", () => {
    const out = normalizeCopilotResponse(
      envelope({ response_type: "answer", message: "hi", trusted_context: { room_id: "r", room_number: "412" } }),
    );
    expect(out.trustedContext).toEqual({ roomId: "r", roomNumber: "412" });
  });

  it("treats assignment previews and insights as valid but unsupported — never as an action", () => {
    for (const type of ["assignment_preview", "insights", "something_new"]) {
      const out = normalizeCopilotResponse(envelope({ response_type: type, message: "x", assignments: [{ staff_name_hint: "A" }] }));
      expect(out.kind).toBe("unsupported");
    }
  });
});

describe("normalizeCopilotResponse — never trusts a malformed reply", () => {
  const bad: Array<[string, unknown]> = [
    ["null", null],
    ["a bare string", "ok"],
    ["a legacy flat shape", { message: "hi", intent: "task_creation", task_preview: { title: "x" } }],
    ["no response_type", { data: { message: "hi" } }],
    ["no message", { data: { response_type: "answer" } }],
    ["task_preview with a non-array tasks", { data: { response_type: "task_preview", message: "m", tasks: { title: "x" } } }],
    ["task_preview whose tasks are all unusable", { data: { response_type: "task_preview", message: "m", tasks: [{}, null, { title: "  " }] } }],
  ];

  it.each(bad)("%s → invalid_response failure, not a success", (_name, raw) => {
    let caught: unknown;
    try {
      normalizeCopilotResponse(raw);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CopilotFailure);
    expect((caught as CopilotFailure).kind).toBe("invalid_response");
  });

  it("an empty tasks array is a plain answer, not an action", () => {
    const out = normalizeCopilotResponse(envelope({ response_type: "task_preview", message: "No tasks found.", tasks: [] }));
    expect(out.kind).toBe("answer");
  });

  it("caps runaway previews", () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({ title: `T${i}` }));
    const out = normalizeCopilotResponse(envelope({ response_type: "task_preview", message: "many", tasks }));
    expect(out.kind === "actions" && out.actions.length).toBe(20);
  });
});

describe("toCopilotFailure", () => {
  it.each([
    [new ApiError("Permission", 403), "permission"],
    [new ApiError("Monthly AI credit cap reached.", 402), "credit_limit"],
    [new ApiError("Too many", 429), "rate_limited"],
    [new ApiError("AI service temporarily unavailable.", 503), "unavailable"],
    [new ApiError("Boom", 500), "unavailable"],
    [new ApiError("Record not found.", 404), "not_found"],
    [new ApiError("Room 9 was not found in your hotel", 400), "invalid_request"],
    [new ApiError("Unsupported intent hint.", 422), "invalid_request"],
    [new ApiError("Expired", 401), "unauthenticated"],
    [new Error("Network request failed"), "offline"],
    [new TypeError("Failed to fetch"), "offline"],
    [new Error("Request timed out. Please try again."), "unavailable"],
    [new Error("Session expired. Please log in again."), "unauthenticated"],
    [new Error("???"), "unknown"],
  ])("%p → %s", (error, kind) => {
    expect(toCopilotFailure(error).kind).toBe(kind);
  });

  it("passes an existing failure through", () => {
    const failure = new CopilotFailure("unconfirmed", "x");
    expect(toCopilotFailure(failure)).toBe(failure);
  });
});
