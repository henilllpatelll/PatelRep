import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

let mockLanguage: "en" | "es" = "en";
let mockOnline = true;
let mockUnread = 0;
let mockRole = "housekeeper";
let mockPermission: string | null = "granted";
const mockEnable = jest.fn().mockResolvedValue("granted");
const mockOpenSettings = jest.fn();
const mockPush = jest.fn();
const mockGetPrefs = jest.fn();
const mockSetPref = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage) }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => "light",
  useAppearancePreference: () => ({ preference: "system", mode: "light", setPreference: jest.fn(), isHydrated: true }),
}));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock("expo-notifications", () => ({}));
jest.mock("@/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/lib/notifications/usePushPermission", () => ({
  usePushPermission: () => ({
    state: mockPermission,
    busy: false,
    enable: mockEnable,
    openSettings: mockOpenSettings,
    refresh: jest.fn(),
  }),
}));
jest.mock("@/lib/api/notifications", () => ({
  getNotificationPreferences: (...a: unknown[]) => mockGetPrefs(...a),
  setNotificationPreference: (...a: unknown[]) => mockSetPref(...a),
}));
jest.mock("@/stores/appStore", () => {
  const state = () => ({
    user: { id: "u1", tenant_id: "h1", role: mockRole, effective_role: undefined },
    isOnline: mockOnline,
    unreadCount: mockUnread,
  });
  return { useAppStore: (selector: (s: ReturnType<typeof state>) => unknown) => selector(state()) };
});

import NotificationSettingsScreen from "@/app/(app)/profile/notifications";

const HOUSEKEEPER = [
  { key: "room_assignments", enabled: true, has_critical: false },
  { key: "tasks", enabled: true, has_critical: true },
];
const ENGINEER = [
  { key: "work_orders", enabled: true, has_critical: false },
  { key: "tasks", enabled: false, has_critical: true },
];
const GM = [{ key: "tasks", enabled: true, has_critical: true }];

const rowIds = (utils: ReturnType<typeof render>) =>
  ["room_assignments", "work_orders", "tasks"].filter((key) => utils.queryByTestId(`row-notif-${key}`));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLanguage = "en";
  mockOnline = true;
  mockUnread = 0;
  mockRole = "housekeeper";
  mockPermission = "granted";
  mockGetPrefs.mockResolvedValue(HOUSEKEEPER);
  mockSetPref.mockResolvedValue(undefined);
});

describe("work notification categories", () => {
  it("shows a housekeeper only the categories the server says apply to them", async () => {
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(rowIds(ui)).toEqual(["room_assignments", "tasks"]);
    expect(ui.getByText("New Assignments")).toBeTruthy();
    expect(ui.getByText("Task Updates")).toBeTruthy();
  });

  it("shows an engineer work orders and tasks, with the saved opt-out reflected", async () => {
    mockRole = "engineer";
    mockGetPrefs.mockResolvedValue(ENGINEER);
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-work_orders")).toBeTruthy());
    expect(rowIds(ui)).toEqual(["work_orders", "tasks"]);
    expect(ui.getByTestId("row-notif-tasks").props.accessibilityState.checked).toBe(false);
    expect(ui.getByTestId("row-notif-work_orders").props.accessibilityState.checked).toBe(true);
  });

  it("shows a manager only the single category that exists for them, and never invents the rest", async () => {
    mockRole = "gm";
    mockGetPrefs.mockResolvedValue(GM);
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(rowIds(ui)).toEqual(["tasks"]);
  });

  it("ignores a category from a newer server that this build has no label for", async () => {
    mockGetPrefs.mockResolvedValue([...HOUSEKEEPER, { key: "brand_new_thing", enabled: true, has_critical: false }]);
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(ui.queryByTestId("row-notif-brand_new_thing")).toBeNull();
  });

  it("exposes each switch with its state, a spoken hint, and a 44pt-high row", async () => {
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    const row = ui.getByTestId("row-notif-tasks");
    expect(row.props.accessibilityRole).toBe("switch");
    expect(row.props.accessibilityHint).toBe("Double tap to turn off");
    expect(JSON.stringify(row.props.style)).toContain("56"); // minHeight 56 >= 44pt
  });
});

