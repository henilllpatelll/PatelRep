export type AppearancePreference = "system" | "light" | "dark";
export type ResolvedThemeMode = Exclude<AppearancePreference, "system">;

export const APPEARANCE_STORAGE_KEY =
  "@patelrep/mobile/appearance-preference";

export function normalizeAppearancePreference(
  value: unknown,
): AppearancePreference {
  return value === "system" || value === "light" || value === "dark"
    ? value
    : "system";
}

export function resolveThemeMode(
  preference: AppearancePreference,
  systemScheme: ResolvedThemeMode | null | undefined,
): ResolvedThemeMode {
  if (preference !== "system") {
    return preference;
  }

  return systemScheme === "dark" ? "dark" : "light";
}
