import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import "react-native-url-polyfill/auto";
import secureSessionStorage from "@/lib/auth/secureSessionStorage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Keychain/Keystore-backed (see secureSessionStorage); migrates sessions from older builds.
    storage: secureSessionStorage,
    // PKCE: magic-link and recovery links return a one-time ?code= that only this device can exchange,
    // instead of access/refresh tokens in the URL.
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

export type UserRole =
  | "housekeeper"
  | "inspector"
  | "engineer"
  | "chief_engineer"
  | "housekeeping_supervisor"
  | "front_desk"
  | "gm";

const APP_ROLES: ReadonlySet<string> = new Set([
  "housekeeper",
  "inspector",
  "engineer",
  "chief_engineer",
  "housekeeping_supervisor",
  "front_desk",
  "gm",
]);

/** Normalize a JWT claim to a PatelRep app role. The Supabase JWT hook puts
 *  the app role in the `user_role` claim and leaves top-level `role` as
 *  "authenticated" (PostgREST needs it) — never cast `role` directly. */
export function toAppRole(...candidates: Array<string | null | undefined>): UserRole | null {
  for (const candidate of candidates) {
    if (candidate && APP_ROLES.has(candidate)) return candidate as UserRole;
  }
  return null;
}

export interface UserProfile {
  id: string;
  tenant_id: string;
  role: UserRole;
  effective_role?: UserRole;
  full_name: string;
  language_pref: "en" | "es";
  preferred_name?: string;
  /** Signed/hotel-set photo URL; filled from GET /staff/me/profile, never a storage key. */
  avatar_url?: string | null;
  expo_push_token?: string;
  is_active?: boolean;
}
