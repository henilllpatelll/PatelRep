import { listActiveRoomPeriods } from "@/lib/api/engineeringRooms";
import { buildRoomsDown, type RoomsDown } from "@/lib/engineering/roomsDown";
import { useAsyncResource, type AsyncResource } from "@/lib/engineering/useAsyncResource";

export interface RoomsDownResource extends Omit<AsyncResource<RoomsDown>, "data"> {
  impact: RoomsDown | null;
}

/**
 * The rooms that are down right now, read only while the Room Impact drawer is open (Home itself keeps using the overview's
 * aggregate). Opening the drawer always starts a fresh read; the last good list shows meanwhile. Scoped to hotel + person.
 */
export function useRoomsDown(scope: string | null, enabled: boolean): RoomsDownResource {
  const { data, ...rest } = useAsyncResource((signal) => listActiveRoomPeriods(signal).then(buildRoomsDown), { scope, key: "room-impact", enabled });
  return { ...rest, impact: data };
}
