import React from "react";

const mockSend = jest.fn();
const mockStore = new Map<string, string>();
const mockPush = jest.fn();
let mockPath = "/home";

jest.mock("expo-router", () => ({
  usePathname: () => mockPath,
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
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
import type { CopilotOutcome } from "@/lib/ai/contract";
import { AssistantProvider, useAssistant } from "@/lib/ai/AssistantProvider";
import { workOrderDraftFromRaw } from "@/lib/ai/drafts";
import { resetLegacyPurgeFlag } from "@/lib/ai/history";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const user = (id: string, tenant: string) => ({ id, tenant_id: tenant, role: "housekeeper" }) as unknown as UserProfile;
const ALICE = user("alice", "hotel-a");
const BOB = user("bob", "hotel-b");
const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";

const answer = (message: string): CopilotOutcome => ({
  kind: "answer",
  message,
  intent: "general",
  provenance: "deterministic",
  trustedContext: null,
  sources: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const wrapper = ({ children }: { children: React.ReactNode }) => <AssistantProvider>{children}</AssistantProvider>;

function signIn(profile: UserProfile | null, online = true) {
  act(() => {
    useAppStore.setState({ isOnline: online });
    useAppStore.getState().setUser(profile);
  });
}

function setup() {
  return renderHook(() => useAssistant(), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockPath = "/home";
  resetLegacyPurgeFlag();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  signIn(ALICE);
});

describe("one conversation for the sheet and the full assistant", () => {
  it("keeps the conversation when the sheet is closed, reopened, or expanded into the full chat", async () => {
    mockSend.mockResolvedValue(answer("Room 214 is next."));
    const { result } = setup();

    act(() => result.current.openAssistant());
    expect(result.current.sheetOpen).toBe(true);
    await act(async () => {
      await result.current.conversation.send("what is next?");
    });
    const ids = result.current.conversation.messages.map((m) => m.id);
    expect(ids).toHaveLength(2);

    act(() => result.current.closeAssistant());
    expect(result.current.sheetOpen).toBe(false);
    act(() => result.current.openAssistant());
    expect(result.current.conversation.messages.map((m) => m.id)).toEqual(ids);

    act(() => result.current.expandAssistant());
    expect(mockPush).toHaveBeenCalledWith("/(app)/copilot");
    expect(result.current.sheetOpen).toBe(false);
    expect(result.current.conversation.messages.map((m) => m.id)).toEqual(ids);
    // Nothing was re-asked by any of that.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("makes no model call just by opening, closing or launching with context", () => {
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A }));
    act(() => result.current.closeAssistant());
    act(() => result.current.openAssistant());
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("shares one composer draft between surfaces and sends it once, with its intent hint", async () => {
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = setup();
    act(() => {
      result.current.setDraft("How do I strip a bed?");
      result.current.setPendingHint("sop_query");
    });
    await act(async () => {
      result.current.sendDraft();
      result.current.sendDraft();
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("How do I strip a bed?", expect.objectContaining({ intentHint: "sop_query" }));
    expect(result.current.draft).toBe("");
    expect(result.current.pendingHint).toBeUndefined();
  });
});

describe("cancelling, overlapping and stale requests", () => {
  it("cancel aborts the request, takes the question back out of the thread and returns its text to the composer", async () => {
    const pending = deferred<CopilotOutcome>();
    mockSend.mockReturnValue(pending.promise);
    const { result } = setup();
    act(() => {
      void result.current.conversation.send("is 214 ready?");
    });
    await waitFor(() => expect(result.current.conversation.sending).toBe(true));
    const signal = mockSend.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    act(() => result.current.cancelSend());
    expect(signal.aborted).toBe(true);
    expect(result.current.conversation.sending).toBe(false);
    expect(result.current.conversation.messages).toEqual([]);
    expect(result.current.draft).toBe("is 214 ready?");

    // The answer that arrives late is dropped, not shown.
    await act(async () => pending.resolve(answer("Too late")));
    expect(result.current.conversation.messages).toEqual([]);
  });

  it("allows a new question right after a cancel, and shows only that answer", async () => {
    const first = deferred<CopilotOutcome>();
    mockSend.mockReturnValueOnce(first.promise);
    mockSend.mockResolvedValueOnce(answer("Second answer"));
    const { result } = setup();
    act(() => {
      void result.current.conversation.send("first");
    });
    act(() => result.current.cancelSend());
    await act(async () => {
      await result.current.conversation.send("second");
    });
    await act(async () => first.resolve(answer("First answer")));
    expect(result.current.conversation.messages.map((m) => m.content)).toEqual(["second", "Second answer"]);
  });

  it("ignores a reply that arrives after a new conversation was started", async () => {
    const pending = deferred<CopilotOutcome>();
    mockSend.mockReturnValue(pending.promise);
    const { result } = setup();
    act(() => {
      void result.current.conversation.send("old question");
    });
    act(() => result.current.startFresh());
    await act(async () => pending.resolve(answer("Old answer")));
    expect(result.current.conversation.messages).toEqual([]);
    expect(result.current.conversation.sending).toBe(false);
  });

  it("sends one request when asked twice while the first is still waiting", async () => {
    const pending = deferred<CopilotOutcome>();
    mockSend.mockReturnValue(pending.promise);
    const { result } = setup();
    await act(async () => {
      void result.current.conversation.send("one");
      void result.current.conversation.send("two");
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(answer("done")));
  });
});

describe("context", () => {
  it("sends only validated ids, which the server verifies, and shows the subject", async () => {
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A, label: "Room 218" }));
    expect(result.current.context.type).toBe("room");
    expect(result.current.contextLabel).toEqual({ text: "Room 218", verified: false });
    await act(async () => {
      await result.current.conversation.send("why this room?");
    });
    expect(mockSend).toHaveBeenCalledWith("why this room?", expect.objectContaining({ context: { roomId: ROOM_A } }));
  });

  it("falls back to the general context for an id that is not an id", async () => {
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: "../../admin" }));
    expect(result.current.context.type).toBe("general");
    await act(async () => {
      await result.current.conversation.send("hello");
    });
    expect(mockSend).toHaveBeenCalledWith("hello", expect.objectContaining({ context: {} }));
  });

  it("prefers the room number the server confirmed over the launcher's label", async () => {
    mockSend.mockResolvedValue({ ...answer("ok"), trustedContext: { roomId: ROOM_A, roomNumber: "219" } });
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A, label: "Room 218" }));
    await act(async () => {
      await result.current.conversation.send("hi");
    });
    expect(result.current.contextLabel).toEqual({ text: "219", verified: true });
  });

  it("starts a new conversation when the subject changes, so the old room never leaks into the new one", async () => {
    mockSend.mockResolvedValue(answer("About 218"));
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A }));
    await act(async () => {
      await result.current.conversation.send("tell me about it");
    });
    expect(result.current.conversation.messages).toHaveLength(2);

    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_B }));
    expect(result.current.conversation.messages).toEqual([]);
    await act(async () => {
      await result.current.conversation.send("and this one?");
    });
    expect(mockSend).toHaveBeenLastCalledWith("and this one?", expect.objectContaining({ context: { roomId: ROOM_B } }));
  });

  it("keeps the conversation when re-opened about the same subject", async () => {
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A }));
    await act(async () => {
      await result.current.conversation.send("hi");
    });
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A }));
    expect(result.current.conversation.messages).toHaveLength(2);
  });

  it("lets the person remove the subject, and a fresh conversation drops it too", async () => {
    mockSend.mockResolvedValue(answer("ok"));
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "task", entityId: ROOM_B }));
    act(() => result.current.clearContext());
    await act(async () => {
      await result.current.conversation.send("hello");
    });
    expect(mockSend).toHaveBeenLastCalledWith("hello", expect.objectContaining({ context: {} }));

    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A }));
    act(() => result.current.startFresh());
    expect(result.current.context.type).toBe("general");
  });

  it("drops a subject when the person leaves the screen that set it (but not into the assistant)", () => {
    const { result, rerender } = setup();
    act(() => result.current.launchContext({ contextType: "room", entityId: ROOM_A }));
    expect(result.current.context.type).toBe("room");

    mockPath = "/copilot";
    rerender({});
    expect(result.current.context.type).toBe("room");

    mockPath = "/tasks";
    rerender({});
    expect(result.current.context.type).toBe("general");
  });
});

