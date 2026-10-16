import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Keyboard } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

let mockPath = "/home";
const mockPush = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en", resolvedLanguage: "en" } }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock("expo-router", () => ({
  usePathname: () => mockPath,
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/api/client", () => ({ ApiError: class extends Error {}, api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/lib/auth/secureSessionStorage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

import { AssistantFab } from "@/components/ai/AssistantFab";
import { AssistantProvider, useAssistant, type AssistantApi } from "@/lib/ai/AssistantProvider";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const user = (role: string) => ({ id: "alice", tenant_id: "hotel-a", role }) as unknown as UserProfile;

let assistant: AssistantApi;
function Capture() {
  assistant = useAssistant();
  return null;
}

function renderFab() {
  return render(
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={METRICS}>
        <AssistantProvider>
          <Capture />
          <AssistantFab />
        </AssistantProvider>
      </SafeAreaProvider>
    </ThemeProvider>,
  );
}

function signIn(role: string) {
  act(() => {
    useAppStore.setState({ isOnline: true, isAuthenticated: true });
    useAppStore.getState().setUser(user(role));
    useAppStore.setState({ isAuthenticated: true });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/home";
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true, myRooms: [] });
});

describe("AssistantFab", () => {
  it("shows for a signed-in housekeeper, above the tab bar and the home indicator", () => {
    signIn("housekeeper");
    const screen = renderFab();
    const button = screen.getByTestId("copilot-bubble");
    expect(button).toBeTruthy();
    const style = Array.isArray(button.props.style) ? Object.assign({}, ...button.props.style.flat()) : button.props.style;
    expect(style.bottom).toBeGreaterThanOrEqual(34 + 76);
    expect(button.props.accessibilityLabel).toBe("assistant.fab.label");
    expect(button.props.accessibilityRole).toBe("button");
  });

  it("is not shown to any other role (they keep the corner card)", () => {
    for (const role of ["engineer", "front_desk", "gm", "housekeeping_supervisor"]) {
      signIn(role);
      const screen = renderFab();
      expect(screen.queryByTestId("copilot-bubble")).toBeNull();
      screen.unmount();
    }
  });

  it("is hidden when signed out", () => {
    const screen = renderFab();
    expect(screen.queryByTestId("copilot-bubble")).toBeNull();
  });

  it("never covers room detail's own actions", () => {
    signIn("housekeeper");
    mockPath = "/my-rooms/11111111-1111-4111-8111-111111111111";
    const screen = renderFab();
    expect(screen.queryByTestId("copilot-bubble")).toBeNull();
  });

  it("steps aside for the keyboard and comes back", () => {
    signIn("housekeeper");
    const listeners: Record<string, () => void> = {};
    jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, handler: () => void) => {
      listeners[event] = handler;
      return { remove: jest.fn() };
    }) as never);
    const screen = renderFab();
    expect(screen.queryByTestId("copilot-bubble")).toBeTruthy();
    act(() => listeners.keyboardDidShow?.());
    expect(screen.queryByTestId("copilot-bubble")).toBeNull();
    act(() => listeners.keyboardDidHide?.());
    expect(screen.queryByTestId("copilot-bubble")).toBeTruthy();
  });

  it("a tap opens the compact assistant; a long press opens it on the voice panel without listening", () => {
    signIn("housekeeper");
    const screen = renderFab();
    fireEvent.press(screen.getByTestId("copilot-bubble"));
    expect(assistant.sheetOpen).toBe(true);
    expect(assistant.sheetView).toBe("home");
    expect(screen.queryByTestId("copilot-bubble")).toBeNull();

    act(() => assistant.closeAssistant());
    fireEvent(screen.getByTestId("copilot-bubble"), "longPress");
    expect(assistant.sheetOpen).toBe(true);
    expect(assistant.sheetView).toBe("voice");
  });

  it("rendering it makes no request", () => {
    signIn("housekeeper");
    renderFab();
    const { api } = jest.requireMock("@/lib/api/client");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
});
