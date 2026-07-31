import React from "react";
import {
  Alert,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { darkTheme, lightTheme, type ThemeMode } from "@/components/shared/tokens";

let mockLanguage = "en";
let mockThemeMode: ThemeMode = "light";
const mockSignInWithPassword = jest.fn();
const mockSignInWithOtp = jest.fn();

const mockEn: Record<string, string> = {
  "auth.login": "Log In",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.magicLink": "Send Magic Link",
  "auth.magicLinkSent": "Check your email for a login link",
  "auth.signInWith": "Sign in with email/password",
  "auth.propertySubtitle": "v2 - {{property}}",
  "auth.signInEyebrow": "Sign in",
  "auth.welcomeBack": "Welcome back.",
  "auth.startShift": "Sign in to start your shift.",
  "auth.signInWithPhone": "Sign in with phone",
  "auth.newTo": "New to PatelRep?",
  "auth.getInviteLink": "Get the invite link",
  "auth.errorTitle": "Error",
};

const mockEs: Record<string, string> = {
  "auth.login": "Iniciar sesión",
  "auth.email": "Correo electrónico",
  "auth.password": "Contraseña",
  "auth.magicLink": "Enviar enlace mágico",
  "auth.magicLinkSent": "Revisa tu correo para el enlace de acceso",
  "auth.signInWith": "Iniciar sesión con correo/contraseña",
  "auth.propertySubtitle": "v2 - {{property}}",
  "auth.signInEyebrow": "Iniciar sesión",
  "auth.welcomeBack": "Te damos la bienvenida.",
  "auth.startShift": "Inicia sesión para comenzar tu turno.",
  "auth.signInWithPhone": "Iniciar sesión con teléfono",
  "auth.newTo": "¿Primera vez en PatelRep?",
  "auth.getInviteLink": "Obtén el enlace de invitación",
  "auth.errorTitle": "Error",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const messages = mockLanguage === "es" ? mockEs : mockEn;
      const template = messages[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? `{{${name}}}`));
    },
  }),
}));

jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => mockThemeMode,
}));

jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text } = require("react-native");
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      ReactRuntime.createElement(Text, { testID: `icon-${name}`, style: { color } }, name),
  };
});

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
    },
  },
}));

import LoginScreen from "@/app/(auth)/login";

function flattenedStyle(node: { props: { style: unknown } }) {
  return StyleSheet.flatten(
    node.props.style as StyleProp<ViewStyle & TextStyle>,
  ) as ViewStyle & TextStyle;
}

