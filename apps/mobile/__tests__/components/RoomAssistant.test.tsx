import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockApiPost = jest.fn();
const mockPush = jest.fn();
const mockSecure = new Map<string, string>();
const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.room ? `${key}:${options.room}` : key),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({
  usePathname: () => "/my-rooms/room",
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), canGoBack: () => true },
}));
jest.mock("@/lib/voice/speechModule", () => ({
  speechModule: { start: jest.fn(), stop: jest.fn(), abort: jest.fn(), requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) },
  useSpeechRecognitionEvent: jest.fn(),
  isSpeechAvailable: () => false,
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
import { resetSharedBriefing } from "@/lib/ai/shiftBriefingSource";
import { useAppStore } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import type { UserProfile } from "@/lib/supabase";
import { room, session } from "../helpers/homeModelFixture";

const ALICE = { id: "alice", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile;
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

function open(launch?: Parameters<AssistantApi["openAssistant"]>[0]) {
  act(() => assistant.openAssistant(launch));
}

const listed = (id: string, number: string, extra = {}) => room(id, { room_number: number, ...extra });

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecure.clear();
  await AsyncStorage.clear();
  resetLegacyPurgeFlag();
  resetSharedBriefing();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  act(() => {
    useAppStore.getState().setUser(ALICE);
    useAppStore.setState({ myRooms: [listed(ROOM_A, "218"), listed(ROOM_B, "305")] as never });
  });
  useCleanSessionStore.setState({ scope: "hotel-a:alice", sessions: {} } as never);
});

describe("Ask about this room — the assistant sheet with a room", () => {
  it("offers the room's own questions instead of the general quick actions, and asks no model", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    expect(screen.getByTestId("assistant-context-chip")).toBeTruthy();
    for (const id of ["reportProblem", "openWorkOrders", "findProcedure"]) expect(screen.getByTestId(`room-question-${id}`)).toBeTruthy();
    // No clean is open, so there is no checklist to ask about.
    expect(screen.queryByTestId("room-question-checklistLeft")).toBeNull();
    expect(screen.queryByTestId("quick-nextRoom")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("adds the checklist question while a clean is open, and answers it from the phone", () => {
    useCleanSessionStore.setState({ scope: "hotel-a:alice", sessions: { [ROOM_A]: session(ROOM_A) } } as never);
    const screen = renderSheet();
    open({ contextType: "cleaningSession", entityId: ROOM_A, label: "218" });
    fireEvent.press(screen.getByTestId("room-question-checklistLeft"));
    const [question, answer] = assistant.conversation.messages;
    expect(question.content).toBe("assistant.roomQ.q.checklistLeft");
    expect(answer.content).toContain("assistant.roomQ.checklist.left");
    expect(answer.kind).toBe("local");
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("points 'how do I report a problem' at the existing issue form for this room", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    fireEvent.press(screen.getByTestId("room-question-reportProblem"));
    fireEvent.press(screen.getByTestId("assistant-room-answer-open"));
    expect(mockPush).toHaveBeenCalledWith(`/(app)/my-rooms/${ROOM_A}?action=issue`);
    expect(assistant.sheetOpen).toBe(false);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("answers from the room as it is NOW: a room reassigned while the sheet is open is gone, not described", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    act(() => useAppStore.setState({ myRooms: [listed(ROOM_B, "305")] as never }));
    // The sheet stops offering questions for a room that left the list; the one already on screen still refuses.
    expect(screen.queryByTestId("room-questions")).toBeNull();
  });

  it("refuses a question for a room that left the list between render and tap, and drops the room", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    const press = screen.getByTestId("room-question-openWorkOrders");
    useAppStore.setState({ myRooms: [listed(ROOM_B, "305")] as never });
    fireEvent.press(press);
    expect(assistant.conversation.messages[1].content).toBe("assistant.roomQ.gone");
    expect(assistant.context.type).toBe("general");
  });

  it("shows no room questions for a room that is not on this person's list (the server decides about anything else)", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: "99999999-9999-4999-8999-999999999999", label: "999" });
    expect(screen.queryByTestId("room-questions")).toBeNull();
    expect(screen.getByTestId("quick-nextRoom")).toBeTruthy();
  });

  it("never reuses one room's conversation for another", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    fireEvent.press(screen.getByTestId("room-question-openWorkOrders"));
    expect(assistant.conversation.messages).toHaveLength(2);
    open({ contextType: "room", entityId: ROOM_B, label: "305" });
    expect(assistant.conversation.messages).toHaveLength(0);
    expect(assistant.context.entityId).toBe(ROOM_B);
  });

  it("hands a procedure search to the composer without sending it", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    fireEvent.press(screen.getByTestId("room-question-findProcedure"));
    expect(assistant.draft).toBe("assistant.roomQ.sopPrefill:218");
    expect(assistant.pendingHint).toBe("sop_query");
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("works offline: the room questions are answered locally", () => {
    act(() => useAppStore.setState({ isOnline: false }));
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    fireEvent.press(screen.getByTestId("room-question-openWorkOrders"));
    expect(assistant.conversation.messages[1].content).toBe("assistant.roomQ.workOrder.none");
  });

  it("does not keep a room answer in the saved conversation (it is a live snapshot)", () => {
    const screen = renderSheet();
    open({ contextType: "room", entityId: ROOM_A, label: "218" });
    fireEvent.press(screen.getByTestId("room-question-openWorkOrders"));
    expect(assistant.conversation.messages[1].kind).toBe("local");
  });
});
