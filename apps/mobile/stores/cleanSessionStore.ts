import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { useAppStore, type Room } from "@/stores/appStore";
import {
  apiCompleteSession,
  apiGetActiveSession,
  apiGetSession,
  apiPatchChecklist,
  apiStartSession,
  applyLocalState,
  checklistFromTemplate,
  classifyFailure,
  getProgress,
  hasPendingSync,
  isApiError,
  newSessionId,
  setItemChecked,
  type ChecklistItem,
  type LocalCleanSession,
  type ServerCleanSession,
  type SessionConflictCode,
} from "@/lib/housekeeping/cleanSession";
import { loadCachedTemplates, refreshCachedTemplates } from "@/lib/housekeeping/checklistTemplates";
import { registerSessionFlush, setManagedRooms } from "@/lib/housekeeping/sessionGuard";

const STORAGE_PREFIX = "@patelrep/clean_sessions/v1/";
const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;

export type RestoreActiveResult = "restored" | "none" | "offline" | "failed";

export type ActionResult =
  | { outcome: "confirmed"; session: LocalCleanSession }
  /** Saved on this device, not yet confirmed by the server. */
  | { outcome: "queued"; session: LocalCleanSession }
  | { outcome: "rejected"; code: string; message: string; missing?: string[]; session?: LocalCleanSession };

interface CleanSessionState {
  /** `${tenantId}:${userId}` the in-memory sessions belong to. */
  scope: string | null;
  sessions: Record<string, LocalCleanSession>;
  hydrate: () => Promise<void>;
  startSession: (room: Pick<Room, "id" | "clean_type">, opts: { entryAcknowledged: boolean }) => Promise<ActionResult>;
  toggleItem: (roomId: string, key: string, checked: boolean) => void;
  completeSession: (roomId: string) => Promise<ActionResult>;
  /** Replay everything the server has not confirmed yet, in order. */
  flush: () => Promise<void>;
  /** Online refresh of one room's session against the server (restart / reopen). */
  restoreForRoom: (room: Pick<Room, "id" | "status">) => Promise<void>;
  /**
   * Read-only: ask the server for this user's active session and adopt it when
   * the device has no record (restart, data loss, started elsewhere). Never
   * starts a session — unlike restoreForRoom, safe to call from a list screen.
   */
  restoreActive: () => Promise<RestoreActiveResult>;
  /** Clear a conflict and try the queued work again. */
  retry: (roomId: string) => Promise<void>;
  /** Drop local session state for a room (conflict resolution / room undone). */
  discard: (roomId: string) => void;
  reset: () => void;
}

function currentScope(): string | null {
  const user = useAppStore.getState().user;
  return user ? `${user.tenant_id}:${user.id}` : null;
}

