import { isActiveWorkOrder, type WorkOrder } from "@/lib/engineering/workOrders";
import type { AssetServiceStatus } from "@/lib/engineering/assetModel";
import { isSafeRouteId } from "@/lib/engineering/routes";

/* The facts a "Review Room Impact" sheet shows. Everything here is read, none of it is decided: the sheet never changes
   a room's availability, so a down piece of equipment, an open repair or a finished repair says nothing about whether the
   room can be sold. The room's own availability comes from the room board read, shown separately. */

export interface RoomImpactInput {
  roomId: string | null | undefined;
  roomNumber: string | null | undefined;
  /** Shared-area equipment has a free-text location and no room; it is shown as that location, never as a room. */
  locationText: string | null | undefined;
  serviceStatus: AssetServiceStatus;
  /** Repairs linked to THIS asset by id (never to the room), as already loaded. */
  repairs: readonly WorkOrder[];
  activeDowntimeSince: string | null | undefined;
}

export interface RoomImpact {
  /** An authoritative room link exists and can be opened. */
  hasRoom: boolean;
  roomId: string | null;
  roomNumber: string | null;
  locationText: string | null;
  serviceStatus: AssetServiceStatus;
  activeRepairs: WorkOrder[];
  downtimeSince: string | null;
}

export function buildRoomImpact(input: RoomImpactInput): RoomImpact {
  const roomId = isSafeRouteId(input.roomId) ? input.roomId : null;
  return {
    hasRoom: roomId != null && !!input.roomNumber?.trim(),
    roomId,
    roomNumber: input.roomNumber?.trim() || null,
    locationText: input.locationText?.trim() || null,
    serviceStatus: input.serviceStatus,
    activeRepairs: input.repairs.filter(isActiveWorkOrder),
    downtimeSince: input.activeDowntimeSince ?? null,
  };
}
