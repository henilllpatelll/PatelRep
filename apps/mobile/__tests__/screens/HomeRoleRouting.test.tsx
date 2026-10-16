import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({ data: [] }) } }));
jest.mock("@/components/home/HousekeeperHomeScreen", () => {
  const { Text } = require("react-native");
  return { HousekeeperHome: () => <Text testID="home-housekeeper">hk</Text> };
});
jest.mock("@/components/home/SupervisorHome", () => {
  const { Text } = require("react-native");
  return { SupervisorHome: ({ name }: { name: string }) => <Text testID="home-supervisor">{`sup:${name}`}</Text> };
});
jest.mock("@/components/engineering/EngineerHome", () => {
  const { Text } = require("react-native");
  return { EngineerHome: () => <Text testID="home-engineer">eng</Text> };
});

let mockUser: Record<string, unknown> | null = null;
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => {
    const state = { user: mockUser, isOnline: true };
    return selector ? selector(state) : state;
  },
}));

import HomeScreen from "@/app/(app)/home/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

function renderAs(role: string, extra: Record<string, unknown> = {}) {
  mockUser = { id: "u1", role, effective_role: role, tenant_id: "h1", language_pref: "en", ...extra };
  return render(
    <ThemeProvider>
      <HomeScreen />
    </ThemeProvider>,
  );
}

describe("Home route by role", () => {
  it("shows the Today dashboard only for the housekeeping supervisor", () => {
    const screen = renderAs("housekeeping_supervisor", { full_name: "Sam Super" });
    expect(screen.getByTestId("home-supervisor")).toHaveTextContent("sup:Sam Super");
    expect(screen.queryByTestId("home-housekeeper")).toBeNull();
  });

  it("passes no made-up name when the supervisor has none", () => {
    const screen = renderAs("housekeeping_supervisor");
    expect(screen.getByTestId("home-supervisor")).toHaveTextContent(/^sup:$/);
  });

  it.each([["housekeeper", "home-housekeeper"], ["engineer", "home-engineer"]])("%s keeps its own Home", (role, testID) => {
    const screen = renderAs(role);
    expect(screen.getByTestId(testID)).toBeTruthy();
    expect(screen.queryByTestId("home-supervisor")).toBeNull();
  });

  it.each(["front_desk", "gm"])("%s never renders the supervisor Today", (role) => {
    const screen = renderAs(role);
    expect(screen.queryByTestId("home-supervisor")).toBeNull();
    expect(screen.queryByTestId("home-housekeeper")).toBeNull();
  });
});
