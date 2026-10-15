import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import i18n from "@/i18n";

/**
 * Android notification channels. The ids are what the API names in each push (`channelId`), and Android
 * fixes a channel's importance when it is first created, so these ids must not be reused for a different
 * level. Time-sensitive floor work (room and work-order assignments, urgent tasks) is HIGH; everything
 * else is DEFAULT. Nothing is MAX, and nothing tries to bypass Do Not Disturb.
 *
 * The earlier build created a single MAX channel named "default"; it is left alone (a person may have
 * tuned it) and simply stops being used by new pushes.
 */
export const ALERTS_CHANNEL = "alerts";
export const UPDATES_CHANNEL = "updates";

let channelsReady: Promise<void> | null = null;

async function createChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL, {
    name: i18n.t("settings.notifications.channelAlerts"),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  });
  await Notifications.setNotificationChannelAsync(UPDATES_CHANNEL, {
    name: i18n.t("settings.notifications.channelUpdates"),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
}

/**
 * Create the Android channels. Must run BEFORE the permission prompt and the push-token request: on
 * Android 13+ the system only offers the prompt once a channel exists. A no-op everywhere else, and
 * created once per app run.
 */
export function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  if (!channelsReady) {
    channelsReady = createChannels().catch((error) => {
      channelsReady = null; // try again next time rather than caching a failure
      throw error;
    });
  }
  return channelsReady;
}
