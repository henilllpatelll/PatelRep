import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native");
    return <Text testID="redirect">{href}</Text>;
  },
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/security/SignOutSheet", () => ({
  SignOutSheet: ({ visible }: { visible: boolean }) => {
    const { Text } = require("react-native");
    return visible ? <Text testID="sign-out-sheet">open</Text> : null;
  },
}));
let mockRole: string | undefined = "engineer";
let mockUnread = 0;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({ unreadCount: mockUnread, user: { id: "u1", role: mockRole } })),
  };
});

import { router } from "expo-router";
import EngineeringMoreScreen from "@/app/(app)/more/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const renderMore = () =>
  render(
    <ThemeProvider>
      <EngineeringMoreScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "engineer";
  mockUnread = 0;
});

describe("Engineering More screen", () => {
  it("reaches Rooms, Notifications, My Profile and Settings", () => {
    const { getByTestId } = renderMore();
    const cases: [string, string][] = [
      ["more-rooms", "/(app)/room-status"],
      ["more-notifications", "/(app)/notifications"],
      ["more-profile", "/(app)/profile/personal"],
      ["more-settings", "/(app)/profile"],
      ["more-help", "/(app)/profile/help"],
    ];
    for (const [id, href] of cases) {
      fireEvent.press(getByTestId(id));
      expect(router.push).toHaveBeenLastCalledWith(href);
    }
  });

  it("opens the existing sign-out confirmation instead of signing out directly", () => {
    const { getByTestId, queryByTestId } = renderMore();
    expect(queryByTestId("sign-out-sheet")).toBeNull();
    fireEvent.press(getByTestId("more-signOut"));
    expect(getByTestId("sign-out-sheet")).toBeTruthy();
  });

  it("shows the unread notification count on the Notifications row", () => {
    mockUnread = 4;
    const { getByTestId } = renderMore();
    expect(getByTestId("more-notifications").props.accessibilityLabel).toContain("4");
  });

  it("does not show Management rows to a chief engineer until those screens exist", () => {
    mockRole = "chief_engineer";
    const { queryByText, getByTestId } = renderMore();
    expect(getByTestId("more-rooms")).toBeTruthy();
    expect(queryByText("engineeringMore.management")).toBeNull();
  });

  it("sends any other role back to Home", () => {
    mockRole = "housekeeper";
    const { getByTestId, queryByTestId } = renderMore();
    expect(getByTestId("redirect").props.children).toBe("/(app)/home");
    expect(queryByTestId("more-rooms")).toBeNull();
  });
});
