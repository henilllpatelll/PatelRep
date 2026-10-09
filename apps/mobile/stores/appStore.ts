import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { api } from "@/lib/api/client";
import { clearRoomsCache, upsertRooms } from "@/lib/offline/db";
import { currentShiftDate } from "@/lib/housekeeping/hotelTime";
import { flushSessions, isRoomManagedBySession } from "@/lib/housekeeping/sessionGuard";
import type { UserProfile } from "@/lib/supabase";

const QUEUE_STORAGE_KEY = "@patelrep/offline_queue";

export type OfflineActionType = "task_complete" | "room_status" | "work_order_update" | "logbook_create";

export interface OfflineAction {
  id: string;
  type: OfflineActionType;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AppState {
  // Auth
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: UserProfile | null) => void;
  setIsLoading: (loading: boolean) => void;

  // Network
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  /** ISO time of the last sync that left nothing waiting (in memory; resets with the app). */
  lastSyncedAt: string | null;
  setLastSyncedAt: (at: string | null) => void;

  // Rooms (housekeeper view)
  myRooms: Room[];
  setMyRooms: (rooms: Room[]) => void;
  refreshRooms: () => Promise<void>;

  /** The hotel's IANA zone (from GET /housekeeping/my-rooms meta), for hotel-local display. */
  hotelTimezone: string | null;
  setHotelTimezone: (zone: string | null) => void;

  // Notifications badge
  unreadCount: number;
  setUnreadCount: (count: number) => void;

  // Offline write queue
  pendingActions: OfflineAction[];
  enqueueAction: (action: Omit<OfflineAction, "id" | "createdAt">) => Promise<void>;
  /** Drop queued legacy room_status actions for rooms now owned by a clean session. */
  dropQueuedRoomStatus: (roomId: string) => Promise<void>;
  flushQueue: () => Promise<void>;
  loadPendingActions: () => Promise<void>;
}

export interface RecleanCorrection {
  id: string | null;
  label: string;
  /** Inspector's extra detail, when it adds to the label. */
  note: string | null;
}

export interface RecleanDetails {
  inspection_id: string;
  inspected_at: string | null;
  overall_result: "failed" | "conditional" | string | null;
  notes: string | null;
  items: RecleanCorrection[];
}

export interface Room {
  id: string;
  room_number: string;
  floor: number;
  status: "DIRTY" | "IN_PROGRESS" | "CLEAN" | "INSPECTED" | "OOO" | "PICKUP" | "OCCUPIED" | "OUT_OF_ORDER" | "OUT_OF_SERVICE";
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  dnd_flag: boolean;
  do_not_service?: boolean;
  guest_name: string | null;
  predicted_ready_at: string | null;
  vip_flag: boolean;
  checkin_time: string | null;
  checkout_time?: string | null;
  actual_checkout_at?: string | null;
  fo_status?: "OCC" | "VAC" | null;
  clean_type?: string | null;
  clean_type_label?: string | null;
  latest_note?: string | null;
  latest_note_at?: string | null;
  open_work_order_id?: string | null;
  open_work_order_number?: string | null;
  open_work_order_title?: string | null;
  open_work_order_priority?: string | null;
  open_work_order_status?: string | null;
  assignment_id?: string | null;
  assignment_date?: string | null;
  updated_at?: string | null;
  last_cleaned_at?: string | null;
  last_inspected_at?: string | null;
  room_type_code?: string | null;
  room_type_name?: string | null;
  /** Real property topology (rooms.building); null/absent when the hotel has none. */
  building?: string | null;
  /** Supervisor/auto-assign visiting order for this housekeeper's day (1-based). */
  sequence_order?: number | null;
  /** Rush when <= 2 (same rule as the housekeeping board); lower = more urgent. */
  priority?: number | null;
  priority_reason?: string | null;
  priority_needed_by?: string | null;
  priority_note?: string | null;
  do_not_service_reason?: string | null;
  dnd_started_at?: string | null;
  dnd_retry_at?: string | null;
  dnd_attempt_count?: number | null;
  dnd_last_attempt_at?: string | null;
  service_declined_reason?: string | null;
  service_declined_note?: string | null;
  service_declined_at?: string | null;
  reclean_requested_at?: string | null;
  reclean_corrections?: string[] | null;
  /** Failed-inspection context for a reclean (server: services/reclean_corrections). */
  reclean_details?: RecleanDetails | null;
  rooms?: {
    room_types?: { name?: string; code?: string; base_clean_minutes?: number } | null;
  } | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => {
    const previous = get().user;
    const changed = (previous?.id ?? null) !== (user?.id ?? null) || (previous?.tenant_id ?? null) !== (user?.tenant_id ?? null);
    if (changed && previous) {
      // A different person/hotel on this device must never see the last user's rooms.
      set({ user, isAuthenticated: !!user, myRooms: [], hotelTimezone: null });
      void clearRoomsCache().catch(() => undefined);
      return;
    }
    set({ user, isAuthenticated: !!user });
  },
  setIsLoading: (isLoading) => set({ isLoading }),

