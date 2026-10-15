import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockApiPost = jest.fn();
const mockSecure = new Map<string, string>();
const mockUseLocalSearchParams = jest.fn(() => ({}) as { prefill?: string; documentId?: string; roomId?: string });

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options?.room ? `${key}:${options.room}` : key) }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  router: { push: jest.fn() },
}));
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: { start: jest.fn(), stop: jest.fn() },
  useSpeechRecognitionEvent: jest.fn(),
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
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { ApiError, api: { get: jest.fn(), patch: jest.fn(), post: (...args: unknown[]) => mockApiPost(...args) } };
});
jest.mock("@/lib/auth/secureSessionStorage", () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockSecure.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockSecure.set(key, value);
    },
    removeItem: async (key: string) => {
      mockSecure.delete(key);
    },
  },
}));

import CopilotScreen from "@/app/(app)/copilot";
import { ApiError } from "@/lib/api/client";
import { LEGACY_HISTORY_KEY, historyKey, resetLegacyPurgeFlag } from "@/lib/ai/history";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const ALICE = { id: "alice", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile;
const BOB = { id: "bob", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile;

const envelope = (data: Record<string, unknown>) => ({ data });

function renderScreen() {
  return render(
    <ThemeProvider>
      <CopilotScreen />
    </ThemeProvider>,
  );
}

function signIn(user: UserProfile | null, online = true) {
  act(() => {
    useAppStore.setState({ isOnline: online });
    useAppStore.getState().setUser(user);
  });
}

async function ask(screen: ReturnType<typeof renderScreen>, text: string) {
  fireEvent.changeText(screen.getByTestId("copilot-input"), text);
  await act(async () => {
    fireEvent.press(screen.getByTestId("copilot-send"));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecure.clear();
  await AsyncStorage.clear();
  resetLegacyPurgeFlag();
  mockUseLocalSearchParams.mockReturnValue({});
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  signIn(ALICE);
});

describe("CopilotScreen — reading the backend envelope", () => {
  it("shows a general answer with its provenance", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Happy to help.", model_used: null }));
    const screen = renderScreen();
    await ask(screen, "hello");
    await waitFor(() => expect(screen.getByText("Happy to help.")).toBeTruthy());
    expect(screen.getByTestId("assistant-provenance")).toBeTruthy();
    expect(mockApiPost).toHaveBeenCalledWith("/ai/copilot/chat", { message: "hello", context: { source: "mobile" } });
  });

  it("shows SOP sources", async () => {
    mockApiPost.mockResolvedValue(
      envelope({
        response_type: "answer",
        message: "Strip the bed first.",
        model_used: "claude-sonnet-4-6",
        sources: [{ content: "Strip linen", metadata: { page_number: 2 }, document_id: "d1", title: "Linen SOP" }],
      }),
    );
    const screen = renderScreen();
    await ask(screen, "how do I strip a bed");
    await waitFor(() => expect(screen.getByTestId("assistant-sources")).toBeTruthy());
    expect(screen.getByText(/Linen SOP/)).toBeTruthy();
  });

  it("asks which action the person meant and re-asks with that intent", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "ambiguous",
        message: "I'm not sure what you need.",
        options: [
          { label: "Work Order", intent_hint: "work_order_creation" },
          { label: "Guest Request", intent_hint: "guest_request_creation" },
        ],
      }),
    );
    mockApiPost.mockResolvedValueOnce(envelope({ response_type: "answer", message: "Done." }));
    const screen = renderScreen();
    await ask(screen, "broken tv guest wants");
    await waitFor(() => expect(screen.getByTestId("assistant-option-work_order_creation")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId("assistant-option-work_order_creation"));
    });
    expect(mockApiPost).toHaveBeenLastCalledWith("/ai/copilot/chat", {
      message: "broken tv guest wants",
      context: { source: "mobile", intent_hint: "work_order_creation" },
    });
  });

  it("does not present a legacy/malformed reply as a success", async () => {
    mockApiPost.mockResolvedValue({ message: "I created it!", task_preview: { title: "x" } });
    const screen = renderScreen();
    await ask(screen, "make a task");
    await waitFor(() => expect(screen.getByTestId("assistant-notice")).toBeTruthy());
    expect(screen.queryByText("I created it!")).toBeNull();
    expect(screen.queryByTestId("action-card-task")).toBeNull();
  });
});

