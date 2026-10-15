import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";

let mockLanguage: "en" | "es" = "en";
let mockParams: Record<string, string | undefined> = {};
let mockSessionEmail: string | null = "maria@hotel.com";
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockResetForEmail = jest.fn();
const mockUpdateUser = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockExchange = jest.fn();
const mockSignOut = jest.fn();
const mockMarkFresh = jest.fn();

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage) }) }));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text>{name}</Text>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => "light",
  useAppearancePreference: () => ({ preference: "system", mode: "light", setPreference: jest.fn(), isHydrated: true }),
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), back: () => mockBack(), canGoBack: () => true, push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/stores/appLockStore", () => ({ useAppLockStore: { getState: () => ({ markFreshSignIn: mockMarkFresh }) } }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...a: unknown[]) => mockResetForEmail(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      signInWithPassword: (...a: unknown[]) => mockSignInWithPassword(...a),
      exchangeCodeForSession: (...a: unknown[]) => mockExchange(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
      getSession: () => Promise.resolve({ data: { session: mockSessionEmail ? { user: { email: mockSessionEmail } } : null } }),
    },
  },
}));

import ForgotPasswordScreen from "@/app/(auth)/forgot-password";
import ResetPasswordScreen from "@/app/(auth)/reset-password";
import AuthCallback from "@/app/(auth)/auth/callback";
import ChangePasswordScreen from "@/app/(app)/profile/change-password";
import { useRecoveryStore } from "@/lib/auth/recoveryStore";

const LONG = "correct horse battery staple";

beforeEach(() => {
  mockLanguage = "en";
  mockParams = {};
  mockSessionEmail = "maria@hotel.com";
  [mockReplace, mockBack, mockToast.success, mockToast.error, mockToast.info, mockResetForEmail, mockUpdateUser, mockSignInWithPassword, mockExchange, mockSignOut, mockMarkFresh].forEach((m) => m.mockReset());
  mockResetForEmail.mockResolvedValue({ error: null });
  mockUpdateUser.mockResolvedValue({ error: null });
  mockSignInWithPassword.mockResolvedValue({ error: null });
  mockExchange.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
  useRecoveryStore.setState({ pending: false });
});

describe("Forgot password", () => {
  it("prefills the email from the sign-in screen and requests a Supabase recovery email", async () => {
    mockParams = { email: "maria@hotel.com" };
    const { getByTestId } = render(<ForgotPasswordScreen />);
    expect(getByTestId("forgot-email").props.value).toBe("maria@hotel.com");
    fireEvent.changeText(getByTestId("forgot-email"), "  Maria@Hotel.COM ");
    fireEvent.press(getByTestId("forgot-submit"));
    await waitFor(() =>
      expect(mockResetForEmail).toHaveBeenCalledWith("maria@hotel.com", { redirectTo: "patelrep://auth/callback" }),
    );
  });

  it("shows the same neutral confirmation whether or not the account exists", async () => {
    mockResetForEmail.mockResolvedValue({ error: { code: "user_not_found", status: 400, message: "User not found" } });
    const { getByTestId, queryByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId("forgot-email"), "nobody@example.com");
    fireEvent.press(getByTestId("forgot-submit"));
    await waitFor(() => expect(getByTestId("forgot-sent").props.children).toMatch(/If that address belongs to a PatelRep account/));
    expect(queryByTestId("forgot-error")).toBeNull();
  });

  it("validates the address first and reports only rate limits and connectivity", async () => {
    const { getByTestId, queryByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId("forgot-email"), "nope");
    fireEvent.press(getByTestId("forgot-submit"));
    expect(getByTestId("forgot-invalid")).toBeTruthy();
    expect(mockResetForEmail).not.toHaveBeenCalled();

    mockResetForEmail.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit", message: "x" } });
    fireEvent.changeText(getByTestId("forgot-email"), "a@b.co");
    fireEvent.press(getByTestId("forgot-submit"));
    await waitFor(() => expect(getByTestId("forgot-error").props.children).toBe("Too many attempts. Please wait a few minutes and try again."));
    expect(queryByTestId("forgot-sent")).toBeNull();
  });

  it("ignores repeated taps while sending", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mockResetForEmail.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId("forgot-email"), "a@b.co");
    fireEvent.press(getByTestId("forgot-submit"));
    fireEvent.press(getByTestId("forgot-submit"));
    expect(mockResetForEmail).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ error: null }));
  });
});

