import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";

const mockApiPost = jest.fn();
const mockPush = jest.fn();
let mockToday: { today: SupervisorToday; refreshing: boolean; refresh: jest.Mock };

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.room ? `${key}:${options.room}` : key),
    i18n: { language: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
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
jest.mock("@/lib/housekeeping/useSupervisorToday", () => ({ useSupervisorToday: () => mockToday }));

import { SupervisorCopilotCard } from "@/components/ai/SupervisorCopilotCard";
import { ApiError } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { launchSupervisorCopilot, useSupervisorCopilotStore } from "@/stores/supervisorCopilotStore";
import { resetAssistantSession } from "@/lib/ai/session";
import { resetSupervisorSummaries, SUMMARY_COOLDOWN_MS } from "@/lib/ai/supervisorSummaryAi";
import type { UserProfile } from "@/lib/supabase";
import { resetAiCapabilities, setAiCapabilities } from "../helpers/aiCapabilities";
import { rawRoom, todayFrom } from "../helpers/supervisorCopilotFixture";

const SUP = { id: "sup-1", tenant_id: "hotel-a", role: "housekeeping_supervisor" } as unknown as UserProfile;
const SUMMARY_URL = "/ai/supervisor/today-summary";

const summaryCalls = () => mockApiPost.mock.calls.filter((call) => call[0] === SUMMARY_URL);

function renderCard() {
  return render(
    <ThemeProvider>
      <SupervisorCopilotCard onClose={jest.fn()} insetsBottom={0} brief={null} loading={false} error={false} reload={jest.fn()} />
    </ThemeProvider>,
  );
}

async function setToday(overrides = {}) {
  mockToday = { today: await todayFrom(overrides), refreshing: false, refresh: jest.fn() };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAssistantSession();
  resetSupervisorSummaries();
  resetAiCapabilities();
  setAiCapabilities({ unifiedAssistant: true });
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  act(() => useAppStore.getState().setUser(SUP));
  await setToday();
});