describe("saving", () => {
  it("saves a toggle through the API and confirms it", async () => {
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    fireEvent.press(ui.getByTestId("row-notif-tasks"));
    expect(mockSetPref).toHaveBeenCalledWith("tasks", false);
    await waitFor(() => expect(ui.getByText("Changes Saved")).toBeTruthy());
    expect(ui.getByTestId("row-notif-tasks").props.accessibilityState.checked).toBe(false);
  });

  it("shows a failed save honestly, keeps the last saved state, and offers Retry", async () => {
    mockSetPref.mockRejectedValueOnce(new Error("500"));
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    fireEvent.press(ui.getByTestId("row-notif-tasks"));
    await waitFor(() => expect(ui.getByText("Unable to save. The switch shows your last saved setting.")).toBeTruthy());
    expect(ui.getByTestId("row-notif-tasks").props.accessibilityState.checked).toBe(true);
    expect(ui.queryByText("Changes Saved")).toBeNull();
    fireEvent.press(ui.getByTestId("notifications-retry"));
    await waitFor(() => expect(mockSetPref).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ui.getByText("Changes Saved")).toBeTruthy());
  });

  it("does not leave a blank screen when the settings cannot be loaded: message plus Retry", async () => {
    mockGetPrefs.mockRejectedValueOnce(new Error("offline"));
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("notifications-load-error")).toBeTruthy());
    mockGetPrefs.mockResolvedValue(HOUSEKEEPER);
    fireEvent.press(ui.getByTestId("notifications-load-retry"));
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
  });

  it("shows a loading state while the settings load", () => {
    mockGetPrefs.mockReturnValue(new Promise(() => undefined));
    const ui = render(<NotificationSettingsScreen />);
    expect(ui.getByTestId("notifications-loading")).toBeTruthy();
  });

  it("says plainly when offline and does not let a switch pretend to save", async () => {
    mockOnline = false;
    const ui = render(<NotificationSettingsScreen />);
    expect(ui.getByTestId("notifications-offline")).toBeTruthy();
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(ui.getByTestId("row-notif-tasks").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(ui.getByTestId("row-notif-tasks"));
    expect(mockSetPref).not.toHaveBeenCalled();
  });
});

describe("this phone's permission", () => {
  it("never asks the OS just by rendering", async () => {
    mockPermission = "undetermined";
    render(<NotificationSettingsScreen />);
    await waitFor(() => expect(mockGetPrefs).toHaveBeenCalled());
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it("offers Enable Notifications only while the OS will still ask", async () => {
    mockPermission = "undetermined";
    const ui = render(<NotificationSettingsScreen />);
    expect(ui.getByText("Not turned on yet")).toBeTruthy();
    expect(ui.queryByTestId("row-push-open-settings")).toBeNull();
    fireEvent.press(ui.getByTestId("row-push-enable"));
    expect(mockEnable).toHaveBeenCalledTimes(1);
  });

  it("after a denial offers Open Device Settings instead of asking again, and explains the saved choices", async () => {
    mockPermission = "denied";
    const ui = render(<NotificationSettingsScreen />);
    expect(ui.queryByTestId("row-push-enable")).toBeNull();
    fireEvent.press(ui.getByTestId("row-push-open-settings"));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(mockEnable).not.toHaveBeenCalled();
    await waitFor(() => expect(ui.getByTestId("notifications-phone-off")).toBeTruthy());
  });

  it("when allowed, shows no fake enable control and points to the phone for sound and banners", async () => {
    const ui = render(<NotificationSettingsScreen />);
    expect(ui.queryByTestId("row-push-enable")).toBeNull();
    expect(ui.queryByTestId("row-push-open-settings")).toBeNull();
    expect(ui.getByText("On")).toBeTruthy();
    fireEvent.press(ui.getByTestId("row-device-settings"));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("offers no sound switch of any kind (the phone owns it)", async () => {
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(ui.queryByTestId("row-notif-sound")).toBeNull();
    expect(ui.queryByText(/sound toggle/i)).toBeNull();
  });
});

describe("policy copy and inbox", () => {
  it("explains mandatory alerts and the hotel policy, and mentions the urgent-task guarantee where it applies", async () => {
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(ui.getByTestId("notifications-policy").props.children).toContain("Important operational alerts may still appear in PatelRep");
    expect(ui.getByTestId("notifications-critical")).toBeTruthy();
  });

  it("keeps the inbox on its own screen, reachable from here, with the unread count", async () => {
    mockUnread = 4;
    const ui = render(<NotificationSettingsScreen />);
    expect(ui.getByText("4 unread")).toBeTruthy();
    fireEvent.press(ui.getByTestId("row-notification-inbox"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/notifications");
  });
});

describe("Spanish", () => {
  it("renders in Spanish with no raw translation keys", async () => {
    mockLanguage = "es";
    const ui = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(ui.getByTestId("row-notif-tasks")).toBeTruthy());
    expect(ui.getByText("Nuevas asignaciones")).toBeTruthy();
    expect(ui.getByText("Actualizaciones de tareas")).toBeTruthy();
    const everyText = ui.UNSAFE_root
      .findAll((node) => typeof node.type === "string" && (node.type as string) === "Text")
      .map((node) => String(node.props.children));
    expect(everyText.filter((text) => text.includes("settings.notifications"))).toEqual([]);
  });

  it("has the same notification keys in English and Spanish", () => {
    const flat = (obj: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(obj).flatMap(([key, value]) =>
        typeof value === "object" && value !== null ? flat(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
      );
    const enKeys = flat((en as { settings: { notifications: Record<string, unknown> } }).settings.notifications).sort();
    const esKeys = flat((es as { settings: { notifications: Record<string, unknown> } }).settings.notifications).sort();
    expect(esKeys).toEqual(enKeys);
  });
});
