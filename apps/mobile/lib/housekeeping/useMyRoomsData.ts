import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api/client";
import { getRoomsByDate, upsertRooms } from "@/lib/offline/db";
import { currentShiftDate, isValidTimeZone } from "@/lib/housekeeping/hotelTime";
import { useAppStore, type Room } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";

const POLL_MS = 45_000;
const TZ_KEY_PREFIX = "@patelrep/hotel_timezone/";

interface MyRoomsResponse {
  data: Room[];
  meta?: { timezone?: string | null; shift_date?: string | null };
}

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
  /**
   * The clock the suggested route was last ranked at. It only moves when data
   * is refreshed, so arrival-time tiers cannot reshuffle the list while the
   * attendant is scrolling or tapping.
   */
  rankedAt: Date;
  refresh: () => Promise<void>;
}

/**
 * Loads /housekeeping/my-rooms into the app store (the single room source of
 * truth), falls back to the offline cache, and keeps it fresh on an interval
 * and on foreground. A failed fetch is reported, never turned into "no rooms".
 */
export function useMyRoomsData(): MyRoomsData {
  const { isOnline, myRooms, setMyRooms, hotelTimezone, setHotelTimezone, user } = useAppStore();
  const tenantId = user?.tenant_id ?? null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [rankedAt, setRankedAt] = useState(() => new Date());

  const roomsRef = useRef<Room[]>(myRooms);
  roomsRef.current = myRooms;
  const inFlight = useRef<Promise<void> | null>(null);
  // Re-rank the suggested route only for deliberate refreshes (open, foreground,
  // pull-to-refresh) or when the set of assigned rooms changes — not on every poll.
  const forceRank = useRef(true);
  const roomSignature = useRef("");

  const zoneRef = useRef<string | null>(hotelTimezone ?? null);
  zoneRef.current = hotelTimezone ?? null;

  // Offline cold start: the hotel's zone was cached the last time we were online.
  useEffect(() => {
    if (!tenantId || zoneRef.current) return;
    void AsyncStorage.getItem(TZ_KEY_PREFIX + tenantId)
      .then((zone) => {
        if (isValidTimeZone(zone) && !zoneRef.current) setHotelTimezone?.(zone);
      })
      .catch(() => undefined);
  }, [tenantId, setHotelTimezone]);

  const readCache = useCallback(async (): Promise<Room[]> => {
    try {
      return (await getRoomsByDate(currentShiftDate(zoneRef.current))) as Room[];
    } catch (err) {
      console.warn("[my-rooms] cache read failed", err);
      return [];
    }
  }, []);

  const loadRooms = useCallback((): Promise<void> => {
    // Overlapping polls/pull-to-refresh share one request.
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      if (isOnline) {
        try {
          const shiftDate = currentShiftDate(zoneRef.current);
          const result = await api.get<MyRoomsResponse>(`/housekeeping/my-rooms?date=${shiftDate}`);
          setMyRooms(result.data);
          const zone = result.meta?.timezone;
          if (isValidTimeZone(zone)) {
            if (zone !== zoneRef.current) setHotelTimezone?.(zone);
            if (tenantId) void AsyncStorage.setItem(TZ_KEY_PREFIX + tenantId, zone).catch(() => undefined);
          }
          setFetchError(null);
          setUsingCache(false);
          const now = new Date();
          setLastUpdated(now);
          const signature = result.data.map((room) => room.id).sort().join("|");
          if (forceRank.current || signature !== roomSignature.current) setRankedAt(now);
          forceRank.current = false;
          roomSignature.current = signature;
          try {
            await upsertRooms(result.data, { replaceDate: result.meta?.shift_date ?? shiftDate });
          } catch (err) {
            console.warn("[my-rooms] cache write failed", err);
          }
        } catch (err: unknown) {
          setFetchError(err instanceof Error ? err.message : String(err));
          setUsingCache(true);
          // Keep what is already on screen; only reach for the cache when empty.
          if (roomsRef.current.length === 0) {
            const cached = await readCache();
            if (cached.length > 0) setMyRooms(cached);
          }
        }
      } else {
        setFetchError(null);
        setUsingCache(true);
        if (roomsRef.current.length === 0) {
          const cached = await readCache();
          if (cached.length > 0) setMyRooms(cached);
        }
      }
      setLoading(false);
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [isOnline, setMyRooms, setHotelTimezone, tenantId, readCache]);

  useEffect(() => {
    void loadRooms();
    const interval = setInterval(() => { void loadRooms(); }, POLL_MS);
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
  }, [loadRooms]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    forceRank.current = true;
    try {
      await loadRooms();
    } finally {
      setRefreshing(false);
    }
  }, [loadRooms]);

  const shiftDate = myRooms[0]?.assignment_date?.slice(0, 10) ?? currentShiftDate(hotelTimezone);
  return {
    loading,
    refreshing,
    fetchError,
    usingCache,
    lastUpdated,
    timeZone: hotelTimezone ?? null,
    shiftDate,
    rankedAt,
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
