import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { listNotifications, markRead } from "@/lib/api/notifications";
import { isMessageNotification } from "@/lib/housekeeping/notificationLinks";
import { useHomeBridge, type MarkReadResult } from "@/stores/homeBridgeStore";
import { currentShiftDate } from "@/lib/housekeeping/hotelTime";
import { useEstimateVersion } from "@/lib/housekeeping/estimateTable";
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
  /**
   * Marks the supervisor's message read on the server. "Read" is all the backend
   * records (there is no acknowledgement); on any failure the message stays on
   * screen, unread, and the caller says so.
   */
  markSupervisorNoteRead: () => Promise<MarkReadResult>;
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
      // The newest unread message wins, whatever order the server returned them in.
      const found = result.data
        .filter((n) => isMessageNotification(n.type))
        .sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0))[0];
      setNote(
        found
          ? { id: found.id, title: found.title, body: found.body, createdAt: found.created_at ?? null, type: found.type, data: found.data ?? null }
          : null,
      );
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

  const markingNote = useRef(false);
  const markSupervisorNoteRead = useCallback(async (): Promise<MarkReadResult> => {
    if (!note) return { ok: true };
    if (!isOnline) return { ok: false, reason: "offline" };
    if (markingNote.current) return { ok: false, reason: "failed" };
    markingNote.current = true;
    const id = note.id;
    try {
      await markRead(id);
    } catch {
      // Nothing was recorded: keep the message and its unread state.
      return { ok: false, reason: "failed" };
    } finally {
      markingNote.current = false;
    }
    setNote((current) => (current?.id === id ? null : current));
    const { unreadCount, setUnreadCount } = useAppStore.getState();
    if (typeof unreadCount === "number") setUnreadCount?.(Math.max(0, unreadCount - 1));
    // Another unread instruction may be waiting behind it.
    void loadNote();
    return { ok: true };
  }, [note, isOnline, loadNote]);

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

  // A refreshed estimate table re-derives the model (estimates only; ordering never reads them).
  const estimateVersion = useEstimateVersion();
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
      estimateVersion,
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

  // The Attention Center is its own route and reads this same model instead of rebuilding it.
  const { publish, clear } = useHomeBridge.getState();
  useEffect(() => {
    if (!enabled) return;
    publish({ scope, model, refresh, markNoteRead: markSupervisorNoteRead });
  }, [enabled, scope, model, refresh, markSupervisorNoteRead, publish]);
  useEffect(() => (enabled ? clear : undefined), [enabled, clear]);

  return { model, data, rooms, shift, refresh, markSupervisorNoteRead, restoringSession: restore.restoring };
}
