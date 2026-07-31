import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

let mockLanguage = "en";
let mockPreference: "system" | "light" | "dark" = "system";
const mockSetPreference = jest.fn().mockResolvedValue(undefined);

const mockEn: Record<string, string> = {
  "profile.me": "Me",
  "profile.preferences": "Preferences",
  "profile.language": "Language",
  "profile.appearance.label": "Appearance",
  "profile.appearance.system": "System",
  "profile.appearance.light": "Light",
  "profile.appearance.dark": "Dark",
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

const mockEs: Record<string, string> = {
  ...mockEn,
  "profile.me": "Yo",
  "profile.preferences": "Preferencias",
  "profile.language": "Idioma",
  "profile.appearance.label": "Apariencia",
  "profile.appearance.system": "Sistema",
  "profile.appearance.light": "Claro",
  "profile.appearance.dark": "Oscuro",
  "profile.notifications": "Notificaciones",
  "profile.notificationsUnread": "{{count}} sin leer",
  "profile.myWork": "Mi trabajo",
  "profile.schedule": "Mi horario",
  "profile.sopLibrary": "Biblioteca SOP",
  "profile.dataSync": "Datos y sincronización",
  "profile.offlineChanges": "Cambios sin conexión",
  "profile.upToDate": "Al día",
  "profile.pendingChanges": "{{count}} por sincronizar",
  "profile.syncNow": "Sincronizar",
  "profile.connection.online": "En línea — todo está sincronizado",
  "profile.connection.offline": "Sin conexión — tus cambios se sincronizarán después",
  "profile.connection.pending": "En línea — {{count}} cambio(s) por sincronizar",
  "profile.account": "Cuenta",
  "profile.signOut": "Cerrar sesión",
  "profile.signOutTitle": "Cerrar sesión",
  "profile.signOutConfirm": "¿Estás seguro?",
  "staff.roles.housekeeper": "Ama de llaves",
  "common.cancel": "Cancelar",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const messages = mockLanguage === "es" ? mockEs : mockEn;
      const template = messages[key] ?? key;
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

jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => "light",
  useAppearancePreference: () => ({
    preference: mockPreference,
    mode: "light",
    setPreference: mockSetPreference,
    isHydrated: true,
  }),
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
  get language() {
    return mockLanguage;
  },
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
  beforeEach(() => {
    mockLanguage = "en";
    mockPreference = "system";
    mockSetPreference.mockClear();
  });

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

  it("does not expose the English language name while Spanish is active", async () => {
    mockLanguage = "es";
    const { getByText, queryByText } = render(<ProfileScreen />);

    await waitFor(() => expect(getByText("Ingl\u00e9s")).toBeTruthy());
    expect(getByText("Espa\u00f1ol")).toBeTruthy();
    expect(queryByText("English")).toBeNull();
  });

  it("exposes immediate System, Light, and Dark radio choices with 44pt targets", async () => {
    const { getByRole, getByTestId, getByText } = render(<ProfileScreen />);
    await waitFor(() => expect(getByText("Lone Star Inn")).toBeTruthy());

    const group = getByTestId("appearance-segmented");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    expect(group.props.accessibilityLabel).toBe("Appearance");

    const choices = [
      { label: "System", value: "system", selected: true },
      { label: "Light", value: "light", selected: false },
      { label: "Dark", value: "dark", selected: false },
    ] as const;

    for (const choice of choices) {
      const radio = getByRole("radio", { name: choice.label });
      expect(radio.props.accessibilityState).toEqual({ selected: choice.selected });
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);

      fireEvent.press(getByTestId(`appearance-${choice.value}`));
    }

    expect(mockSetPreference).toHaveBeenNthCalledWith(1, "system");
    expect(mockSetPreference).toHaveBeenNthCalledWith(2, "light");
    expect(mockSetPreference).toHaveBeenNthCalledWith(3, "dark");
  });

  it("keeps neighboring Profile controls radio-semantic and at least 44pt", async () => {
    const { getByRole, getByTestId, getByText } = render(<ProfileScreen />);
    await waitFor(() => expect(getByText("Lone Star Inn")).toBeTruthy());

    const english = getByRole("radio", { name: "English" });
    const spanish = getByRole("radio", { name: "Espa\u00f1ol" });
    expect(english.props.accessibilityState).toEqual({ selected: true });
    expect(spanish.props.accessibilityState).toEqual({ selected: false });
    expect(StyleSheet.flatten(english.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(spanish.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const bellStyle = StyleSheet.flatten(getByTestId("profile-bell").props.style);
    expect(bellStyle.width).toBeGreaterThanOrEqual(44);
    expect(bellStyle.height).toBeGreaterThanOrEqual(44);
  });

  it("renders distinct Spanish appearance choices without English fallback", async () => {
    mockLanguage = "es";
    const { getByRole, getByText, queryByText } = render(<ProfileScreen />);
    await waitFor(() => expect(getByText("Lone Star Inn")).toBeTruthy());

    expect(getByText("Apariencia")).toBeTruthy();
    expect(getByRole("radio", { name: "Sistema" })).toBeTruthy();
    expect(getByRole("radio", { name: "Claro" })).toBeTruthy();
    expect(getByRole("radio", { name: "Oscuro" })).toBeTruthy();
    expect(queryByText("System")).toBeNull();
    expect(queryByText("Light")).toBeNull();
    expect(queryByText("Dark")).toBeNull();
  });
});
