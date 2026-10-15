import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearRoomsCache, getRoomsByDate, upsertRooms } from "@/lib/offline/db";
import type { Room } from "@/stores/appStore";

/**
 * The offline room cache, stamped with the person it belongs to
 * (`${tenantId}:${userId}`). A cache with no stamp or someone else's stamp is
 * treated as empty and replaced on the next write, so rooms from another hotel,
 * another account or an earlier app version can never show up as today's work.
 */

const STAMP_KEY = "@patelrep/rooms_cache_scope";

export async function readRoomsCache(scope: string | null, shiftDate: string): Promise<Room[]> {
  if (!scope) return [];
  try {
    const stamp = await AsyncStorage.getItem(STAMP_KEY);
    if (stamp !== scope) return [];
    return (await getRoomsByDate(shiftDate)) as Room[];
  } catch (err) {
    console.warn("[rooms-cache] read failed", err);
    return [];
  }
}

/** `replaceDate`: the assignment date this list is the COMPLETE set for. */
export async function writeRoomsCache(scope: string | null, rooms: Room[], replaceDate: string): Promise<void> {
  if (!scope) return;
  try {
    const stamp = await AsyncStorage.getItem(STAMP_KEY);
    if (stamp !== scope) await clearRoomsCache();
    await upsertRooms(rooms, { replaceDate });
    if (stamp !== scope) await AsyncStorage.setItem(STAMP_KEY, scope);
  } catch (err) {
    console.warn("[rooms-cache] write failed", err);
  }
}
