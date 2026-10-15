import { supabase } from "@/lib/supabase";
import { unregisterPushToken } from "@/lib/notifications";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import { useAppLockStore } from "@/stores/appLockStore";
import { classifyAuthError, type AuthFailure } from "@/lib/auth/authErrors";

/**
 * Sign out of THIS device only. Order matters:
 *  1. detach this phone's push token while the session is still valid (best effort);
 *  2. clear the local session (scope "local": other devices stay signed in);
 *  3. drop in-memory per-person state so the next person cannot see it.
 * Saved-but-unsent work is NOT deleted: it stays on disk under its owner's `${hotel}:${user}` scope and
 * is only visible to, and only sent by, that person after they sign in again on this phone. The
 * appStore/taskOutbox already swap scope when the user changes; this clears the clean-session store
 * too, which is only re-scoped by the housekeeping screens.
 */
export async function signOutThisDevice(): Promise<AuthFailure | null> {
  await unregisterPushToken().catch(() => undefined);
  const { error } = await supabase.auth.signOut({ scope: "local" });
  useCleanSessionStore.setState({ scope: null, sessions: {} });
  useAppLockStore.getState().reset();
  return error ? classifyAuthError(error) : null;
}

/**
 * Revoke every OTHER session of this account at Supabase, keeping this device signed in. Returns null
 * only when the provider confirms. Other devices' access tokens may keep working until they expire
 * (Supabase access tokens are short-lived JWTs); their refresh tokens stop working immediately.
 */
export async function signOutOtherDevices(): Promise<AuthFailure | null> {
  const { error } = await supabase.auth.signOut({ scope: "others" });
  return error ? classifyAuthError(error) : null;
}
