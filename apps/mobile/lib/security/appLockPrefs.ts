import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const LOCK_TIMEOUTS_MS = [0, 60_000, 300_000, 900_000, 1_800_000] as const;
export type LockTimeoutMs = (typeof LOCK_TIMEOUTS_MS)[number];
export const DEFAULT_LOCK_TIMEOUT_MS: LockTimeoutMs = 60_000;

export interface AppLockPrefs {
  enabled: boolean;
  timeoutMs: LockTimeoutMs;
}

export const DEFAULT_PREFS: AppLockPrefs = { enabled: false, timeoutMs: DEFAULT_LOCK_TIMEOUT_MS };

// Keyed by person so a shared phone keeps each employee's own choice; kept in the Keychain/Keystore
// (device-only) so the setting cannot be flipped by editing app storage.
const keyFor = (userId: string) => `patelrep.applock.v1.${userId}`;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function coerce(value: unknown): AppLockPrefs {
  const v = (value ?? {}) as Partial<AppLockPrefs>;
  const timeoutMs = LOCK_TIMEOUTS_MS.includes(v.timeoutMs as LockTimeoutMs) ? (v.timeoutMs as LockTimeoutMs) : DEFAULT_LOCK_TIMEOUT_MS;
  return { enabled: v.enabled === true, timeoutMs };
}

export async function loadAppLockPrefs(userId: string): Promise<AppLockPrefs> {
  if (Platform.OS === "web") return DEFAULT_PREFS;
  try {
    const raw = await SecureStore.getItemAsync(keyFor(userId), OPTIONS);
    return raw ? coerce(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    // Unreadable preference: fail closed only if we cannot tell. Treat as disabled but let the caller know.
    return DEFAULT_PREFS;
  }
}

export async function saveAppLockPrefs(userId: string, prefs: AppLockPrefs): Promise<void> {
  if (Platform.OS === "web") throw new Error("app-lock unsupported");
  await SecureStore.setItemAsync(keyFor(userId), JSON.stringify(prefs), OPTIONS);
}
