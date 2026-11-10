import React from "react";
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { darkThemeV2, lightThemeV2 } from "@/components/shared/tokensV2";

let mockLanguage: "en" | "es" = "en";
let mockMode: "light" | "dark" = "light";
let mockOnline = true;
let mockPending = 0;
const mockBack = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage) }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: (...a: unknown[]) => mockBack(...a), canGoBack: () => true },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ isOnline: mockOnline, pendingActions: new Array(mockPending).fill({}) }),
}));
jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text } = require("react-native");
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      ReactRuntime.createElement(Text, { testID: `icon-${name}`, style: { color } }, name),
  };
});

import {
  AccountHeader,
  ConnectionIndicator,
  DetailHeader,
  HomeHeader,
  NotificationBell,
  ScreenHeader,
  SheetHeader,
  useConnectionState,
} from "@/components/shared/HeadersV2";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { Text } from "react-native";

const flat = (node: { props: Record<string, unknown> }) =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>) as ViewStyle & TextStyle;

function v2(ui: React.ReactElement) {
  return render(<DesignV2Scope>{ui}</DesignV2Scope>);
}

beforeEach(() => {
  mockLanguage = "en";
  mockMode = "light";
  mockOnline = true;
  mockPending = 0;
  mockBack.mockReset();
});

describe("V2 headers", () => {
  it("HomeHeader: safe-area top, V2 surface, hotel context, bell with unread text, sync chip", () => {
    const onBell = jest.fn();
    const onSync = jest.fn();
    const u = v2(
      <HomeHeader
        title="Good morning"
        subtitle="Your shift is underway."
        hotelName="Fossil Creek Inn"
        unreadCount={3}
        connection={{ state: "pending", pendingCount: 2 }}
        onOpenNotifications={onBell}
        onOpenSync={onSync}
        avatarName="Maria Lopez"
        onOpenAccount={jest.fn()}
      />,
    );
    const frame = u.getByTestId("header-home");
    expect(flat(frame).paddingTop).toBeGreaterThanOrEqual(47);
    expect(flat(frame).backgroundColor).toBe(lightThemeV2.background);
    expect(u.getByTestId("header-home-hotel")).toBeTruthy();
    expect(u.getByRole("header")).toBeTruthy();
    // Unread count is text and part of the spoken label, not color alone.
    expect(u.getByLabelText("Notifications, 3")).toBeTruthy();
    expect(u.getByText("3")).toBeTruthy();
    fireEvent.press(u.getByTestId("header-home-notifications"));
    expect(onBell).toHaveBeenCalledTimes(1);
    fireEvent.press(u.getByTestId("header-home-sync"));
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(u.getByLabelText("Account: Maria Lopez")).toBeTruthy();
  });

  it("follows dark mode", () => {
    mockMode = "dark";
    const u = v2(<ScreenHeader title="Tasks" />);
    expect(flat(u.getByTestId("header-screen")).backgroundColor).toBe(darkThemeV2.background);
  });

  it("DetailHeader: back is first, labelled and 44pt; pressing it goes back", () => {
    const u = v2(<DetailHeader title="Room 214" subtitle="King suite" onBack={mockBack} />);
    const back = u.getByTestId("header-back");
    expect(flat(back).minWidth).toBeGreaterThanOrEqual(44);
    expect(flat(back).minHeight).toBeGreaterThanOrEqual(44);
    expect(u.getByLabelText("Back")).toBe(back);
    fireEvent.press(back);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("SheetHeader: close control is named", () => {
    const onClose = jest.fn();
    const u = v2(<SheetHeader title="Shift briefing" onClose={onClose} />);
    fireEvent.press(u.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("AccountHeader keeps the legacy settings test IDs and omits back on the root", () => {
    const root = v2(<AccountHeader title="Settings" />);
    expect(root.getByTestId("settings-title")).toBeTruthy();
    expect(root.queryByTestId("settings-back")).toBeNull();
    const child = v2(<AccountHeader title="Language" onBack={mockBack} backLabel="Back" />);
    fireEvent.press(child.getAllByTestId("settings-back")[0]);
    expect(mockBack).toHaveBeenCalled();
  });

  it("Spanish labels resolve", () => {
    mockLanguage = "es";
    const u = v2(<NotificationBell unreadCount={2} onPress={jest.fn()} />);
    expect(u.getByLabelText("Notificaciones, 2")).toBeTruthy();
  });
});

describe("Connection indicator", () => {
  it("is hidden when fully online, and always pairs an icon with text", () => {
    const hidden = v2(<ConnectionIndicator state="online" testID="c" />);
    expect(hidden.queryByTestId("c")).toBeNull();
    const off = v2(<ConnectionIndicator state="offline" testID="c" />);
    expect(off.getByText("Offline")).toBeTruthy();
    expect(off.getByTestId("icon-cloud-offline-outline")).toBeTruthy();
    const pend = v2(<ConnectionIndicator state="pending" pendingCount={1} testID="c2" />);
    expect(pend.getByText("Waiting to send: 1")).toBeTruthy();
    expect(pend.getByLabelText("Waiting to send: 1")).toBeTruthy();
  });

  it("useConnectionState reflects the app store honestly", () => {
    function Probe() {
      const { state, pendingCount } = useConnectionState();
      return <Text testID="probe">{`${state}:${pendingCount}`}</Text>;
    }
    mockOnline = false;
    mockPending = 2;
    expect(render(<Probe />).getByTestId("probe").props.children).toBe("offline:2");
    mockOnline = true;
    expect(render(<Probe />).getByTestId("probe").props.children).toBe("pending:2");
    mockPending = 0;
    expect(render(<Probe />).getByTestId("probe").props.children).toBe("online:0");
  });
});

describe("Offline banner chrome", () => {
  it("shows an icon with the offline message", () => {
    mockOnline = false;
    const scoped = v2(<OfflineBanner />);
    expect(scoped.getByTestId("icon-cloud-offline-outline")).toBeTruthy();
    expect(scoped.getByRole("alert")).toBeTruthy();
  });
});

describe("Settings chrome", () => {
  it("renders the V2 account header", () => {
    const u = render(
      <SettingsScreen title="Language" back>
        <Text>body</Text>
      </SettingsScreen>,
    );
    expect(u.getByTestId("settings-screen-v2")).toBeTruthy();
    expect(u.getByTestId("settings-title")).toBeTruthy();
    expect(u.getByTestId("settings-back")).toBeTruthy();
    expect(u.getByText("body")).toBeTruthy();
  });

  it("screens that reuse the frame for non-Settings content can opt out of V2", () => {
    const u = render(
      <SettingsScreen title="Team" back v2Chrome={false}>
        <Text>body</Text>
      </SettingsScreen>,
    );
    expect(u.queryByTestId("settings-screen-v2")).toBeNull();
  });

  it("section titles are sentence case", () => {
    const scoped = v2(<SettingsSection title="Account"><Text>x</Text></SettingsSection>);
    expect(flat(scoped.getByText("Account")).textTransform).toBe("none");
  });
});
