export type AuthFailure =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "rateLimited"
  | "offline"
  | "linkExpired"
  | "weakPassword"
  | "samePassword"
  | "session"
  | "reauthRequired"
  | "generic";

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
}

/** Maps a Supabase/network error to a staff-safe category. Raw provider text is never shown. */
export function classifyAuthError(err: unknown): AuthFailure {
  const e = (err ?? {}) as AuthErrorLike;
  const code = (e.code ?? "").toLowerCase();
  const message = (e.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) return "invalidCredentials";
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) return "emailNotConfirmed";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || e.status === 429) return "rateLimited";
  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    code === "flow_state_not_found" ||
    message.includes("expired")
  ) {
    return "linkExpired";
  }
  // Checked first: "New password should be different from the old password" also contains "password should be".
  if (code === "same_password" || message.includes("different from the old password")) return "samePassword";
  if (code === "weak_password" || message.includes("password should be") || message.includes("weak password")) return "weakPassword";
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid" || message.includes("reauthentication")) {
    return "reauthRequired";
  }
  if (
    code === "session_not_found" ||
    code === "session_expired" ||
    code === "refresh_token_not_found" ||
    e.status === 401 ||
    message.includes("not authenticated") ||
    message.includes("auth session missing")
  ) {
    return "session";
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("timed out")
  ) {
    return "offline";
  }
  return "generic";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cases and trims: sign-in emails are case-insensitive and pasted values often carry spaces. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(raw));
}

/** Encourages passphrases without composition rules or a maximum length. */
export const MIN_PASSWORD_LENGTH = 8;