describe("CopilotScreen — action previews and explicit confirmation", () => {
  it("previews a task, lets the person edit it, and creates only on Create", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "task_preview",
        message: "I found 1 task.",
        model_used: "gpt-4o-mini",
        tasks: [{ title: "Bring towels", task_type: "guest_request", priority: "high", room_id: "room-1", room_number_display: "214" }],
      }),
    );
    const screen = renderScreen();
    await ask(screen, "towels to 214");
    await waitFor(() => expect(screen.getByTestId("action-card-task")).toBeTruthy());
    // Nothing was created by merely previewing.
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    fireEvent.changeText(screen.getByLabelText("copilot.action.fields.title"), "Bring 2 towels");
    mockApiPost.mockResolvedValueOnce({ data: { created_count: 1, tasks: [{}] }, meta: { deduplicated: 0 } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("action-confirm"));
    });
    expect(mockApiPost).toHaveBeenLastCalledWith("/ai/tasks/confirm", [
      { title: "Bring 2 towels", task_type: "guest_request", priority: "urgent", room_id: "room-1" },
    ]);
    await waitFor(() => expect(screen.getByTestId("action-confirmed")).toBeTruthy());
  });

  it("shows several generated actions at once", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "task_preview",
        message: "I found 2 tasks.",
        tasks: [{ title: "Towels 214" }, { title: "Restock cart" }],
      }),
    );
    const screen = renderScreen();
    await ask(screen, "towels to 214 and restock the cart");
    await waitFor(() => expect(screen.getAllByTestId("action-card-task")).toHaveLength(2));
  });

  it("creates a work order through /ai/work-orders/confirm with an idempotency key", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "work_order_preview",
        message: "ok",
        work_orders: [{ title: "Leak under sink", category: "plumbing", priority: "urgent", room_number: "305", room_id: "room-9" }],
      }),
    );
    const screen = renderScreen();
    await ask(screen, "leak in 305");
    await waitFor(() => expect(screen.getByTestId("action-card-work_order")).toBeTruthy());
    mockApiPost.mockResolvedValueOnce({ data: { created_count: 1, work_orders: [{}] }, meta: { deduplicated: 0 } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("action-confirm"));
    });
    const [path, body] = mockApiPost.mock.calls[mockApiPost.mock.calls.length - 1];
    expect(path).toBe("/ai/work-orders/confirm");
    expect(body).toEqual([
      expect.objectContaining({ title: "Leak under sink", category: "plumbing", priority: "urgent", room_id: "room-9", client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
    ]);
  });

  it("creates a guest request through /ai/guest-requests/confirm", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "guest_request_preview",
        message: "ok",
        requests: [{ title: "Crib", category: "service", priority: "normal", guest_impact: "standard", room_number: "412", room_id: "room-4" }],
      }),
    );
    const screen = renderScreen();
    await ask(screen, "crib to 412");
    await waitFor(() => expect(screen.getByTestId("action-card-guest_request")).toBeTruthy());
    mockApiPost.mockResolvedValueOnce({ data: { created_count: 1, requests: [{}] }, meta: { deduplicated: 0 } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("action-confirm"));
    });
    expect(mockApiPost).toHaveBeenLastCalledWith("/ai/guest-requests/confirm", [
      { title: "Crib", category: "service", priority: "normal", guest_impact: "standard", room_id: "room-4" },
    ]);
  });

  it("does not report success when the server refuses (unknown room) and lets the person fix it", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "guest_request_preview",
        message: "ok",
        requests: [{ title: "Crib", room_number: "9999" }],
      }),
    );
    const screen = renderScreen();
    await ask(screen, "crib to 9999");
    await waitFor(() => expect(screen.getByTestId("action-card-guest_request")).toBeTruthy());
    mockApiPost.mockRejectedValueOnce(new ApiError("Room 9999 was not found in your hotel", 400));
    await act(async () => {
      fireEvent.press(screen.getByTestId("action-confirm"));
    });
    await waitFor(() => expect(screen.getByTestId("action-failure")).toBeTruthy());
    expect(screen.getByText("Room 9999 was not found in your hotel")).toBeTruthy();
    expect(screen.queryByTestId("action-confirmed")).toBeNull();
  });

  it("creates only once if Create is tapped twice quickly", async () => {
    mockApiPost.mockResolvedValueOnce(envelope({ response_type: "task_preview", message: "ok", tasks: [{ title: "Towels" }] }));
    const screen = renderScreen();
    await ask(screen, "towels");
    await waitFor(() => expect(screen.getByTestId("action-card-task")).toBeTruthy());
    let release!: () => void;
    mockApiPost.mockReturnValueOnce(new Promise((resolve) => { release = () => resolve({ data: { created_count: 1 } }); }));
    await act(async () => {
      fireEvent.press(screen.getByTestId("action-confirm"));
      fireEvent.press(screen.getByTestId("action-confirm"));
    });
    await act(async () => release());
    expect(mockApiPost.mock.calls.filter(([path]) => path === "/ai/tasks/confirm")).toHaveLength(1);
  });
});

