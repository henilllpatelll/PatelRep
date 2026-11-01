import { hotelDateKey } from "@/lib/housekeeping/hotelTime";

/* Date wording for the asset screens. Instants are read in the HOTEL's time zone (an engineer on a phone set to
   another zone still sees the hotel's calendar day); date-only fields (install date, warranty) have no zone. */

function localeFor(language?: string): string {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

/** "Oct 31" for a stored instant, in the hotel's zone. */
export function formatDay(iso: string | null | undefined, timezone: string | null | undefined, language?: string): string | null {
  const key = hotelDateKey(iso, timezone);
  return key ? formatDateKey(key, language, false) : null;
}

/** "Oct 31, 2026" for a stored instant or a date-only value. */
export function formatDayYear(value: string | null | undefined, timezone: string | null | undefined, language?: string): string | null {
  if (!value) return null;
  const key = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : hotelDateKey(value, timezone);
  return key ? formatDateKey(key, language, true) : null;
}

/** "Oct 31, 4:12 PM" for a stored instant, in the hotel's zone. */
export function formatDayTime(iso: string | null | undefined, timezone: string | null | undefined, language?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString(localeFor(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone || undefined });
  } catch {
    return date.toLocaleString(localeFor(language), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}

function formatDateKey(key: string, language: string | undefined, withYear: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString(localeFor(language), { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** Whole days from `iso` to `now`; null when unparseable. */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.floor((now.getTime() - at) / 86_400_000) : null;
}

/** "3 h 20 min" / "2 d 4 h" for a recorded duration in minutes; never pads or rounds up. */
export function formatSpan(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.floor(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return `${hours} h ${total % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
