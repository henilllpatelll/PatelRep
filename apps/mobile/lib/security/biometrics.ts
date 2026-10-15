import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

export type BiometricKind = "face" | "fingerprint" | "iris" | "generic";

export type BiometricCapability =
  | { available: true; kind: BiometricKind }
  | { available: false; reason: "unsupported" | "notEnrolled" };

export type AuthResult = "success" | "cancelled" | "unavailable" | "failed";

/**
 * What this phone can do right now. Uses the operating system's own APIs only: nothing about a
 * person's face or fingerprint is ever read, stored or compared by the app.
 */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (Platform.OS === "web") return { available: false, reason: "unsupported" };
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return { available: false, reason: "unsupported" };
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return { available: false, reason: "notEnrolled" };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const T = LocalAuthentication.AuthenticationType;
    const kind: BiometricKind = types.includes(T.FACIAL_RECOGNITION)
      ? "face"
      : types.includes(T.FINGERPRINT)
        ? "fingerprint"
        : types.includes(T.IRIS)
          ? "iris"
          : "generic";
    return { available: true, kind };
  } catch {
    return { available: false, reason: "unsupported" };
  }
}

/**
 * Ask the OS to verify the person. The device passcode/PIN stays available as the OS-provided fallback
 * (disableDeviceFallback is false), so a changed or failing biometric never locks anyone out.
 */
export async function authenticate(promptMessage: string, cancelLabel: string): Promise<AuthResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false,
    });
    if (result.success) return "success";
    switch (result.error) {
      case "user_cancel":
      case "system_cancel":
      case "app_cancel":
        return "cancelled";
      case "not_enrolled":
      case "not_available":
      case "passcode_not_set":
        return "unavailable";
      default:
        return "failed";
    }
  } catch {
    return "failed";
  }
}