describe("CopilotScreen — failures and states", () => {
  it.each([
    [new ApiError("Monthly AI credit cap reached.", 402), "copilot.notice.credit_limit"],
    [new ApiError("AI service temporarily unavailable.", 503), "copilot.notice.unavailable"],
    [new ApiError("Role not allowed", 403), "copilot.notice.permission"],
    [new ApiError("Too many", 429), "copilot.notice.rate_limited"],
  ])("explains %p", async (error, key) => {
    mockApiPost.mockRejectedValue(error);
    const screen = renderScreen();
    await ask(screen, "hello");
    await waitFor(() => expect(screen.getByText(key)).toBeTruthy());
  });

  it("works offline: says so, sends nothing, and disables sending", async () => {
    signIn(ALICE, false);
    const screen = renderScreen();
    expect(screen.getByTestId("copilot-offline")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("copilot-input"), "hello");
    await act(async () => {
      fireEvent.press(screen.getByTestId("copilot-send"));
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("a quick action routes the next message to the matching intent", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "ok" }));
    const screen = renderScreen();
    fireEvent.press(screen.getByText("copilot.quickActions.searchSOPs"));
    expect(screen.getByTestId("copilot-input").props.value).toBe("copilot.quickPrompts.searchSOPs");
    await act(async () => {
      fireEvent.press(screen.getByTestId("copilot-send"));
    });
    expect(mockApiPost).toHaveBeenCalledWith("/ai/copilot/chat", {
      message: "copilot.quickPrompts.searchSOPs",
      context: { source: "mobile", intent_hint: "sop_query" },
    });
  });

  it("sends a deep-linked prefill exactly once, with only ids for the server to verify", async () => {
    mockUseLocalSearchParams.mockReturnValue({ prefill: "Room 214 needs towels", roomId: "room-1" });
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "ok" }));
    const screen = renderScreen();
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));
    screen.rerender(
      <ThemeProvider>
        <CopilotScreen />
      </ThemeProvider>,
    );
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost.mock.calls[0][1]).toEqual({
      message: "Room 214 needs towels",
      context: { source: "mobile", room_id: "room-1" },
    });
  });
});

describe("CopilotScreen — history belongs to one person", () => {
  it("never shows the old unscoped history, and deletes it", async () => {
    await AsyncStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([{ id: "x", role: "user", content: "Somebody else's chat" }]));
    const screen = renderScreen();
    await waitFor(async () => expect(await AsyncStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull());
    expect(screen.queryByText("Somebody else's chat")).toBeNull();
  });

  it("shows only the signed-in person's saved conversation, and swaps it on account change", async () => {
    const now = Date.now();
    mockSecure.set(historyKey("hotel-a:alice"), JSON.stringify([{ id: "a1", role: "user", content: "Alice's earlier question", at: now - 1000 }]));
    mockSecure.set(historyKey("hotel-a:bob"), JSON.stringify([{ id: "b1", role: "user", content: "Bob's earlier question", at: now - 1000 }]));
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("Alice's earlier question")).toBeTruthy());
    expect(screen.queryByText("Bob's earlier question")).toBeNull();

    signIn(BOB);
    await waitFor(() => expect(screen.getByText("Bob's earlier question")).toBeTruthy());
    expect(screen.queryByText("Alice's earlier question")).toBeNull();
  });

  it("clears the visible conversation on sign-out", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Private answer" }));
    const screen = renderScreen();
    await ask(screen, "private question");
    await waitFor(() => expect(screen.getByText("Private answer")).toBeTruthy());
    signIn(null);
    expect(screen.queryByText("Private answer")).toBeNull();
    expect(screen.queryByText("private question")).toBeNull();
  });

  it("New conversation clears the thread and its saved copy", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "An answer" }));
    const screen = renderScreen();
    await ask(screen, "a question");
    await waitFor(() => expect(mockSecure.has(historyKey("hotel-a:alice"))).toBe(true));
    await act(async () => {
      fireEvent.press(screen.getByTestId("copilot-new-chat"));
    });
    expect(screen.queryByText("An answer")).toBeNull();
    await waitFor(() => expect(mockSecure.has(historyKey("hotel-a:alice"))).toBe(false));
  });
});