describe("LoginScreen theme and i18n contract", () => {
  beforeEach(() => {
    mockLanguage = "en";
    mockThemeMode = "light";
    mockSignInWithPassword.mockReset().mockResolvedValue({ error: null });
    mockSignInWithOtp.mockReset().mockResolvedValue({ error: null });
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ] as const)("uses %s semantic roles across the complete auth surface", async (mode, theme) => {
    mockThemeMode = mode;
    let resolveLogin: ((value: { error: null }) => void) | undefined;
    mockSignInWithPassword.mockReturnValue(
      new Promise<{ error: null }>((resolve) => {
        resolveLogin = resolve;
      }),
    );

    const { getByPlaceholderText, getByTestId, getByText } = render(<LoginScreen />);

    expect(flattenedStyle(getByTestId("login-screen")).backgroundColor).toBe(theme.background);
    expect(flattenedStyle(getByTestId("login-logo-mark")).backgroundColor).toBe(theme.shell.bg);
    expect(flattenedStyle(getByTestId("icon-home-outline")).color).toBe(theme.shell.ink);
    expect(flattenedStyle(getByText("PatelRep")).color).toBe(theme.textPrimary);
    expect(flattenedStyle(getByText("v2 - Lone Star Inn")).color).toBe(theme.textMuted);
    expect(flattenedStyle(getByText("Sign in")).color).toBe(theme.primaryAction);
    expect(flattenedStyle(getByText("Welcome back.")).color).toBe(theme.textPrimary);
    expect(flattenedStyle(getByText("Sign in to start your shift.")).color).toBe(theme.textSecondary);

    const emailContainer = getByTestId("email-input-container");
    const emailInput = getByPlaceholderText("Email address");
    expect(flattenedStyle(emailContainer).backgroundColor).toBe(theme.surface);
    expect(flattenedStyle(emailContainer).borderColor).toBe(theme.border);
    expect(flattenedStyle(emailContainer).minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenedStyle(emailInput).color).toBe(theme.textPrimary);
    expect(emailInput.props.placeholderTextColor).toBe(theme.textMuted);
    expect(flattenedStyle(getByTestId("icon-mail-outline")).color).toBe(theme.textMuted);

    const submit = getByTestId("login-submit");
    const toggle = getByTestId("login-mode-toggle");
    expect(flattenedStyle(submit).backgroundColor).toBe(theme.primaryAction);
    expect(flattenedStyle(submit).minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenedStyle(getByText("Log In")).color).toBe(theme.onPrimary);
    expect(flattenedStyle(getByTestId("icon-arrow-forward")).color).toBe(theme.onPrimary);
    expect(flattenedStyle(toggle).backgroundColor).toBe(theme.surface);
    expect(flattenedStyle(toggle).borderColor).toBe(theme.border);
    expect(flattenedStyle(toggle).minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenedStyle(getByText("Sign in with phone")).color).toBe(theme.textPrimary);
    expect(flattenedStyle(getByTestId("icon-phone-portrait-outline")).color).toBe(theme.textPrimary);
    expect(flattenedStyle(getByTestId("login-invite")).color).toBe(theme.textMuted);
    expect(flattenedStyle(getByTestId("login-invite-link")).color).toBe(theme.primaryAction);

    fireEvent.changeText(emailInput, "staff@example.com");
    fireEvent.press(submit);
    await waitFor(() =>
      expect(getByTestId("login-submit").props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      }),
    );
    expect(getByTestId("login-loading").props.color).toBe(theme.onPrimary);

    resolveLogin?.({ error: null });
    await waitFor(() =>
      expect(getByTestId("login-submit").props.accessibilityState).toEqual({
        disabled: false,
        busy: false,
      }),
    );
  });

  it("keeps the password request contract unchanged", async () => {
    const { getByPlaceholderText, getByTestId } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText("Email address"), "staff@example.com");
    fireEvent.changeText(getByPlaceholderText("Password"), "secret");
    fireEvent.press(getByTestId("login-submit"));

    await waitFor(() =>
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "staff@example.com",
        password: "secret",
      }),
    );
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("renders Spanish-only staff copy and preserves the magic-link redirect contract", async () => {
    mockLanguage = "es";
    const { getAllByText, getByPlaceholderText, getByTestId, getByText, queryByText } =
      render(<LoginScreen />);

    expect(getAllByText("Iniciar sesión")).toHaveLength(2);
    expect(getByText("Te damos la bienvenida.")).toBeTruthy();
    expect(getByText("Inicia sesión para comenzar tu turno.")).toBeTruthy();
    expect(getByText("Iniciar sesión con teléfono")).toBeTruthy();
    expect(getByTestId("login-invite").props.children[0]).toBe("¿Primera vez en PatelRep?");
    expect(getByText("Obtén el enlace de invitación")).toBeTruthy();
    expect(queryByText("Sign in")).toBeNull();
    expect(queryByText("Welcome back.")).toBeNull();
    expect(queryByText("Sign in to start your shift.")).toBeNull();
    expect(queryByText("Sign in with phone")).toBeNull();
    expect(queryByText("New to PatelRep?")).toBeNull();
    expect(queryByText("Get the invite link")).toBeNull();

    fireEvent.press(getByTestId("login-mode-toggle"));
    expect(getByText("Enviar enlace mágico")).toBeTruthy();
    expect(getByText("Iniciar sesión con correo/contraseña")).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText("Correo electrónico"), "staff@example.com");
    fireEvent.press(getByTestId("login-submit"));

    await waitFor(() =>
      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: "staff@example.com",
        options: { emailRedirectTo: "patelrep://auth/callback" },
      }),
    );
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("", "Revisa tu correo para el enlace de acceso");
  });
});
