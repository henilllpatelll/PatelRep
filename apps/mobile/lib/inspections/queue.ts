import type { ReadyRoom } from "@/lib/api/inspections";
import { normalizeQuery, searchRank } from "@/lib/housekeeping/roomBoardFilters";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";
import { reinspectionContext, type ReinspectionContext } from "@/lib/inspections/corrections";

/* ─── The inspection queue — model and freshness (pure) ─────────────────────
   Rooms the server says are CLEAN and waiting for a supervisor, for the hotel the person is signed in to. The model
   keeps every fact the inspection flow must NOT guess (room type, clean cycle, what failed last time) exactly as the
   server gave it, and keeps room NUMBERS as labels only: the room id is the identity. */

export interface QueueItem {
  /** The stable identity. Never a room number. */
  roomId: string;
  roomNumber: string;
  floor: number | null;
  building: string | null;
  /** When the room became CLEAN (epoch ms), or null when unknown / unparseable. */
  cleanedAtMs: number | null;
  cleanedBy: string;
  housekeeperId: string | null;
  cleanType: string | null;
  roomTypeId: string | null;
  /** The room type's recorded name, for display; null when the server did not send one (never guessed). */
  roomTypeName: string | null;
  cleanCycleId: string | null;
  reinspection: ReinspectionContext;
  /** Recorded operational facts. `vip` is null when the server does not send the flag (so "not VIP" is never assumed). */
  vip: boolean | null;
  arrivalAtMs: number | null;
  /** 1 (highest) .. 10, or null when not recorded. */
  priority: number | null;
  neededByMs: number | null;
  /** The row as the server returned it; handed to the inspection flow untouched. */
  room: ReadyRoom;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Natural room order: floor, then room number compared numerically where both are numbers ("99" before "100"). */
export function compareRooms(a: Pick<QueueItem, "floor" | "roomNumber">, b: Pick<QueueItem, "floor" | "roomNumber">): number {
  if ((a.floor ?? -1) !== (b.floor ?? -1)) return (a.floor ?? -1) - (b.floor ?? -1);
  return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
}

export function buildQueue(rooms: readonly ReadyRoom[]): QueueItem[] {
  const seen = new Set<string>();
  const items: QueueItem[] = [];
  for (const room of rooms) {
    // The same room twice would let one tap inspect it twice; the id is the identity.
    if (!room.room_id || seen.has(room.room_id)) continue;
    seen.add(room.room_id);
    items.push({
      roomId: room.room_id,
      roomNumber: room.room_number,
      floor: room.floor ?? null,
      building: room.building?.trim() || null,
      cleanedAtMs: parseMs(room.cleaned_at),
      cleanedBy: room.cleaned_by ?? "",
      housekeeperId: room.housekeeper_id ?? null,
      cleanType: room.clean_type ?? null,
      roomTypeId: room.room_type_id ?? null,
      roomTypeName: room.room_type_name?.trim() || null,
      cleanCycleId: room.clean_cycle_id ?? null,
      reinspection: reinspectionContext(room),
      vip: typeof room.vip === "boolean" ? room.vip : null,
      arrivalAtMs: parseMs(room.arrival_at),
      priority: typeof room.priority === "number" && Number.isFinite(room.priority) ? room.priority : null,
      neededByMs: parseMs(room.priority_needed_by),
      room,
    });
  }
  return items.sort(compareRooms);
}

/** Whole minutes a room has waited since it was cleaned; null when the clean time is unknown. Never negative. */
export function waitingMinutes(item: Pick<QueueItem, "cleanedAtMs">, now: number): number | null {
  return item.cleanedAtMs === null ? null : Math.max(0, Math.floor((now - item.cleanedAtMs) / 60_000));
}

/** Room-number search: exact, then prefix, then contains (case- and whitespace-insensitive). Never matches people or guests. */
export function searchQueue<T extends Pick<QueueItem, "roomNumber">>(items: readonly T[], query: string): T[] {
  const needle = normalizeQuery(query);
  if (!needle) return [...items];
  const ranked: T[][] = [[], [], []];
  for (const item of items) {
    const rank = searchRank(item.roomNumber, needle);
    if (rank !== null) ranked[rank].push(item);
  }
  return [...ranked[0], ...ranked[1], ...ranked[2]];
}

/* ─── Freshness ─────────────────────────────────────────────────────────── */

export type QueueFreshness =
  /** A verified answer, recent. */
  | "live"
  /** The last good answer is showing, but it is old, was not renewed, or the device is offline. */
  | "stale"
  /** Nothing verified yet (loading) or the request failed with nothing to show: unknown, never "all clear". */
  | "unverified";

export function queueFreshness(source: SourceState<unknown>, now: number, staleAfterMs: number = STALE_AFTER_MS): QueueFreshness {
  switch (source.status) {
    case "available":
    case "empty":
      return now - source.fetchedAt > staleAfterMs ? "stale" : "live";
    case "stale":
      return "stale";
    case "loading":
    case "failed":
      return "unverified";
  }
}

/**
 * The rooms to show, or null when nothing is known. An EMPTY list is only returned for a verified-empty answer, so
 * "nothing to inspect" is never confused with "we could not load".
 */
export function queueRooms(source: SourceState<readonly ReadyRoom[]>): readonly ReadyRoom[] | null {
  switch (source.status) {
    case "available":
      return source.data;
    case "empty":
      return [];
    case "stale":
      return source.data ?? [];
    case "loading":
    case "failed":
      return null;
  }
}
