import React from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";

let mockLanguage: "en" | "es" = "en";
let mockPreference: "system" | "light" | "dark" = "system";
let mockMode: "light" | "dark" = "light";
let mockRole = "housekeeper";
let mockEffectiveRole: string | undefined;
let mockFullName: string | undefined = "Maria Vega";
let mockOnline = true;
let mockPending = 0;
let mockUnread = 3;
let mockCanGoBack = true;
const mockSetPreference = jest.fn().mockResolvedValue(undefined);
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockFlushQueue = jest.fn().mockResolvedValue(undefined);

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage) }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => mockMode,
  useAppearancePreference: () => ({
    preference: mockPreference,
    mode: mockMode,
    setPreference: mockSetPreference,
    isHydrated: true,
  }),
}));

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack,
  },
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

jest.mock("@/i18n", () => ({
  get language() {
    return mockLanguage;
  },
  changeLanguage: jest.fn(),
}));

jest.mock("@/components/security/SignOutSheet", () => ({
  SignOutSheet: ({ visible }: { visible: boolean }) => {
    const { View } = require("react-native");
    return visible ? <View testID="signout-sheet-mock" /> : null;
  },
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { signOut: jest.fn() },
    from: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue({ eq: jest.fn() }),
    }),
  },
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    // Pending by default so the hotel name never lands as a stray state update; tests opt in via mockHotelResolved().
    get: jest.fn(() => new Promise(() => {})),
  },
}));

jest.mock("@/stores/appStore", () => {
  const buildState = () => ({
    user: {
      id: "user-1",
      full_name: mockFullName,
      role: mockRole,
      effective_role: mockEffectiveRole,
      tenant_id: "hotel-1",
      language_pref: "en",
    },
    isOnline: mockOnline,
    pendingActions: Array.from({ length: mockPending }, (_, i) => ({
      id: `a-${i}`,
      type: "room_status",
      entityId: "r-1",
      payload: {},
      createdAt: "2026-06-11",
    })),
    flushQueue: mockFlushQueue,
    unreadCount: mockUnread,
  });
  return {
    useAppStore: Object.assign((selector?: (s: ReturnType<typeof buildState>) => unknown) => (selector ? selector(buildState()) : buildState()), {
      getState: () => buildState(),
    }),
  };
});

import SettingsHome from "@/app/(app)/profile";
import NotificationSettings from "@/app/(app)/profile/notifications";
import AppearanceScreen from "@/app/(app)/profile/appearance";
import LanguageScreen from "@/app/(app)/profile/language";
import SyncScreen from "@/app/(app)/profile/sync";
import HelpScreen from "@/app/(app)/profile/help";
import AboutScreen from "@/app/(app)/profile/about";
import { api } from "@/lib/api/client";

const ALL_ROLES = [
  ["housekeeper", "Housekeeper"],
  ["inspector", "Inspector"],
  ["engineer", "Engineer"],
  ["housekeeping_supervisor", "HK Supervisor"],
  ["front_desk", "Front Desk"],
  ["gm", "GM"],
] as const;


beforeEach(() => {
  mockLanguage = "en";
  mockPreference = "system";
  mockMode = "light";
  mockRole = "housekeeper";
  mockEffectiveRole = undefined;
  mockFullName = "Maria Vega";
  mockOnline = true;
  mockPending = 0;
  mockUnread = 3;
  mockCanGoBack = true;
  [mockSetPreference, mockPush, mockReplace, mockBack, mockFlushQueue].forEach((m) => m.mockClear());
});

