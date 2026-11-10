import React from "react";
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { darkThemeV2, lightThemeV2 } from "@/components/shared/tokensV2";

let mockMode: "light" | "dark" = "light";
const mockSignInWithPassword = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockPush = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => "en") }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text } = require("react-native");
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      ReactRuntime.createElement(Text, { testID: `icon-${name}`, style: { color } }, name),
  };
});
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  Stack: () => {
    const { Text } = require("react-native");
    const { useIsDesignV2 } = require("@/lib/design/DesignV2Scope");
    return require("react").createElement(Text, { testID: "stack-probe" }, String(useIsDesignV2()));
  },
  useLocalSearchParams: () => ({}),
}));
jest.mock("@/stores/appLockStore", () => ({
  useAppLockStore: { getState: () => ({ markFreshSignIn: jest.fn() }) },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ isAuthenticated: false, isLoading: false }),
}));
jest.mock("@/lib/auth/recoveryStore", () => ({
  useRecoveryStore: (sel: (s: unknown) => unknown) => sel({ pending: false }),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => mockSignInWithPassword(...a),
      signInWithOtp: (...a: unknown[]) => mockSignInWithOtp(...a),
    },
  },
}));

import LoginScreen from "@/app/(auth)/login";
import ForgotPasswordScreen from "@/app/(auth)/forgot-password";
import AuthLayout from "@/app/(auth)/_layout";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";

const flat = (node: { props: Record<string, unknown> }) =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>) as ViewStyle & TextStyle;

function scoped(ui: React.ReactElement) {
  return render(<DesignV2Scope>{ui}</DesignV2Scope>);
}

beforeEach(() => {
  mockMode = "light";
  mockSignInWithPassword.mockReset().mockResolvedValue({ error: null });
  mockSignInWithOtp.mockReset().mockResolvedValue({ error: null });
  mockPush.mockReset();
});

describe("Login (V2 preview)", () => {
  it("uses the V2 presentation: slate logo tile, no uppercase eyebrow, system-bold heading", () => {
    const u = scoped(<LoginScreen />);
    expect(flat(u.getByTestId("login-screen")).backgroundColor).toBe(lightThemeV2.background);
    expect(flat(u.getByTestId("login-logo-mark")).backgroundColor).toBe(lightThemeV2.shell.bg);
    expect(u.queryByText("Sign in")).toBeNull();
    const title = flat(u.getByText("Welcome back."));
    expect(title.fontFamily).toBeUndefined();
    expect(title.fontWeight).toBe("700");
    expect(u.getByRole("header")).toBeTruthy();
  });

  it("has visible labels, 52pt controls and the V2 primary color", () => {
    const u = scoped(<LoginScreen />);
    // A visible label above each field (the placeholder alone is not a label).
    expect(u.getAllByText("Email address")).toHaveLength(1);
    expect(u.getAllByText("Password")).toHaveLength(1);
    const submit = flat(u.getByTestId("login-submit"));
    expect(submit.minHeight).toBeGreaterThanOrEqual(48);
    expect(submit.backgroundColor).toBe(lightThemeV2.primaryAction);
    expect(flat(u.getByTestId("login-mode-toggle")).minHeight).toBeGreaterThanOrEqual(48);
  });

  it("follows dark mode", () => {
    mockMode = "dark";
    const u = scoped(<LoginScreen />);
    expect(flat(u.getByTestId("login-screen")).backgroundColor).toBe(darkThemeV2.background);
    expect(flat(u.getByTestId("login-submit")).backgroundColor).toBe(darkThemeV2.primaryAction);
  });

  it("still signs in with a password, shows classified errors and switches to the email link", async () => {
    const u = scoped(<LoginScreen />);
    fireEvent.changeText(u.getByTestId("email-input"), "Staff@Example.com ");
    fireEvent.changeText(u.getByTestId("password-input"), "pw-123456");
    await act(async () => {
      fireEvent.press(u.getByTestId("login-submit"));
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: "staff@example.com", password: "pw-123456" });

    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials", status: 400 } });
    await act(async () => {
      fireEvent.press(u.getByTestId("login-submit"));
    });
    await waitFor(() => expect(u.getByTestId("login-error")).toBeTruthy());

    fireEvent.press(u.getByTestId("login-mode-toggle"));
    await act(async () => {
      fireEvent.press(u.getByTestId("login-submit"));
    });
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) }),
    );
    expect(u.getByTestId("login-link-sent")).toBeTruthy();
  });

  it("keeps the forgot-password route and the empty-field validation", async () => {
    const u = scoped(<LoginScreen />);
    fireEvent.press(u.getByTestId("login-forgot"));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/(auth)/forgot-password" }));
    await act(async () => {
      fireEvent.press(u.getByTestId("login-submit"));
    });
    expect(u.getByTestId("login-field-error")).toBeTruthy();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("reveals the password with a named toggle", () => {
    const u = scoped(<LoginScreen />);
    expect(u.getByTestId("password-input").props.secureTextEntry).toBe(true);
    fireEvent.press(u.getByTestId("password-input-toggle"));
    expect(u.getByTestId("password-input").props.secureTextEntry).toBe(false);
  });
});

describe("Other auth screens", () => {
  it("Forgot password takes the V2 frame (labelled field, 44pt back, V2 surface)", () => {
    const u = scoped(<ForgotPasswordScreen />);
    expect(flat(u.getByTestId("forgot-screen")).backgroundColor).toBe(lightThemeV2.background);
    expect(flat(u.getByTestId("auth-back")).width).toBeGreaterThanOrEqual(44);
    expect(u.getAllByText("Email address")).toHaveLength(1);
  });

  it("the (auth) layout renders its stack V2 with no flag or scope, without touching routing", () => {
    const u = render(<AuthLayout />);
    expect(u.getByTestId("stack-probe").props.children).toBe("true");
  });
});
