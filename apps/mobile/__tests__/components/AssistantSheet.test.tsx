import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockApiPost = jest.fn();
const mockPush = jest.fn();
const mockSecure = new Map<string, string>();
let mockSpeechAvailable = false;
const mockHandlers: Record<string, (event: Record<string, unknown>) => void> = {};
const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const CHAT_OPTIONS = { signal: expect.anything() };

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.room ? `${key}:${options.room}` : key),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  usePathname: () => "/home",
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), canGoBack: () => true },
}));
jest.mock("@/lib/voice/speechModule", () => ({
  speechModule: { start: jest.fn(), stop: jest.fn(), abort: jest.fn(), requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) },
  useSpeechRecognitionEvent: (name: string, handler: (event: Record<string, unknown>) => void) => {
    mockHandlers[name] = handler;
  },
  isSpeechAvailable: () => mockSpeechAvailable,
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

import { AssistantSheet } from "@/components/ai/AssistantSheet";
import { AssistantProvider, useAssistant, type AssistantApi } from "@/lib/ai/AssistantProvider";
import { resetLegacyPurgeFlag } from "@/lib/ai/history";
import { publishLocalBriefing, resetSharedBriefing } from "@/lib/ai/shiftBriefingSource";
import { ApiError } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const ALICE = { id: "alice", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile;
const envelope = (data: Record<string, unknown>) => ({ data });
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

let assistant: AssistantApi;
function Capture() {
  assistant = useAssistant();
  return null;
}

function renderSheet() {
  return render(
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={METRICS}>
        <AssistantProvider>
          <Capture />
          <AssistantSheet />
        </AssistantProvider>
      </SafeAreaProvider>
    </ThemeProvider>,
  );
}

function signIn(user: UserProfile | null, online = true) {
  act(() => {
    useAppStore.setState({ isOnline: online });
    useAppStore.getState().setUser(user);
  });
}

function open(launch?: Parameters<AssistantApi["openAssistant"]>[0]) {
  act(() => assistant.openAssistant(launch));
}

async function typeAndSend(screen: ReturnType<typeof renderSheet>, text: string) {
  fireEvent.changeText(screen.getByTestId("assistant-sheet-input"), text);
  await act(async () => {
    fireEvent.press(screen.getByTestId("assistant-sheet-send"));
  });
}

function publishNextRoom() {
  publishLocalBriefing({
    key: "hotel-a:alice:2026-10-15:en",
    local: { headline: "h", plan: ["218"], watchouts: [], estimatedMinutes: 30, source: "local" } as never,
    knownRooms: ["218"],
    restrictedRooms: [],
    nextRoom: { roomId: ROOM_A, roomNumber: "218", kind: "start", context: "Departure · Floor 2", reason: "Guest arrives at 2:00 PM", estimateMinutes: 30 },
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecure.clear();
  mockSpeechAvailable = false;
  await AsyncStorage.clear();
  resetLegacyPurgeFlag();
  resetSharedBriefing();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  signIn(ALICE);
});

describe("compact assistant — opening, closing, content", () => {
  it("renders nothing until it is opened, and asks no model to open or close", () => {
    const screen = renderSheet();
    expect(screen.queryByTestId("assistant-sheet")).toBeNull();
    open();
    expect(screen.getByTestId("assistant-sheet")).toBeTruthy();
    act(() => assistant.closeAssistant());
    expect(screen.queryByTestId("assistant-sheet")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("offers the four housekeeper quick actions and the full-assistant link", () => {
    const screen = renderSheet();
    open();
    for (const id of ["nextRoom", "reportIssue", "createTask", "askQuestion"]) {
      expect(screen.getByTestId(`quick-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId("assistant-expand")).toBeTruthy();
  });

  it("offers no housekeeper quick actions to another role", () => {
    signIn({ ...ALICE, role: "engineer" } as unknown as UserProfile);
    const screen = renderSheet();
    open();
    expect(screen.queryByTestId("quick-nextRoom")).toBeNull();
  });

  it("shows what the assistant is about, and lets the person remove it", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    expect(screen.getByTestId("assistant-context-chip")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assistant-context-clear"));
    expect(screen.queryByTestId("assistant-context-chip")).toBeNull();
  });
});

describe("compact assistant — quick actions do the real thing", () => {
  it("My next room shows Home's own ranked room with no AI call", () => {
    publishNextRoom();
    const screen = renderSheet();
    open();
    fireEvent.press(screen.getByTestId("quick-nextRoom"));
    expect(screen.getByTestId("assistant-room-card")).toBeTruthy();
    expect(screen.getByText("assistant.room.kicker:218")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    // It is a message in the shared conversation, so the full assistant shows the same one.
    expect(assistant.conversation.messages.map((m) => m.kind)).toEqual([undefined, "local"]);

    fireEvent.press(screen.getByTestId("assistant-room-open"));
    expect(mockPush).toHaveBeenCalledWith(`/(app)/my-rooms/${ROOM_A}`);
    expect(assistant.sheetOpen).toBe(false);
  });

  it("My next room never invents a room when Home has not ranked any", () => {
    const screen = renderSheet();
    open();
    fireEvent.press(screen.getByTestId("quick-nextRoom"));
    expect(screen.queryByTestId("assistant-room-card")).toBeNull();
    expect(screen.getByTestId("assistant-open-my-rooms")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("does not show another person's next room", () => {
    publishNextRoom();
    signIn({ id: "bob", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile);
    const screen = renderSheet();
    open();
    fireEvent.press(screen.getByTestId("quick-nextRoom"));
    expect(screen.queryByTestId("assistant-room-card")).toBeNull();
  });

  it("Report an issue asks which of the person's own rooms, then opens that room's issue form", () => {
    useAppStore.setState({ myRooms: [{ id: ROOM_B, room_number: "305" }, { id: ROOM_A, room_number: "218" }] as never });
    const screen = renderSheet();
    open();
    fireEvent.press(screen.getByTestId("quick-reportIssue"));
    expect(screen.getByTestId("room-picker")).toBeTruthy();
    fireEvent.press(screen.getByTestId("room-picker-305"));
    expect(mockPush).toHaveBeenCalledWith(`/(app)/my-rooms/${ROOM_B}?action=issue`);
    expect(assistant.sheetOpen).toBe(false);
  });

  it("Report an issue goes straight to the form when the assistant is already about a room", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A });
    fireEvent.press(screen.getByTestId("quick-reportIssue"));
    expect(mockPush).toHaveBeenCalledWith(`/(app)/my-rooms/${ROOM_A}?action=issue`);
  });

  it("Report an issue can fall back to describing it when it is not one of the person's rooms", () => {
    const screen = renderSheet();
    open();
    fireEvent.press(screen.getByTestId("quick-reportIssue"));
    fireEvent.press(screen.getByTestId("room-picker-describe"));
    expect(assistant.draft).toBe("copilot.quickPrompts.reportIssue");
    expect(assistant.pendingHint).toBe("work_order_creation");
    expect(screen.getByTestId("assistant-sheet-input")).toBeTruthy();
  });

  it("Create a task opens the existing Add Task sheet, carrying what was typed", () => {
    const screen = renderSheet();
    open();
    act(() => assistant.setDraft("Fix the squeaky cart"));
    fireEvent.press(screen.getByTestId("quick-createTask"));
    expect(mockPush).toHaveBeenCalledWith(`/(app)/tasks?add=1&prefill=${encodeURIComponent("Fix the squeaky cart")}`);
    expect(assistant.draft).toBe("");
    expect(assistant.sheetOpen).toBe(false);
  });

  it("Ask a question puts the cursor in the message box", () => {
    const screen = renderSheet();
    open();
    const before = assistant.focusToken;
    fireEvent.press(screen.getByTestId("quick-askQuestion"));
    expect(assistant.focusToken).toBe(before + 1);
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe("compact assistant — conversation", () => {
  it("answers in place, then continues in the full assistant with the same messages", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Strip the bed first.", model_used: null }));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "how do I strip a bed");
    await waitFor(() => expect(screen.getByText("Strip the bed first.")).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledWith(
      "/ai/copilot/chat",
      { message: "how do I strip a bed", context: { source: "mobile" } },
      CHAT_OPTIONS,
    );
    const ids = assistant.conversation.messages.map((m) => m.id);

    fireEvent.press(screen.getByTestId("assistant-expand"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/copilot");
    expect(assistant.conversation.messages.map((m) => m.id)).toEqual(ids);
  });

  it("shortens a long answer and points to the full assistant", async () => {
    const long = "Step one. ".repeat(60);
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: long, model_used: null }));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "explain");
    await waitFor(() => expect(screen.getByTestId("assistant-read-more")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assistant-read-more"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/copilot");
  });

  it("labels AI-written answers as not authoritative", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Probably yes.", model_used: "claude-sonnet" }));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "is it ok?");
    await waitFor(() => expect(screen.getByTestId("assistant-disclaimer")).toBeTruthy());
  });

  it("shows the thinking state, and Stop gives the question back instead of sending it on", async () => {
    let resolve!: (value: unknown) => void;
    mockApiPost.mockReturnValue(new Promise((res) => (resolve = res)));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "slow question");
    expect(screen.getByTestId("assistant-thinking")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("assistant-sheet-cancel"));
    });
    expect(assistant.draft).toBe("slow question");
    expect(screen.queryByTestId("assistant-thinking")).toBeNull();
    await act(async () => resolve(envelope({ response_type: "answer", message: "Late" })));
    expect(screen.queryByText("Late")).toBeNull();
  });

  it("asks which action was meant, and only offers what the server returned", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "ambiguous",
        message: "Room 312 needs help with AC.",
        options: [
          { label: "Report Maintenance Issue", intent_hint: "work_order_creation" },
          { label: "Create Housekeeping Task", intent_hint: "task_creation" },
        ],
      }),
    );
    mockApiPost.mockResolvedValueOnce(envelope({ response_type: "answer", message: "Done." }));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "Room 312 needs help with AC");
    await waitFor(() => expect(screen.getByTestId("assistant-clarify")).toBeTruthy());
    expect(screen.getByText("Report Maintenance Issue")).toBeTruthy();
    expect(screen.queryByTestId("assistant-option-guest_request_creation")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("assistant-option-task_creation"));
    });
    // The original words are re-sent with the chosen intent; nothing was created by asking.
    expect(mockApiPost).toHaveBeenLastCalledWith(
      "/ai/copilot/chat",
      { message: "Room 312 needs help with AC", context: { source: "mobile", intent_hint: "task_creation" } },
      CHAT_OPTIONS,
    );
    expect(mockApiPost).toHaveBeenCalledTimes(2);
  });
});

describe("compact assistant — states", () => {
  it("says it is offline, sends nothing, and disables sending", async () => {
    signIn(ALICE, false);
    const screen = renderSheet();
    open();
    expect(screen.getByTestId("assistant-sheet-offline")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("assistant-sheet-input"), "hello");
    expect(screen.getByTestId("assistant-sheet-send").props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId("assistant-sheet-send"));
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("explains a used-up credit allowance without offering a pointless retry", async () => {
    mockApiPost.mockRejectedValue(new ApiError("Monthly AI credit cap reached.", 402));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "hello");
    await waitFor(() => expect(screen.getByText("copilot.notice.credit_limit")).toBeTruthy());
    expect(screen.queryByTestId("assistant-retry")).toBeNull();
    // The quick actions that need no AI still work.
    expect(screen.getByTestId("quick-chip-createTask")).toBeTruthy();
  });

  it("stays usable when the AI provider is down: says so, offers a retry that asks again", async () => {
    mockApiPost.mockRejectedValueOnce(new ApiError("AI service temporarily unavailable.", 503));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "hello");
    await waitFor(() => expect(screen.getByText("copilot.notice.unavailable")).toBeTruthy());
    expect(screen.queryByText("AI service temporarily unavailable.")).toBeNull();
    mockApiPost.mockResolvedValueOnce(envelope({ response_type: "answer", message: "Back now." }));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assistant-retry"));
    });
    await waitFor(() => expect(screen.getByText("Back now.")).toBeTruthy());
  });

  it("explains a role that is not allowed to do something", async () => {
    mockApiPost.mockRejectedValue(new ApiError("Role not allowed", 403));
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "assign rooms");
    await waitFor(() => expect(screen.getByText("copilot.notice.permission")).toBeTruthy());
    expect(screen.queryByTestId("assistant-retry")).toBeNull();
  });
});

describe("compact assistant — proposed actions are confirmed before they exist", () => {
  const preview = () =>
    envelope({
      response_type: "work_order_preview",
      message: "I prepared a work order.",
      model_used: "gpt-4o-mini",
      work_orders: [{ title: "Bathroom sink leaking", category: "plumbing", priority: "normal", room_number: "312", room_id: ROOM_B }],
    });

  it("shows a summary first, a drawer with every field second, and creates only on Confirm", async () => {
    mockApiPost.mockResolvedValueOnce(preview());
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "312 sink leaking");
    await waitFor(() => expect(screen.getByTestId("action-card-work_order")).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId("action-review"));
    expect(screen.getByTestId("confirm-panel")).toBeTruthy();
    expect(screen.getByLabelText(/Bathroom sink leaking/)).toBeTruthy();
    expect(screen.getByLabelText(/312/)).toBeTruthy();
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    mockApiPost.mockResolvedValueOnce({ data: { created_count: 1 }, meta: { deduplicated: 0 } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-create"));
    });
    expect(mockApiPost.mock.calls[1][0]).toBe("/ai/work-orders/confirm");
    await waitFor(() => expect(screen.getByTestId("confirm-success")).toBeTruthy());
  });

  it("leaving the drawer with Cancel creates nothing and removes the proposal", async () => {
    mockApiPost.mockResolvedValueOnce(preview());
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "312 sink leaking");
    await waitFor(() => expect(screen.getByTestId("action-review")).toBeTruthy());
    fireEvent.press(screen.getByTestId("action-review"));
    fireEvent.press(screen.getByTestId("confirm-cancel"));
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("action-card-work_order")).toBeNull();
  });

  it("cannot create while offline", async () => {
    mockApiPost.mockResolvedValueOnce(preview());
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "312 sink leaking");
    await waitFor(() => expect(screen.getByTestId("action-review")).toBeTruthy());
    act(() => useAppStore.setState({ isOnline: false }));
    fireEvent.press(screen.getByTestId("action-review"));
    expect(screen.getByTestId("confirm-offline")).toBeTruthy();
    expect(screen.getByTestId("confirm-create").props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-create"));
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("does not claim success when the server did not confirm", async () => {
    mockApiPost.mockResolvedValueOnce(preview());
    const screen = renderSheet();
    open();
    await typeAndSend(screen, "312 sink leaking");
    await waitFor(() => expect(screen.getByTestId("action-review")).toBeTruthy());
    fireEvent.press(screen.getByTestId("action-review"));
    mockApiPost.mockResolvedValueOnce({ data: { created_count: 0 } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-create"));
    });
    await waitFor(() => expect(screen.getByTestId("confirm-failure")).toBeTruthy());
    expect(screen.queryByTestId("confirm-success")).toBeNull();
    expect(screen.queryByTestId("action-confirmed")).toBeNull();
  });
});

describe("compact assistant — voice", () => {
  it("hides the microphone where speech recognition is unavailable", () => {
    const screen = renderSheet();
    open();
    expect(screen.queryByTestId("assistant-sheet-mic")).toBeNull();
  });

  it("opens the voice panel from the microphone, and keeps typed words when speech is added", async () => {
    mockSpeechAvailable = true;
    const screen = renderSheet();
    open();
    act(() => assistant.setDraft("Room 312"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assistant-sheet-mic"));
    });
    expect(screen.getByTestId("voice-panel")).toBeTruthy();
    // It is listening: the words only become usable once speech has finished.
    expect(screen.getByTestId("voice-use").props.accessibilityState.disabled).toBe(true);
    act(() => mockHandlers.result?.({ results: [{ transcript: "has a leaking sink" }], isFinal: true }));
    act(() => mockHandlers.end?.({}));
    expect(screen.getByTestId("voice-text").props.value).toBe("has a leaking sink");
    fireEvent.press(screen.getByTestId("voice-use"));
    expect(assistant.draft).toBe("Room 312 has a leaking sink");
    expect(screen.queryByTestId("voice-panel")).toBeNull();
    // Using the text puts it in the box; nothing is sent until the person sends.
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
