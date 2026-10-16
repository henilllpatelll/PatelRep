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

import i18next from "i18next";
import { sendCopilotMessage } from "@/lib/ai/copilotChat";
import { contextToIds, normalizeLaunch } from "@/lib/ai/launch";

const DOC = "d0000000-0000-4000-8000-000000000001";
const sent = () => mockPost.mock.calls[0][1].context as Record<string, string>;

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { response_type: "answer", message: "ok" } });
  (i18next as { language: string | undefined }).language = undefined;
});
afterAll(() => {
  (i18next as { language: string | undefined }).language = undefined;
});

describe("asking about a procedure", () => {
  it("is always a procedure question when a document is in context, whatever words it uses", async () => {
    await sendCopilotMessage("What if it stays on?", { context: { documentId: DOC } });
    expect(sent()).toMatchObject({ intent_hint: "sop_query", document_id: DOC });
  });

  it("does not turn an ordinary message into a procedure question", async () => {
    await sendCopilotMessage("Room 412 needs towels");
    expect(sent().intent_hint).toBeUndefined();
  });

  it("keeps an intent the caller chose", async () => {
    await sendCopilotMessage("Create a task", { intentHint: "task_creation", context: { documentId: DOC } });
    expect(sent().intent_hint).toBe("task_creation");
  });

  it("tells the server the app's language so the answer comes back in it", async () => {
    (i18next as { language: string | undefined }).language = "es-US";
    await sendCopilotMessage("¿Qué hago?", { context: { documentId: DOC } });
    expect(sent().language).toBe("es");
    mockPost.mockClear();
    (i18next as { language: string | undefined }).language = "en";
    await sendCopilotMessage("What do I do?");
    expect(sent().language).toBe("en");
  });

  it("lets a caller pick the language, and sends none the server would reject", async () => {
    (i18next as { language: string | undefined }).language = "fr";
    await sendCopilotMessage("Bonjour");
    expect(sent().language).toBeUndefined();
    mockPost.mockClear();
    await sendCopilotMessage("Hola", { language: "es" });
    expect(sent().language).toBe("es");
  });

  it("sends the document id of a SOP launch and only that, and never a malformed id", () => {
    expect(contextToIds(normalizeLaunch({ contextType: "sop", entityId: DOC, label: "Do Not Disturb Policy" }))).toEqual({ documentId: DOC });
    expect(contextToIds(normalizeLaunch({ contextType: "sop", entityId: "../etc/passwd" }))).toEqual({});
  });

  it("starts a different conversation when the procedure changes", () => {
    const a = normalizeLaunch({ contextType: "sop", entityId: DOC });
    const b = normalizeLaunch({ contextType: "sop", entityId: "d0000000-0000-4000-8000-000000000002" });
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe(`sop:${DOC}`);
  });
});
