import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";

/**
 * Android Expo Go dropped remote push with SDK 53: fetching a push token or listening for token changes
 * throws there. `isRunningInExpoGo()` is true only when the native ExpoGo module exists, so development
 * clients and production builds (which also report a "storeClient"-like environment in some setups)
 * keep full push support. Local notifications and the in-app inbox are unaffected.
 */
export function isRemotePushSupported(): boolean {
  if (Platform.OS !== "android") return true;
  try {
    return !isRunningInExpoGo();
  } catch {
    return true;
  }
}
