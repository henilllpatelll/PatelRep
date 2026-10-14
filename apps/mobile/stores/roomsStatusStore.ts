import { create } from "zustand";

/**
 * Shared status of the my-rooms refresh, so Home and My Rooms describe the
 * same data the same way. Rooms themselves stay in appStore (the one room
 * source of truth); this only records how trustworthy they currently are.
 */

export interface RoomsStatus {
  /** `${tenantId}:${userId}` this status belongs to. */
  scope: string | null;
  /** First load has not finished. */
  loading: boolean;
  refreshing: boolean;
  /** Message from the latest failed fetch; null after a success. */
  fetchError: string | null;
  /** The rows on screen came from the device cache, not a fresh response. */
  usingCache: boolean;
  /** ms epoch of the last response from the server. */
  lastRefreshAt: number | null;
  /** The last successful response said "no assignments" (an answer, not a failure). */
  confirmedEmpty: boolean;
  /** Shift date the server resolved for the last response. */
  serverShiftDate: string | null;
  /** The hotel calendar date the last applied response was REQUESTED for; null when no server answer is current. */
  answeredForDate: string | null;
  /** Ranking clock: only moves on deliberate refreshes or when the room set changes. */
  rankedAt: number;
}

const initial = (scope: string | null): RoomsStatus => ({
  scope,
  loading: true,
  refreshing: false,
  fetchError: null,
  usingCache: false,
  lastRefreshAt: null,
  confirmedEmpty: false,
  serverShiftDate: null,
  answeredForDate: null,
  rankedAt: Date.now(),
});

interface Store extends RoomsStatus {
  /** Switch person/hotel: nothing carries over. No-op when the scope is unchanged. */
  ensureScope: (scope: string | null) => void;
  patch: (change: Partial<RoomsStatus>) => void;
}

export const useRoomsStatus = create<Store>((set, get) => ({
  ...initial(null),
  ensureScope: (scope) => {
    if (get().scope !== scope) set({ ...initial(scope) });
  },
  patch: (change) => set(change),
}));

export function resetRoomsStatus(): void {
  useRoomsStatus.setState({ ...initial(null) });
}