describe("whose assistant is it", () => {
  it("drops the conversation, the draft, the subject and the open sheet when another person or hotel signs in", async () => {
    mockSend.mockResolvedValue(answer("Alice's private answer"));
    const { result } = setup();
    act(() => result.current.openAssistant({ contextType: "room", entityId: ROOM_A }));
    act(() => result.current.setDraft("half-typed secret"));
    await act(async () => {
      await result.current.conversation.send("alice question");
    });
    expect(result.current.conversation.messages).toHaveLength(2);

    signIn(BOB);
    await waitFor(() => expect(result.current.conversation.messages).toEqual([]));
    expect(result.current.draft).toBe("");
    expect(result.current.context.type).toBe("general");
    expect(result.current.sheetOpen).toBe(false);
  });

  it("clears everything on sign-out", async () => {
    mockSend.mockResolvedValue(answer("Private"));
    const { result } = setup();
    await act(async () => {
      await result.current.conversation.send("private");
    });
    signIn(null);
    await waitFor(() => expect(result.current.conversation.messages).toEqual([]));
  });

  it("does not answer for a person who signed out while a request was in flight", async () => {
    const pending = deferred<CopilotOutcome>();
    mockSend.mockReturnValue(pending.promise);
    const { result } = setup();
    act(() => {
      void result.current.conversation.send("question");
    });
    signIn(BOB);
    await act(async () => pending.resolve(answer("Alice's answer")));
    expect(result.current.conversation.messages.map((m) => m.content)).not.toContain("Alice's answer");
  });
});

