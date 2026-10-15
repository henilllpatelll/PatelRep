import type { Room } from "@/stores/appStore";

/**
 * Pure rules for deciding what the room board may claim. A failed request is
 * never an empty board; cached or old data is labelled as such; rooms from a
 * different shift date are never today's work.
 */

/** Past this, a successful refresh is no longer "fresh". Polls run every 45 s. */
export const STALE_AFTER_MS = 5 * 60_000;

export function roomShiftDate(room: Pick<Room, "assignment_date">): string | null {
  const value = room.assignment_date?.slice(0, 10);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Rooms whose assignment belongs to another date are dropped; undated rooms cannot be disproved and stay. */
export function roomsForShiftDate(rooms: Room[], shiftDate: string): Room[] {
  return rooms.filter((room) => {
    const date = roomShiftDate(room);
    return date === null || date === shiftDate;
  });
}

/** True when every dated room belongs to some other day (the list is yesterday's). */
export function isWrongDay(rooms: Room[], shiftDate: string): boolean {
  const dated = rooms.map(roomShiftDate).filter((d): d is string => d !== null);
  return dated.length > 0 && dated.every((d) => d !== shiftDate);
}

/**
 * The shift date the loaded rooms belong to. The server may resolve a different
 * date than the one requested (it falls back to its own hotel date), so a current
 * server answer is trusted; once the calendar has moved past the day it was
 * requested for, only the hotel's calendar date is known.
 */
export function resolveBoardDate(
  expectedDate: string,
  serverDate: string | null,
  answeredForDate: string | null,
): string {
  const calendarRolled = answeredForDate !== null && answeredForDate !== expectedDate;
  return !calendarRolled && serverDate ? serverDate : expectedDate;
}

/** The list on hand is another day's: the calendar rolled since the last answer, or every room is dated otherwise. */
export function boardIsWrongDay(
  rooms: Room[],
  expectedDate: string,
  serverDate: string | null,
  answeredForDate: string | null,
): boolean {
  const calendarRolled = answeredForDate !== null && answeredForDate !== expectedDate;
  return calendarRolled || isWrongDay(rooms, resolveBoardDate(expectedDate, serverDate, answeredForDate));
}

export type BoardState =
  /** First load still running. */
  | "loading"
  /** Rooms to show (possibly cached or stale — see freshness). */
  | "ready"
  /** The server answered, and there are no assignments. The only "nothing to do" state. */
  | "empty"
  /** Nothing to show and no trustworthy answer: failed request, or offline with no cache. */
  | "unavailable"
  /** The hotel's day rolled over; yesterday's list is hidden until today's arrives. */
  | "stale_date";

export function resolveBoardState(input: {
  loading: boolean;
  roomCount: number;
  /** Rooms in the store belong to a date other than the hotel's current one. */
  wrongDay: boolean;
  /** The latest request for this person succeeded and said there are no assignments. */
  confirmedEmpty: boolean;
}): BoardState {
  if (input.wrongDay) return "stale_date";
  if (input.loading) return "loading";
  if (input.roomCount > 0) return "ready";
  return input.confirmedEmpty ? "empty" : "unavailable";
}

export type Freshness =
  /** Refreshed from the server recently. */
  | "fresh"
  /** Server data, but old or the latest refresh failed. */
  | "stale"
  /** Showing the device cache; no refresh has succeeded since opening. */
  | "cached"
  /** Nothing loaded yet. */
  | "never";

export function resolveFreshness(input: {
  lastRefreshAt: number | null;
  fetchFailed: boolean;
  hasRooms: boolean;
  now: number;
}): Freshness {
  const { lastRefreshAt, fetchFailed, hasRooms, now } = input;
  if (lastRefreshAt === null) return hasRooms ? "cached" : "never";
  if (fetchFailed || now - lastRefreshAt > STALE_AFTER_MS) return "stale";
  return "fresh";
}
