import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform } from "react-native";
import { ensureNotificationChannels } from "./channels";

/**
 * What this phone will actually do with PatelRep notifications, taken from the operating system, never
 * from a saved preference.
 *  - granted:      the OS allows alerts.
 *  - provisional:  iOS delivers quietly to Notification Center until the person promotes them.
 *  - undetermined: the OS will still show its permission prompt (or, on Android after one refusal, once more).
 *  - denied:       refused (or all PatelRep notifications switched off in system settings); only the
 *                  person can change it, in system settings. The app cannot and must not override it.
 *  - unavailable:  this device cannot receive push (web, or the permission API failed).
 */
export type PushPermissionState = "granted" | "provisional" | "undetermined" | "denied" | "unavailable";

const PROMPTED_KEY = "@patelrep/push_prompted/v1";
// expo-notifications enum values, kept numeric so the mapping works without the native enum in tests.
const IOS_PROVISIONAL = 3;
const ANDROID_IMPORTANCE_NONE = 0;

type PermissionResponse = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;

export function mapPermission(response: PermissionResponse): PushPermissionState {
  const iosStatus = (response as { ios?: { status?: number } }).ios?.status;
  const androidImportance = (response as { android?: { importance?: number } }).android?.importance;
  if (response.status === "granted" || response.granted) {
    if (androidImportance === ANDROID_IMPORTANCE_NONE) return "denied"; // allowed, but every channel is switched off
    return iosStatus === IOS_PROVISIONAL ? "provisional" : "granted";
  }
  if (response.status === "undetermined") return "undetermined";
  // Denied: Android allows one more prompt after the first refusal; after that only system settings can help.
  return response.canAskAgain ? "undetermined" : "denied";
}

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (Platform.OS === "web") return "unavailable";
  try {
    return mapPermission(await Notifications.getPermissionsAsync());
  } catch {
    return "unavailable";
  }
}

export function canReceivePush(state: PushPermissionState): boolean {
  return state === "granted" || state === "provisional";
}

export async function hasBeenPrompted(): Promise<boolean> {
  return (await AsyncStorage.getItem(PROMPTED_KEY).catch(() => null)) === "1";
}

/**
 * Ask the OS for permission, only when it is still askable. Android channels are created first (a
 * requirement of the Android 13+ prompt). Returns the resulting state; never prompts again once the
 * system says it will not.
 */
export async function requestPushPermission(): Promise<PushPermissionState> {
  const current = await getPushPermissionState();
  if (current !== "undetermined") return current;
  try {
    await ensureNotificationChannels();
    await AsyncStorage.setItem(PROMPTED_KEY, "1").catch(() => undefined);
    const response = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return mapPermission(response);
  } catch {
    return getPushPermissionState();
  }
}

/** Opens this app's page in the system settings (the only place a refused permission can be changed). */
export async function openDeviceNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing else to try: the screen keeps showing the current state.
  }
}
