const mockSend = jest.fn();
const mockConfirm = jest.fn();
const mockStore = new Map<string, string>();

jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } };
});
jest.mock("@/lib/ai/copilotChat", () => ({
  ...jest.requireActual("@/lib/ai/copilotChat"),
  sendCopilotMessage: (...args: unknown[]) => mockSend(...args),
  confirmAction: (...args: unknown[]) => mockConfirm(...args),
}));
jest.mock("@/lib/auth/secureSessionStorage", () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStore.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStore.delete(key);
    },
  },
}));

import { act, renderHook, waitFor } from "@testing-library/react-native";
import { CopilotFailure, type CopilotOutcome } from "@/lib/ai/contract";
import { useAssistantConversation } from "@/lib/ai/useAssistantConversation";
import { historyKey, resetLegacyPurgeFlag } from "@/lib/ai/history";
import { resetAssistantSession } from "@/lib/ai/session";
import { taskDraftFromRaw, workOrderDraftFromRaw } from "@/lib/ai/drafts";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const user = (id: string, tenant: string) => ({ id, tenant_id: tenant, role: "housekeeper" }) as unknown as UserProfile;
const ALICE = user("alice", "hotel-a");
const BOB = user("bob", "hotel-a");

const answer = (message: string): CopilotOutcome => ({
  kind: "answer",
  message,
  intent: "general",
  provenance: "deterministic",
  trustedContext: null,
  sources: [],
});
const actionsOutcome = (): CopilotOutcome => ({
  kind: "actions",
  message: "I'll create this",
  intent: "task_creation",
  provenance: "ai",
  trustedContext: null,
  actions: [taskDraftFromRaw({ title: "Bring towels", room_id: "r1", room_number_display: "214" })!],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function signIn(profile: UserProfile | null, online = true) {
  act(() => {
    useAppStore.setState({ isOnline: online });
    useAppStore.getState().setUser(profile);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  resetLegacyPurgeFlag();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
});

describe("sending", () => {
  it("adds the person's message and the normalised reply", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("Hello there"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("hi");
    });
    expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "hi"],
      ["assistant", "Hello there"],
    ]);
    expect(result.current.sending).toBe(false);
  });

  it("treats a double tap as one paid request", async () => {
    signIn(ALICE);
    const pending = deferred<CopilotOutcome>();
    mockSend.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAssistantConversation());
    act(() => {
      void result.current.send("room 214 needs towels");
      void result.current.send("room 214 needs towels");
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(answer("ok"));
    });
    expect(result.current.messages).toHaveLength(2);
  });

  it("does not send offline, and says so", async () => {
    signIn(ALICE, false);
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("hi");
    });
    expect(mockSend).not.toHaveBeenCalled();
    const last = result.current.messages[result.current.messages.length - 1];
    expect(last).toMatchObject({ kind: "notice", notice: "offline" });
    expect(result.current.sending).toBe(false);
  });

  it.each([
    ["credit_limit", "credit_limit"],
    ["unavailable", "unavailable"],
    ["permission", "permission"],
    ["invalid_response", "invalid_response"],
  ] as const)("shows a %s failure as a notice, never as an answer or an action", async (kind, notice) => {
    signIn(ALICE);
    mockSend.mockRejectedValue(new CopilotFailure(kind, "x"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("hi");
    });
    const last = result.current.messages[result.current.messages.length - 1];
    expect(last).toMatchObject({ kind: "notice", notice, askedText: "hi" });
    expect(last.actions).toBeUndefined();
  });

  it("re-sends the original words with the chosen intent after a clarification", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValueOnce({
      kind: "clarify",
      message: "What do you need?",
      intent: "ambiguous",
      provenance: "deterministic",
      trustedContext: null,
      options: [{ label: "Work Order", intentHint: "work_order_creation" }],
    } satisfies CopilotOutcome);
    mockSend.mockResolvedValueOnce(answer("done"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("AC broken in 305");
    });
    const clarify = result.current.messages[1];
    await act(async () => {
      await result.current.chooseOption(clarify, clarify.options![0]);
    });
    expect(mockSend).toHaveBeenLastCalledWith("AC broken in 305", { intentHint: "work_order_creation", context: undefined });
  });
});

