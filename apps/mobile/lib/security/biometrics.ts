import { Platform } from "react-native";

type LocalAuthModule = typeof import("expo-local-authentication");

/**
 * expo-local-authentication is native code added after some binaries were already installed, and over-the-air
 * JS reaches those binaries too. A static import would throw at launch there ("Cannot find native module"),
 * so it is loaded on first use and, when the installed app lacks it, the phone simply reports no biometrics.
 */
let loaded: LocalAuthModule | null | undefined;
function localAuth(): LocalAuthModule | null {
  if (loaded === undefined) {
    try {
      loaded = require("expo-local-authentication") as LocalAuthModule;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

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
  const LocalAuthentication = localAuth();
  if (!LocalAuthentication) return { available: false, reason: "unsupported" };
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
  const LocalAuthentication = localAuth();
  if (!LocalAuthentication) return "unavailable";
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
