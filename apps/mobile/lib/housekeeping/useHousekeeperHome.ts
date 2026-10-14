import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { listNotifications, markRead } from "@/lib/api/notifications";
import { currentShiftDate } from "@/lib/housekeeping/hotelTime";
import { buildHomeModel, type HomeModel, type SupervisorNoteInput } from "@/lib/housekeeping/homeModel";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { buildSyncRows, loadSyncRows, type SyncRow } from "@/lib/housekeeping/syncDetails";
import { useActiveSessionRestore, useMyRoomsData, type MyRoomsData } from "@/lib/housekeeping/useMyRoomsData";
import { useShiftLifecycle, type ShiftController } from "@/lib/housekeeping/useShiftLifecycle";
import { useAppStore, type Room } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";

const NOTE_POLL_MS = 45_000;
const CLOCK_TICK_MS = 60_000;
const NO_SESSIONS: Record<string, LocalCleanSession> = {};

export interface HousekeeperHome {
  model: HomeModel;
  /** Shared room loading state (same hook My Rooms uses). */
  data: MyRoomsData;
  /** The rooms Home is describing: today's, for this person, with local completions applied. */
  rooms: Room[];
  shift: ShiftController;
  /** Pull-to-refresh: rooms, shift, supervisor message and sync status. */
  refresh: () => Promise<void>;
  acknowledgeSupervisorNote: () => Promise<void>;
  /** Looking up an active clean session this device lost (restart, started elsewhere). */
  restoringSession: boolean;
}

/**
 * Everything the housekeeper Home needs, composed from the same pieces as My
 * Rooms: one room loader, the clean-session store, the offline queues. It never
 * starts a shift and never calls paid AI; both stay explicit user actions.
 */
export function useHousekeeperHome({ enabled }: { enabled: boolean }): HousekeeperHome {
  const { user, isOnline, myRooms, pendingActions, hotelTimezone } = useAppStore();
  const scope = user ? `${user.tenant_id}:${user.id}` : null;

  const data = useMyRoomsData({ enabled });

  // Sessions belong to one signed-in user; ignore records from another scope.
  const sessionScope = useCleanSessionStore((state) => state.scope);
  const storedSessions = useCleanSessionStore((state) => state.sessions);
  const sessions = sessionScope && sessionScope === scope ? storedSessions : NO_SESSIONS;
  useEffect(() => {
    if (enabled) void useCleanSessionStore.getState().hydrate();
  }, [enabled, scope]);

  // A minute tick keeps shift-date rollover and freshness honest without a render storm.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const expectedShiftDate = currentShiftDate(hotelTimezone, now);
  const shift = useShiftLifecycle({
    enabled,
    scope,
    shiftDate: expectedShiftDate,
    timeZone: hotelTimezone ?? null,
    isOnline,
  });

  // Supervisor message (best-effort; Home never blocks on it).
  const [note, setNote] = useState<SupervisorNoteInput | null>(null);
  const noteScope = useRef(scope);
  noteScope.current = scope;
  const loadNote = useCallback(async () => {
    if (!enabled || !isOnline || !scope) return;
    try {
      const result = await listNotifications(false);
      if (noteScope.current !== scope) return;
      const found = result.data.find((n) => n.type === "direct_message" || n.type === "broadcast");
      setNote(found ? { id: found.id, title: found.title, body: found.body, createdAt: found.created_at ?? null } : null);
    } catch {
      // Leave the last known message; a failed read says nothing about it.
    }
  }, [enabled, isOnline, scope]);
  useEffect(() => {
    setNote(null);
  }, [scope]);
  useEffect(() => {
    if (!enabled) return;
    void loadNote();
    const interval = setInterval(() => void loadNote(), NOTE_POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadNote();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [enabled, loadNote]);

  const acknowledgeSupervisorNote = useCallback(async () => {
    if (!note) return;
    const id = note.id;
    setNote(null);
    try {
      await markRead(id);
    } catch {
      // Dismissed locally; it returns on the next unread fetch if the write failed.
    }
  }, [note]);

  // What the device is holding: cheap synchronous rows now, the full queues (SQLite + task outbox) when they load.
  const [loadedSync, setLoadedSync] = useState<{ rows: SyncRow[]; complete: boolean } | null>(null);
  const immediateSync = useMemo(
    () => buildSyncRows({ sessions, actions: pendingActions ?? [], queue: [] }),
    [sessions, pendingActions],
  );
  const reloadSync = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoadedSync(await loadSyncRows());
    } catch {
      setLoadedSync({ rows: [], complete: false });
    }
  }, [enabled]);
  // Re-read when the queues change; `loadSyncRows` reads the stores itself, so a count is enough to key on.
  const pendingCount = pendingActions?.length ?? 0;
  useEffect(() => {
    void reloadSync();
  }, [reloadSync, sessions, pendingCount, isOnline]);
  useEffect(() => {
    setLoadedSync(null);
  }, [scope]);

  const model = useMemo(
    () =>
      buildHomeModel({
        rooms: myRooms,
        sessions,
        rankedAt: data.rankedAt,
        now,
        expectedShiftDate,
        timeZone: hotelTimezone ?? null,
        isOnline,
        board: {
          // Rooms already on hand (earlier fetch, cache) show immediately; only an empty first load waits.
          loading: data.loading && myRooms.length === 0,
          refreshing: data.refreshing,
          confirmedEmpty: data.confirmedEmpty,
          freshness: data.freshness,
          fetchError: data.fetchError,
          usingCache: data.usingCache,
          lastRefreshAt: data.lastUpdated ? data.lastUpdated.getTime() : null,
          serverShiftDate: data.serverShiftDate,
          answeredForDate: data.answeredForDate,
        },
        lifecycle: shift.lifecycle,
        syncRows: loadedSync?.rows ?? immediateSync,
        syncRowsComplete: loadedSync?.complete ?? true,
        supervisorNote: note,
      }),
    [
      myRooms,
      sessions,
      data.rankedAt,
      data.loading,
      data.refreshing,
      data.confirmedEmpty,
      data.freshness,
      data.fetchError,
      data.usingCache,
      data.lastUpdated,
      data.serverShiftDate,
      data.answeredForDate,
      now,
      expectedShiftDate,
      hotelTimezone,
      isOnline,
      shift.lifecycle,
      loadedSync,
      immediateSync,
      note,
    ],
  );

  // An IN_PROGRESS room this device holds no session for: ask the server (read-only; never starts one).
  const missingKey = useMemo(
    () =>
      model.dashboard.current
        .filter((entry) => entry.session?.state === "missing")
        .map((entry) => entry.room.id)
        .sort()
        .join(","),
    [model.dashboard.current],
  );
  const restore = useActiveSessionRestore(enabled ? missingKey : "", isOnline);

  const rooms = useMemo(() => model.dashboard.all.map((entry) => entry.room), [model.dashboard.all]);

  const { refresh: refreshRooms } = data;
  const { refresh: refreshShift } = shift;
  const refresh = useCallback(async () => {
    await Promise.all([refreshRooms(), refreshShift(), loadNote(), reloadSync()]);
  }, [refreshRooms, refreshShift, loadNote, reloadSync]);

  return { model, data, rooms, shift, refresh, acknowledgeSupervisorNote, restoringSession: restore.restoring };
}
