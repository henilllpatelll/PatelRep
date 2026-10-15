import { Platform } from "react-native";

/**
 * Settings text scales with the person's system font size up to this multiplier. Every Settings row, sheet and
 * form wraps and grows (minHeight, never a fixed height), so the cap is generous; it only stops the very largest
 * accessibility sizes from overflowing a 320dp screen. The screen header keeps a tighter cap of its own.
 */
export const SETTINGS_MAX_FONT_SCALE = 2;

/** Smallest comfortable touch target: 44pt on iOS, 48dp on Android (platform guidance). */
export const MIN_TOUCH = Platform.OS === "ios" ? 44 : 48;
