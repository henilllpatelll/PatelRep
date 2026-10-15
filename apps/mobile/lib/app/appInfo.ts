/**
 * The one place the installed app's identity is read. About, Help & Support diagnostics, the Settings footer
 * and the device card all call this, so they can never disagree.
 *
 * Version and build come from the installed binary (expo-application), not from the app config: after an OTA
 * update the config belongs to the update, while the binary is what is actually installed. The config is only a
 * fallback where there is no native binary to ask (tests, web). Nothing is invented when a value is unknown.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

export interface AppInfo {
  name: string;
  /** Installed version, e.g. "1.0.0"; null when it cannot be determined. */
  version: string | null;
  /** Native build number (iOS CFBundleVersion / Android versionCode); null when unknown. */
  build: string | null;
  /** Id of the downloaded OTA update that is running; null when running the build's embedded code. */
  updateId: string | null;
}

export interface AppInfoSources {
  nativeVersion?: string | null;
  nativeBuild?: string | null;
  configVersion?: string | null;
  configBuild?: string | number | null;
  updatesEnabled?: boolean;
  isEmbeddedLaunch?: boolean | null;
  updateId?: string | null;
  name?: string | null;
}

const clean = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 64) : null;
};

/** Pure resolution so every fallback rule is testable without a native runtime. */
export function resolveAppInfo(src: AppInfoSources): AppInfo {
  // An update id is only meaningful for a downloaded update. The embedded launch has an id too, but it is
  // simply "the code this build shipped with" and would read as noise next to the version.
  const runningDownloadedUpdate = src.updatesEnabled === true && src.isEmbeddedLaunch === false;
  return {
    name: clean(src.name) ?? "PatelRep",
    version: clean(src.nativeVersion) ?? clean(src.configVersion),
    build: clean(src.nativeBuild) ?? clean(src.configBuild),
    updateId: runningDownloadedUpdate ? clean(src.updateId) : null,
  };
}

/** First characters of an update id: enough to quote to support, short enough to read. */
export function shortUpdateId(updateId: string): string {
  return updateId.slice(0, 8);
}

/** Reads a native module defensively: a missing or unlinked module must never take a Settings screen down. */
function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

let cached: AppInfo | null = null;

export function getAppInfo(): AppInfo {
  if (cached) return cached;
  const application = safely(() => require("expo-application") as typeof import("expo-application"));
  const updates = safely(() => require("expo-updates") as typeof import("expo-updates"));
  const config = Constants.expoConfig;
  const configBuild = Platform.OS === "ios" ? config?.ios?.buildNumber : Platform.OS === "android" ? config?.android?.versionCode : null;
  cached = resolveAppInfo({
    name: config?.name,
    nativeVersion: safely(() => application?.nativeApplicationVersion),
    nativeBuild: safely(() => application?.nativeBuildVersion),
    configVersion: config?.version,
    configBuild,
    updatesEnabled: safely(() => updates?.isEnabled),
    isEmbeddedLaunch: safely(() => updates?.isEmbeddedLaunch),
    updateId: safely(() => updates?.updateId),
  });
  return cached;
}

/** Test seam: forget the memoised value. */
export function resetAppInfoCache(): void {
  cached = null;
}
