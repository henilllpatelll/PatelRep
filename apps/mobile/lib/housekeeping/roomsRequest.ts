import { api } from "@/lib/api/client";
import type { Room } from "@/stores/appStore";

/**
 * One request path for GET /housekeeping/my-rooms, shared by every caller (the
 * Home and My Rooms hooks, the store's refreshRooms, the reconnect sync).
 *
 *  - Overlapping calls for the same person + date share ONE request.
 *  - Every request gets an increasing sequence number when it STARTS. A caller
 *    applies its result only if `acceptRoomsResult(seq)` agrees, so an older
 *    response that lands late can never overwrite newer data.
 */

export interface MyRoomsResult {
  rooms: Room[];
  /** The hotel's IANA zone from response meta, if sent. */
  timezone: string | null;
  /** The shift date the SERVER resolved (authoritative), if sent. */
  shiftDate: string | null;
  seq: number;
  scope: string;
  requestedDate: string;
}

interface MyRoomsResponse {
  data: Room[];
  meta?: { timezone?: string | null; shift_date?: string | null };
}

let counter = 0;
let appliedSeq = 0;
let inFlight: { key: string; promise: Promise<MyRoomsResult> } | null = null;

export function fetchMyRooms(scope: string, date: string): Promise<MyRoomsResult> {
  const key = `${scope}|${date}`;
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const seq = (counter += 1);
  const promise: Promise<MyRoomsResult> = api
    .get<MyRoomsResponse>(`/housekeeping/my-rooms?date=${date}`)
    .then((result) => ({
      rooms: result.data,
      timezone: result.meta?.timezone ?? null,
      shiftDate: result.meta?.shift_date ?? null,
      seq,
      scope,
      requestedDate: date,
    }))
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { key, promise };
  return promise;
}

/** True when this result is not older than what was already applied (and records it). */
export function acceptRoomsResult(seq: number): boolean {
  if (seq < appliedSeq) return false;
  appliedSeq = seq;
  return true;
}

/** Test/sign-out hook: forget in-flight and applied state. */
export function resetRoomsRequestState(): void {
  counter = 0;
  appliedSeq = 0;
  inFlight = null;
}