describe("confirming an action", () => {
  async function withAction() {
    signIn(ALICE);
    mockSend.mockResolvedValue(actionsOutcome());
    const hook = renderHook(() => useAssistantConversation());
    await act(async () => {
      await hook.result.current.send("towels to 214");
    });
    const message = hook.result.current.messages[1];
    return { hook, message, item: message.actions![0] };
  }

  it("creates nothing until the person confirms", async () => {
    const { item } = await withAction();
    expect(item.status).toBe("ready");
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("confirms once even when tapped twice, and shows success only after the server confirmed", async () => {
    const { hook, message, item } = await withAction();
    const pending = deferred<{ createdCount: number; deduplicated: boolean }>();
    mockConfirm.mockReturnValue(pending.promise);
    act(() => {
      void hook.result.current.confirm(message.id, item.id);
      void hook.result.current.confirm(message.id, item.id);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messages[1].actions![0].status).toBe("confirming");
    await act(async () => {
      pending.resolve({ createdCount: 1, deduplicated: false });
    });
    expect(hook.result.current.messages[1].actions![0].status).toBe("confirmed");
    // Already created: another tap does nothing.
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it("reports a failure honestly and retries with the same idempotency key", async () => {
    const { hook, message, item } = await withAction();
    mockConfirm.mockRejectedValueOnce(new CopilotFailure("unavailable", "x"));
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(hook.result.current.messages[1].actions![0]).toMatchObject({ status: "failed", failure: "unavailable" });

    mockConfirm.mockResolvedValueOnce({ createdCount: 1, deduplicated: true });
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(mockConfirm.mock.calls[0][1]).toBe(mockConfirm.mock.calls[1][1]);
    expect(hook.result.current.messages[1].actions![0]).toMatchObject({ status: "confirmed", deduplicated: true });
  });

  it("keeps the server's explanation when it refuses this specific preview", async () => {
    const { hook, message, item } = await withAction();
    mockConfirm.mockRejectedValueOnce(new CopilotFailure("invalid_request", "Room 9999 was not found in your hotel"));
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(hook.result.current.messages[1].actions![0]).toMatchObject({
      status: "failed",
      failure: "invalid_request",
      failureMessage: "Room 9999 was not found in your hotel",
    });
  });

  it("does not try to create while offline", async () => {
    const { hook, message, item } = await withAction();
    signIn(ALICE, false);
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(hook.result.current.messages[1].actions![0]).toMatchObject({ status: "failed", failure: "offline" });
  });

  it("will not confirm an invalid edit", async () => {
    const { hook, message, item } = await withAction();
    act(() => hook.result.current.editAction(message.id, item.id, { title: "" }));
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(hook.result.current.messages[1].actions![0].status).toBe("failed");
  });

  it("uses the edited values, and an edited room is no longer treated as verified", async () => {
    const { hook, message, item } = await withAction();
    act(() => hook.result.current.editAction(message.id, item.id, { title: "More towels", roomNumber: "215" }));
    mockConfirm.mockResolvedValue({ createdCount: 1, deduplicated: false });
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    const sent = mockConfirm.mock.calls[0][0];
    expect(sent.draft).toMatchObject({ title: "More towels", roomNumber: "215", roomId: null });
  });

  it("dismissing leaves nothing to confirm", async () => {
    const { hook, message, item } = await withAction();
    act(() => hook.result.current.dismissAction(message.id, item.id));
    expect(hook.result.current.messages[1].actions![0].status).toBe("dismissed");
    await act(async () => {
      await hook.result.current.confirm(message.id, item.id);
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("supports a work-order preview end to end", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue({
      kind: "actions",
      message: "wo",
      intent: "work_order_creation",
      provenance: "ai",
      trustedContext: null,
      actions: [workOrderDraftFromRaw({ title: "Leak", category: "plumbing", priority: "urgent", room_number: "305" })!],
    } satisfies CopilotOutcome);
    mockConfirm.mockResolvedValue({ createdCount: 1, deduplicated: false });
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("leak in 305");
    });
    const message = result.current.messages[1];
    await act(async () => {
      await result.current.confirm(message.id, message.actions![0].id);
    });
    expect(result.current.messages[1].actions![0].status).toBe("confirmed");
  });
});

describe("account switching and sign-out", () => {
  it("drops the conversation the moment a different person signs in", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("Room 214 is on your list"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("which rooms?");
    });
    expect(result.current.messages).toHaveLength(2);

    signIn(BOB);
    expect(result.current.messages).toEqual([]);
    expect(result.current.scope).toBe("hotel-a:bob");
  });

  it("drops it when the same person moves to another hotel", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("x"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("hi");
    });
    signIn(user("alice", "hotel-b"));
    expect(result.current.messages).toEqual([]);
  });

  it("clears the open conversation on sign-out", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("x"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("hi");
    });
    signIn(null);
    expect(result.current.messages).toEqual([]);
    expect(result.current.scope).toBeNull();
  });

  it("clears it when the app resets the assistant session, even if the same person stays signed in", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("x"));
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("hi");
    });
    act(() => resetAssistantSession());
    expect(result.current.messages).toEqual([]);
  });

  it("discards a reply that arrives after a different person signed in", async () => {
    signIn(ALICE);
    const pending = deferred<CopilotOutcome>();
    mockSend.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAssistantConversation());
    act(() => {
      void result.current.send("secret question");
    });
    signIn(BOB);
    await act(async () => {
      pending.resolve(answer("Alice's answer"));
    });
    expect(result.current.messages).toEqual([]);
  });

  it("discards a confirmation result for a conversation that is gone", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(actionsOutcome());
    const pending = deferred<{ createdCount: number; deduplicated: boolean }>();
    mockConfirm.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAssistantConversation());
    await act(async () => {
      await result.current.send("towels");
    });
    const message = result.current.messages[1];
    act(() => {
      void result.current.confirm(message.id, message.actions![0].id);
    });
    signIn(BOB);
    await act(async () => {
      pending.resolve({ createdCount: 1, deduplicated: false });
    });
    expect(result.current.messages).toEqual([]);
  });
});