  isOnline: true,
  lastSyncedAt: null,
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setIsOnline: (online: boolean) => {
    set({ isOnline: online });
    if (online) {
      // Clean sessions replay first (start -> checklist -> complete); the generic
      // queue follows and skips room_status entries a session now owns.
      flushSessions()
        .catch(console.warn)
        .finally(() => get().flushQueue().catch(console.warn));
    }
  },

  myRooms: [],
  setMyRooms: (myRooms) => set({ myRooms }),
  hotelTimezone: null,
  setHotelTimezone: (hotelTimezone) => set({ hotelTimezone }),
  refreshRooms: async () => {
    try {
      const shiftDate = currentShiftDate(get().hotelTimezone);
      const result = await api.get<{ data: Room[]; meta?: { timezone?: string | null; shift_date?: string | null } }>(
        `/housekeeping/my-rooms?date=${shiftDate}`,
      );
      set({ myRooms: result.data, ...(result.meta?.timezone ? { hotelTimezone: result.meta.timezone } : {}) });
      await upsertRooms(result.data, { replaceDate: result.meta?.shift_date ?? shiftDate });
    } catch {
      // Silently preserve local state on refresh failure.
    }
  },

  unreadCount: 0,
  setUnreadCount: (unreadCount) => set({ unreadCount }),

  pendingActions: [],

  enqueueAction: async (action) => {
    const fullAction: OfflineAction = {
      ...action,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
    };
    const next = [...get().pendingActions, fullAction];
    set({ pendingActions: next });
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next));
  },

  dropQueuedRoomStatus: async (roomId) => {
    const remaining = get().pendingActions.filter(
      (a) => !(a.type === "room_status" && a.entityId === roomId),
    );
    if (remaining.length === get().pendingActions.length) return;
    set({ pendingActions: remaining });
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(remaining));
  },

  flushQueue: async () => {
    const actions = get().pendingActions;
    if (actions.length === 0) return;

    const succeeded: string[] = [];
    for (const action of actions) {
      // A persistent clean session owns this room's start/complete lifecycle;
      // replaying the legacy status change as well would transition it twice.
      if (action.type === "room_status" && isRoomManagedBySession(action.entityId)) {
        succeeded.push(action.id);
        continue;
      }
      try {
        if (action.type === "task_complete") {
          await api.patch(`/tasks/${action.entityId}`, { status: "completed", ...action.payload });
        } else if (action.type === "room_status") {
          await api.patch(`/rooms/${action.entityId}/status`, action.payload);
        } else if (action.type === "work_order_update") {
          await api.patch(`/work-orders/${action.entityId}`, action.payload);
        } else if (action.type === "logbook_create") {
          await api.post("/logbook/entries", action.payload);
        }
        succeeded.push(action.id);
      } catch (err) {
        console.warn("[offline] flush failed for action", action.id, err);
      }
    }

    const remaining = actions.filter((a) => !succeeded.includes(a.id));
    set({ pendingActions: remaining });
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(remaining));
  },

  loadPendingActions: async () => {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        const actions = JSON.parse(stored) as OfflineAction[];
        set({ pendingActions: actions });
      }
    } catch (err) {
      console.warn("[offline] failed to load pending actions", err);
    }
  },
}));
