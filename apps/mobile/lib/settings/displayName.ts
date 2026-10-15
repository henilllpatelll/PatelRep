/** The one display-name rule for the whole app: preferred name, else full name, else nothing. */
export function displayNameFor(
  user: { preferred_name?: string | null; full_name?: string | null } | null | undefined,
): string {
  const preferred = user?.preferred_name?.trim();
  if (preferred) return preferred;
  return user?.full_name?.trim() ?? "";
}

export const PREFERRED_NAME_MAX = 40;

export type PreferredNameError = "empty" | "tooLong" | "invalid";

/** Trims and collapses whitespace; mirrors the API's rules (1-40 chars, no control characters). */
export function normalizePreferredName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function validatePreferredName(raw: string): PreferredNameError | null {
  const value = normalizePreferredName(raw);
  if (!value) return "empty";
  if (value.length > PREFERRED_NAME_MAX) return "tooLong";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "invalid";
  return null;
}
