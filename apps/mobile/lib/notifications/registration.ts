import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getAppInfo } from "@/lib/app/appInfo";
import { Platform } from "react-native";
import { api } from "@/lib/api/client";
import { ensureNotificationChannels } from "./channels";
import { canReceivePush, getPushPermissionState, hasBeenPrompted, requestPushPermission, type PushPermissionState } from "./permissions";

const PUSH_TOKEN_KEY = "@patelrep/push_token";
const REGISTRATION_KEY = "@patelrep/push_registration/v1";
const INSTALLATION_KEY = "@patelrep/installation_id/v1";
/** A registration the server already holds is refreshed at most this often (it only updates last-seen). */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

interface RegistrationRecord {
  userId: string;
  token: string;
  at: number;
}

function randomId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A random label for this install, so a rotated push token replaces the old registration instead of
 * adding a second one. It identifies a phone to the server; it is never proof of who is using it.
 */
export async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALLATION_KEY).catch(() => null);
  if (existing) return existing;
  const created = randomId();
  await AsyncStorage.setItem(INSTALLATION_KEY, created).catch(() => undefined);
  return created;
}

export async function getExpoPushToken(): Promise<string | null> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId ??
    "";

  if (!projectId) {
    console.warn("[push] EAS projectId not set in app.json extra.eas.projectId — push token registration skipped");
    return null;
  }

  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (error) {
    // e.g. a simulator, or a phone with no Google Play services: no token, no push, nothing to retry now.
    console.warn("[push] could not obtain a push token", error);
    return null;
  }
}

export async function savePushTokenToProfile(token: string): Promise<void> {
  const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : undefined;
  const appVersion = getAppInfo().version;
  await api.patch("/staff/me/push-token", {
    token,
    installation_id: await getInstallationId(),
    ...(platform ? { platform } : {}),
    ...(appVersion ? { app_version: appVersion } : {}),
  });
  // Remembered only so sign-out can detach this device (the token is not a credential).
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token).catch(() => undefined);
}

async function readRecord(): Promise<RegistrationRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRATION_KEY);
    return raw ? (JSON.parse(raw) as RegistrationRecord) : null;
  } catch {
    return null;
  }
}

let inFlight: { userId: string; promise: Promise<boolean> } | null = null;

async function registerNow(userId: string, force: boolean): Promise<boolean> {
  try {
    const token = await getExpoPushToken();
    if (!token) return false;
    const record = await readRecord();
    const fresh = record && record.userId === userId && record.token === token && Date.now() - record.at < REFRESH_AFTER_MS;
    if (fresh && !force) return true;
    await savePushTokenToProfile(token);
    await AsyncStorage.setItem(REGISTRATION_KEY, JSON.stringify({ userId, token, at: Date.now() })).catch(() => undefined);
    return true;
  } catch (error) {
    console.warn("[push] registration failed", error);
    return false;
  }
}

/**
 * Register this phone for the signed-in person. Safe to call from several places (launch, foreground,
 * token rotation, the Settings screen): overlapping calls for the same person share one request, a call
 * for a different person (an account switch) waits for the previous one and then registers its own, and a
 * registration the server already holds for this exact person + token is not re-sent for a day. Returns
 * true when the server now holds this phone's token for `userId`.
 */
export function syncPushRegistration(userId: string, options: { force?: boolean } = {}): Promise<boolean> {
  if (inFlight && inFlight.userId === userId) return inFlight.promise;
  const previous = inFlight?.promise ?? Promise.resolve(true);
  const promise = previous.then(() => registerNow(userId, options.force ?? false));
  const entry = { userId, promise };
  inFlight = entry;
  void promise.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  return promise;
}

/**
 * Launch / sign-in step. Channels first, then permission, then the token. The OS prompt is shown at most
 * once automatically (the first time after sign-in, when the value is obvious: work alerts); after that
 * only the Settings screen can ask again, and a refusal is never re-asked.
 */
export async function setupPushNotifications(userId?: string): Promise<PushPermissionState> {
  await ensureNotificationChannels().catch((error) => console.warn("[push] channel setup failed", error));
  let state = await getPushPermissionState();
  if (state === "undetermined" && !(await hasBeenPrompted())) state = await requestPushPermission();
  if (canReceivePush(state) && userId) await syncPushRegistration(userId);
  return state;
}

/**
 * Sign-out step: detach this device's push token from the signed-in person so the next employee on a
 * shared phone does not receive their alerts. Best effort and must run before the session is cleared;
 * the server also detaches a token from any other account when someone else registers it.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
  await AsyncStorage.removeItem(REGISTRATION_KEY).catch(() => undefined);
  // The OS badge belongs to the person who is leaving.
  await Notifications.setBadgeCountAsync?.(0).catch(() => undefined);
  if (!token) return;
  await api.post("/staff/me/push-token/revoke", { token });
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => undefined);
}
