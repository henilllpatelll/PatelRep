import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native");
    return <Text testID="redirect">{href}</Text>;
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o && o.count !== undefined ? `${k}:${o.count}` : k) }),
}));
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
let mockName = "Sam Rivera";
let mockHotel: string | null = "Fossil Creek Inn";
let mockOverviewStatus = "saved";
let mockConnection = { text: "settings.connection.onlineSynced", color: "#0a0" };
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({ unreadCount: mockUnread, user: { id: "u1", role: mockRole } })),
  };
});
jest.mock("@/lib/offline/useSyncOverview", () => ({
  useSyncOverview: () => ({ overview: { status: mockOverviewStatus } }),
}));
jest.mock("@/lib/settings/useOwnProfile", () => ({ useOwnProfile: () => ({ profile: null }) }));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({
  useSettingsIdentity: () => ({ user: { id: "u1" }, name: mockName, hotelName: mockHotel, connection: mockConnection }),
}));

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
  mockName = "Sam Rivera";
  mockHotel = "Fossil Creek Inn";
  mockOverviewStatus = "saved";
  mockConnection = { text: "settings.connection.onlineSynced", color: "#0a0" };
});

describe("Engineering More screen: layout", () => {
  it("renders the header, identity card, tools, account & support and sign out", () => {
    const { getByTestId, getByText } = renderMore();
    expect(getByTestId("more-title").props.children).toBe("tabs.more");
    expect(getByTestId("more-identity")).toBeTruthy();
    expect(getByTestId("more-name").props.children).toBe("Sam Rivera");
    expect(getByTestId("more-role").props.children).toBe("engineeringMore.roleLine.engineer");
    expect(getByTestId("more-hotel").props.children).toBe("Fossil Creek Inn");
    for (const id of ["more-rooms", "more-sop", "more-schedule", "more-settings", "more-help", "more-signOut"]) expect(getByTestId(id)).toBeTruthy();
    expect(getByText("engineeringMore.groups.tools")).toBeTruthy();
    expect(getByText("engineeringMore.accountSupport")).toBeTruthy();
  });

  it("drops the rows the header and identity card now cover, and the old footer hint", () => {
    const { queryByTestId, queryByText } = renderMore();
    for (const id of ["more-notificationSettings", "more-security"]) expect(queryByTestId(id)).toBeNull();
    expect(queryByText("engineeringMore.hint")).toBeNull();
  });

  it("uses the chief engineer role line for a chief engineer", () => {
    mockRole = "chief_engineer";
    expect(renderMore().getByTestId("more-role").props.children).toBe("engineeringMore.roleLine.chief_engineer");
  });
});

describe("Engineering More screen: navigation", () => {
  it("opens each destination", () => {
    const { getByTestId } = renderMore();
    const cases: [string, string][] = [
      ["more-profile", "/(app)/profile/personal"],
      ["more-notifications", "/(app)/notifications"],
      ["more-header-settings", "/(app)/profile"],
      ["more-rooms", "/(app)/room-status"],
      ["more-sop", "/(app)/sop"],
      ["more-schedule", "/(app)/scheduling"],
      ["more-settings", "/(app)/profile"],
      ["more-help", "/(app)/profile/help"],
      ["more-sync", "/(app)/engineering-sync"],
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
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("Engineering More screen: roles", () => {
  it("shows Team Overview under Management to a chief engineer only", () => {
    mockRole = "chief_engineer";
    const { getByTestId, getByText } = renderMore();
    expect(getByText("engineeringMore.management")).toBeTruthy();
    fireEvent.press(getByTestId("more-team"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/team");
  });

  it("hides Management from a regular engineer", () => {
    const { queryByTestId, queryByText } = renderMore();
    expect(queryByTestId("more-team")).toBeNull();
    expect(queryByText("engineeringMore.management")).toBeNull();
  });

  it("sends any other role back to Home", () => {
    mockRole = "housekeeper";
    const { getByTestId, queryByTestId } = renderMore();
    expect(getByTestId("redirect").props.children).toBe("/(app)/home");
    expect(queryByTestId("more-rooms")).toBeNull();
  });
});

describe("Engineering More screen: edge cases", () => {
  it("shows no badge at zero unread, the exact count below 100 and 99+ above", () => {
    const zero = renderMore();
    expect(zero.queryByTestId("more-notifications-badge")).toBeNull();
    expect(zero.getByTestId("more-notifications").props.accessibilityLabel).toBe("engineeringMore.notificationsA11y");
    zero.unmount();
    mockUnread = 4;
    const some = renderMore();
    expect(some.getByTestId("more-notifications-badge").props.children).toBe("4");
    expect(some.getByTestId("more-notifications").props.accessibilityLabel).toBe("home.engineer.notificationsUnread:4");
    some.unmount();
    mockUnread = 240;
    expect(renderMore().getByTestId("more-notifications-badge").props.children).toBe("99+");
  });

  it("omits the hotel line when the hotel name is unknown and keeps navigation working", () => {
    mockHotel = null;
    const { queryByTestId, getByTestId } = renderMore();
    expect(queryByTestId("more-hotel")).toBeNull();
    fireEvent.press(getByTestId("more-rooms"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/room-status");
  });

  it("wraps a long name and long hotel name instead of clipping or overflowing", () => {
    mockName = "Alejandro Maximiliano de la Cruz-Hernandez Fitzgerald";
    mockHotel = "The Grand Fossil Creek Inn & Suites at the Texas Hill Country Conference Center";
    const { getByTestId } = renderMore();
    expect(getByTestId("more-name").props.numberOfLines).toBe(2);
    expect(getByTestId("more-hotel").props.numberOfLines).toBe(2);
  });

  it("shows the real connection state, and a neutral label when it cannot be determined", () => {
    mockConnection = { text: "settings.connection.offlinePending:3", color: "#c00" };
    const offline = renderMore();
    expect(offline.getByTestId("more-sync-text").props.children).toBe("settings.connection.offlinePending:3");
    offline.unmount();
    mockOverviewStatus = "unavailable";
    expect(renderMore().getByTestId("more-sync-text").props.children).toBe("engineeringMore.syncStatus");
  });
});
