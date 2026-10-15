import { supabase } from "@/lib/supabase";
import { classifyAuthError, type AuthFailure } from "@/lib/auth/authErrors";

/**
 * Change the signed-in account's password. The current password is re-verified with Supabase first
 * (a fresh sign-in also satisfies "secure password change"'s recently-signed-in rule), because
 * holding an old local session is not enough to change credentials. Only the authenticated account
 * can be affected: updateUser acts on the session user and takes no id.
 */
export async function changePassword(email: string, current: string, next: string): Promise<AuthFailure | null> {
  const verify = await supabase.auth.signInWithPassword({ email, password: current });
  if (verify.error) {
    const kind = classifyAuthError(verify.error);
    return kind === "generic" ? "generic" : kind;
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  return error ? classifyAuthError(error) : null;
}

/** Set a new password inside a recovery session (opened from the emailed link). */
export async function setRecoveredPassword(next: string): Promise<AuthFailure | null> {
  const { error } = await supabase.auth.updateUser({ password: next });
  return error ? classifyAuthError(error) : null;
}

/** Sends a recovery email. Unknown addresses look identical to known ones; only rate limits and
 *  connectivity are surfaced. */
export async function requestPasswordReset(email: string): Promise<AuthFailure | null> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "patelrep://auth/callback" });
  if (!error) return null;
  const kind = classifyAuthError(error);
  return kind === "rateLimited" || kind === "offline" ? kind : null;
}
