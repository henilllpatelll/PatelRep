import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockApiPost = jest.fn();
const mockPush = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options?.room ? `${key}:${options.room}` : key), i18n: { language: "en" } }),
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

import { CopilotCard } from "@/components/shared/CopilotCard";
import { ApiError } from "@/lib/api/client";
import { housekeeperBriefFromShared, type CopilotCardBrief } from "@/lib/ai/copilotCard";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const ALICE = { id: "alice", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile;
const envelope = (data: Record<string, unknown>) => ({ data });

const SUPERVISOR_BRIEF: CopilotCardBrief = {
  label: "Live risk",
  confidence: 88,
  brief: "Ana is 40 minutes behind on floor 3.",
  sources: ["today's board", "6 housekeepers"],
  primaryAction: "Reassign 313, 314",
  secondaryAction: "Floor 3",
  chips: ["Who needs help?", "Arrivals before 3"],
};

const HOUSEKEEPER_BRIEF = housekeeperBriefFromShared((key) => key, {
  briefing: {
    headline: "ai.briefing.startWith",
    plan: ["214"],
    watchouts: ["ai.briefing.dndWatchout"],
    estimatedMinutes: 40,
    source: "local",
  },
  provenance: "deterministic",
});

function renderCard(overrides: Partial<React.ComponentProps<typeof CopilotCard>> = {}) {
  return render(
    <ThemeProvider>
      <CopilotCard onClose={jest.fn()} insetsBottom={0} brief={null} loading={false} error={false} reload={jest.fn()} {...overrides} />
    </ThemeProvider>,
  );
}

async function ask(screen: ReturnType<typeof renderCard>, text: string) {
  fireEvent.changeText(screen.getByTestId("copilot-card-input"), text);
  await act(async () => {
    fireEvent.press(screen.getByTestId("copilot-card-send"));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  act(() => useAppStore.getState().setUser(ALICE));
});

describe("CopilotCard — brief display", () => {
  it("renders the brief, sources, actions and chips", () => {
    const { getByText, getByTestId } = renderCard({ brief: SUPERVISOR_BRIEF });
    expect(getByTestId("copilot-card")).toBeTruthy();
    expect(getByText("Live risk")).toBeTruthy();
    expect(getByText("88%")).toBeTruthy();
    expect(getByText("Ana is 40 minutes behind on floor 3.")).toBeTruthy();
    expect(getByText("today's board")).toBeTruthy();
    expect(getByText("Reassign 313, 314")).toBeTruthy();
    expect(getByText("Floor 3")).toBeTruthy();
    expect(getByText("Who needs help?")).toBeTruthy();
  });

  it("shows a loading state while the brief is being fetched", () => {
    expect(renderCard({ loading: true }).getByText("copilot.card.loading")).toBeTruthy();
  });

  it("shows an unavailable state with a working retry button", () => {
    const reload = jest.fn();
    const { getByText } = renderCard({ error: true, reload });
    expect(getByText("copilot.card.unavailable")).toBeTruthy();
    fireEvent.press(getByText("copilot.card.retry"));
    expect(reload).toHaveBeenCalled();
  });

  it("does NOT close when the dimming scrim is pressed, and closes via the header button", () => {
    const onClose = jest.fn();
    const { getByTestId, getByLabelText } = renderCard({ brief: SUPERVISOR_BRIEF, onClose });
    fireEvent.press(getByTestId("copilot-card-scrim"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText("common.close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotCard — the housekeeper brief only does real things", () => {
  it("opens My Rooms from the primary action (and closes) instead of chatting 'Reorder my queue'", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderCard({ brief: HOUSEKEEPER_BRIEF, onClose });
    fireEvent.press(getByTestId("copilot-card-primary"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/my-rooms");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("'Not now' just closes — it never spends a credit asking the AI about 'Not now'", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderCard({ brief: HOUSEKEEPER_BRIEF, onClose });
    fireEvent.press(getByTestId("copilot-card-secondary"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("shows where the briefing came from, no invented confidence, and watch-outs as notes not buttons", () => {
    const { getByTestId, queryByText, getAllByTestId } = renderCard({ brief: HOUSEKEEPER_BRIEF });
    expect(getByTestId("copilot-card-provenance").props.children).toBe("copilot.provenance.deterministic");
    expect(queryByText(/%/)).toBeNull();
    expect(getAllByTestId("copilot-card-info-chip")).toHaveLength(1);
    fireEvent.press(getAllByTestId("copilot-card-info-chip")[0]);
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

describe("CopilotCard — inline chat uses the same contract as the full assistant", () => {
  it("sends a typed message inline and shows the reply without closing", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Sure, on it.", model_used: null }));
    const onClose = jest.fn();
    const screen = renderCard({ brief: SUPERVISOR_BRIEF, onClose });
    await ask(screen, "What's next?");
    await waitFor(() => expect(screen.getByText("Sure, on it.")).toBeTruthy());
    expect(screen.getByText("What's next?")).toBeTruthy();
    expect(mockApiPost).toHaveBeenCalledWith("/ai/copilot/chat", { message: "What's next?", context: { source: "mobile" } });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends a non-housekeeper primary action inline", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Reassigned." }));
    const screen = renderCard({ brief: SUPERVISOR_BRIEF });
    await act(async () => {
      fireEvent.press(screen.getByText("Reassign 313, 314"));
    });
    expect(mockApiPost.mock.calls[0][1].message).toBe("Reassign 313, 314");
    await waitFor(() => expect(screen.getByText("Reassigned.")).toBeTruthy());
  });

  it("shows a typed notice when the AI is unavailable", async () => {
    mockApiPost.mockRejectedValue(new ApiError("AI service temporarily unavailable.", 503));
    const screen = renderCard({ brief: SUPERVISOR_BRIEF });
    await ask(screen, "hello");
    await waitFor(() => expect(screen.getByText("copilot.notice.unavailable")).toBeTruthy());
  });

  it("explains credit exhaustion", async () => {
    mockApiPost.mockRejectedValue(new ApiError("Monthly AI credit cap reached.", 402));
    const screen = renderCard({ brief: SUPERVISOR_BRIEF });
    await ask(screen, "hello");
    await waitFor(() => expect(screen.getByText("copilot.notice.credit_limit")).toBeTruthy());
  });

  it("says it is offline and sends nothing", async () => {
    act(() => useAppStore.setState({ isOnline: false }));
    const screen = renderCard({ brief: SUPERVISOR_BRIEF });
    expect(screen.getByTestId("copilot-card-offline")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("copilot-card-input"), "hello");
    fireEvent.press(screen.getByTestId("copilot-card-send"));
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("previews a task inline, creates it only on Create, and confirms from the server's answer", async () => {
    mockApiPost.mockResolvedValueOnce(
      envelope({
        response_type: "task_preview",
        message: "I found 1 task.",
        tasks: [{ title: "Bring towels to 214", task_type: "guest_request", priority: "high", room_id: "r1", room_number_display: "214" }],
      }),
    );
    const screen = renderCard({ brief: SUPERVISOR_BRIEF });
    await ask(screen, "bring towels to 214");
    await waitFor(() => expect(screen.getByTestId("action-card-task")).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    mockApiPost.mockResolvedValueOnce({ data: { created_count: 1 }, meta: { deduplicated: 0 } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("action-confirm"));
    });
    expect(mockApiPost).toHaveBeenLastCalledWith("/ai/tasks/confirm", [
      { title: "Bring towels to 214", task_type: "guest_request", priority: "urgent", room_id: "r1" },
    ]);
    await waitFor(() => expect(screen.getByTestId("action-confirmed")).toBeTruthy());
  });
});

describe("CopilotCard — nothing carries over to the next person", () => {
  it("empties the card's conversation when a different person signs in", async () => {
    mockApiPost.mockResolvedValue(envelope({ response_type: "answer", message: "Alice's private answer" }));
    const screen = renderCard({ brief: SUPERVISOR_BRIEF });
    await ask(screen, "something private");
    await waitFor(() => expect(screen.getByText("Alice's private answer")).toBeTruthy());
    act(() => useAppStore.getState().setUser({ id: "bob", tenant_id: "hotel-a", role: "housekeeper" } as unknown as UserProfile));
    expect(screen.queryByText("Alice's private answer")).toBeNull();
    expect(screen.queryByText("something private")).toBeNull();
  });
});