// One sync at a time, app-wide: start -> checklist -> complete must reach the
// server in order, and two overlapping flushes would double-send.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export const useCleanSessionStore = create<CleanSessionState>((set, get) => {
  async function persist(): Promise<void> {
    const { scope, sessions } = get();
    if (!scope) return;
    setManagedRooms(
      Object.values(sessions)
        .filter((s) => !s.completionConfirmed)
        .map((s) => s.roomId),
    );
    try {
      await AsyncStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(sessions));
    } catch (err) {
      console.warn("[clean-session] failed to persist", err);
    }
  }

  async function ensureScope(): Promise<boolean> {
    const scope = currentScope();
    if (!scope) return false;
    if (get().scope !== scope) {
      let sessions: Record<string, LocalCleanSession> = {};
      try {
        const raw = await AsyncStorage.getItem(STORAGE_PREFIX + scope);
        if (raw) sessions = JSON.parse(raw) as Record<string, LocalCleanSession>;
        // Confirmed completions only need to outlive the screen that shows them.
        const cutoff = Date.now() - COMPLETED_RETENTION_MS;
        sessions = Object.fromEntries(
          Object.entries(sessions).filter(
            ([, record]) => !record.completionConfirmed || new Date(record.updatedAt).getTime() > cutoff,
          ),
        );
      } catch (err) {
        console.warn("[clean-session] failed to load", err);
      }
      // Another call may have switched scope while we awaited storage.
      if (get().scope !== scope) {
        set({ scope, sessions });
        setManagedRooms(
          Object.values(sessions)
            .filter((s) => !s.completionConfirmed)
            .map((s) => s.roomId),
        );
      }
    }
    return true;
  }

  function patch(roomId: string, change: Partial<LocalCleanSession> | ((s: LocalCleanSession) => LocalCleanSession)) {
    set((state) => {
      const current = state.sessions[roomId];
      if (!current) return state;
      const next =
        typeof change === "function" ? change(current) : { ...current, ...change };
      return { sessions: { ...state.sessions, [roomId]: { ...next, updatedAt: new Date().toISOString() } } };
    });
  }

  function remove(roomId: string) {
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[roomId];
      return { sessions };
    });
  }

  function adoptServerSession(roomId: string, server: ServerCleanSession) {
    patch(roomId, (local) => {
      const merged = applyLocalState(server.checklist ?? [], local.pendingItems, local.provisional ? local.checklist : []);
      return {
        ...local,
        sessionId: server.id,
        cleanType: server.clean_type ?? local.cleanType,
        // Server timestamps are authoritative once it has the session.
        startedAt: server.started_at ?? local.startedAt,
        checklist: merged.checklist,
        pendingItems: merged.pendingItems,
        provisional: false,
        startConfirmed: true,
      };
    });
  }

  function markConflict(roomId: string, code: SessionConflictCode, message: string) {
    patch(roomId, { conflict: { code, message, at: new Date().toISOString() } });
  }

  /** Replay one room's queue. Stops at the first step that cannot finish. */
  async function syncRoom(roomId: string, interactive: boolean): Promise<ActionResult | null> {
    if (!useAppStore.getState().isOnline) return null;
    let result: ActionResult | null = null;

    for (let guard = 0; guard < 20; guard += 1) {
      const session = get().sessions[roomId];
      if (!session || session.completionConfirmed || session.conflict) break;

      // 1. start
      if (!session.startConfirmed) {
        try {
          const server = await apiStartSession({
            id: session.sessionId,
            roomId,
            startedAt: session.startedAt,
            entryAcknowledged: session.entryAcknowledged,
          });
          if (server.status === "completed") {
            // The server already finished this session (e.g. completed from another flow).
            adoptServerSession(roomId, server);
            patch(roomId, { completionConfirmed: true, endedAt: server.ended_at, durationSeconds: server.duration_seconds, completeRequestedAt: null, pendingItems: {} });
            break;
          }
          adoptServerSession(roomId, server);
          await persist();
          continue;
        } catch (err) {
          const failure = classifyFailure(err);
          if (failure.kind === "offline" || failure.kind === "retry") break;
          const local = get().sessions[roomId];
          const hasWork = local && (Object.keys(local.pendingItems).length > 0 || local.completeRequestedAt);
          if (interactive && !hasWork) {
            // Nothing was done yet — drop the attempt instead of leaving a dead record.
            remove(roomId);
            await persist();
            return { outcome: "rejected", code: failure.code, message: failure.message };
          }
          markConflict(roomId, failure.code as SessionConflictCode, failure.message);
          await persist();
          result = { outcome: "rejected", code: failure.code, message: failure.message, session: get().sessions[roomId] };
          break;
        }
      }

      // 2. checklist changes (only the items the user touched, so untouched
      //    items keep whatever newer state the server already has)
      const pending = Object.values(session.pendingItems);
      if (pending.length > 0) {
        try {
          const server = await apiPatchChecklist(session.sessionId, pending);
          patch(roomId, (local) => {
            // Anything edited while the request was in flight stays pending.
            const stillPending: Record<string, ChecklistItem> = {};
            for (const [key, item] of Object.entries(local.pendingItems)) {
              const sent = session.pendingItems[key];
              if (!sent || sent.checked !== item.checked) stillPending[key] = item;
            }
            const merged = applyLocalState(server.checklist ?? local.checklist, stillPending);
            return { ...local, checklist: merged.checklist, pendingItems: merged.pendingItems };
          });
          await persist();
          continue;
        } catch (err) {
          const failure = classifyFailure(err);
          if (failure.kind === "offline" || failure.kind === "retry") break;
          markConflict(roomId, failure.code as SessionConflictCode, failure.message);
          await persist();
          result = { outcome: "rejected", code: failure.code, message: failure.message, session: get().sessions[roomId] };
          break;
        }
      }

      // 3. complete
      if (session.completeRequestedAt) {
        try {
          const server = await apiCompleteSession(session.sessionId, session.completeRequestedAt, []);
          patch(roomId, {
            completionConfirmed: true,
            completeRequestedAt: null,
            pendingItems: {},
            endedAt: server.ended_at,
            durationSeconds: server.duration_seconds,
            checklist: server.checklist ?? session.checklist,
            lastError: null,
          });
          await persist();
          result = { outcome: "confirmed", session: get().sessions[roomId] };
          break;
        } catch (err) {
          const failure = classifyFailure(err);
          if (failure.kind === "offline" || failure.kind === "retry") break;
          if (failure.kind === "validation") {
            // The completion was refused, not lost: back to active work with the reason.
            patch(roomId, {
              completeRequestedAt: null,
              lastError: { code: failure.code, message: failure.message, missing: failure.missing },
            });
            await persist();
            result = { outcome: "rejected", code: failure.code, message: failure.message, missing: failure.missing, session: get().sessions[roomId] };
            break;
          }
          markConflict(roomId, failure.code as SessionConflictCode, failure.message);
          await persist();
          result = { outcome: "rejected", code: failure.code, message: failure.message, session: get().sessions[roomId] };
          break;
        }
      }
      break;
    }
    return result;
  }

  async function afterServerChange() {
    // Room list reflects server truth (IN_PROGRESS / CLEAN) only after confirmation.
    await useAppStore.getState().refreshRooms();
  }

  const store: CleanSessionState = {
    scope: null,
    sessions: {},

    hydrate: async () => {
      if (!(await ensureScope())) return;
      registerSessionFlush(() => get().flush());
      // Prime the offline-start template cache while we have signal.
      const user = useAppStore.getState().user;
      if (user && useAppStore.getState().isOnline) void refreshCachedTemplates(user.tenant_id);
      for (const session of Object.values(get().sessions)) {
        if (!session.completionConfirmed) await useAppStore.getState().dropQueuedRoomStatus(session.roomId);
      }
    },

    startSession: async (room, opts) => {
      if (!(await ensureScope())) {
        return { outcome: "rejected", code: "NOT_AUTHENTICATED", message: "Not signed in" };
      }
      registerSessionFlush(() => get().flush());
      const existing = get().sessions[room.id];
      if (existing && !existing.completionConfirmed && !existing.conflict) {
        // Resume: the same session id keeps the server call idempotent.
        const synced = await exclusive(() => syncRoom(room.id, true));
        return synced ?? { outcome: existing.startConfirmed ? "confirmed" : "queued", session: get().sessions[room.id] ?? existing };
      }

      const user = useAppStore.getState().user!;
      const isOnline = useAppStore.getState().isOnline;
      let checklist: ChecklistItem[] = [];
      let provisional = false;
      if (!isOnline) {
        const templates = await loadCachedTemplates(user.tenant_id);
        const fromTemplate = templates ? checklistFromTemplate(templates, room.clean_type) : null;
        if (!fromTemplate) {
          return {
            outcome: "rejected",
            code: "NO_CHECKLIST_OFFLINE",
            message: "Connect once to download this hotel's cleaning checklist before starting offline.",
          };
        }
        checklist = fromTemplate;
        provisional = true;
      }

      const now = new Date().toISOString();
      const record: LocalCleanSession = {
        roomId: room.id,
        sessionId: newSessionId(),
        cleanType: room.clean_type ?? null,
        startedAt: now,
        entryAcknowledged: opts.entryAcknowledged,
        checklist,
        provisional,
        startConfirmed: false,
        pendingItems: {},
        completeRequestedAt: null,
        completionConfirmed: false,
        endedAt: null,
        durationSeconds: null,
        conflict: null,
        lastError: null,
        updatedAt: now,
      };
      set((state) => ({ sessions: { ...state.sessions, [room.id]: record } }));
      // Durable before any network call: a crash mid-request must not lose the id.
      await persist();
      await useAppStore.getState().dropQueuedRoomStatus(room.id);

      const synced = await exclusive(() => syncRoom(room.id, true));
      if (synced) return synced;
      const stored = get().sessions[room.id];
      if (stored?.startConfirmed) {
        void afterServerChange();
        return { outcome: "confirmed", session: stored };
      }
      return { outcome: "queued", session: stored ?? record };
    },

    toggleItem: (roomId, key, checked) => {
      const before = get().sessions[roomId];
      if (!before || before.completionConfirmed || before.completeRequestedAt) return;
      patch(roomId, (s) => setItemChecked(s, key, checked, new Date().toISOString()));
      void persist().then(() => exclusive(() => syncRoom(roomId, false)));
    },

    completeSession: async (roomId) => {
      const session = get().sessions[roomId];
      if (!session) return { outcome: "rejected", code: "NO_SESSION", message: "No active cleaning session for this room" };
      if (session.completionConfirmed) return { outcome: "confirmed", session };
      if (session.conflict) {
        return { outcome: "rejected", code: session.conflict.code, message: session.conflict.message, session };
      }
      const progress = getProgress(session.checklist);
      if (progress.requiredRemaining.length > 0) {
        return {
          outcome: "rejected",
          code: "REQUIRED_ITEMS_INCOMPLETE",
          message: `${progress.requiredRemaining.length} required checklist item(s) unfinished`,
          missing: progress.requiredRemaining.map((item) => item.label),
          session,
        };
      }
      patch(roomId, { completeRequestedAt: session.completeRequestedAt ?? new Date().toISOString(), lastError: null });
      await persist();
      await exclusive(() => syncRoom(roomId, false));
      // Report from the stored state, not from whichever queued sync happened to
      // run the completion step (a toggle's background sync can get there first).
      const after = get().sessions[roomId];
      if (!after) return { outcome: "rejected", code: "NO_SESSION", message: "No active cleaning session for this room" };
      if (after.completionConfirmed) {
        void afterServerChange();
        return { outcome: "confirmed", session: after };
      }
      if (after.conflict) {
        return { outcome: "rejected", code: after.conflict.code, message: after.conflict.message, session: after };
      }
      if (after.lastError && !after.completeRequestedAt) {
        return { outcome: "rejected", code: after.lastError.code, message: after.lastError.message, missing: after.lastError.missing, session: after };
      }
      return { outcome: "queued", session: after };
    },

    flush: async () => {
      if (!(await ensureScope())) return;
      const ids = Object.values(get().sessions)
        .filter((s) => hasPendingSync(s))
        .map((s) => s.roomId);
      for (const roomId of ids) {
        await useAppStore.getState().dropQueuedRoomStatus(roomId);
        const result = await exclusive(() => syncRoom(roomId, false));
        if (get().sessions[roomId]?.startConfirmed || result?.outcome === "confirmed") {
          void afterServerChange();
        }
      }
    },

    restoreForRoom: async (room) => {
      if (!(await ensureScope())) return;
      registerSessionFlush(() => get().flush());
      if (!useAppStore.getState().isOnline) return;
      await exclusive(async () => {
        const local = get().sessions[room.id];
        if (local && !local.completionConfirmed) {
          // A conflict stays put until the housekeeper resolves it; an unconfirmed
          // start is the flush's job. Otherwise reconcile with the server copy.
          if (local.conflict || !local.startConfirmed) return;
          try {
            const server = await apiGetSession(local.sessionId);
            if (server.status === "completed") {
              patch(room.id, { completionConfirmed: true, endedAt: server.ended_at, durationSeconds: server.duration_seconds, completeRequestedAt: null, pendingItems: {} });
            } else if (server.status === "abandoned") {
              markConflict(room.id, "SESSION_ABANDONED", "This cleaning session was closed by the server.");
            } else {
              adoptServerSession(room.id, server);
            }
            await persist();
          } catch (err) {
            if (isApiError(err) && (err.status === 404 || err.status === 403)) {
              markConflict(room.id, "SESSION_GONE", err.message);
              await persist();
            }
          }
          return;
        }
        if (room.status !== "IN_PROGRESS") return;

        // Server says IN_PROGRESS but this device has no record (restart after
        // data loss, or the room was started by an older app / the web).
        try {
          const active = await apiGetActiveSession();
          if (active && active.room_id !== room.id) return;
          const server = active ?? (await apiStartSession({ id: newSessionId(), roomId: room.id, startedAt: new Date().toISOString(), entryAcknowledged: false }));
          const now = new Date().toISOString();
          set((state) => ({
            sessions: {
              ...state.sessions,
              [room.id]: {
                roomId: room.id,
                sessionId: server.id,
                cleanType: server.clean_type,
                startedAt: server.started_at,
                entryAcknowledged: true,
                checklist: server.checklist ?? [],
                provisional: false,
                startConfirmed: true,
                pendingItems: {},
                completeRequestedAt: null,
                completionConfirmed: server.status === "completed",
                endedAt: server.ended_at,
                durationSeconds: server.duration_seconds,
                conflict: null,
                lastError: null,
                updatedAt: now,
              },
            },
          }));
          await persist();
        } catch (err) {
          console.warn("[clean-session] restore failed", err);
        }
      });
    },

    restoreActive: async () => {
      if (!(await ensureScope())) return "failed";
      registerSessionFlush(() => get().flush());
      if (!useAppStore.getState().isOnline) return "offline";
      return exclusive(async (): Promise<RestoreActiveResult> => {
        try {
          const server = await apiGetActiveSession();
          if (!server) return "none";
          const local = get().sessions[server.room_id];
          if (local && !local.completionConfirmed) return "restored";
          const now = new Date().toISOString();
          set((state) => ({
            sessions: {
              ...state.sessions,
              [server.room_id]: {
                roomId: server.room_id,
                sessionId: server.id,
                cleanType: server.clean_type,
                startedAt: server.started_at,
                entryAcknowledged: true,
                checklist: server.checklist ?? [],
                provisional: false,
                startConfirmed: true,
                pendingItems: {},
                completeRequestedAt: null,
                completionConfirmed: false,
                endedAt: null,
                durationSeconds: null,
                conflict: null,
                lastError: null,
                updatedAt: now,
              },
            },
          }));
          await persist();
          return "restored";
        } catch (err) {
          console.warn("[clean-session] restore active failed", err);
          return "failed";
        }
      });
    },

    retry: async (roomId) => {
      patch(roomId, { conflict: null });
      await persist();
      await exclusive(() => syncRoom(roomId, false));
    },

    discard: (roomId) => {
      remove(roomId);
      void persist();
    },

    reset: () => {
      set({ scope: null, sessions: {} });
      setManagedRooms([]);
    },
  };
  return store;
});

export function selectSession(roomId: string | undefined) {
  // Records belong to one signed-in user; never surface another user's in-memory
  // state while the scope is still switching.
  return (state: CleanSessionState): LocalCleanSession | undefined =>
    roomId && state.scope === currentScope() ? state.sessions[roomId] : undefined;
}
