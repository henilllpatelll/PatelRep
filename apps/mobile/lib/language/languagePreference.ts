export type AppLanguage = "en" | "es";

/** The person's chosen language as kept on this phone, scoped to their account id. */
export interface LocalLanguageRecord {
  value: AppLanguage;
  /** True until the profile update is confirmed by the server. */
  pending: boolean;
  /** When the choice was made (ms); tells a confirmation apart from a newer choice. */
  updatedAt: number;
}

export const DEVICE_LANGUAGE_KEY = "@patelrep/mobile/language-last";
export const userLanguageKey = (userId: string) => `@patelrep/mobile/language-pref:${userId}`;

/** "es", "es-MX", "ES_us" -> "es"; anything else (including unsupported languages) -> null. */
export function normalizeLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return base === "en" || base === "es" ? base : null;
}

export function deviceLanguage(): AppLanguage | null {
  try {
    return normalizeLanguage(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

export function parseLocalRecord(raw: string | null): LocalLanguageRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalLanguageRecord>;
    const value = normalizeLanguage(parsed.value);
    if (!value) return null;
    return {
      value,
      pending: parsed.pending === true,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Precedence for a signed-in person:
 *  1. a choice made here that the server has not confirmed yet (never overwritten by older server data),
 *  2. the saved account preference,
 *  3. this person's cached choice on this phone,
 *  4. the device language, 5. English.
 */
export function resolveLanguage(input: {
  local: LocalLanguageRecord | null;
  remote: unknown;
  device: AppLanguage | null;
}): AppLanguage {
  if (input.local?.pending) return input.local.value;
  return normalizeLanguage(input.remote) ?? input.local?.value ?? input.device ?? "en";
}