describe("Auth callback (magic link / recovery link)", () => {
  it("exchanges the one-time code exactly once and never logs it", async () => {
    mockParams = { code: "pkce-code-abc123" };
    const spies = (["log", "warn", "error", "info"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const { rerender } = render(<AuthCallback />);
    rerender(<AuthCallback />);
    await waitFor(() => expect(mockExchange).toHaveBeenCalledWith("pkce-code-abc123"));
    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockMarkFresh).toHaveBeenCalled();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("pkce-code-abc123");
      spy.mockRestore();
    }
  });

  it("sends a recovery link to the reset screen, and a magic link into the normal flow", async () => {
    mockParams = { code: "c1" };
    mockExchange.mockImplementation(async () => {
      useRecoveryStore.setState({ pending: true }); // what the PASSWORD_RECOVERY event does in _layout
      return { error: null };
    });
    render(<AuthCallback />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(auth)/reset-password"));
  });

  it("a plain magic link does not open the reset screen", async () => {
    mockParams = { code: "c2" };
    render(<AuthCallback />);
    await waitFor(() => expect(mockExchange).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" }, "This link has expired"],
    [{ error_code: "otp_expired" }, "This link has expired"],
    [{ error: "server_error" }, "We couldn't use this link"],
    [{}, "We couldn't use this link"],
  ])("shows a clear failure for %j without exchanging anything", async (params, title) => {
    mockParams = params;
    const { findByText, getByTestId } = render(<AuthCallback />);
    expect(await findByText(title)).toBeTruthy();
    expect(mockExchange).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("callback-back"));
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
  });

  it("handles an expired or already-used code from the provider", async () => {
    mockParams = { code: "used" };
    mockExchange.mockResolvedValue({ error: { code: "flow_state_not_found", message: "invalid flow state" } });
    const { findByText } = render(<AuthCallback />);
    expect(await findByText("This link has expired")).toBeTruthy();
  });
});

describe("Reset password (recovery session)", () => {
  it("is unavailable without a verified recovery link", () => {
    const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
    expect(getByTestId("reset-invalid")).toBeTruthy();
    expect(queryByTestId("password-form")).toBeNull();
  });

  it("saves the new password through Supabase and shows success only after it confirms", async () => {
    useRecoveryStore.setState({ pending: true });
    let resolve: (v: unknown) => void = () => undefined;
    mockUpdateUser.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
    expect(queryByTestId("current-password-input")).toBeNull();

    fireEvent.changeText(getByTestId("new-password-input"), LONG);
    fireEvent.changeText(getByTestId("confirm-password-input"), LONG);
    fireEvent.press(getByTestId("password-submit"));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: LONG }));
    expect(queryByTestId("reset-done")).toBeNull();

    await act(async () => resolve({ error: null }));
    await waitFor(() => expect(getByTestId("reset-done")).toBeTruthy());

    fireEvent.press(getByTestId("reset-continue"));
    expect(useRecoveryStore.getState().pending).toBe(false);
  });

  it("does not claim success when the provider refuses (weak or reused password)", async () => {
    useRecoveryStore.setState({ pending: true });
    mockUpdateUser.mockResolvedValue({ error: { code: "weak_password", message: "Password should be at least 6 characters" } });
    const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId("new-password-input"), LONG);
    fireEvent.changeText(getByTestId("confirm-password-input"), LONG);
    fireEvent.press(getByTestId("password-submit"));
    await waitFor(() => expect(getByTestId("password-error").props.children).toBe("That password is too easy to guess. Try a longer passphrase."));
    expect(queryByTestId("reset-done")).toBeNull();
  });

  it("cancelling signs the temporary recovery session out and clears the flag", async () => {
    useRecoveryStore.setState({ pending: true });
    const { getByTestId } = render(<ResetPasswordScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("reset-cancel"));
    });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(useRecoveryStore.getState().pending).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
  });
});

