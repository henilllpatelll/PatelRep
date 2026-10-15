import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { currentShiftDate, isValidTimeZone } from "@/lib/housekeeping/hotelTime";
import { readRoomsCache, writeRoomsCache } from "@/lib/housekeeping/roomsCache";
import {
  boardIsWrongDay,
  isWrongDay,
  resolveBoardState,
  resolveFreshness,
  roomShiftDate,
  type BoardState,
  type Freshness,
} from "@/lib/housekeeping/roomsFreshness";
import { acceptRoomsResult, fetchMyRooms } from "@/lib/housekeeping/roomsRequest";
import { useAppStore, type Room } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import { useRoomsStatus } from "@/stores/roomsStatusStore";

const POLL_MS = 45_000;
const TZ_KEY_PREFIX = "@patelrep/hotel_timezone/";

export interface MyRoomsData {
  loading: boolean;
  refreshing: boolean;
  /** Message from the latest failed fetch; null after a success. */
  fetchError: string | null;
  /** The rows on screen came from the device cache, not a fresh response. */
  usingCache: boolean;
  lastUpdated: Date | null;
  /** The hotel's IANA zone, once known (cached per hotel for offline starts). */
  timeZone: string | null;
  /** Calendar date the listed rooms belong to, in hotel time. */
  shiftDate: string;
  /** The hotel's calendar date right now; differs from `shiftDate` after midnight until a refresh lands. */
  expectedShiftDate: string;
  /** Shift date the server resolved for the last answer, and the calendar date it was requested for. */
  serverShiftDate: string | null;
  answeredForDate: string | null;
  /**
   * The clock the suggested route was last ranked at. It only moves when data
   * is refreshed, so arrival-time tiers cannot reshuffle the list while the
   * attendant is scrolling or tapping.
   */
  rankedAt: Date;
  /** The server has answered at least once for this person since the app opened. */
  hasConfirmedFetch: boolean;
  /** The latest request succeeded and the server said there are no assignments. */
  confirmedEmpty: boolean;
  freshness: Freshness;
  boardState: BoardState;
  refresh: () => Promise<void>;
}

function signatureOf(rooms: Room[]): string {
  return rooms.map((room) => room.id).sort().join("|");
}

/**
 * Loads /housekeeping/my-rooms into the app store (the single room source of
 * truth), falls back to the offline cache, and keeps it fresh on an interval
 * and on foreground. A failed fetch is reported, never turned into "no rooms".
 *
 * Every screen using this hook shares one request path (overlapping refreshes
 * join one request, late responses are dropped) and one status record, so Home
 * and My Rooms always agree on what is loaded and how fresh it is.
 */
