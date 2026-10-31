import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRoomRow,
  getActiveRoomPeriod,
  listRoomActiveRepairs,
  listRoomAssets,
  listRoomPeriods,
  listRoomRepairHistory,
} from "@/lib/api/engineeringRooms";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { markRoomBoardStale } from "@/lib/engineering/useRoomBoard";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export interface RoomHistory {
  orders: WorkOrder[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  failure: LoadFailure | null;
  loaded: boolean;
  loadMore: () => void;
  reload: () => Promise<void>;
}

/** Finished repairs for one room, paged, with the same stale-answer guard as every engineering read. */
function useRoomHistory(scope: string | null, roomId: string, enabled: boolean): RoomHistory {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loaded, setLoaded] = useState(false);
  const ticket = useRef(0);
  const key = `${scope ?? ""}|${roomId}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const moreInFlight = useRef(false);
  const pageRef = useRef(1);
  pageRef.current = page;

  const read = useCallback(
    async (mode: "first" | "more") => {
      const requestKey = keyRef.current;
      const mine = ++ticket.current;
      const nextPage = mode === "more" ? pageRef.current + 1 : 1;
      if (mode === "first") setLoading(true);
      else setLoadingMore(true);
      try {
        const result = await listRoomRepairHistory(roomId, nextPage);
        if (mine !== ticket.current || requestKey !== keyRef.current) return;
        setOrders((prev) => {
          if (mode === "first") return result.orders;
          const seen = new Set(prev.map((wo) => wo.id));
          return [...prev, ...result.orders.filter((wo) => !seen.has(wo.id))];
        });
        setPage(nextPage);
        setHasMore(result.hasMore);
        setFailure(null);
        setLoaded(true);
      } catch (err) {
        if (mine !== ticket.current || requestKey !== keyRef.current) return;
        setFailure(classifyLoadFailure(err));
      } finally {
        if (mine === ticket.current) {
          setLoading(false);
          setLoadingMore(false);
          moreInFlight.current = false;
        }
      }
    },
    [roomId],
  );

  useEffect(() => {
    setOrders([]);
    setPage(1);
    setHasMore(false);
    setLoaded(false);
    setFailure(null);
    moreInFlight.current = false;
    if (!enabled || !scope) return;
    void read("first");
    return () => {
      ticket.current += 1;
    };
  }, [key, enabled, scope, read]);

  const loadMore = useCallback(() => {
    if (!hasMore || moreInFlight.current) return;
    moreInFlight.current = true;
    void read("more");
  }, [hasMore, read]);

  const reload = useCallback(() => read("first"), [read]);
  return { orders, hasMore, loading, loadingMore, failure, loaded, loadMore, reload };
}

/**
 * Everything Room Detail shows, each part read on its own so one failing read never blanks the others:
 * the room's board row (occupancy, housekeeping, availability, counts), its active repairs, its equipment, the
 * active out-of-order record, its availability history and its repair history.
 */
export function useRoomDetail(scope: string | null, roomId: string) {
  const row = useAsyncResource((signal) => fetchRoomRow(roomId, signal), { scope, key: `eng-room-row:${roomId}` });
  const repairs = useAsyncResource((signal) => listRoomActiveRepairs(roomId, signal), { scope, key: `eng-room-repairs:${roomId}` });
  const equipment = useAsyncResource((signal) => listRoomAssets(roomId, signal), { scope, key: `eng-room-assets:${roomId}` });
  const period = useAsyncResource((signal) => getActiveRoomPeriod(roomId, signal), { scope, key: `eng-room-period:${roomId}` });
  const periods = useAsyncResource((signal) => listRoomPeriods(roomId, signal), { scope, key: `eng-room-periods:${roomId}` });
  const history = useRoomHistory(scope, roomId, true);

  const reloadRow = row.reload;
  const reloadRepairs = repairs.reload;
  const reloadEquipment = equipment.reload;
  const reloadPeriod = period.reload;
  const reloadPeriods = periods.reload;
  const reloadHistory = history.reload;

  /** After any change made from this screen (or returned to from a repair): re-read everything that could differ. */
  const reloadAll = useCallback(async () => {
    markRoomBoardStale();
    await Promise.all([reloadRow(), reloadRepairs(), reloadEquipment(), reloadPeriod(), reloadPeriods(), reloadHistory()]);
  }, [reloadRow, reloadRepairs, reloadEquipment, reloadPeriod, reloadPeriods, reloadHistory]);

  return { row, repairs, equipment, period, periods, history, reloadAll };
}
