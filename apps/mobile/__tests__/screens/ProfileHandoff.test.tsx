import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const EN: Record<string, string> = {
  "profile.me": "Me",
  "profile.preferences": "Preferences",
  "profile.language": "Language",
  "profile.notifications": "Notifications",
  "profile.notificationsUnread": "{{count}} unread",
  "profile.myWork": "My work",
  "profile.schedule": "My schedule",
  "profile.sopLibrary": "SOP Library",
  "profile.dataSync": "Data & sync",
  "profile.offlineChanges": "Offline changes",
  "profile.upToDate": "Up to date",
  "profile.pendingChanges": "{{count}} waiting to sync",
  "profile.syncNow": "Sync now",
  "profile.connection.online": "Online — everything is synced",
  "profile.connection.offline": "Offline — your changes are saved and will sync later",
  "profile.connection.pending": "Online — {{count}} change(s) syncing soon",
  "profile.account": "Account",
  "profile.signOut": "Sign out",
  "profile.signOutTitle": "Sign out",
  "profile.signOutConfirm": "Are you sure?",
  "staff.roles.housekeeper": "Housekeeper",
  "common.cancel": "Cancel",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));
    },
  }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

jest.mock("@/i18n", () => ({
  language: "en",
  changeLanguage: jest.fn(),
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
    get: jest.fn().mockResolvedValue({ data: { name: "Lone Star Inn" } }),
  },
}));

const mockFlushQueue = jest.fn().mockResolvedValue(undefined);

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    user: {
      id: "user-1",
      full_name: "Maria Vega",
      role: "housekeeper",
      tenant_id: "hotel-1",
      language_pref: "en",
    },
    isOnline: true,
    pendingActions: [
      { id: "a-1", type: "room_status", entityId: "r-1", payload: {}, createdAt: "2026-06-11" },
      { id: "a-2", type: "task_complete", entityId: "t-1", payload: {}, createdAt: "2026-06-11" },
    ],
    flushQueue: mockFlushQueue,
    unreadCount: 3,
  }),
}));

import ProfileScreen from "@/app/(app)/profile";

describe("ProfileScreen settings redesign", () => {
  it("renders identity hero, grouped settings, sync state, and sign out — no fake stats", async () => {
    const { getByText, getByTestId, queryByText } = render(<ProfileScreen />);

    // Identity hero: name, translated role chip, hotel (loaded from API), connection state
    expect(getByText("Maria Vega")).toBeTruthy();
    expect(getByText("Housekeeper")).toBeTruthy();
    await waitFor(() => expect(getByText("Lone Star Inn")).toBeTruthy());
    expect(getByText("Online — 2 change(s) syncing soon")).toBeTruthy();

    // Preferences: language segmented control + notifications row with unread count
    expect(getByText("Preferences")).toBeTruthy();
    expect(getByTestId("language-en")).toBeTruthy();
    expect(getByTestId("language-es")).toBeTruthy();
    expect(getByText("English")).toBeTruthy();
    expect(getByText("Español")).toBeTruthy();
    expect(getByText("Notifications")).toBeTruthy();
    expect(getByText("3 unread")).toBeTruthy();

    // My work shortcuts navigate to real hidden routes
    expect(getByText("My schedule")).toBeTruthy();
    expect(getByText("SOP Library")).toBeTruthy();
    fireEvent.press(getByTestId("row-schedule"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/scheduling");
    fireEvent.press(getByTestId("row-sop"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/sop");

    // Data & sync: pending queue surfaced with a working Sync now action
    expect(getByText("Offline changes")).toBeTruthy();
    expect(getByText("2 waiting to sync")).toBeTruthy();
    fireEvent.press(getByTestId("sync-now"));
    await waitFor(() => expect(mockFlushQueue).toHaveBeenCalled());

    // Account + honest version footer
    expect(getByText("Sign out")).toBeTruthy();
    expect(getByText("PatelRep v1.0.0")).toBeTruthy();

    // The fake handoff data is gone
    expect(queryByText("128")).toBeNull();
    expect(queryByText("Top pace")).toBeNull();
    expect(queryByText("Pay & hours")).toBeNull();
    expect(queryByText(/build 1182/)).toBeNull();
  });
});