export function useMyRoomsData({ enabled = true }: { enabled?: boolean } = {}): MyRoomsData {
  const { isOnline, myRooms, setMyRooms, hotelTimezone, setHotelTimezone, user } = useAppStore();
  const tenantId = user?.tenant_id ?? null;
  const scope = user ? `${user.tenant_id}:${user.id}` : null;
  const status = useRoomsStatus();

  const roomsRef = useRef<Room[]>(myRooms);
  roomsRef.current = myRooms;
  const scopeRef = useRef<string | null>(scope);
  scopeRef.current = scope;
  // Re-rank the suggested route only for deliberate refreshes (open, foreground,
  // pull-to-refresh) or when the set of assigned rooms changes — not on every poll.
  const forceRank = useRef(true);

  const zoneRef = useRef<string | null>(hotelTimezone ?? null);
  zoneRef.current = hotelTimezone ?? null;

  // A different person or hotel starts from a clean status.
  useEffect(() => {
    useRoomsStatus.getState().ensureScope(scope);
  }, [scope]);

  // Offline cold start: the hotel's zone was cached the last time we were online.
  useEffect(() => {
    if (!tenantId || zoneRef.current) return;
    void AsyncStorage.getItem(TZ_KEY_PREFIX + tenantId)
      .then((zone) => {
        if (isValidTimeZone(zone) && !zoneRef.current) setHotelTimezone?.(zone);
      })
      .catch(() => undefined);
  }, [tenantId, setHotelTimezone]);

  const loadRooms: (retryOnRollover?: boolean) => Promise<void> = useCallback(
    (retryOnRollover = true): Promise<void> =>
      (async () => {
        if (!scope || !enabled) return;
        const patch = useRoomsStatus.getState().patch;
        const expectedDate = currentShiftDate(zoneRef.current);

        const fallBackToCache = async () => {
          // A server answer for a day that is over no longer describes today.
          const answered = useRoomsStatus.getState().answeredForDate;
          if (answered !== null && answered !== expectedDate) patch({ answeredForDate: null, serverShiftDate: null });
          // Keep what is already on screen — unless it is another day's list or empty.
          const current = roomsRef.current;
          if (current.length > 0 && !isWrongDay(current, expectedDate)) return;
          const cached = await readRoomsCache(scope, expectedDate);
          if (scopeRef.current !== scope) return;
          if (cached.length > 0 || current.length > 0) setMyRooms(cached);
        };

        if (!isOnline) {
          patch({ fetchError: null, usingCache: true, confirmedEmpty: false, loading: false });
          await fallBackToCache();
          return;
        }

        try {
          const result = await fetchMyRooms(scope, expectedDate);
          if (scopeRef.current !== scope) return; // signed out / switched hotel mid-request
          if (!acceptRoomsResult(result.seq)) return; // a newer answer was already applied
          const answeredDate = result.shiftDate ?? result.requestedDate;
          // The hotel's day rolled over while this request was out: it answers a day that is over.
          if (result.requestedDate !== currentShiftDate(zoneRef.current)) {
            if (retryOnRollover) await loadRooms(false);
            return;
          }

          const now = Date.now();
          const rankNow = forceRank.current || signatureOf(result.rooms) !== signatureOf(roomsRef.current);
          setMyRooms(result.rooms);
          if (isValidTimeZone(result.timezone)) {
            if (result.timezone !== zoneRef.current) setHotelTimezone?.(result.timezone);
            if (tenantId) void AsyncStorage.setItem(TZ_KEY_PREFIX + tenantId, result.timezone).catch(() => undefined);
          }
          forceRank.current = false;
          patch({
            fetchError: null,
            usingCache: false,
            lastRefreshAt: now,
            confirmedEmpty: result.rooms.length === 0,
            serverShiftDate: answeredDate,
            answeredForDate: result.requestedDate,
            loading: false,
            ...(rankNow ? { rankedAt: now } : {}),
          });
          await writeRoomsCache(scope, result.rooms, answeredDate);
        } catch (err: unknown) {
          if (scopeRef.current !== scope) return;
          patch({
            fetchError: err instanceof Error ? err.message : String(err),
            usingCache: true,
            confirmedEmpty: false,
            loading: false,
          });
          await fallBackToCache();
        }
      })(),
    [enabled, isOnline, scope, setMyRooms, setHotelTimezone, tenantId],
  );

  useEffect(() => {
    if (!enabled) return;
    void loadRooms();
    const interval = setInterval(() => {
      // A sibling screen refreshed moments ago; one poll per interval is enough.
      const last = useRoomsStatus.getState().lastRefreshAt;
      if (last !== null && Date.now() - last < POLL_MS / 2) return;
      void loadRooms();
    }, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        forceRank.current = true;
        void loadRooms();
      }
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [enabled, loadRooms]);

  const refresh = useCallback(async () => {
    useRoomsStatus.getState().patch({ refreshing: true });
    forceRank.current = true;
    try {
      await loadRooms();
    } finally {
      useRoomsStatus.getState().patch({ refreshing: false });
    }
  }, [loadRooms]);

  const expectedShiftDate = currentShiftDate(hotelTimezone);
  const shiftDate = (myRooms[0] ? roomShiftDate(myRooms[0]) : null) ?? status.serverShiftDate ?? expectedShiftDate;
  return {
    loading: status.loading,
    refreshing: status.refreshing,
    fetchError: status.fetchError,
    usingCache: status.usingCache,
    lastUpdated: status.lastRefreshAt === null ? null : new Date(status.lastRefreshAt),
    timeZone: hotelTimezone ?? null,
    shiftDate,
    expectedShiftDate,
    serverShiftDate: status.serverShiftDate,
    answeredForDate: status.answeredForDate,
    rankedAt: new Date(status.rankedAt),
    hasConfirmedFetch: status.lastRefreshAt !== null,
    confirmedEmpty: status.confirmedEmpty,
    freshness: resolveFreshness({
      lastRefreshAt: status.lastRefreshAt,
      fetchFailed: status.fetchError !== null,
      hasRooms: myRooms.length > 0,
      now: Date.now(),
    }),
    boardState: resolveBoardState({
      loading: status.loading && myRooms.length === 0,
      roomCount: myRooms.length,
      wrongDay: boardIsWrongDay(myRooms, expectedShiftDate, status.serverShiftDate, status.answeredForDate),
      confirmedEmpty: status.confirmedEmpty,
    }),
    refresh,
  };
}

/**
 * Rooms the list calls IN_PROGRESS but this device holds no session for:
 * ask the server for the active session (read-only — it never starts one).
 * `missingKey` is a stable string of those room ids; the lookup runs once per
 * distinct set, and again only when the attendant asks.
 */
export function useActiveSessionRestore(missingKey: string, isOnline: boolean) {
  const [restoring, setRestoring] = useState(false);
  const attempted = useRef<string | null>(null);

  const run = useCallback(async () => {
    setRestoring(true);
    try {
      await useCleanSessionStore.getState().hydrate();
      await useCleanSessionStore.getState().restoreActive();
    } finally {
      setRestoring(false);
    }
  }, []);

  useEffect(() => {
    if (!missingKey) {
      attempted.current = null;
      return;
    }
    if (!isOnline || attempted.current === missingKey) return;
    attempted.current = missingKey;
    void run();
  }, [missingKey, isOnline, run]);

  const reload = useCallback(() => {
    attempted.current = missingKey;
    void run();
  }, [missingKey, run]);

  return { restoring, reload };
}
