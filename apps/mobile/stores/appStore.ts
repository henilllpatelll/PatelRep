import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { api } from "@/lib/api/client";
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

  // Rooms (housekeeper view)
  myRooms: Room[];
  setMyRooms: (rooms: Room[]) => void;

  // Notifications badge
  unreadCount: number;
  setUnreadCount: (count: number) => void;

  // Offline write queue
  pendingActions: OfflineAction[];
  enqueueAction: (action: Omit<OfflineAction, "id" | "createdAt">) => Promise<void>;
  flushQueue: () => Promise<void>;
  loadPendingActions: () => Promise<void>;
}

export interface Room {
  id: string;
  room_number: string;
  floor: number;
  status: "DIRTY" | "IN_PROGRESS" | "CLEAN" | "INSPECTED" | "OOO" | "PICKUP" | "OCCUPIED" | "OUT_OF_ORDER" | "OUT_OF_SERVICE";
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  dnd_flag: boolean;
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
  rooms?: {
    room_types?: { name?: string; base_clean_minutes?: number } | null;
  } | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setIsLoading: (isLoading) => set({ isLoading }),

  isOnline: true,
  setIsOnline: (online: boolean) => {
    set({ isOnline: online });
    if (online) {
      get().flushQueue().catch(console.warn);
    }
  },

  myRooms: [],
  setMyRooms: (myRooms) => set({ myRooms }),

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

  flushQueue: async () => {
    const actions = get().pendingActions;
    if (actions.length === 0) return;

    const succeeded: string[] = [];
    for (const action of actions) {
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
