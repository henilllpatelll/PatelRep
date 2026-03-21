import { create } from "zustand";
import type { UserProfile } from "@/lib/supabase";

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
}

export interface Room {
  id: string;
  room_number: string;
  floor: number;
  status: "DIRTY" | "IN_PROGRESS" | "CLEAN" | "INSPECTED" | "OOO" | "PICKUP";
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  dnd_flag: boolean;
  guest_name: string | null;
  predicted_ready_at: string | null;
  vip_flag: boolean;
  checkin_time: string | null;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setIsLoading: (isLoading) => set({ isLoading }),

  isOnline: true,
  setIsOnline: (isOnline) => set({ isOnline }),

  myRooms: [],
  setMyRooms: (myRooms) => set({ myRooms }),

  unreadCount: 0,
  setUnreadCount: (unreadCount) => set({ unreadCount }),
}));
