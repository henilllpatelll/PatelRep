/**
 * Employee-facing release notes, bundled with the app so they work offline and are never fetched from GitHub.
 *
 * Add an entry here when a version is released, in plain language for the people who use the app: what they can
 * now do, what is easier, what was fixed. No commit text, no internal ids, no pipeline detail. An entry is only
 * written once the version has actually shipped; a version with no entry simply has no What's New, and the app
 * says so rather than inventing one.
 */

export interface LocalizedText {
  en: string;
  es: string;
}

export interface ReleaseNote {
  /** Must equal the installed app version it describes, e.g. "1.0.0". */
  version: string;
  /** Release date as YYYY-MM-DD. Optional: leave it out rather than guess. */
  date?: string;
  features?: LocalizedText[];
  improvements?: LocalizedText[];
  fixes?: LocalizedText[];
}

export type ReleaseNoteSection = "features" | "improvements" | "fixes";
export const RELEASE_NOTE_SECTIONS: ReleaseNoteSection[] = ["features", "improvements", "fixes"];

// No version has been released with verified employee-facing notes yet.
export const RELEASE_NOTES: ReleaseNote[] = [];

/** True when a note has at least one line to show; an entry with only empty sections counts as no notes. */
export function hasContent(note: ReleaseNote | null | undefined): note is ReleaseNote {
  return !!note && RELEASE_NOTE_SECTIONS.some((section) => (note[section] ?? []).length > 0);
}

export function findReleaseNotes(version: string | null | undefined, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote | null {
  if (!version) return null;
  const match = notes.find((note) => note.version === version);
  return hasContent(match) ? match : null;
}

export function localized(text: LocalizedText, language: string): string {
  return (language.startsWith("es") ? text.es : text.en) || text.en;
}

/** "2026-10-15" -> a readable date in the person's language; null for anything that is not a real date. */
export function formatReleaseDate(date: string | undefined, language: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) return null;
  try {
    return new Intl.DateTimeFormat(language.startsWith("es") ? "es" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(parsed);
  } catch {
    return date;
  }
}