describe("saved history", () => {
  it("restores only the signed-in person's saved conversation", async () => {
    const now = Date.now();
    mockStore.set(historyKey("hotel-a:alice"), JSON.stringify([{ id: "h1", role: "user", content: "Alice's old question", at: now - 1000 }]));
    mockStore.set(historyKey("hotel-a:bob"), JSON.stringify([{ id: "h2", role: "user", content: "Bob's old question", at: now - 1000 }]));

    signIn(ALICE);
    const { result } = renderHook(() => useAssistantConversation({ persist: true }));
    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toEqual(["Alice's old question"]));

    signIn(BOB);
    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toEqual(["Bob's old question"]));
  });

  it("saves text only — no previews — under the person's own key", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(actionsOutcome());
    const { result } = renderHook(() => useAssistantConversation({ persist: true }));
    await act(async () => {
      await result.current.send("how do I strip a bed");
    });
    await waitFor(() => expect(mockStore.has(historyKey("hotel-a:alice"))).toBe(true));
    const saved = JSON.parse(mockStore.get(historyKey("hotel-a:alice"))!);
    expect(saved.map((m: { content: string }) => m.content)).toEqual(["how do I strip a bed", "I'll create this"]);
    expect(saved[1]).not.toHaveProperty("actions");
    expect(mockStore.has(historyKey("hotel-a:bob"))).toBe(false);
  });

  it("does not save anything when persistence is off (the corner card)", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = renderHook(() => useAssistantConversation({ persist: false }));
    await act(async () => {
      await result.current.send("hi");
    });
    expect(mockStore.size).toBe(0);
  });

  it("startNewConversation forgets both the open conversation and its saved copy", async () => {
    signIn(ALICE);
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = renderHook(() => useAssistantConversation({ persist: true }));
    await act(async () => {
      await result.current.send("hi");
    });
    await waitFor(() => expect(mockStore.has(historyKey("hotel-a:alice"))).toBe(true));
    await act(async () => {
      result.current.startNewConversation();
    });
    await waitFor(() => expect(mockStore.has(historyKey("hotel-a:alice"))).toBe(false));
    expect(result.current.messages).toEqual([]);
  });

  it("clearHistory removes the saved conversation too", async () => {
    mockStore.set(historyKey("hotel-a:alice"), JSON.stringify([{ id: "h1", role: "user", content: "old", at: Date.now() - 10 }]));
    signIn(ALICE);
    const { result } = renderHook(() => useAssistantConversation({ persist: true }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.clearHistory();
    });
    expect(mockStore.has(historyKey("hotel-a:alice"))).toBe(false);
    expect(result.current.messages).toEqual([]);
  });
});
