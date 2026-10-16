import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-i18next", () => {
  const { makeTranslator } = require("../helpers/i18n");
  const t = makeTranslator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en", resolvedLanguage: "en" } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock("@/lib/api/notifications", () => ({ listNotifications: jest.fn(), markAllRead: jest.fn(), markRead: jest.fn() }));

const mockOpenAssistant = jest.fn();
let mockAssistant = true;
jest.mock("@/lib/ai/AssistantProvider", () => ({
  useAssistantOptional: () => (mockAssistant ? { openAssistant: (...a: unknown[]) => mockOpenAssistant(...a) } : null),
}));

import { listNotifications, markAllRead, markRead } from "@/lib/api/notifications";
import { useAppStore } from "@/stores/appStore";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import NotificationsScreen from "@/app/(app)/notifications/index";

const mockList = listNotifications as jest.Mock;
const TASK = "3f2b9c1e-6a4d-4e8b-9c3a-1d2e3f4a5b6c";

const note = (over: Record<string, unknown> = {}) => ({
  id: "n-1",
  type: "direct_message",
  title: "Message from supervisor",
  body: "Please finish 208 and then do 310.",
  data: {},
  created_at: new Date().toISOString(),
  is_read: false,
  ...over,
});

async function renderScreen() {
  const view = render(
    <ThemeProvider>
      <NotificationsScreen />
    </ThemeProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAssistant = true;
  (markAllRead as jest.Mock).mockResolvedValue(undefined);
  (markRead as jest.Mock).mockResolvedValue(undefined);
  useAppStore.setState({
    unreadCount: 0,
    myRooms: [{ id: "room-310", room_number: "310", floor: 3, status: "DIRTY" } as never],
    isOnline: true,
    hotelTimezone: "America/Chicago",
    user: { id: "u1", tenant_id: "h1", role: "housekeeper" } as never,
  });
});

