import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRoomDirectory, type RoomOption } from "@/lib/api/tasks";

/* ─── Room directory for the Add Task picker ────────────────────────────────
   The list comes from GET /rooms/directory, which is scoped to the signed-in hotel on the server, so
   nothing here can offer a room of another property. It is cached per hotel+user for the session and
   dropped when either changes. */

/** "Room 318", "rm 318", " 318 " -> "318". Letters stay (rooms like "12A" exist). */
export function normalizeRoomQuery(input: string): string {
  return input
    .trim()
    .replace(/^(?:room|rm|habitaci[oó]n|hab)\.?\s*#?\s*/i, "")
    .replace(/^#/, "")
    .trim();
}

/** The one room whose number is exactly what was typed, or null (never a "close" match). */
export function findRoomByNumber(rooms: RoomOption[], input: string): RoomOption | null {
  const wanted = normalizeRoomQuery(input).toLowerCase();
  if (!wanted) return null;
  return rooms.find((room) => room.room_number.toLowerCase() === wanted) ?? null;
}

/** Rooms to list for a query: numbers starting with it first, then ones containing it. */
export function searchRooms(rooms: RoomOption[], input: string, limit = 40): RoomOption[] {
  const wanted = normalizeRoomQuery(input).toLowerCase();
  if (!wanted) return rooms.slice(0, limit);
  const starts: RoomOption[] = [];
  const contains: RoomOption[] = [];
  for (const room of rooms) {
    const number = room.room_number.toLowerCase();
    if (number.startsWith(wanted)) starts.push(room);
    else if (number.includes(wanted)) contains.push(room);
  }
  return [...starts, ...contains].slice(0, limit);
}

type Cache = { owner: string; rooms: RoomOption[] } | null;
let cache: Cache = null;

/** Test hook and sign-out cleanup. */
export function clearRoomDirectoryCache() {
  cache = null;
}

export type RoomDirectoryStatus = "idle" | "loading" | "ready" | "error";

/** Loads the directory when `enabled`; re-loadable, and never shared between hotels or users. */
export function useRoomDirectory(owner: string | null, enabled: boolean) {
  const [rooms, setRooms] = useState<RoomOption[]>(cache && cache.owner === owner ? cache.rooms : []);
  const [status, setStatus] = useState<RoomDirectoryStatus>(cache && cache.owner === owner ? "ready" : "idle");
  const run = useRef(0);

  const load = useCallback(async () => {
    if (!owner) return;
    const ticket = ++run.current;
    setStatus("loading");
    try {
      const list = await fetchRoomDirectory();
      if (ticket !== run.current) return;
      cache = { owner, rooms: list };
      setRooms(list);
      setStatus("ready");
    } catch {
      if (ticket !== run.current) return;
      setStatus("error");
    }
  }, [owner]);

  useEffect(() => {
    if (cache && owner && cache.owner !== owner) cache = null;
    if (!enabled || !owner) return;
    if (cache && cache.owner === owner) {
      setRooms(cache.rooms);
      setStatus("ready");
      return;
    }
    void load();
  }, [enabled, owner, load]);

  useEffect(() => () => void (run.current += 1), []);

  return { rooms, status, reload: load };
}
