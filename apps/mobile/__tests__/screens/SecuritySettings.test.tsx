import React from "react";
import { Platform, Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";

let mockLanguage: "en" | "es" = "en";
let mockMode: "light" | "dark" = "light";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockHasHardware = jest.fn();
const mockIsEnrolled = jest.fn();
const mockSupportedTypes = jest.fn();
const mockAuthenticate = jest.fn();
const mockSupabaseSignOut = jest.fn();
const mockUnregisterPush = jest.fn();
const mockSecure = new Map<string, string>();
let mockSessionSignedIn: string | null = "2026-10-12T15:30:00Z";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage), i18n: { get language() { return mockLanguage; } } }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text: T } = require("react-native");
    return <T>{name}</T>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => mockMode,
  useAppearancePreference: () => ({ preference: "system", mode: mockMode, setPreference: jest.fn(), isHydrated: true }),
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: () => mockBack(),
    canGoBack: () => true,
  },
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.0.0" } } }));
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async (k: string) => (mockSecure.has(k) ? (mockSecure.get(k) as string) : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockSecure.set(k, v);
  }),
}));
jest.mock("expo-local-authentication", () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: (...a: unknown[]) => mockHasHardware(...a),
  isEnrolledAsync: (...a: unknown[]) => mockIsEnrolled(...a),
  supportedAuthenticationTypesAsync: (...a: unknown[]) => mockSupportedTypes(...a),
  authenticateAsync: (...a: unknown[]) => mockAuthenticate(...a),
}));
jest.mock("@/components/housekeeping/roomDetail/BottomSheet", () => ({
  BottomSheet: ({ visible, title, children, footer, testID }: any) => {
    const { View, Text: T } = require("react-native");
    return visible ? (
      <View testID={testID}>
        <T accessibilityRole="header">{title}</T>
        {children}
        {footer}
      </View>
    ) : null;
  },
}));
jest.mock("@/lib/notifications", () => ({ unregisterPushToken: (...a: unknown[]) => mockUnregisterPush(...a) }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: (...a: unknown[]) => mockSupabaseSignOut(...a),
      getSession: () => Promise.resolve({ data: { session: { user: { email: "m@h.com", last_sign_in_at: mockSessionSignedIn } } } }),
    },
  },
}));
jest.mock("@/lib/api/client", () => ({ API_BASE: "x", ApiError: class extends Error {}, api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/stores/appStore", () => {
  const { create } = require("zustand");
  const useAppStore = create((set: any) => ({
    user: { id: "alice", tenant_id: "hotel-1", full_name: "Alice A", role: "housekeeper", language_pref: "en" },
    isAuthenticated: true,
    isOnline: true,
    pendingActions: [],
    unreadCount: 0,
    flushQueue: jest.fn(),
    loadPendingActions: jest.fn(),
    setUser: (user: unknown) => set({ user }),
  }));
  return { useAppStore };
});

import SecurityScreen from "@/app/(app)/profile/security";
import DevicesScreen from "@/app/(app)/profile/devices";
import { SignOutSheet } from "@/components/security/SignOutSheet";
import { AppLockGate } from "@/components/security/AppLockGate";
import { useAppLockStore } from "@/stores/appLockStore";
import { useAppStore } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";

const appStore = useAppStore as unknown as { getState: () => any; setState: (s: object) => void };
const lock = () => useAppLockStore.getState();

function supportFace() {
  mockHasHardware.mockResolvedValue(true);
  mockIsEnrolled.mockResolvedValue(true);
  mockSupportedTypes.mockResolvedValue([2]);
}

async function renderSecurity() {
  const utils = render(<SecurityScreen />);
  // Capability check is async; the switch is disabled until it resolves.
  await waitFor(() => expect(utils.getByTestId("row-biometric").props.accessibilityState.disabled).not.toBe(undefined));
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

beforeEach(async () => {
  mockLanguage = "en";
  mockMode = "light";
  mockSessionSignedIn = "2026-10-12T15:30:00Z";
  Platform.OS = "ios";
  mockSecure.clear();
  [mockToast.success, mockToast.error, mockToast.info, mockPush, mockReplace, mockBack, mockHasHardware, mockIsEnrolled, mockSupportedTypes, mockAuthenticate, mockSupabaseSignOut, mockUnregisterPush].forEach((m) => m.mockReset());
  mockSupabaseSignOut.mockResolvedValue({ error: null });
  mockUnregisterPush.mockResolvedValue(undefined);
  mockAuthenticate.mockResolvedValue({ success: true });
  supportFace();
  appStore.setState({
    user: { id: "alice", tenant_id: "hotel-1", full_name: "Alice A", role: "housekeeper", language_pref: "en" },
    isOnline: true,
    pendingActions: [],
  });
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {} } as never);
  useCleanSessionStore.setState({ scope: null, sessions: {} } as never);
  lock().reset();
  await lock().hydrate("alice");
});

