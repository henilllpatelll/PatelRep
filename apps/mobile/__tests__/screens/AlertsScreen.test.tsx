import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
// Stable references, like the real hook: a fresh `t` on every render would re-run every effect that depends on it.
const mockT = (key: string, options?: { count?: number }) => (options?.count == null ? key : `${key}:${options.count}`);
const mockI18n = { resolvedLanguage: "en" };
const mockTranslation = { t: mockT, i18n: mockI18n };
jest.mock("react-i18next", () => ({
  useTranslation: () => mockTranslation,
}));

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

const mockStoreState = { isOnline: true, hotelTimezone: "America/Chicago" };
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: typeof mockStoreState) => unknown) => (selector ? selector(mockStoreState) : mockStoreState),
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

    await waitFor(() => expect(screen.getByTestId("alert-alert-1")).toBeTruthy());
    expect(mockGet).toHaveBeenCalledWith("/ai/risk-alerts");
    expect(screen.getByTestId("alerts-v2")).toBeTruthy();
    expect(screen.getByTestId("alerts-metric-attention")).toBeTruthy();
  });

  it("shows the existing all-clear state when no risk alerts are returned", async () => {
    mockGet.mockResolvedValue({ data: [] });

    renderScreen();

    await waitFor(() => expect(screen.getByText("alertsV2.empty.title")).toBeTruthy());
    expect(screen.getByText("alertsV2.empty.body")).toBeTruthy();
  });
});
