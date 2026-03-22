import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
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

export async function savePushTokenToProfile(token: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  await supabase
    .from("user_profiles")
    .update({ expo_push_token: token })
    .eq("id", user.id);
}

export async function setupPushNotifications(): Promise<void> {
  const token = await registerForPushNotifications();
  if (token) {
    await savePushTokenToProfile(token);
  }
}
