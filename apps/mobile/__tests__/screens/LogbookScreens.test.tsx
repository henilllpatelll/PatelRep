import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: true }),
}));

import { router } from "expo-router";
import { api } from "@/lib/api/client";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import LogbookScreen from "@/app/(app)/logbook";
import NewLogbookEntryScreen from "@/app/(app)/logbook/new";

const mockApiGet = api.get as jest.Mock;
const mockApiPost = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockImplementation((url: string) => {
    if (url === "/logbook/shift-summary") {
      return Promise.resolve({ data: null });
    }
    return Promise.resolve({
      data: [
        {
          id: "entry-1",
          title: "Pool deck handoff",
          body: "West gate latch needs an engineer.",
          department_name: "Front Desk",
          author_name: "Jordan",
          is_urgent: true,
          created_at: "2026-07-30T14:30:00.000Z",
        },
      ],
    });
  });
  mockApiPost.mockResolvedValue({ data: { id: "entry-2" } });
});

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Logbook screens", () => {
  it("keeps the list data and new-entry navigation available through the primary action", async () => {
    renderWithTheme(<LogbookScreen />);

    await waitFor(() => expect(screen.getByText("Pool deck handoff")).toBeTruthy());
    expect(screen.getByText("West gate latch needs an engineer.")).toBeTruthy();
    expect(screen.getByText("logbook.urgent")).toBeTruthy();

    fireEvent.press(screen.getByTestId("logbook-new-entry-button"));

    expect(router.push).toHaveBeenCalledWith("/(app)/logbook/new");
  });

  it("preserves the create-entry payload and returns after a successful save", async () => {
    renderWithTheme(<NewLogbookEntryScreen />);

    fireEvent.changeText(screen.getByPlaceholderText("logbook.titlePlaceholder"), "Evening handoff");
    fireEvent.changeText(
      screen.getByPlaceholderText("logbook.detailsPlaceholder"),
      "Pool gate checked and secured.",
    );
    fireEvent.press(screen.getByTestId("logbook-save-button"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/logbook/entries", {
        title: "Evening handoff",
        body: "Pool gate checked and secured.",
        is_urgent: false,
        department_id: null,
      }),
    );
    expect(router.back).toHaveBeenCalled();
  });
});