describe("Change password (Settings)", () => {
  async function fillAndSubmit(current: string, next: string, confirm: string, utils: ReturnType<typeof render>) {
    fireEvent.changeText(utils.getByTestId("current-password-input"), current);
    fireEvent.changeText(utils.getByTestId("new-password-input"), next);
    fireEvent.changeText(utils.getByTestId("confirm-password-input"), confirm);
    await act(async () => {
      fireEvent.press(utils.getByTestId("password-submit"));
    });
  }

  it("shows current/new/confirm fields with show-hide, paste-friendly autofill and plain requirements", () => {
    const { getByTestId, getByText } = render(<ChangePasswordScreen />);
    expect(getByText("Change password")).toBeTruthy();
    expect(getByTestId("current-password-input").props.autoComplete).toBe("current-password");
    expect(getByTestId("new-password-input").props.autoComplete).toBe("new-password");
    expect(getByTestId("new-password-input").props.textContentType).toBe("newPassword");
    expect(getByTestId("new-password-input").props.maxLength).toBeUndefined();
    expect(getByTestId("new-password-input").props.secureTextEntry).toBe(true);
    fireEvent.press(getByTestId("new-password-input-toggle"));
    expect(getByTestId("new-password-input").props.secureTextEntry).toBe(false);
    expect(getByTestId("password-requirements").props.children).toMatch(/at least 8 characters/);
  });

  it("re-verifies the current password, then updates, then confirms", async () => {
    const utils = render(<ChangePasswordScreen />);
    await fillAndSubmit("old-password-1", LONG, LONG, utils);

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: LONG }));
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: "maria@hotel.com", password: "old-password-1" });
    expect(mockSignInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateUser.mock.invocationCallOrder[0]);
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Password updated"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("does not change anything when the current password is wrong", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    const utils = render(<ChangePasswordScreen />);
    await fillAndSubmit("wrong", LONG, LONG, utils);
    await waitFor(() => expect(utils.getByTestId("password-error").props.children).toBe("Your current password isn't right."));
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "old-password-1", "short", "short", "Use at least 8 characters."],
    ["mismatch", "old-password-1", LONG, LONG + "x", "The two passwords don't match."],
    ["same as current", LONG, LONG, LONG, "Choose a password different from your current one."],
    ["no current", "", LONG, LONG, "Enter your current password."],
  ])("validates locally: %s", async (_name, current, next, confirm, message) => {
    const utils = render(<ChangePasswordScreen />);
    await fillAndSubmit(current, next, confirm, utils);
    expect(utils.getByTestId("password-error").props.children).toBe(message);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("allows long passphrases and symbols without composition rules", async () => {
    const passphrase = "this is a very long passphrase with spaces and no digits at all ".repeat(3);
    const utils = render(<ChangePasswordScreen />);
    await fillAndSubmit("old-password-1", passphrase, passphrase, utils);
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: passphrase }));
  });

  it("reports a provider refusal safely and never logs passwords", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    mockUpdateUser.mockResolvedValue({ error: { code: "same_password", message: "New password should be different from the old password." } });
    const utils = render(<ChangePasswordScreen />);
    await fillAndSubmit("old-password-1", LONG, LONG, utils);
    await waitFor(() => expect(utils.getByTestId("password-error").props.children).toBe("Choose a password different from your current one."));
    for (const spy of spies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(LONG);
      expect(logged).not.toContain("old-password-1");
      spy.mockRestore();
    }
  });

  it("asks the person to sign in again when there is no session", async () => {
    mockSessionEmail = null;
    const utils = render(<ChangePasswordScreen />);
    await fillAndSubmit("old-password-1", LONG, LONG, utils);
    await waitFor(() => expect(utils.getByTestId("password-error").props.children).toBe("Your session expired. Please sign in again."));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("ignores duplicate submissions", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mockSignInWithPassword.mockReturnValue(new Promise((r) => (resolve = r)));
    const utils = render(<ChangePasswordScreen />);
    fireEvent.changeText(utils.getByTestId("current-password-input"), "old-password-1");
    fireEvent.changeText(utils.getByTestId("new-password-input"), LONG);
    fireEvent.changeText(utils.getByTestId("confirm-password-input"), LONG);
    await act(async () => {
      fireEvent.press(utils.getByTestId("password-submit"));
      fireEvent.press(utils.getByTestId("password-submit"));
    });
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ error: null }));
  });

  it("renders in Spanish", () => {
    mockLanguage = "es";
    const { getByText, getByPlaceholderText } = render(<ChangePasswordScreen />);
    expect(getByText("Cambiar contraseña")).toBeTruthy();
    expect(getByPlaceholderText("Contraseña actual")).toBeTruthy();
    expect(getByPlaceholderText("Confirma la nueva contraseña")).toBeTruthy();
  });
});
