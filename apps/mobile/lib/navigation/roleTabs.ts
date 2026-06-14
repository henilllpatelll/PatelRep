import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import type { UserRole } from "@/lib/supabase";

export type RoleTabKey =
  | "home"
  | "rooms"
  | "inspect"
  | "orders"
  | "copilot"
  | "tasks"
  | "assets"
  | "me"
  | "board"
  | "assignments"
  | "pm"
  | "more"
  | "requests"
  | "room-status"
  | "lost"
  | "alerts"
  | "staff"
  | "logbook";

export type RoleTabDef = {
  key: RoleTabKey;
  name: string;
  titleKey: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  special?: boolean;
};

const HOUSEKEEPER_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "rooms", name: "my-rooms/index", titleKey: "tabs.myRooms", icon: "bed-outline" },
  { key: "tasks", name: "tasks/index", titleKey: "tabs.tasks", icon: "checkmark-circle-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const INSPECTOR_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "inspect", name: "inspect/index", titleKey: "tabs.inspect", icon: "shield-checkmark-outline" },
  { key: "tasks", name: "tasks/index", titleKey: "tabs.tasks", icon: "checkmark-circle-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const ENGINEER_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "orders", name: "work-orders/index", titleKey: "tabs.orders", icon: "construct-outline" },
  { key: "rooms", name: "rooms/index", titleKey: "tabs.rooms", icon: "bed-outline" },
  { key: "assets", name: "assets/index", titleKey: "tabs.assets", icon: "cube-outline" },
  { key: "more", name: "more/index", titleKey: "tabs.more", icon: "ellipsis-horizontal-circle-outline" },
];

const SUPERVISOR_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "board", name: "room-board/index", titleKey: "tabs.roomBoard", icon: "grid-outline" },
  { key: "assignments", name: "assignments/index", titleKey: "tabs.assignments", icon: "people-outline" },
  { key: "inspect", name: "inspect/index", titleKey: "tabs.inspect", icon: "shield-checkmark-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const FRONT_DESK_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "requests", name: "guest-requests/index", titleKey: "tabs.guestRequests", icon: "chatbubble-ellipses-outline" },
  { key: "room-status", name: "room-status/index", titleKey: "tabs.roomStatus", icon: "bed-outline" },
  { key: "logbook", name: "logbook/index", titleKey: "tabs.logbook", icon: "book-outline" },
  { key: "lost", name: "lost-found/index", titleKey: "tabs.lostFound", icon: "search-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const GM_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "alerts", name: "alerts/index", titleKey: "tabs.alerts", icon: "warning-outline" },
  { key: "staff", name: "staff/index", titleKey: "tabs.staff", icon: "people-circle-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const ALL_TAB_ARRAYS = [
  ...HOUSEKEEPER_TABS,
  ...INSPECTOR_TABS,
  ...ENGINEER_TABS,
  ...SUPERVISOR_TABS,
  ...FRONT_DESK_TABS,
  ...GM_TABS,
];

export const ALL_ROLE_TAB_ROUTES = Array.from(new Set(ALL_TAB_ARRAYS.map((tab) => tab.name)));

export const HIDDEN_APP_ROUTES = [
  "copilot/index",
  "pm-schedules/index",
  "notifications/index",
  "scheduling/index",
  "sop/index",
  "sop/[sopId]",
  "my-rooms/[roomId]",
  "work-orders/[woId]",
  "guest-requests/[requestId]",
  "logbook/new",
];

export function getTabsForRole(role: UserRole): RoleTabDef[] {
  switch (role) {
    case "inspector":
      return INSPECTOR_TABS;
    case "engineer":
    case "chief_engineer":
      return ENGINEER_TABS;
    case "housekeeping_supervisor":
      return SUPERVISOR_TABS;
    case "front_desk":
      return FRONT_DESK_TABS;
    case "gm":
      return GM_TABS;
    default:
      return HOUSEKEEPER_TABS;
  }
}