describe("the supervisor's Copilot is the existing card with a supervisor body", () => {
  it("shows the overview, observations, suggestions, quick actions and where the facts came from — with no model call", async () => {
    const screen = renderCard();
    expect(screen.getByTestId("copilot-card")).toBeTruthy(); // the one existing card, not a second assistant
    expect(screen.getByText("supervisorCopilot.headerLabel")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-overview-ready")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-observation-room:r-308:arrival_at_risk")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-quick-rooms")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-source-board")).toBeTruthy();
    expect(screen.getByTestId("copilot-card-input")).toBeTruthy(); // Ask PatelRep
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("states what it could not check instead of showing zeros", async () => {
    await setToday({
      board: async () => {
        throw new Error("down");
      },
    });
    const screen = renderCard();
    expect(screen.getByTestId("supervisor-copilot-overview-board")).toBeTruthy();
    expect(screen.queryByTestId("supervisor-copilot-overview-ready")).toBeNull();
    expect(screen.getByTestId("supervisor-copilot-unchecked")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-no-observations")).toBeTruthy();
  });

  it("opens only supervisor screens from suggestions and quick actions, and closes the card first", async () => {
    const onClose = jest.fn();
    const screen = render(
      <ThemeProvider>
        <SupervisorCopilotCard onClose={onClose} insetsBottom={0} brief={null} loading={false} error={false} reload={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByTestId("supervisor-copilot-quick-inspections"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/inspect");
    fireEvent.press(screen.getByTestId("supervisor-copilot-quick-unassigned"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/assignments");
    fireEvent.press(screen.getByTestId("supervisor-copilot-suggestion-open:room:r-308:arrival_at_risk"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/(app)/room-board", params: { roomId: "r-308" } });
    expect(onClose).toHaveBeenCalledTimes(3);
    for (const call of mockPush.mock.calls) expect(JSON.stringify(call)).not.toContain("my-rooms");
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe("no paid call happens by itself", () => {
  it("makes no AI request on mount, re-render, a realtime-style snapshot change, or closing and reopening", async () => {
    const screen = renderCard();
    screen.rerender(
      <ThemeProvider>
        <SupervisorCopilotCard onClose={jest.fn()} insetsBottom={0} brief={null} loading={false} error={false} reload={jest.fn()} />
      </ThemeProvider>,
    );
    // Several quick board changes, as a burst of realtime events would produce.
    for (let i = 0; i < 4; i += 1) {
      await setToday({ board: async () => [rawRoom("r-301", "INSPECTED"), rawRoom(`r-40${i}`, "DIRTY")] });
      screen.rerender(
        <ThemeProvider>
          <SupervisorCopilotCard onClose={jest.fn()} insetsBottom={0} brief={null} loading={false} error={false} reload={jest.fn()} />
        </ThemeProvider>,
      );
    }
    screen.unmount();
    for (let i = 0; i < 3; i += 1) renderCard().unmount();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("asks once per deliberate tap: rapid taps are one request, and the answer is labelled as AI wording", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const screen = renderCard();
    await act(async () => {
      fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask"));
      fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask"));
      fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask"));
    });
    expect(summaryCalls()).toHaveLength(1);
    await act(async () => release({ data: { summary: "Room 308 has an arrival soon.", credits_used: 1.5 } }));
    await waitFor(() => expect(screen.getByTestId("supervisor-copilot-ai-text")).toBeTruthy());
    expect(screen.getByText("supervisorCopilot.ai.interpretation")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-ai-meta")).toBeTruthy();
    // Reopening shows the stored answer; it does not buy another.
    screen.unmount();
    const again = renderCard();
    expect(again.getByTestId("supervisor-copilot-ai-text")).toBeTruthy();
    expect(summaryCalls()).toHaveLength(1);
  });

  it("labels an answer written for earlier figures and does not regenerate it when the board changes", async () => {
    mockApiPost.mockResolvedValueOnce({ data: { summary: "Room 308 has an arrival soon." } });
    const screen = renderCard();
    await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask")));
    await waitFor(() => expect(screen.getByTestId("supervisor-copilot-ai-text")).toBeTruthy());
    await setToday({ board: async () => [rawRoom("r-301", "INSPECTED")] });
    screen.rerender(
      <ThemeProvider>
        <SupervisorCopilotCard onClose={jest.fn()} insetsBottom={0} brief={null} loading={false} error={false} reload={jest.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("supervisor-copilot-ai-outdated")).toBeTruthy();
    expect(summaryCalls()).toHaveLength(1);
  });

  it("is hidden entirely when the hotel has AI switched off, and the overview still works", async () => {
    resetAiCapabilities();
    const screen = renderCard();
    expect(screen.queryByTestId("supervisor-copilot-ai-ask")).toBeNull();
    expect(screen.getByTestId("supervisor-copilot-ai-disabled")).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-overview-ready")).toBeTruthy();
  });

  it.each([
    [402, "credit_limit"],
    [429, "rate_limited"],
    [503, "unavailable"],
    [502, "invalid"],
  ])("explains a %s without breaking the overview or offering a bypass", async (status, failure) => {
    mockApiPost.mockRejectedValueOnce(new ApiError("x", status as number));
    const screen = renderCard();
    await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask")));
    await waitFor(() => expect(screen.getByTestId("supervisor-copilot-ai-failure")).toBeTruthy());
    expect(screen.getByText(`supervisorCopilot.ai.failure.${failure}`)).toBeTruthy();
    expect(screen.getByTestId("supervisor-copilot-overview-ready")).toBeTruthy();
    if (failure === "credit_limit") expect(screen.queryByTestId("supervisor-copilot-ai-ask")).toBeNull();
  });

  it("sends nothing while offline", async () => {
    act(() => useAppStore.setState({ isOnline: false }));
    const screen = renderCard();
    await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask")));
    expect(summaryCalls()).toHaveLength(0);
    await waitFor(() => expect(screen.getByText("supervisorCopilot.ai.failure.offline")).toBeTruthy());
  });

  it("allows a retry only after the cooldown", async () => {
    jest.useFakeTimers({ now: 2_000_000 });
    try {
      mockApiPost.mockRejectedValueOnce(new ApiError("x", 503));
      const screen = renderCard();
      await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask")));
      await waitFor(() => expect(screen.getByTestId("supervisor-copilot-ai-failure")).toBeTruthy());
      await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask")));
      expect(summaryCalls()).toHaveLength(1);
      expect(screen.getByText("supervisorCopilot.ai.failure.cooldown")).toBeTruthy();
      jest.setSystemTime(2_000_000 + SUMMARY_COOLDOWN_MS + 5);
      mockApiPost.mockResolvedValueOnce({ data: { summary: "Room 308 has an arrival soon." } });
      await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-ai-ask")));
      expect(summaryCalls()).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("drafting a task keeps the existing review → confirm → server flow", () => {
  async function openDraft() {
    const screen = renderCard();
    await act(async () => fireEvent.press(screen.getByTestId("supervisor-copilot-suggestion-draft:r-308")));
    return screen;
  }

  it("shows an editable draft for a verified room and creates nothing until Create", async () => {
    const screen = await openDraft();
    expect(screen.getByTestId("action-card-task")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("action-review"));
    expect(mockApiPost).not.toHaveBeenCalled(); // first press only opens the review
  });

  it("confirms through the existing endpoint exactly once, and never shows success before the server does", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockApiPost.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const screen = await openDraft();
    fireEvent.press(screen.getByTestId("action-review"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("confirm-create"));
      fireEvent.press(screen.getByTestId("confirm-create"));
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith("/ai/tasks/confirm", [
      expect.objectContaining({ room_id: "r-308", task_type: "housekeeping", priority: "urgent" }),
    ]);
    expect(screen.queryByTestId("action-confirmed")).toBeNull();
    await act(async () => release({ data: { created_count: 1 }, meta: { deduplicated: 0 } }));
    await waitFor(() => expect(screen.getByTestId("confirm-success")).toBeTruthy());
  });

  it("does not claim success when the server refuses", async () => {
    mockApiPost.mockRejectedValueOnce(new ApiError("Room not found in your hotel", 400));
    const screen = await openDraft();
    fireEvent.press(screen.getByTestId("action-review"));
    await act(async () => fireEvent.press(screen.getByTestId("confirm-create")));
    await waitFor(() => expect(screen.getByTestId("confirm-failure")).toBeTruthy());
    expect(screen.queryByTestId("action-confirmed")).toBeNull();
  });

  it("with no room, 'Prepare follow-up task' asks the person to describe it and sends it as a task request", async () => {
    mockApiPost.mockResolvedValueOnce({ data: { response_type: "task_preview", message: "ok", tasks: [{ title: "Restock 3rd floor", task_type: "housekeeping", priority: "normal" }] } });
    const screen = renderCard();
    fireEvent.press(screen.getByTestId("supervisor-copilot-quick-task"));
    expect(screen.getByTestId("supervisor-copilot-task-hint")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("copilot-card-input"), "restock the third floor");
    await act(async () => fireEvent.press(screen.getByTestId("copilot-card-send")));
    expect(mockApiPost).toHaveBeenCalledWith(
      "/ai/copilot/chat",
      {
        message: "restock the third floor",
        context: expect.objectContaining({ intent_hint: "task_creation" }),
      },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

describe("opened about one room", () => {
  const ASK = { roomId: "r-308", roomNumber: "308" };

  it("shows what it is about, sends the verified id with the question, and lets the person clear it", async () => {
    mockApiPost.mockResolvedValue({ data: { response_type: "answer", message: "ok" } });
    act(() => launchSupervisorCopilot("hotel-a:sup-1", ASK));
    const screen = renderCard();
    expect(screen.getByTestId("supervisor-copilot-context")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("copilot-card-input"), "why is it late?");
    await act(async () => fireEvent.press(screen.getByTestId("copilot-card-send")));
    expect(mockApiPost).toHaveBeenCalledWith(
      "/ai/copilot/chat",
      {
        message: "why is it late?",
        context: expect.objectContaining({ room_id: "r-308" }),
      },
      expect.objectContaining({ signal: expect.anything() }),
    );
    fireEvent.press(screen.getByTestId("supervisor-copilot-back"));
    fireEvent.press(screen.getByTestId("supervisor-copilot-context-clear"));
    expect(screen.queryByTestId("supervisor-copilot-context")).toBeNull();
  });

  it("says the room is gone, and sends no id for it, when it is no longer on the board", async () => {
    mockApiPost.mockResolvedValue({ data: { response_type: "answer", message: "ok" } });
    act(() => launchSupervisorCopilot("hotel-a:sup-1", { roomId: "r-999", roomNumber: "999" }));
    const screen = renderCard();
    expect(screen.getByText("supervisorCopilot.context.gone:999")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("copilot-card-input"), "status?");
    await act(async () => fireEvent.press(screen.getByTestId("copilot-card-send")));
    expect(JSON.stringify(mockApiPost.mock.calls[0][1])).not.toContain("r-999");
  });

  it("never carries one room's context to another person or hotel", async () => {
    act(() => launchSupervisorCopilot("hotel-a:sup-1", ASK));
    act(() => useAppStore.getState().setUser({ id: "sup-2", tenant_id: "hotel-b", role: "housekeeping_supervisor" } as unknown as UserProfile));
    const screen = renderCard();
    expect(screen.queryByTestId("supervisor-copilot-context")).toBeNull();
    act(() => resetAssistantSession());
    expect(useSupervisorCopilotStore.getState().room).toBeNull();
  });
});
