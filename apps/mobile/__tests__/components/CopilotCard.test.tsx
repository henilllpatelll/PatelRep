import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { CopilotCard } from "@/components/shared/CopilotCard";
import { sendCopilotMessage, confirmTask, confirmWorkOrder, confirmGuestRequest } from "@/lib/ai/copilotChat";

const EN: Record<string, string> = {
  "copilot.title": "AI Copilot",
  "copilot.card.badge": "AI",
  "copilot.card.readLabel": "Read",
  "copilot.card.askPlaceholder": "Ask about your shift…",
  "copilot.card.send": "Send",
  "copilot.card.notNow": "Not now",
  "copilot.card.loading": "Thinking…",
  "copilot.card.unavailable": "Copilot is unavailable right now.",
  "copilot.card.retry": "Retry",
  "common.close": "Close",
  "common.error": "Something went wrong.",
  "copilot.createTask": "Create Task",
  "copilot.createWorkOrder": "Create Work Order",
  "copilot.createGuestRequest": "Create Guest Request",
  "copilot.create": "Create",
  "copilot.dismiss": "Dismiss",
  "copilot.taskCreated": "Task created!",
  "copilot.workOrderCreated": "Work order created",
  "copilot.guestRequestCreated": "Guest request created",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => EN[key] ?? key,
    i18n: { language: "en" },
  }),
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ user: { role: "housekeeper" } }),
}));

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({
  useToast: () => mockToast,
}));

jest.mock("@/lib/ai/copilotChat", () => ({
  sendCopilotMessage: jest.fn(),
  confirmTask: jest.fn(),
  confirmWorkOrder: jest.fn(),
  confirmGuestRequest: jest.fn(),
}));

const mockedSend = sendCopilotMessage as jest.Mock;
const mockedConfirmTask = confirmTask as jest.Mock;
const mockedConfirmWorkOrder = confirmWorkOrder as jest.Mock;
const mockedConfirmGuestRequest = confirmGuestRequest as jest.Mock;

const FULL_BRIEF = {
  label: "Live risk",
  confidence: 88,
  brief: "Ana is 40 minutes behind on floor 3.",
  sources: ["today's board", "6 housekeepers"],
  primaryAction: "Reassign 313, 314",
  secondaryAction: "Floor 3",
  chips: ["Who needs help?", "Arrivals before 3"],
};

function renderCard(overrides: Partial<React.ComponentProps<typeof CopilotCard>> = {}) {
  return render(
    <ThemeProvider>
      <CopilotCard
        onClose={jest.fn()}
        insetsBottom={0}
        brief={null}
        loading={false}
        error={false}
        reload={jest.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockedSend.mockReset();
  mockedConfirmTask.mockReset();
  mockedConfirmWorkOrder.mockReset();
  mockedConfirmGuestRequest.mockReset();
  mockToast.success.mockClear();
  mockToast.error.mockClear();
});

describe("CopilotCard — brief display", () => {
  it("renders the brief, sources, actions and chips", () => {
    const { getByText, getByTestId } = renderCard({ brief: FULL_BRIEF });

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
    const { getByText } = renderCard({ loading: true });

    expect(getByText("Thinking…")).toBeTruthy();
  });

  it("shows an unavailable state with a working retry button", () => {
    const reload = jest.fn();
    const { getByText } = renderCard({ error: true, reload });

    expect(getByText("Copilot is unavailable right now.")).toBeTruthy();
    fireEvent.press(getByText("Retry"));
    expect(reload).toHaveBeenCalled();
  });

  it("does NOT close when the dimming scrim behind the card is pressed", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderCard({ brief: FULL_BRIEF, onClose });

    fireEvent.press(getByTestId("copilot-card-scrim"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("only closes via the header close button", () => {
    const onClose = jest.fn();
    const { getByLabelText } = renderCard({ brief: FULL_BRIEF, onClose });

    fireEvent.press(getByLabelText("Close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotCard — inline chat (no full-screen navigation)", () => {
  it("sends a typed message inline and shows the reply in the card, without closing it", async () => {
    mockedSend.mockResolvedValue({ message: "Sure, on it.", intent: "general" });
    const onClose = jest.fn();
    const { getByPlaceholderText, getByLabelText, getByText } = renderCard({ brief: FULL_BRIEF, onClose });

    fireEvent.changeText(getByPlaceholderText("Ask about your shift…"), "What's next?");
    fireEvent.press(getByLabelText("Send"));

    expect(mockedSend).toHaveBeenCalledWith("What's next?", "housekeeper");
    await waitFor(() => expect(getByText("Sure, on it.")).toBeTruthy());
    expect(getByText("What's next?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends the primary action inline instead of navigating", async () => {
    mockedSend.mockResolvedValue({ message: "Reassigned.", intent: "general" });
    const { getByText } = renderCard({ brief: FULL_BRIEF });

    fireEvent.press(getByText("Reassign 313, 314"));

    expect(mockedSend).toHaveBeenCalledWith("Reassign 313, 314", "housekeeper");
    await waitFor(() => expect(getByText("Reassigned.")).toBeTruthy());
  });

  it("sends a tapped chip inline instead of navigating", async () => {
    mockedSend.mockResolvedValue({ message: "Ana and Rosa need help.", intent: "general" });
    const { getByText } = renderCard({ brief: FULL_BRIEF });

    fireEvent.press(getByText("Who needs help?"));

    expect(mockedSend).toHaveBeenCalledWith("Who needs help?", "housekeeper");
    await waitFor(() => expect(getByText("Ana and Rosa need help.")).toBeTruthy());
  });

  it("shows a fallback message when sending fails, without crashing", async () => {
    mockedSend.mockRejectedValue(new Error("offline"));
    const { getByPlaceholderText, getByLabelText, getByText } = renderCard({ brief: FULL_BRIEF });

    fireEvent.changeText(getByPlaceholderText("Ask about your shift…"), "hello");
    fireEvent.press(getByLabelText("Send"));

    await waitFor(() => expect(getByText("Something went wrong.")).toBeTruthy());
  });

  it("shows an inline task confirm card and creates it on confirm", async () => {
    mockedSend.mockResolvedValue({
      message: "Want me to create this task?",
      intent: "task_creation",
      task_preview: { title: "Bring towels to 214", task_type: "guest_request", priority: "high" },
    });
    mockedConfirmTask.mockResolvedValue({});
    const { getByPlaceholderText, getByLabelText, getByText } = renderCard({ brief: FULL_BRIEF });

    fireEvent.changeText(getByPlaceholderText("Ask about your shift…"), "bring towels to 214");
    fireEvent.press(getByLabelText("Send"));

    await waitFor(() => expect(getByText("Bring towels to 214")).toBeTruthy());
    fireEvent.press(getByText("Create"));

    await waitFor(() =>
      expect(mockedConfirmTask).toHaveBeenCalledWith({
        title: "Bring towels to 214",
        task_type: "guest_request",
        priority: "high",
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith("Task created!");
  });
});