describe("saved conversation", () => {
  it("keeps plain answers, but not a proposal's sentence without its card, nor a stale snapshot of live data", async () => {
    mockSend.mockResolvedValueOnce(answer("Strip the bed first."));
    mockSend.mockResolvedValueOnce({
      kind: "actions",
      message: "I prepared a work order.",
      intent: "work_order_creation",
      provenance: "ai",
      trustedContext: null,
      actions: [workOrderDraftFromRaw({ title: "Leaking sink", room_number: "312" })!],
    } satisfies CopilotOutcome);
    const { result } = setup();
    await act(async () => {
      await result.current.conversation.send("how do I strip a bed");
      await result.current.conversation.send("312 sink is leaking");
    });
    act(() => result.current.conversation.showLocal("My next room", "Room 218 is first on your list right now.", { type: "noRoomOrder" }));
    expect(result.current.conversation.messages).toHaveLength(6);

    await waitFor(() => {
      const saved = [...mockStore.entries()].find(([key]) => key.includes("history"));
      expect(saved).toBeTruthy();
      const lines = (JSON.parse(saved![1]) as Array<{ content: string }>).map((m) => m.content);
      expect(lines).toEqual(["how do I strip a bed", "Strip the bed first."]);
    });
  });
});

describe("offline", () => {
  it("says so, sends nothing, and lets the person try again later", async () => {
    signIn(ALICE, false);
    const { result } = setup();
    await act(async () => {
      await result.current.conversation.send("hello");
    });
    expect(mockSend).not.toHaveBeenCalled();
    const last = result.current.conversation.messages[result.current.conversation.messages.length - 1];
    expect(last?.kind).toBe("notice");
    expect(last?.notice).toBe("offline");
  });
});
