import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/lib/api/notifications", () => ({
  listNotifications: jest.fn(),
  markAllRead: jest.fn(),
}));

import { listNotifications, markAllRead } from "@/lib/api/notifications";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import NotificationsScreen from "@/app/(app)/notifications/index";

const mockListNotifications = listNotifications as jest.Mock;
const mockMarkAllRead = markAllRead as jest.Mock;

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
});
