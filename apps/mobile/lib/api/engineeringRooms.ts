import { api } from "@/lib/api/client";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { AssetRow } from "@/lib/engineering/assetModel";
import type { AvailabilityReason, CreateAvailabilityBody, PeriodResult, ReleaseBody } from "@/lib/engineering/roomAvailability";
import type { RoomBoardPage, RoomBoardParams, RoomBoardRow, RoomUnavailability } from "@/lib/engineering/roomModel";

export const ROOM_BOARD_PAGE_SIZE = 25;
export const ROOM_HISTORY_PAGE_SIZE = 10;

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== false && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

interface BoardResponse {
  data: RoomBoardRow[];
  meta?: {
    total?: number;
    has_more?: boolean;
    counts?: RoomBoardPage["counts"];
    facets?: { floors?: number[]; buildings?: string[] };
  };
}

/** One page of rooms for a search + filter combination (GET /rooms/engineering-board). */
export async function fetchRoomBoard(params: RoomBoardParams, page: number, signal?: AbortSignal): Promise<RoomBoardPage> {
  const res = await api.get<BoardResponse>(
    `/rooms/engineering-board?${queryString({ ...params, page: page > 1 ? page : undefined, per_page: ROOM_BOARD_PAGE_SIZE })}`,
    { signal },
  );
  const rows = res.data ?? [];
  return {
    rows,
    total: res.meta?.total ?? rows.length,
    hasMore: res.meta?.has_more ?? rows.length >= ROOM_BOARD_PAGE_SIZE,
    counts: res.meta?.counts ?? null,
    floors: res.meta?.facets?.floors ?? [],
    buildings: res.meta?.facets?.buildings ?? [],
  };
}

/** One room's board row (same derivation and visibility as the list), or null when it is not in this hotel. */
export async function fetchRoomRow(roomId: string, signal?: AbortSignal): Promise<RoomBoardRow | null> {
  const res = await api.get<BoardResponse>(`/rooms/engineering-board?${queryString({ room_id: roomId, per_page: 1 })}`, { signal });
  return res.data?.[0] ?? null;
}

export interface RoomWorkOrderPage {
  orders: WorkOrder[];
  hasMore: boolean;
}

/** Active repairs in one room, most urgent first. Same visibility as the Work tab. */
export async function listRoomActiveRepairs(roomId: string, signal?: AbortSignal): Promise<WorkOrder[]> {
  const res = await api.get<{ data: WorkOrder[] }>(
    `/work-orders?${queryString({ room_id: roomId, statuses: "open,escalated,in_progress,on_hold", sort_by: "priority", per_page: 50 })}`,
    { signal },
  );
  return res.data ?? [];
}

/** Finished repairs in one room, newest first, paged. */
export async function listRoomRepairHistory(roomId: string, page = 1, signal?: AbortSignal): Promise<RoomWorkOrderPage> {
  const res = await api.get<{ data: WorkOrder[]; meta?: { has_more?: boolean } }>(
    `/work-orders?${queryString({
      room_id: roomId,
      statuses: "completed,cancelled",
      sort_by: "updated_at",
      sort_dir: "desc",
      page: page > 1 ? page : undefined,
      per_page: ROOM_HISTORY_PAGE_SIZE,
    })}`,
    { signal },
  );
  const orders = res.data ?? [];
  return { orders, hasMore: res.meta?.has_more ?? orders.length >= ROOM_HISTORY_PAGE_SIZE };
}

export interface RoomPeriod extends RoomUnavailability {
  status?: "ACTIVE" | "RELEASED" | "CANCELLED";
  actual_return_at?: string | null;
  release_notes?: string | null;
  repair_completed_at?: string | null;
  work_orders?: { id?: string; work_order_number?: string | null; title?: string | null; status?: string | null; priority?: string | null; assigned_to?: string | null } | null;
}

/** Every out-of-order / out-of-service period the room has had, newest first (the endpoint is not paged). */
export async function listRoomPeriods(roomId: string, signal?: AbortSignal): Promise<RoomPeriod[]> {
  const res = await api.get<{ data: RoomPeriod[] }>(`/room-unavailability?${queryString({ room_id: roomId })}`, { signal });
  return res.data ?? [];
}

/** A room that is down right now, with the room's number and the repair the period is linked to. */
export interface ActiveRoomPeriod extends RoomPeriod {
  room_id?: string | null;
  rooms?: { room_number?: string | null; floor?: number | null } | null;
}

/** Every room currently out of order / service in this hotel (GET /room-unavailability?status=ACTIVE; not paged). */
export async function listActiveRoomPeriods(signal?: AbortSignal): Promise<ActiveRoomPeriod[]> {
  const res = await api.get<{ data: ActiveRoomPeriod[] }>(`/room-unavailability?${queryString({ status: "ACTIVE" })}`, { signal });
  return res.data ?? [];
}

export async function getActiveRoomPeriod(roomId: string, signal?: AbortSignal): Promise<RoomPeriod | null> {
  const res = await api.get<{ data: RoomPeriod | null }>(`/room-unavailability/room/${encodeURIComponent(roomId)}/active`, { signal });
  return res.data ?? null;
}

export async function listAvailabilityReasons(signal?: AbortSignal): Promise<AvailabilityReason[]> {
  const res = await api.get<{ data: AvailabilityReason[] }>("/room-unavailability/reasons", { signal });
  return (res.data ?? []).filter((reason) => reason.is_active !== false);
}

export async function createRoomUnavailability(body: CreateAvailabilityBody): Promise<PeriodResult | null> {
  const res = await api.post<{ data: PeriodResult | null }>("/room-unavailability", body);
  return res.data;
}

export async function updateExpectedReturn(periodId: string, expectedReturnAt: Date, note: string): Promise<PeriodResult | null> {
  const res = await api.patch<{ data: PeriodResult | null }>(`/room-unavailability/${encodeURIComponent(periodId)}/expected-return`, {
    expected_return_at: expectedReturnAt.toISOString(),
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  return res.data;
}

export async function releaseRoomUnavailability(periodId: string, body: ReleaseBody): Promise<PeriodResult | null> {
  const res = await api.post<{ data: PeriodResult | null }>(`/room-unavailability/${encodeURIComponent(periodId)}/release`, body);
  return res.data;
}

export interface RoomAssets {
  assets: AssetRow[];
  /** More equipment is registered to the room than was returned. */
  truncated: boolean;
}

/** Equipment registered to one room (GET /assets/browse scoped by room). Rooms with none return an empty list. */
export async function listRoomAssets(roomId: string, signal?: AbortSignal): Promise<RoomAssets> {
  const res = await api.get<{ data: AssetRow[]; meta?: { has_more?: boolean } }>(
    `/assets/browse?${queryString({ room_id: roomId, sort_by: "name", per_page: 50 })}`,
    { signal },
  );
  return { assets: res.data ?? [], truncated: Boolean(res.meta?.has_more) };
}
