/**
 * Hotel-local time helpers.
 *
 * The API sends every timestamp as an absolute instant (ISO-8601 with offset)
 * and tells the app which IANA zone the hotel runs in (`meta.timezone` on
 * GET /housekeeping/my-rooms, default America/Chicago server-side). Display
 * converts each instant exactly once, into that zone — never the device's — and
 * typed wall-clock times ("1:30 PM") are converted the other way, so a phone on
 * a different clock still records the hotel's 1:30 PM.
 */

import { localDate } from "@/lib/utils/date";

export const DEFAULT_HOTEL_TIMEZONE = "America/Chicago";

const validZones = new Map<string, boolean>();

export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  const cached = validZones.get(zone);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
  } catch {
    ok = false;
  }
  validZones.set(zone, ok);
  return ok;
}

/** An unusable/missing zone falls back to the established default, not the device. */
export function resolveTimeZone(zone: string | null | undefined): string {
  return isValidTimeZone(zone) ? zone : DEFAULT_HOTEL_TIMEZONE;
}

function localeFor(language?: string): string {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "1:30 PM" in the hotel's zone. */
export function formatHotelTime(
  value: string | Date | null | undefined,
  zone: string | null | undefined,
  language?: string,
): string | null {
  const date = parse(value);
  if (!date) return null;
  return date.toLocaleTimeString(localeFor(language), {
    hour: "numeric",
    minute: "2-digit",
    timeZone: resolveTimeZone(zone),
  });
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, zone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") % 24, minute: read("minute") };
}

/** Calendar date (YYYY-MM-DD) of an instant in the hotel's zone. */
export function hotelDateKey(value: string | Date | null | undefined, zone: string | null | undefined): string | null {
  const date = parse(value);
  if (!date) return null;
  const p = zonedParts(date, resolveTimeZone(zone));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset of `zone` from UTC (ms) at the given instant — DST-aware. */
function zoneOffsetMs(instant: number, zone: string): number {
  const p = zonedParts(new Date(instant), zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

/**
 * The instant at which the wall clock in `zone` reads `ymd` `hour:minute`.
 * Handles DST: a time that does not exist (spring-forward gap) resolves to the
 * moment just after the gap; an ambiguous one (fall-back) to its first
 * occurrence.
 */
export function zonedTimeToInstant(ymd: string, hour: number, minute: number, zone: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const tz = resolveTimeZone(zone);
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute);
  let instant = wall - zoneOffsetMs(wall, tz);
  // The offset can differ at the corrected instant (across a DST boundary): re-solve once.
  const corrected = wall - zoneOffsetMs(instant, tz);
  if (corrected !== instant) {
    const check = zonedParts(new Date(corrected), tz);
    if (check.hour === hour && check.minute === minute) instant = corrected;
  }
  return new Date(instant);
}

/** "1:30 PM" / "13:30" / "1pm" → 24h clock, or null when it is not a time. */
export function parseClockText(input: string | null | undefined): { hour: number; minute: number } | null {
  const raw = input?.trim() ?? "";
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$|^(\d{1,2}):(\d{2})$/i);
  if (!match) return null;
  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const pm = match[3].toLowerCase() === "p";
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (pm && hour < 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  return { hour, minute };
}

export type ReturnTimeResult =
  | { ok: true; iso: string }
  | { ok: false; reason: "invalid" | "past" };

/**
 * Turn the time the attendant typed into the instant to retry, using the hotel's
 * calendar day. A time that has already passed today is rejected rather than
 * silently rolled to tomorrow or stored as a past retry.
 */
export function resolveReturnTime(
  text: string | null | undefined,
  zone: string | null | undefined,
  now: Date = new Date(),
): ReturnTimeResult {
  const clock = parseClockText(text);
  if (!clock) return { ok: false, reason: "invalid" };
  const today = hotelDateKey(now, zone);
  const instant = today ? zonedTimeToInstant(today, clock.hour, clock.minute, zone) : null;
  if (!instant) return { ok: false, reason: "invalid" };
  if (instant.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  return { ok: true, iso: instant.toISOString() };
}

/** "Thursday, October 8" for a YYYY-MM-DD shift date (no timezone shift: it is a calendar label). */
export function formatShiftDate(ymd: string | null | undefined, language?: string): string | null {
  const match = ymd ? /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.toLocaleDateString(localeFor(language), { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * The shift date to request. Once the hotel's zone is known the date is the
 * hotel's calendar day; before that (first launch) the device date is the best
 * available guess and the server falls back to the hotel date if it differs.
 */
export function currentShiftDate(zone: string | null | undefined, now: Date = new Date()): string {
  return isValidTimeZone(zone) ? (hotelDateKey(now, zone) ?? localDate()) : localDate();
}