describe("Settings home", () => {
  it("renders the identity card with the real name, role, hotel, and connection state", async () => {
    (api.get as jest.Mock).mockImplementation((path: string) =>
      path.startsWith("/hotels/") ? Promise.resolve({ data: { name: "Lone Star Inn" } }) : new Promise(() => {}),
    );
    const { getByText, getByTestId } = render(<SettingsHome />);

    expect(getByTestId("settings-title").props.children).toBe("Settings");
    expect(getByText("Maria Vega")).toBeTruthy();
    expect(getByTestId("identity-role").props.children).toBe("Housekeeper");
    await waitFor(() => expect(getByTestId("identity-hotel").props.children).toBe("Lone Star Inn"));
    expect(getByText("Online")).toBeTruthy();
    expect(within(getByTestId("settings-identity")).getByTestId("icon-chevron-forward")).toBeTruthy();
  });

  it("shows Offline and Syncing connection states", () => {
    mockOnline = false;
    const offline = render(<SettingsHome />);
    expect(offline.getByText("Offline")).toBeTruthy();
    offline.unmount();

    mockOnline = true;
    mockPending = 2;
    const pending = render(<SettingsHome />);
    expect(pending.getByText("Syncing")).toBeTruthy();
  });

  it.each(ALL_ROLES)("is reachable and complete for the %s role", (role, label) => {
    mockRole = role;
    const { getByTestId, getByText, queryByTestId } = render(<SettingsHome />);

    expect(getByTestId("identity-role").props.children).toBe(label);
    for (const id of [
      "row-personal",
      "row-security",
      "row-notifications",
      "row-appearance",
      "row-language",
      "row-sync",
      "row-help",
      "row-about",
      "row-sign-out",
    ]) {
      expect(getByTestId(id)).toBeTruthy();
    }
    expect(getByText("Account")).toBeTruthy();
    expect(getByText("Preferences")).toBeTruthy();
    expect(getByText("App & support")).toBeTruthy();
    // Every role has the Profile tab that opens this screen.
    expect(getTabsForRole(role).some((tab) => tab.name === "profile/index")).toBe(true);
    // No GM-only administration is exposed to anyone (no supported mobile destination).
    expect(queryByTestId("row-property-admin")).toBeNull();
  });

  it("displays the effective role rather than the base role", () => {
    mockRole = "housekeeper";
    mockEffectiveRole = "housekeeping_supervisor";
    const { getByTestId } = render(<SettingsHome />);
    expect(getByTestId("identity-role").props.children).toBe("HK Supervisor");
  });

  it("falls back for unknown role and missing name without inventing data", () => {
    mockRole = "night_auditor";
    mockFullName = undefined;
    const { getByTestId, getByText } = render(<SettingsHome />);
    expect(getByTestId("identity-role").props.children).toBe("Night Auditor");
    expect(getByText("Staff")).toBeTruthy();
  });

  it("shows row subtitles for the current appearance, language, and sync state", () => {
    mockPreference = "dark";
    const dark = render(<SettingsHome />);
    expect(dark.getByTestId("row-appearance").props.accessibilityLabel).toBe("Appearance, Dark");
    expect(dark.getByTestId("row-language").props.accessibilityLabel).toBe("Language, English");
    expect(dark.getByTestId("row-sync").props.accessibilityLabel).toBe("Offline & Sync, Up to date");
    dark.unmount();

    mockPending = 2;
    const pending = render(<SettingsHome />);
    expect(pending.getByTestId("row-sync").props.accessibilityLabel).toBe("Offline & Sync, 2 waiting to sync");
    pending.unmount();

    mockOnline = false;
    const offline = render(<SettingsHome />);
    expect(offline.getByTestId("row-sync").props.accessibilityLabel).toBe(
      "Offline & Sync, Offline — changes are saved",
    );
  });

  it("renders in Spanish without English fallback", () => {
    mockLanguage = "es";
    const { getByText, getByTestId, queryByText } = render(<SettingsHome />);
    expect(getByTestId("settings-title").props.children).toBe("Ajustes");
    expect(getByText("Información personal")).toBeTruthy();
    expect(getByText("Seguridad e inicio de sesión")).toBeTruthy();
    expect(getByTestId("row-language").props.accessibilityLabel).toBe("Idioma, Español");
    expect(queryByText("Personal Information")).toBeNull();
  });

  it("renders in dark mode", () => {
    mockMode = "dark";
    const { getByTestId } = render(<SettingsHome />);
    expect(getByTestId("settings-identity")).toBeTruthy();
    expect(getByTestId("row-personal")).toBeTruthy();
  });

  it("navigates to every destination from its row and from the identity card", () => {
    const { getByTestId } = render(<SettingsHome />);
    const expected: Record<string, string> = {
      "settings-identity": "/(app)/profile/personal",
      "row-personal": "/(app)/profile/personal",
      "row-security": "/(app)/profile/security",
      "row-notifications": "/(app)/profile/notifications",
      "row-appearance": "/(app)/profile/appearance",
      "row-language": "/(app)/profile/language",
      "row-sync": "/(app)/profile/sync",
      "row-help": "/(app)/profile/help",
      "row-about": "/(app)/profile/about",
      "row-schedule": "/(app)/scheduling",
      "row-sop": "/(app)/sop",
    };
    for (const [id, href] of Object.entries(expected)) {
      mockPush.mockClear();
      fireEvent.press(getByTestId(id));
      expect(mockPush).toHaveBeenCalledWith(href);
    }
  });

  it("keeps Schedule and SOP Library reachable until they have another home", () => {
    const { getByText } = render(<SettingsHome />);
    expect(getByText("My schedule")).toBeTruthy();
    expect(getByText("SOP Library")).toBeTruthy();
  });

  it("shows the unread notification count on the Notifications row", () => {
    const { getByTestId } = render(<SettingsHome />);
    expect(getByTestId("row-notifications").props.accessibilityLabel).toBe(
      "Notifications, Work alerts and reminders, 3",
    );
  });

  it("gives every row a button role, an accessible label, and a 44pt+ target", () => {
    const { getByTestId } = render(<SettingsHome />);
    for (const id of ["row-personal", "row-security", "row-notifications", "row-appearance", "row-sign-out"]) {
      const row = getByTestId(id);
      expect(row.props.accessibilityRole).toBe("button");
      expect(row.props.accessibilityLabel).toBeTruthy();
      const style = StyleSheet.flatten(
        typeof row.props.style === "function" ? row.props.style({ pressed: false }) : row.props.style,
      );
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it("shows the version footer", () => {
    const { getByText } = render(<SettingsHome />);
    expect(getByText("PatelRep v1.0.0")).toBeTruthy();
  });
});

describe("Settings home sign out", () => {
  it("opens the sign-out confirmation instead of signing out immediately", () => {
    const { getByTestId, queryByTestId } = render(<SettingsHome />);
    expect(queryByTestId("signout-sheet-mock")).toBeNull();
    fireEvent.press(getByTestId("row-sign-out"));
    expect(getByTestId("signout-sheet-mock")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("Settings destination screens", () => {
  const shells = [
    ["Help & Support", HelpScreen],
    ["About PatelRep", AboutScreen],
  ] as const;

  it.each(shells)("%s has its own title, a back button, and an honest not-configured notice", (title, Screen) => {
    const { getByTestId } = render(<Screen />);
    expect(getByTestId("settings-title").props.children).toBe(title);
    expect(getByTestId("settings-not-configured")).toBeTruthy();
    expect(getByTestId("settings-back").props.accessibilityLabel).toBe("Back");
  });

  it("back goes to the previous screen when there is history", () => {
    const { getByTestId } = render(<HelpScreen />);
    fireEvent.press(getByTestId("settings-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("back falls back to the Settings root after a deep link with no history", () => {
    mockCanGoBack = false;
    const { getByTestId } = render(<HelpScreen />);
    fireEvent.press(getByTestId("settings-back"));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(app)/profile");
  });

  it("the root Settings screen has no back button", () => {
    const { queryByTestId } = render(<SettingsHome />);
    expect(queryByTestId("settings-back")).toBeNull();
  });

  it("keeps the notification inbox reachable from the Notifications destination", () => {
    const { getByTestId } = render(<NotificationSettings />);
    fireEvent.press(getByTestId("row-notification-inbox"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/notifications");
  });

  it("Appearance keeps the System/Light/Dark radio group with 44pt targets", () => {
    const { getByRole, getByTestId, getByText } = render(<AppearanceScreen />);
    expect(getByTestId("settings-title").props.children).toBe("Appearance");
    expect(getByText("System")).toBeTruthy();
    const group = getByTestId("appearance-segmented");
    expect(group.props.accessibilityRole).toBe("radiogroup");

    for (const [name, value, selected] of [
      ["System", "system", true],
      ["Light", "light", false],
      ["Dark", "dark", false],
    ] as const) {
      const radio = getByRole("radio", { name });
      expect(radio.props.accessibilityState).toEqual({ selected });
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
      fireEvent.press(getByTestId(`appearance-${value}`));
    }
    expect(mockSetPreference).toHaveBeenNthCalledWith(1, "system");
    expect(mockSetPreference).toHaveBeenNthCalledWith(2, "light");
    expect(mockSetPreference).toHaveBeenNthCalledWith(3, "dark");
  });

  it("Appearance renders Spanish choices without English fallback", () => {
    mockLanguage = "es";
    const { getByRole, queryByText } = render(<AppearanceScreen />);
    expect(getByRole("radio", { name: "Sistema" })).toBeTruthy();
    expect(getByRole("radio", { name: "Claro" })).toBeTruthy();
    expect(getByRole("radio", { name: "Oscuro" })).toBeTruthy();
    expect(queryByText("Light")).toBeNull();
  });

  it("Language keeps the English/Español radio group and hides the English name under Spanish", () => {
    const en = render(<LanguageScreen />);
    expect(en.getByRole("radio", { name: "English" }).props.accessibilityState).toEqual({ selected: true });
    expect(en.getByRole("radio", { name: "Español" }).props.accessibilityState).toEqual({ selected: false });
    expect(StyleSheet.flatten(en.getByTestId("language-en").props.style).minHeight).toBeGreaterThanOrEqual(44);
    en.unmount();

    mockLanguage = "es";
    const es = render(<LanguageScreen />);
    expect(es.getByText("Inglés")).toBeTruthy();
    expect(es.queryByText("English")).toBeNull();
  });

  it("Offline & Sync keeps the pending count and a working Sync now action", async () => {
    mockPending = 2;
    const { getByText, getByTestId } = render(<SyncScreen />);
    expect(getByText("2 waiting to sync")).toBeTruthy();
    fireEvent.press(getByTestId("sync-now"));
    await waitFor(() => expect(mockFlushQueue).toHaveBeenCalled());
  });

  it("Offline & Sync shows Up to date with no action when nothing is pending", () => {
    const { getByText, queryByTestId } = render(<SyncScreen />);
    expect(getByText("Up to date")).toBeTruthy();
    expect(queryByTestId("sync-now")).toBeNull();
  });
});

describe("Settings route registration", () => {
  it("registers every child route as a hidden app route so none becomes a tab", () => {
    for (const name of [
      "profile/personal",
      "profile/security",
      "profile/change-password",
      "profile/devices",
      "profile/notifications",
      "profile/appearance",
      "profile/language",
      "profile/sync",
      "profile/help",
      "profile/about",
    ]) {
      expect(HIDDEN_APP_ROUTES).toContain(name);
    }
  });

  it("keeps existing hidden routes and the Profile tab", () => {
    for (const name of ["notifications/index", "scheduling/index", "sop/index", "sop/[sopId]", "tasks/history"]) {
      expect(HIDDEN_APP_ROUTES).toContain(name);
    }
    expect(getTabsForRole("gm").map((tab) => tab.name)).toContain("profile/index");
  });
});
