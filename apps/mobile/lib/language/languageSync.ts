import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import i18n from "@/i18n";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import {
  DEVICE_LANGUAGE_KEY,
  deviceLanguage,
  normalizeLanguage,
  parseLocalRecord,
  resolveLanguage,
  userLanguageKey,
  type AppLanguage,
  type LocalLanguageRecord,
} from "./languagePreference";

export type LanguageSyncState = "idle" | "pending" | "failed";

/** Drives the "not saved to your account yet" notice on the Language screen. */
export const useLanguageSyncStore = create<{ syncState: LanguageSyncState }>(() => ({ syncState: "idle" }));
const setSyncState = (syncState: LanguageSyncState) => useLanguageSyncStore.setState({ syncState });

// Module state: who the language belongs to right now, and which hydration is the latest.
let activeUserId: string | null = null;
let epoch = 0;

async function readRecord(userId: string): Promise<LocalLanguageRecord | null> {
  try {
    return parseLocalRecord(await AsyncStorage.getItem(userLanguageKey(userId)));
  } catch {
    return null;
  }
}

async function writeRecord(userId: string, record: LocalLanguageRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(userLanguageKey(userId), JSON.stringify(record));
  } catch {
    // Storage unavailable: the language still applies for this run.
  }
}

/** Applies a language to the running app (no restart) and remembers it as this phone's last language. */
export async function applyLanguage(language: AppLanguage): Promise<void> {
  if (normalizeLanguage(i18n.language) !== language) await i18n.changeLanguage(language);
  AsyncStorage.setItem(DEVICE_LANGUAGE_KEY, language).catch(() => undefined);
  const { user, setUser } = useAppStore.getState();
  if (user && user.language_pref !== language) setUser({ ...user, language_pref: language });
}

/** Before anyone signs in: the language this phone last used, else the device language. */
export async function restoreDeviceLanguage(): Promise<void> {
  let last: AppLanguage | null = null;
  try {
    last = normalizeLanguage(await AsyncStorage.getItem(DEVICE_LANGUAGE_KEY));
  } catch {
    // fall through to the device language
  }
  // A sign-in that already chose a language wins over this late restore.
  if (activeUserId) return;
  const language = last ?? deviceLanguage() ?? "en";
  if (normalizeLanguage(i18n.language) !== language) await i18n.changeLanguage(language);
}

/** Called once the signed-in person's profile has loaded. Returns the language that was applied. */
export async function hydrateLanguageForUser(userId: string, remote: unknown): Promise<AppLanguage> {
  const myEpoch = ++epoch;
  activeUserId = userId;
  const local = await readRecord(userId);
  // Someone else signed in, or the person picked a language, while this was loading.
  if (myEpoch !== epoch) return normalizeLanguage(i18n.language) ?? "en";
  const language = resolveLanguage({ local, remote, device: deviceLanguage() });
  await applyLanguage(language);
  if (myEpoch !== epoch) return language;
  if (local?.pending) {
    setSyncState("pending");
    void pushLanguage(userId, local);
  } else {
    setSyncState("idle");
    if (local?.value !== language) await writeRecord(userId, { value: language, pending: false, updatedAt: Date.now() });
  }
  return language;
}

/** The person picked a language: apply it now, keep it for them, then try to save it to their account. */
export async function selectLanguage(userId: string, next: AppLanguage): Promise<void> {
  epoch++; // a profile load that started earlier must not undo this choice
  activeUserId = userId;
  const record: LocalLanguageRecord = { value: next, pending: true, updatedAt: Date.now() };
  setSyncState("pending");
  await Promise.all([applyLanguage(next), writeRecord(userId, record)]);
  await pushLanguage(userId, record);
}

/** Saves a pending choice to the server and only then clears it. Returns whether it is confirmed. */
async function pushLanguage(userId: string, record: LocalLanguageRecord): Promise<boolean> {
  // Never write under a different account than the one that made the choice.
  if (useAppStore.getState().user?.id !== userId) return false;
  let confirmed = false;
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .update({ language_pref: record.value })
      .eq("id", userId)
      .select("id");
    // A blocked update returns no error and no rows; only a returned row is a confirmation.
    confirmed = !error && Array.isArray(data) && data.length > 0;
  } catch {
    confirmed = false;
  }
  // A newer choice owns the state now.
  if ((await readRecord(userId))?.updatedAt !== record.updatedAt) return confirmed;
  if (confirmed) await writeRecord(userId, { ...record, pending: false });
  if (activeUserId === userId) setSyncState(confirmed ? "idle" : "failed");
  return confirmed;
}

/** Retries the signed-in person's unconfirmed choice (back online, or the Retry button). */
export async function retryPendingLanguageSync(): Promise<void> {
  const userId = activeUserId;
  if (!userId) return;
  const record = await readRecord(userId);
  if (record?.pending) {
    setSyncState("pending");
    await pushLanguage(userId, record);
  }
}

/** Sign-out: the language stays as this phone's last language; no pending state follows to the next person. */
export function clearActiveLanguageUser(): void {
  activeUserId = null;
  epoch++;
  setSyncState("idle");
}