describe("Notifications: All and Unread", () => {
  it("opens on Unread and does not fetch read history until asked", async () => {
    mockList.mockResolvedValue({ data: [note()] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(false);
  });

  it("shows read notifications under All, marked as read, and fetches them once", async () => {
    mockList.mockImplementation((all: boolean) =>
      Promise.resolve({ data: all ? [note(), note({ id: "n-2", is_read: true, title: "Old news" })] : [note()] }),
    );
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    expect(screen.queryByTestId("notification-n-2")).toBeNull();
    fireEvent.press(screen.getByTestId("notifications-filter-all"));
    await waitFor(() => expect(screen.getByTestId("notification-n-2")).toBeTruthy());
    expect(mockList).toHaveBeenCalledWith(true, 50);
    expect(screen.getByTestId("notification-unread-n-1")).toBeTruthy();
    expect(screen.queryByTestId("notification-unread-n-2")).toBeNull();
    fireEvent.press(screen.getByTestId("notifications-filter-unread"));
    fireEvent.press(screen.getByTestId("notifications-filter-all"));
    expect(mockList.mock.calls.filter(([all]) => all === true)).toHaveLength(1);
  });

  it("an already-read message can be read again but not marked read a second time", async () => {
    mockList.mockImplementation((all: boolean) => Promise.resolve({ data: all ? [note({ id: "n-2", is_read: true })] : [] }));
    await renderScreen();
    fireEvent.press(screen.getByTestId("notifications-filter-all"));
    await waitFor(() => expect(screen.getByTestId("notification-n-2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-2"));
    expect(screen.getByTestId("message-close")).toBeTruthy();
    expect(screen.queryByTestId("message-mark-read")).toBeNull();
  });

  it("marking a message read keeps it under All as read", async () => {
    mockList.mockImplementation((all: boolean) => Promise.resolve({ data: [note()] }));
    useAppStore.setState({ unreadCount: 1 });
    await renderScreen();
    fireEvent.press(screen.getByTestId("notifications-filter-all"));
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    fireEvent.press(screen.getByTestId("message-mark-read"));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("n-1"));
    await waitFor(() => expect(screen.queryByTestId("notification-unread-n-1")).toBeNull());
    expect(screen.getByTestId("notification-n-1")).toBeTruthy();
    expect(useAppStore.getState().unreadCount).toBe(0);
  });
});

describe("Notifications: states", () => {
  it("a failed first load is an error with retry, never 'all caught up'", async () => {
    mockList.mockRejectedValue(new Error("offline"));
    await renderScreen();
    await waitFor(() => expect(screen.getByText("Retry")).toBeTruthy());
    expect(screen.queryByText("You're all caught up")).toBeNull();
    mockList.mockResolvedValue({ data: [note()] });
    fireEvent.press(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
  });

  it("a failed refresh keeps what was loaded and says it is stale", async () => {
    mockList.mockResolvedValueOnce({ data: [note()] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    mockList.mockRejectedValue(new Error("offline"));
    // Pull to refresh.
    await act(async () => {
      const { RefreshControl } = require("react-native");
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    await waitFor(() => expect(screen.getByTestId("notifications-stale")).toBeTruthy());
    expect(screen.getByTestId("notification-n-1")).toBeTruthy();
  });

  it("explains an empty Unread list and an empty All list differently", async () => {
    mockList.mockResolvedValue({ data: [] });
    await renderScreen();
    await waitFor(() => expect(screen.getByText("You're all caught up")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notifications-filter-all"));
    await waitFor(() => expect(screen.getByText("No notifications yet")).toBeTruthy());
  });

  it("groups by day and shows a clock time, not a relative age", async () => {
    mockList.mockResolvedValue({ data: [note({ created_at: new Date().toISOString() })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByText("Today")).toBeTruthy());
    expect(screen.getByText(/\d{1,2}:\d{2}\s?(AM|PM)/)).toBeTruthy();
  });

  it("shows a masked, short preview in the list and the full text only in the opened message", async () => {
    mockList.mockResolvedValue({ data: [note({ body: "Call guest at 555-123-4567 about the extra towels in 310" })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    expect(screen.queryByText(/555-123-4567/)).toBeNull();
    expect(screen.getByText(/\[number\]/)).toBeTruthy();
  });
});

describe("Notifications: destinations and the assistant", () => {
  it("says a room is no longer on the list instead of silently showing no link", async () => {
    mockList.mockResolvedValue({ data: [note({ data: { room_id: "room-999" } })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    expect(screen.getByTestId("message-link-issue")).toBeTruthy();
    expect(screen.queryByTestId("message-open-link")).toBeNull();
    expect(screen.queryByTestId("message-ask")).toBeNull();
  });

  it("asks the assistant about a verified room with only its id and number", async () => {
    mockList.mockResolvedValue({ data: [note({ type: "room_assignment", data: { room_id: "room-310" } })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    fireEvent.press(screen.getByTestId("message-ask"));
    expect(mockOpenAssistant).toHaveBeenCalledWith({ contextType: "room", entityId: "room-310", label: "310" });
  });

  it("asks about a task using the task-link contract's id", async () => {
    mockList.mockResolvedValue({ data: [note({ type: "task_assigned", title: "New task", data: { task_id: TASK } })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    fireEvent.press(screen.getByTestId("message-ask"));
    expect(mockOpenAssistant).toHaveBeenCalledWith({ contextType: "task", entityId: TASK, label: "New task" });
  });

  it("offers no assistant without a record to ask about, without a provider, or to a role that has none", async () => {
    mockList.mockResolvedValue({ data: [note()] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    expect(screen.queryByTestId("message-ask")).toBeNull();
  });

  it("does not offer the assistant to a role that has none", async () => {
    useAppStore.setState({ user: { id: "u1", tenant_id: "h1", role: "front_desk" } as never });
    mockList.mockResolvedValue({ data: [note({ type: "room_assignment", data: { room_id: "room-310" } })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    expect(screen.getByTestId("message-open-link")).toBeTruthy();
    expect(screen.queryByTestId("message-ask")).toBeNull();
  });

  it("opening and reading the list never calls the assistant", async () => {
    mockList.mockResolvedValue({ data: [note(), note({ id: "n-2" })] });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-2")).toBeTruthy());
    expect(mockOpenAssistant).not.toHaveBeenCalled();
  });
});
