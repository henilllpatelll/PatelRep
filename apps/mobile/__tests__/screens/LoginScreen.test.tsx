import React from "react";
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { darkTheme, lightTheme, type ThemeMode } from "@/components/shared/tokens";

let mockLanguage: "en" | "es" = "en";
let mockThemeMode: ThemeMode = "light";
const mockSignInWithPassword = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockPush = jest.fn();
const mockMarkFresh = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage) }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockThemeMode }));
jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text } = require("react-native");
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      ReactRuntime.createElement(Text, { testID: `icon-${name}`, style: { color } }, name),
  };
});
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock("@/stores/appLockStore", () => ({
  useAppLockStore: { getState: () => ({ markFreshSignIn: mockMarkFresh }) },
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

function style(node: { props: Record<string, unknown> }) {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>) as ViewStyle & TextStyle;
}

function fill(utils: ReturnType<typeof render>, email = "staff@example.com", password?: string) {
  fireEvent.changeText(utils.getByPlaceholderText("Email address"), email);
  if (password !== undefined) fireEvent.changeText(utils.getByPlaceholderText("Password"), password);
}

beforeEach(() => {
  mockLanguage = "en";
  mockThemeMode = "light";
  mockSignInWithPassword.mockReset().mockResolvedValue({ error: null });
  mockSignInWithOtp.mockReset().mockResolvedValue({ error: null });
  mockPush.mockReset();
  mockMarkFresh.mockReset();
});

describe("Login: honest copy and structure", () => {
  it("uses neutral branding, no hardcoded property and no phone sign-in", () => {
    const { queryByText, getByText, getAllByTestId } = render(<LoginScreen />);
    expect(getByText("Staff sign-in")).toBeTruthy();
    expect(queryByText(/Lone Star/i)).toBeNull();
    expect(queryByText(/phone/i)).toBeNull();
    expect(getByText("Email me a sign-in link instead")).toBeTruthy();
    expect(getAllByTestId("icon-mail-outline").length).toBeGreaterThan(0);
  });

  it("shows invitation guidance as plain text with nothing that looks clickable", () => {
    const { getByTestId, queryByText, queryByTestId } = render(<LoginScreen />);
    const invite = getByTestId("login-invite");
    expect(invite.props.children).toBe("New employee? Ask your hotel administrator for an invitation.");
    expect(invite.props.onPress).toBeUndefined();
    expect(invite.props.accessibilityRole).toBeUndefined();
    expect(queryByText("Get the invite link")).toBeNull();
    expect(queryByTestId("login-invite-link")).toBeNull();
  });

  it("configures the fields for password managers and the right keyboard", () => {
    const { getByTestId } = render(<LoginScreen />);
    const email = getByTestId("email-input");
    expect(email.props.autoComplete).toBe("email");
    expect(email.props.textContentType).toBe("emailAddress");
    expect(email.props.keyboardType).toBe("email-address");
    expect(email.props.autoCapitalize).toBe("none");
    const password = getByTestId("password-input");
    expect(password.props.autoComplete).toBe("current-password");
    expect(password.props.textContentType).toBe("password");
    expect(password.props.secureTextEntry).toBe(true);
  });

  it("toggles password visibility with an accessible control", () => {
    const { getByTestId } = render(<LoginScreen />);
    const toggle = getByTestId("password-input-toggle");
    expect(toggle.props.accessibilityLabel).toBe("Show password");
    fireEvent.press(toggle);
    expect(getByTestId("password-input").props.secureTextEntry).toBe(false);
    expect(getByTestId("password-input-toggle").props.accessibilityLabel).toBe("Hide password");
  });

  it("Forgot password is a real destination and carries the typed email", () => {
    const utils = render(<LoginScreen />);
    fill(utils, "  Staff@Example.com ");
    fireEvent.press(utils.getByTestId("login-forgot"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/(auth)/forgot-password", params: { email: "staff@example.com" } });
  });
});

describe("Login: password sign-in", () => {
  it("normalises the email and signs in with exactly the entered password", async () => {
    const utils = render(<LoginScreen />);
    fill(utils, "  Staff@Example.COM ", "  Pa ss word  ");
    fireEvent.press(utils.getByTestId("login-submit"));
    await waitFor(() =>
      expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: "staff@example.com", password: "  Pa ss word  " }),
    );
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(mockMarkFresh).toHaveBeenCalledTimes(1);
  });

  it("validates before calling the server", () => {
    const utils = render(<LoginScreen />);
    fireEvent.press(utils.getByTestId("login-submit"));
    expect(utils.getByText("Enter your email address.")).toBeTruthy();

    fill(utils, "not-an-email", "pw");
    fireEvent.press(utils.getByTestId("login-submit"));
    expect(utils.getByText("Enter a valid email address.")).toBeTruthy();

    fill(utils, "ok@example.com", "");
    fireEvent.press(utils.getByTestId("login-submit"));
    expect(utils.getByText("Enter your password.")).toBeTruthy();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions while a request is in flight and shows a busy state", async () => {
    let resolve: (v: { error: null }) => void = () => undefined;
    mockSignInWithPassword.mockReturnValue(new Promise((r) => (resolve = r)));
    const utils = render(<LoginScreen />);
    fill(utils, "staff@example.com", "secret");
    fireEvent.press(utils.getByTestId("login-submit"));
    fireEvent.press(utils.getByTestId("login-submit"));
    fireEvent.press(utils.getByTestId("login-submit"));

    await waitFor(() => expect(utils.getByTestId("login-submit").props.accessibilityState).toEqual({ disabled: true, busy: true }));
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ error: null }));
    await waitFor(() => expect(utils.getByTestId("login-submit").props.accessibilityState).toEqual({ disabled: false, busy: false }));
  });

  it.each([
    [{ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, "That email or password isn't right. Please try again."],
    [{ code: "over_request_rate_limit", status: 429, message: "x" }, "Too many attempts. Please wait a few minutes and try again."],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch" }, "Can't reach the server. Check your connection and try again."],
    [{ message: "internal stack trace at line 42" }, "We couldn't sign you in. Please try again."],
  ])("shows a friendly message for %j and never the raw provider text", async (error, expected) => {
    mockSignInWithPassword.mockResolvedValue({ error });
    const utils = render(<LoginScreen />);
    fill(utils, "staff@example.com", "wrong");
    fireEvent.press(utils.getByTestId("login-submit"));
    await waitFor(() => expect(utils.getByText(expected)).toBeTruthy());
    expect(utils.queryByText(/stack trace/)).toBeNull();
    expect(mockMarkFresh).not.toHaveBeenCalled();
  });
});

