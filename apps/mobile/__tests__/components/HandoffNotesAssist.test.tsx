import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockApiPost = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.credits ? `${key}:${options.credits}` : key),
    i18n: { language: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/api/client", () => ({
  api: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

import { HandoffNotesAssist } from "@/components/supervisor/handoff/HandoffNotesAssist";
import { useAppStore } from "@/stores/appStore";
import { resetAssistantSession } from "@/lib/ai/session";
import { resetSupervisorSummaries } from "@/lib/ai/supervisorSummaryAi";
import { resetAiCapabilities, setAiCapabilities } from "../helpers/aiCapabilities";
import { todayFrom } from "../helpers/supervisorCopilotFixture";
import type { UserProfile } from "@/lib/supabase";

const SUPERVISOR = { id: "sup-1", tenant_id: "hotel-a", role: "housekeeping_supervisor" } as unknown as UserProfile;

beforeEach(async () => {
  jest.clearAllMocks();
  resetAssistantSession();
  resetSupervisorSummaries();
  resetAiCapabilities();
  setAiCapabilities({ unifiedAssistant: true });
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
  act(() => useAppStore.getState().setUser(SUPERVISOR));
});

describe("HandoffNotesAssist", () => {
  it("only asks after a tap, then lets the supervisor edit and explicitly add a suggestion without submitting the handoff", async () => {
    const today = await todayFrom();
    const setNotes = jest.fn();
    mockApiPost.mockResolvedValueOnce({ data: { summary: "Room 308 still needs attention.", credits_used: 1.5 } });
    const screen = render(
      <ThemeProvider>
        <HandoffNotesAssist today={today} notes="Start with this" setNotes={setNotes} disabled={false} language="en" />
      </ThemeProvider>,
    );

    expect(mockApiPost).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId("handoff-ai-help")));
    await waitFor(() => expect(screen.getByTestId("handoff-ai-draft")).toBeTruthy());
    expect(mockApiPost).toHaveBeenCalledWith("/ai/supervisor/today-summary", expect.objectContaining({ purpose: "handoff" }));

    fireEvent.changeText(screen.getByTestId("handoff-ai-draft-input"), "Room 308 still needs attention. Review after lunch.");
    fireEvent.press(screen.getByTestId("handoff-ai-use"));
    expect(setNotes).toHaveBeenCalledWith("Start with this\n\nRoom 308 still needs attention. Review after lunch.");
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("keeps manual handoff available when AI is disabled", async () => {
    const today = await todayFrom();
    resetAiCapabilities();
    const screen = render(
      <ThemeProvider>
        <HandoffNotesAssist today={today} notes="" setNotes={jest.fn()} disabled={false} language="en" />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId("handoff-ai-assist")).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
