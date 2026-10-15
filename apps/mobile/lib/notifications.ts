import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { api } from "@/lib/api/client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId ??
    "";

  if (!projectId) {
    console.warn(
      "[push] EAS projectId not set in app.json extra.eas.projectId — push token registration skipped"
    );
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });

  return token.data;
}

const PUSH_TOKEN_KEY = "@patelrep/push_token";

export async function savePushTokenToProfile(token: string): Promise<void> {
  await api.patch("/staff/me/push-token", { token });
  // Remembered only so sign-out can detach this device (the token is not a credential).
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token).catch(() => undefined);
}

/**
 * Sign-out step: detach this device's push token from the signed-in person so the next employee on a
 * shared phone does not receive their alerts. Best effort and must run before the session is cleared;
 * the server also detaches a token from any other account when someone else registers it.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
  if (!token) return;
  await api.post("/staff/me/push-token/revoke", { token });
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => undefined);
}

export async function setupPushNotifications(): Promise<void> {
  const token = await registerForPushNotifications();
  if (token) {
    await savePushTokenToProfile(token);
  }
}