describe("Login: email sign-in link", () => {
  it("labels the method honestly, keeps the typed email when switching, and never creates accounts", async () => {
    const utils = render(<LoginScreen />);
    fill(utils, "Staff@Example.com", "typed-password");
    fireEvent.press(utils.getByTestId("login-mode-toggle"));

    expect(utils.getByText("Email me a sign-in link")).toBeTruthy();
    expect(utils.getByText("Sign in with password instead")).toBeTruthy();
    expect(utils.getByPlaceholderText("Email address").props.value).toBe("Staff@Example.com");
    expect(utils.queryByPlaceholderText("Password")).toBeNull();
    expect(utils.queryByTestId("login-forgot")).toBeNull();

    fireEvent.press(utils.getByTestId("login-submit"));
    await waitFor(() =>
      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: "staff@example.com",
        options: { emailRedirectTo: "patelrep://auth/callback", shouldCreateUser: false },
      }),
    );
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(utils.getByTestId("login-link-sent").props.children).toMatch(/If that email belongs to a PatelRep account/);
  });

  it("answers an unknown address exactly like a known one (no account discovery)", async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } });
    const utils = render(<LoginScreen />);
    fireEvent.press(utils.getByTestId("login-mode-toggle"));
    fill(utils, "nobody@example.com");
    fireEvent.press(utils.getByTestId("login-submit"));
    await waitFor(() => expect(utils.getByTestId("login-link-sent")).toBeTruthy());
    expect(utils.queryByTestId("login-error")).toBeNull();
  });

  it("still reports rate limits and connectivity problems", async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit", message: "x" } });
    const utils = render(<LoginScreen />);
    fireEvent.press(utils.getByTestId("login-mode-toggle"));
    fill(utils);
    fireEvent.press(utils.getByTestId("login-submit"));
    await waitFor(() => expect(utils.getByText("Too many attempts. Please wait a few minutes and try again.")).toBeTruthy());
    expect(utils.queryByTestId("login-link-sent")).toBeNull();
  });
});

describe("Login: language and theme", () => {
  it("renders Spanish copy with no English fallback", () => {
    mockLanguage = "es";
    const { getByText, queryByText, getByTestId } = render(<LoginScreen />);
    expect(getByText("Acceso del personal")).toBeTruthy();
    expect(getByText("¿Olvidaste tu contraseña?")).toBeTruthy();
    expect(getByText("Mejor envíame un enlace por correo")).toBeTruthy();
    expect(getByTestId("login-invite").props.children).toMatch(/administrador de tu hotel/);
    expect(queryByText("Forgot password?")).toBeNull();
    expect(queryByText(/phone|teléfono/i)).toBeNull();
  });

  it.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ] as const)("uses %s semantic colours and 44pt targets", (mode, theme) => {
    mockThemeMode = mode;
    const { getByTestId, getByPlaceholderText, getByText } = render(<LoginScreen />);
    expect(style(getByTestId("login-screen")).backgroundColor).toBe(theme.background);
    expect(style(getByText("PatelRep")).color).toBe(theme.textPrimary);
    expect(style(getByTestId("email-input-container")).backgroundColor).toBe(theme.surface);
    expect(style(getByTestId("email-input-container")).minHeight).toBeGreaterThanOrEqual(44);
    expect(style(getByPlaceholderText("Email address")).color).toBe(theme.textPrimary);
    expect(style(getByTestId("login-submit")).backgroundColor).toBe(theme.primaryAction);
    expect(style(getByTestId("login-submit")).minHeight).toBeGreaterThanOrEqual(44);
    expect(style(getByTestId("login-mode-toggle")).minHeight).toBeGreaterThanOrEqual(44);
    expect(style(getByTestId("login-invite")).color).toBe(theme.textMuted);
  });
});
