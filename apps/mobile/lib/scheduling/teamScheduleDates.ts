import { addDaysToYmd, formatHotelTime, hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";

/* ─── Team Schedule — calendar math ─────────────────────────────────────────
   Pure. Every date here is a hotel-local calendar day ("YYYY-MM-DD") handled as a label, not as an instant: adding
   days uses UTC calendar arithmetic (so a DST change cannot move a date) and display formats at noon UTC with
   timeZone "UTC" (so the device's zone can never shift the weekday). Weeks start on Monday, like the server's
   own week (`_week_start`) and the personal My Schedule screen. */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = YMD.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 0 = Monday … 6 = Sunday. */
function mondayIndex(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function weekStartOf(ymd: string): string {
  return addDaysToYmd(ymd, -mondayIndex(ymd));
}

export function weekDays(ymd: string): string[] {
  const start = weekStartOf(ymd);
  return Array.from({ length: 7 }, (_, index) => addDaysToYmd(start, index));
}

export function shiftWeek(ymd: string, weeks: number): string {
  return addDaysToYmd(ymd, weeks * 7);
}

export function isSameWeek(a: string, b: string): boolean {
  return weekStartOf(a) === weekStartOf(b);
}

function localeFor(language?: string): string {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

function noonUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Thursday, October 29" / "jueves, 29 de octubre". */
export function formatLongDate(ymd: string, language?: string): string {
  return noonUtc(ymd).toLocaleDateString(localeFor(language), { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** "Oct 29". */
export function formatShortDate(ymd: string, language?: string): string {
  return noonUtc(ymd).toLocaleDateString(localeFor(language), { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Mon" / "lun". */
export function formatWeekdayShort(ymd: string, language?: string): string {
  return noonUtc(ymd).toLocaleDateString(localeFor(language), { weekday: "short", timeZone: "UTC" });
}

/** Day of the month as text: "29". */
export function dayOfMonth(ymd: string): string {
  return String(Number(ymd.slice(8, 10)));
}

/**
 * "Oct 26 – Nov 1" / "Dec 28 – Jan 3, 2027": the year appears only when the week crosses a year boundary, and then
 * on the side that needs it.
 */
export function formatWeekRange(ymd: string, language?: string): string {
  const days = weekDays(ymd);
  const first = days[0];
  const last = days[6];
  const crossesYear = first.slice(0, 4) !== last.slice(0, 4);
  const locale = localeFor(language);
  const base: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const withYear: Intl.DateTimeFormatOptions = { ...base, year: "numeric" };
  const left = noonUtc(first).toLocaleDateString(locale, crossesYear ? withYear : base);
  const right = noonUtc(last).toLocaleDateString(locale, crossesYear ? withYear : base);
  return `${left} – ${right}`;
}

/** "HH:MM" or "HH:MM:SS" → minutes after midnight, or null. */
export function clockMinutes(value: string | null | undefined): number | null {
  const match = value ? /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim()) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

/**
 * "7:00 AM" for a shift's hotel wall-clock time on `ymd`. The hotel's own wall clock is what the snapshot stores,
 * so it is rendered through the hotel zone (a phone elsewhere still reads the hotel's time). Falls back to the
 * absolute instant when the wall-clock text is missing.
 */
export function formatWallClock(ymd: string, clock: string | null, fallbackInstant: string, zone: string | null | undefined, language?: string): string {
  const minutes = clockMinutes(clock);
  if (minutes !== null) {
    const instant = zonedTimeToInstant(ymd, Math.floor(minutes / 60), minutes % 60, zone);
    const text = instant ? formatHotelTime(instant, zone, language) : null;
    if (text) return text;
  }
  return formatHotelTime(fallbackInstant, zone, language) ?? "—";
}

/** The hotel-local calendar day an instant falls on. */
export function hotelDayOf(instant: string, zone: string | null | undefined): string | null {
  return hotelDateKey(instant, zone);
}

export { addDaysToYmd };
