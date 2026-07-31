import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count == null ? key : `${key}:${options.count}`,
  }),
}));

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: true }),
}));

import { api } from "@/lib/api/client";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AlertsScreen from "@/app/(app)/alerts/index";

const mockGet = api.get as jest.Mock;

function renderScreen() {
  return render(
    <ThemeProvider>
      <AlertsScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AlertsScreen", () => {
  it("loads tenant-scoped risk alerts through the existing API route and renders them", async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          id: "alert-1",
          alert_type: "failure_prediction",
          severity: "critical",
          title: "Elevator motor temperature",
          description: "Temperature is trending above the normal range.",
          room_number: null,
          asset_name: "Elevator 1",
          created_at: new Date().toISOString(),
          is_read: false,
        },
      ],
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText("Elevator motor temperature")).toBeTruthy());
    expect(mockGet).toHaveBeenCalledWith("/ai/risk-alerts");
    expect(screen.getByText("Temperature is trending above the normal range.")).toBeTruthy();
  });

  it("shows the existing all-clear state when no risk alerts are returned", async () => {
    mockGet.mockResolvedValue({ data: [] });

    renderScreen();

    await waitFor(() => expect(screen.getByText("alerts.allClear")).toBeTruthy());
    expect(screen.getByText("alerts.noAlerts")).toBeTruthy();
  });
});
