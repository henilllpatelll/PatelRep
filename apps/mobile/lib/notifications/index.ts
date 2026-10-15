import * as Notifications from "expo-notifications";

// Must be at module scope — calling inside a component or useEffect is too late. Foreground pushes are
// shown like background ones so the three states (foreground, background, closed) behave the same.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export { savePushTokenToProfile, setupPushNotifications, syncPushRegistration, unregisterPushToken } from "./registration";