describe("Security & Sign-in screen", () => {
  it.each(["housekeeper", "inspector", "engineer", "housekeeping_supervisor", "front_desk", "gm"])("opens for the %s role with every section", async (role) => {
    appStore.setState({ user: { id: "alice", tenant_id: "hotel-1", full_name: "A", role, language_pref: "en" } });
    const { getByText, getByTestId, queryByTestId } = await renderSecurity();
    expect(getByTestId("settings-title").props.children).toBe("Security & Sign-in");
    expect(getByText("Password")).toBeTruthy();
    expect(getByText("App protection")).toBeTruthy();
    expect(getByText("Device sessions")).toBeTruthy();
    expect(getByText("Account security")).toBeTruthy();
    expect(queryByTestId("settings-not-configured")).toBeNull();
  });

  it("navigates to Change password and Your devices", async () => {
    const { getByTestId } = await renderSecurity();
    fireEvent.press(getByTestId("row-change-password"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/change-password");
    fireEvent.press(getByTestId("row-devices"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/devices");
  });

  it("renders in Spanish and in dark mode", async () => {
    mockLanguage = "es";
    mockMode = "dark";
    const { getByText, getByTestId } = await renderSecurity();
    expect(getByTestId("settings-title").props.children).toBe("Seguridad e inicio de sesión");
    expect(getByText("Bloqueo biométrico")).toBeTruthy();
    expect(getByText("Bloquear tras inactividad")).toBeTruthy();
  });
});

describe("Biometric app lock", () => {
  it("is off by default and explains what it will do before enabling", async () => {
    const { getByTestId, queryByTestId, getByText } = await renderSecurity();
    expect(getByTestId("row-biometric").props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(getByTestId("row-biometric").props.accessibilityLabel).toMatch(/Off — require Face ID to open PatelRep/);
    expect(queryByTestId("biometric-setup")).toBeNull();

    fireEvent.press(getByTestId("row-biometric"));
    expect(getByTestId("biometric-setup")).toBeTruthy();
    expect(getByText("Protect PatelRep with Face ID?")).toBeTruthy();
    expect(getByText(/never shared with PatelRep/)).toBeTruthy();
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(lock().enabled).toBe(false);
  });

  it("only shows enabled after a successful OS challenge, and saves the choice securely", async () => {
    const { getByTestId, queryByTestId } = await renderSecurity();
    fireEvent.press(getByTestId("row-biometric"));
    await act(async () => {
      fireEvent.press(getByTestId("biometric-setup-confirm"));
    });

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockAuthenticate.mock.calls[0][0]).toMatchObject({ disableDeviceFallback: false });
    await waitFor(() => expect(lock().enabled).toBe(true));
    expect(queryByTestId("biometric-setup")).toBeNull();
    expect(mockToast.success).toHaveBeenCalledWith("App lock is on");
    expect(JSON.parse(mockSecure.get("patelrep.applock.v1.alice") as string)).toEqual({ enabled: true, timeoutMs: 60_000 });
    expect(getByTestId("row-biometric").props.accessibilityState.checked).toBe(true);
  });

  it.each([
    [{ success: false, error: "user_cancel" }, "Cancelled. App lock was not turned on."],
    [{ success: false, error: "authentication_failed" }, "We couldn't verify you. Please try again."],
    [{ success: false, error: "not_enrolled" }, "We couldn't verify you. Please try again."],
  ])("does not enable when the challenge ends with %j", async (result, message) => {
    mockAuthenticate.mockResolvedValue(result);
    const { getByTestId, getByText } = await renderSecurity();
    fireEvent.press(getByTestId("row-biometric"));
    await act(async () => {
      fireEvent.press(getByTestId("biometric-setup-confirm"));
    });
    await waitFor(() => expect(getByText(message)).toBeTruthy());
    expect(lock().enabled).toBe(false);
    expect(mockSecure.size).toBe(0);
    expect(getByTestId("biometric-setup")).toBeTruthy();
  });

  it("explains why on an unsupported device and on a device with nothing enrolled", async () => {
    mockHasHardware.mockResolvedValue(false);
    const none = await renderSecurity();
    expect(none.getByTestId("row-biometric").props.accessibilityLabel).toMatch(/Not available on this device/);
    expect(none.getByTestId("row-biometric").props.accessibilityState.disabled).toBe(true);
    none.unmount();

    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);
    const unenrolled = await renderSecurity();
    expect(unenrolled.getByTestId("row-biometric").props.accessibilityLabel).toMatch(/Set up Face ID, a fingerprint or a screen lock/);
    fireEvent.press(unenrolled.getByTestId("row-biometric"));
    expect(unenrolled.queryByTestId("biometric-setup")).toBeNull();
  });

  it("uses platform wording: Touch ID / Fingerprint", async () => {
    mockSupportedTypes.mockResolvedValue([1]);
    const ios = await renderSecurity();
    expect(ios.getByTestId("row-biometric").props.accessibilityLabel).toMatch(/Touch ID/);
    ios.unmount();
    Platform.OS = "android";
    const android = await renderSecurity();
    expect(android.getByTestId("row-biometric").props.accessibilityLabel).toMatch(/Fingerprint/);
  });

  it("requires the same proof to turn the lock off, and keeps it on if cancelled", async () => {
    await lock().setEnabled(true);
    const { getByTestId } = await renderSecurity();
    mockAuthenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    await act(async () => {
      fireEvent.press(getByTestId("row-biometric"));
    });
    expect(lock().enabled).toBe(true);
    expect(mockToast.success).not.toHaveBeenCalled();

    mockAuthenticate.mockResolvedValue({ success: true });
    await act(async () => {
      fireEvent.press(getByTestId("row-biometric"));
    });
    await waitFor(() => expect(lock().enabled).toBe(false));
    expect(mockToast.success).toHaveBeenCalledWith("App lock is off");
  });

  it("lets the person turn the lock off without a challenge if the phone can no longer provide one", async () => {
    await lock().setEnabled(true);
    mockIsEnrolled.mockResolvedValue(false);
    const { getByTestId } = await renderSecurity();
    await act(async () => {
      fireEvent.press(getByTestId("row-biometric"));
    });
    await waitFor(() => expect(lock().enabled).toBe(false));
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});

describe("Lock after inactivity", () => {
  it("is disabled, with an explanation, until app lock is on (no misleading control)", async () => {
    const { getByTestId } = await renderSecurity();
    expect(getByTestId("row-lock-after").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("row-lock-after").props.accessibilityLabel).toMatch(/Turn on app lock to choose when it locks/);
    fireEvent.press(getByTestId("row-lock-after"));
    expect(() => getByTestId("lock-timeout-sheet")).toThrow();
  });

  it("offers Immediately, 1, 5, 15 and 30 minutes with a clear selection and persists the choice", async () => {
    await lock().setEnabled(true);
    const { getByTestId, queryByTestId } = await renderSecurity();
    expect(getByTestId("row-lock-after").props.accessibilityLabel).toMatch(/After 1 minute/);

    fireEvent.press(getByTestId("row-lock-after"));
    for (const ms of [0, 60_000, 300_000, 900_000, 1_800_000]) expect(getByTestId(`lock-timeout-${ms}`)).toBeTruthy();
    expect(getByTestId("lock-timeout-60000").props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId("lock-timeout-300000").props.accessibilityState).toEqual({ selected: false });

    await act(async () => {
      fireEvent.press(getByTestId("lock-timeout-900000"));
    });
    expect(lock().timeoutMs).toBe(900_000);
    expect(JSON.parse(mockSecure.get("patelrep.applock.v1.alice") as string).timeoutMs).toBe(900_000);
    expect(queryByTestId("lock-timeout-sheet")).toBeNull();
    expect(getByTestId("row-lock-after").props.accessibilityLabel).toMatch(/After 15 minutes/);
  });

  it("supports Immediately", async () => {
    await lock().setEnabled(true);
    const { getByTestId } = await renderSecurity();
    fireEvent.press(getByTestId("row-lock-after"));
    await act(async () => {
      fireEvent.press(getByTestId("lock-timeout-0"));
    });
    expect(lock().timeoutMs).toBe(0);
    expect(getByTestId("row-lock-after").props.accessibilityLabel).toMatch(/Immediately/);
  });
});

describe("Sign out of other devices", () => {
  it("asks first, explains this phone stays signed in, then revokes other sessions through Supabase", async () => {
    const { getByTestId, getByText, queryByTestId } = await renderSecurity();
    fireEvent.press(getByTestId("row-signout-others"));
    expect(getByText(/You'll stay signed in on this phone/)).toBeTruthy();
    expect(mockSupabaseSignOut).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId("signout-others-confirm"));
    });
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mockToast.success).toHaveBeenCalledWith("Other devices were signed out");
    expect(queryByTestId("signout-others")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not claim success if the provider refuses", async () => {
    mockSupabaseSignOut.mockResolvedValue({ error: { status: 500, message: "boom" } });
    const { getByTestId } = await renderSecurity();
    fireEvent.press(getByTestId("row-signout-others"));
    await act(async () => {
      fireEvent.press(getByTestId("signout-others-confirm"));
    });
    await waitFor(() => expect(getByTestId("signout-others-error").props.children).toBe("We couldn't sign out your other devices. Please try again."));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(getByTestId("signout-others")).toBeTruthy();
  });

  it("is unavailable offline", async () => {
    appStore.setState({ isOnline: false });
    const { getByTestId } = await renderSecurity();
    expect(getByTestId("row-signout-others").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("row-signout-others").props.accessibilityLabel).toMatch(/Connect to the internet/);
  });

  it("cancel closes without calling the provider", async () => {
    const { getByTestId, queryByTestId } = await renderSecurity();
    fireEvent.press(getByTestId("row-signout-others"));
    fireEvent.press(getByTestId("signout-others-cancel"));
    expect(queryByTestId("signout-others")).toBeNull();
    expect(mockSupabaseSignOut).not.toHaveBeenCalled();
  });
});

describe("Your devices", () => {
  it("shows only what is true about this phone and never invents other devices", () => {
    const { getByTestId, getByText, queryByText } = render(<DevicesScreen />);
    expect(getByTestId("current-device")).toBeTruthy();
    expect(getByText("This device")).toBeTruthy();
    expect(getByText("Current")).toBeTruthy();
    expect(getByTestId("device-platform").props.children).toMatch(/^iOS .* · PatelRep v1\.0\.0$/);
    expect(getByTestId("devices-note").props.children).toMatch(/can't list your other devices/);
    expect(queryByText(/iPhone|Pixel|Galaxy|Last active/i)).toBeNull();
  });

  it("shows the real sign-in time from the session", async () => {
    const { findByTestId } = render(<DevicesScreen />);
    const line = await findByTestId("device-signed-in");
    expect(line.props.children).toMatch(/^Signed in Oct 12, 2026/);
  });

  it("omits the time when the session has none", async () => {
    mockSessionSignedIn = null;
    const { queryByTestId } = render(<DevicesScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByTestId("device-signed-in")).toBeNull();
  });

  it("signs out other devices after confirmation", async () => {
    const { getByTestId } = render(<DevicesScreen />);
    fireEvent.press(getByTestId("devices-signout-others"));
    await act(async () => {
      fireEvent.press(getByTestId("devices-others-confirm"));
    });
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: "others" });
  });
});

describe("Sign out sheet", () => {
  const seedAliceWork = () => {
    appStore.setState({
      pendingActions: [
        { id: "a1", type: "room_status", entityId: "r1", payload: {}, createdAt: "2026-10-01T10:00:00Z", owner: "hotel-1:alice" },
        { id: "a2", type: "room_status", entityId: "r2", payload: {}, createdAt: "2026-10-01T11:00:00Z", owner: "hotel-1:alice" },
        { id: "a3", type: "work_order_update", entityId: "w1", payload: {}, createdAt: "2026-10-01T12:00:00Z", owner: "hotel-1:alice" },
      ],
    });
    useTaskOutbox.setState({
      scope: "hotel-1:alice",
      entries: { t1: { taskId: "t1", state: "conflict", queuedAt: "2026-10-01T09:00:00Z", userId: "alice", tenantId: "hotel-1" } },
    } as never);
    useCleanSessionStore.setState({
      scope: "hotel-1:alice",
      sessions: { r9: { roomId: "r9", startConfirmed: false, pendingItems: {}, startedAt: "2026-10-01T08:00:00Z", conflict: null, lastError: null } },
    } as never);
  };

  it("with nothing unsynced: explains local sign-out and shows no warning", () => {
    const { getByText, queryByTestId } = render(<SignOutSheet visible onClose={jest.fn()} />);
    expect(getByText("Sign out of this phone?")).toBeTruthy();
    expect(getByText("You'll be signed out on this phone only. Your other devices stay signed in.")).toBeTruthy();
    expect(queryByTestId("signout-unsynced")).toBeNull();
  });

  it("lists only genuinely pending work by category and says what happens to it", () => {
    seedAliceWork();
    const { getByTestId, getByText, queryByTestId } = render(<SignOutSheet visible onClose={jest.fn()} />);
    expect(getByText("5 change(s) not synced yet")).toBeTruthy();
    expect(getByTestId("unsynced-roomUpdates")).toBeTruthy();
    expect(getByTestId("unsynced-workOrders")).toBeTruthy();
    expect(getByTestId("unsynced-taskCompletions")).toBeTruthy();
    expect(getByTestId("unsynced-cleaningSessions")).toBeTruthy();
    expect(queryByTestId("unsynced-logbook")).toBeNull();
    expect(getByText(/stay saved on this phone under your account/)).toBeTruthy();
    expect(getByText(/won't sync while you're signed out/)).toBeTruthy();
    expect(getByText("1 need(s) attention", { exact: false })).toBeTruthy();
    expect(getByTestId("signout-confirm").props.accessibilityLabel).toBe("Sign out anyway");
  });

  it("does not show another employee's saved work to the next person on a shared phone", () => {
    seedAliceWork();
    appStore.setState({ user: { id: "bob", tenant_id: "hotel-1", full_name: "Bob B", role: "engineer", language_pref: "en" } });
    const { queryByTestId } = render(<SignOutSheet visible onClose={jest.fn()} />);
    // The stores may still hold Alice's data in memory; Bob sees none of it.
    expect(queryByTestId("signout-unsynced")).toBeNull();
  });

  it("opens the categorized details drawer and closes it back to the confirmation", () => {
    seedAliceWork();
    const { getByTestId, queryByTestId } = render(<SignOutSheet visible onClose={jest.fn()} />);
    fireEvent.press(getByTestId("signout-details"));
    expect(getByTestId("unsynced-sheet")).toBeTruthy();
    expect(queryByTestId("signout-sheet")).toBeNull();
    fireEvent.press(getByTestId("unsynced-close"));
    expect(getByTestId("signout-sheet")).toBeTruthy();
  });

  it("signs out this device only: detaches push first, keeps queued work on disk, resets in-memory state", async () => {
    seedAliceWork();
    await lock().setEnabled(true);
    const onClose = jest.fn();
    const { getByTestId } = render(<SignOutSheet visible onClose={onClose} />);
    await act(async () => {
      fireEvent.press(getByTestId("signout-confirm"));
    });

    expect(mockUnregisterPush).toHaveBeenCalledTimes(1);
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockUnregisterPush.mock.invocationCallOrder[0]).toBeLessThan(mockSupabaseSignOut.mock.invocationCallOrder[0]);
    expect(useCleanSessionStore.getState().sessions).toEqual({});
    expect(useCleanSessionStore.getState().scope).toBeNull();
    expect(lock().enabled).toBe(false);
    expect(lock().locked).toBe(false);
    // The queued actions were not deleted by signing out.
    expect(appStore.getState().pendingActions).toHaveLength(3);
    expect(onClose).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
  });

  it("still signs out if detaching the push token fails (best effort)", async () => {
    mockUnregisterPush.mockRejectedValue(new Error("offline"));
    const { getByTestId } = render(<SignOutSheet visible onClose={jest.fn()} />);
    await act(async () => {
      fireEvent.press(getByTestId("signout-confirm"));
    });
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
  });

  it("stays open with a safe message if the provider fails, and Cancel never signs out", async () => {
    mockSupabaseSignOut.mockResolvedValue({ error: { status: 500, message: "internal" } });
    const onClose = jest.fn();
    const { getByTestId } = render(<SignOutSheet visible onClose={onClose} />);
    await act(async () => {
      fireEvent.press(getByTestId("signout-confirm"));
    });
    await waitFor(() => expect(getByTestId("signout-error").props.children).toBe("We couldn't sign you out. Please try again."));
    expect(mockReplace).not.toHaveBeenCalled();

    mockSupabaseSignOut.mockClear();
    fireEvent.press(getByTestId("signout-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(mockSupabaseSignOut).not.toHaveBeenCalled();
  });

  it("warns that work cannot sync while signed out when the phone is offline", () => {
    seedAliceWork();
    appStore.setState({ isOnline: false });
    const { getByText } = render(<SignOutSheet visible onClose={jest.fn()} />);
    expect(getByText(/You're offline right now\./)).toBeTruthy();
  });

  it("renders in Spanish", () => {
    mockLanguage = "es";
    seedAliceWork();
    const { getByText } = render(<SignOutSheet visible onClose={jest.fn()} />);
    expect(getByText("¿Cerrar sesión en este teléfono?")).toBeTruthy();
    expect(getByText("5 cambio(s) sin sincronizar")).toBeTruthy();
    expect(getByText("Cerrar sesión de todos modos")).toBeTruthy();
  });
});

describe("App lock gate and lock screen", () => {
  const Secret = () => <Text testID="secret">Room 412 · Guest: Jane Doe</Text>;

  it("renders nothing extra while unlocked", () => {
    const { getByTestId, queryByTestId } = render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    expect(getByTestId("secret")).toBeTruthy();
    expect(queryByTestId("lock-screen")).toBeNull();
    expect(queryByTestId("privacy-cover")).toBeNull();
  });

  it("covers the app, hides it from screen readers, and offers the OS prompt once automatically", async () => {
    await lock().setEnabled(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    lock().lock();
    const { getByTestId, getByText, queryByText } = render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    expect(getByTestId("lock-screen")).toBeTruthy();
    expect(getByText("PatelRep is locked")).toBeTruthy();
    // The lock screen itself exposes no names, rooms or guests.
    expect(queryByText(/Jane Doe|Room 412/)).toBeNull();

    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId("lock-message").props.children).toBe("Unlock cancelled. Tap Unlock to try again."));
    // Cancelling does not loop: still exactly one prompt until the person asks again.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(lock().locked).toBe(true);
  });

  it("unlocks only after the OS confirms", async () => {
    await lock().setEnabled(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    lock().lock();
    const { getByTestId, queryByTestId } = render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledTimes(1));

    mockAuthenticate.mockResolvedValue({ success: true });
    await act(async () => {
      fireEvent.press(getByTestId("lock-unlock"));
    });
    await waitFor(() => expect(lock().locked).toBe(false));
    expect(queryByTestId("lock-screen")).toBeNull();
    expect(getByTestId("secret")).toBeTruthy();
  });

  it.each([
    [{ success: false, error: "authentication_failed" }, "We couldn't verify you. Tap Unlock to try again."],
    [{ success: false, error: "not_enrolled" }, "This phone has no biometrics or passcode set up for unlocking. Sign out and sign in again to continue."],
    [{ success: false, error: "passcode_not_set" }, "This phone has no biometrics or passcode set up for unlocking. Sign out and sign in again to continue."],
  ])("shows a way out for %j without trapping the person", async (result, message) => {
    await lock().setEnabled(true);
    mockAuthenticate.mockResolvedValue(result);
    lock().lock();
    const { getByTestId } = render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    await waitFor(() => expect(getByTestId("lock-message").props.children).toBe(message));
    expect(lock().locked).toBe(true);
    // Sign out is always available.
    fireEvent.press(getByTestId("lock-signout"));
    expect(getByTestId("signout-sheet")).toBeTruthy();
  });

  it("signing out from the lock screen goes through the same confirmation and clears the lock", async () => {
    await lock().setEnabled(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    lock().lock();
    const { getByTestId } = render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalled());
    fireEvent.press(getByTestId("lock-signout"));
    await act(async () => {
      fireEvent.press(getByTestId("signout-confirm"));
    });
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(lock().locked).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
  });

  it("shows an opaque privacy cover (not the lock UI) while merely obscured", async () => {
    await lock().setEnabled(true);
    act(() => lock().onInactive());
    const { getByTestId, queryByTestId } = render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    expect(getByTestId("privacy-cover")).toBeTruthy();
    expect(queryByTestId("lock-screen")).toBeNull();
  });

  it("does not interfere with the underlying app state or session while locked", async () => {
    await lock().setEnabled(true);
    lock().lock();
    appStore.setState({ pendingActions: [{ id: "a1", type: "room_status", entityId: "r", payload: {}, createdAt: "x", owner: "hotel-1:alice" }] });
    render(
      <AppLockGate>
        <Secret />
      </AppLockGate>,
    );
    expect(appStore.getState().isAuthenticated).toBe(true);
    expect(appStore.getState().pendingActions).toHaveLength(1);
    expect(mockSupabaseSignOut).not.toHaveBeenCalled();
  });
});
