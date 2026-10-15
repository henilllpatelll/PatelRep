import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("react-i18next", () => {
  const { makeTranslator } = require("../helpers/i18n");
  const t = makeTranslator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en", resolvedLanguage: "en" } }) };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock("@/lib/api/notifications", () => ({
  listNotifications: jest.fn(),
  markAllRead: jest.fn(),
  markRead: jest.fn(),
}));

import { listNotifications, markAllRead, markRead } from "@/lib/api/notifications";
import { useAppStore } from "@/stores/appStore";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import NotificationsScreen from "@/app/(app)/notifications/index";

const mockListNotifications = listNotifications as jest.Mock;
const mockMarkAllRead = markAllRead as jest.Mock;
const mockMarkRead = markRead as jest.Mock;

function renderScreen() {
  return render(
    <ThemeProvider>
      <NotificationsScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMarkAllRead.mockResolvedValue(undefined);
  mockMarkRead.mockResolvedValue(undefined);
  useAppStore.setState({ unreadCount: 0, myRooms: [], isOnline: true });
});

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "n-1",
  type: "direct_message",
  title: "Message from supervisor",
  body: "Please finish 208 and then do 310.",
  data: {},
  created_at: "2026-10-14T15:00:00.000Z",
  is_read: false,
  ...overrides,
});

describe("NotificationsScreen", () => {
  it("loads unread notifications through the existing API contract", async () => {
    mockListNotifications.mockResolvedValue({
      data: [
        {
          id: "notification-1",
          type: "work_order_complete",
          title: "Work order completed",
          body: "The lobby ice machine is back in service.",
          created_at: new Date().toISOString(),
          is_read: false,
        },
      ],
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText("Work order completed")).toBeTruthy());
    expect(mockListNotifications).toHaveBeenCalledWith(false);
    expect(screen.getByText("The lobby ice machine is back in service.")).toBeTruthy();
  });

  it("keeps mark-all-read wired and clears the unread list after success", async () => {
    mockListNotifications.mockResolvedValue({
      data: [
        {
          id: "notification-1",
          type: "task_assigned",
          title: "New task",
          body: "Restock the second-floor linen closet.",
          created_at: new Date().toISOString(),
          is_read: false,
        },
      ],
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText("New task")).toBeTruthy());
    fireEvent.press(screen.getByText("Mark all read"));

    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("You're all caught up")).toBeTruthy());
    expect(screen.queryByText("New task")).toBeNull();
  });

  it("does not clear the unread count just because the screen was opened", async () => {
    mockListNotifications.mockResolvedValue({ data: [message(), message({ id: "n-2" })] });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-n-2")).toBeTruthy());
    // The count is whatever the server's unread list says, not zero.
    expect(useAppStore.getState().unreadCount).toBe(2);
  });

  it("opens a notification in full and marks it read only after the server accepts", async () => {
    mockListNotifications.mockResolvedValue({ data: [message()] });
    useAppStore.setState({ unreadCount: 1 });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    expect(screen.getByTestId("message-sheet")).toBeTruthy();
    expect(screen.getByTestId("message-body").props.children).toBe("Please finish 208 and then do 310.");

    fireEvent.press(screen.getByTestId("message-mark-read"));
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n-1"));
    await waitFor(() => expect(screen.queryByTestId("notification-n-1")).toBeNull());
    expect(useAppStore.getState().unreadCount).toBe(0);
  });

  it("keeps the notification unread and says so when marking it read fails", async () => {
    mockListNotifications.mockResolvedValue({ data: [message()] });
    mockMarkRead.mockRejectedValue(new Error("server down"));
    useAppStore.setState({ unreadCount: 1 });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-1"));
    fireEvent.press(screen.getByTestId("message-mark-read"));

    await waitFor(() => expect(screen.getByTestId("message-error")).toBeTruthy());
    expect(screen.getByTestId("notification-n-1")).toBeTruthy();
    expect(useAppStore.getState().unreadCount).toBe(1);
  });

  it("keeps the list and count, and shows an error, when mark-all-read fails", async () => {
    mockListNotifications.mockResolvedValue({ data: [message()] });
    mockMarkAllRead.mockRejectedValue(new Error("server down"));
    useAppStore.setState({ unreadCount: 1 });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("notification-n-1")).toBeTruthy());
    fireEvent.press(screen.getByText("Mark all read"));
    await waitFor(() => expect(screen.getByTestId("mark-all-error")).toBeTruthy());
    expect(screen.getByTestId("notification-n-1")).toBeTruthy();
    expect(useAppStore.getState().unreadCount).toBe(1);
  });

  it("links a room only when it is on this person's list, and a task through the task-link contract", async () => {
    const { router } = require("expo-router");
    useAppStore.setState({
      myRooms: [{ id: "room-310", room_number: "310", floor: 3, status: "DIRTY" } as never],
    });
    mockListNotifications.mockResolvedValue({
      data: [
        message({ id: "n-room", data: { room_id: "room-310" } }),
        message({ id: "n-gone", data: { room_id: "room-999" } }),
        message({ id: "n-task", type: "task_assigned", data: { task_id: "3f2b9c1e-6a4d-4e8b-9c3a-1d2e3f4a5b6c" } }),
      ],
    });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("notification-n-room")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-n-gone"));
    expect(screen.queryByTestId("message-open-link")).toBeNull();

    fireEvent.press(screen.getByTestId("notification-n-room"));
    fireEvent.press(screen.getByTestId("message-open-link"));
    expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-310");

    fireEvent.press(screen.getByTestId("notification-n-task"));
    fireEvent.press(screen.getByTestId("message-open-link"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/tasks", params: { taskId: "3f2b9c1e-6a4d-4e8b-9c3a-1d2e3f4a5b6c" } });
  });
});
