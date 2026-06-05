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
  | "me";

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
  { key: "copilot", name: "copilot/index", titleKey: "tabs.copilot", icon: "sparkles-outline", special: true },
  { key: "tasks", name: "tasks/index", titleKey: "tabs.tasks", icon: "checkmark-circle-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const INSPECTOR_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "inspect", name: "inspect/index", titleKey: "tabs.inspect", icon: "shield-checkmark-outline" },
  { key: "copilot", name: "copilot/index", titleKey: "tabs.copilot", icon: "sparkles-outline", special: true },
  { key: "tasks", name: "tasks/index", titleKey: "tabs.tasks", icon: "checkmark-circle-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

const ENGINEER_TABS: RoleTabDef[] = [
  { key: "home", name: "home/index", titleKey: "tabs.home", icon: "grid-outline" },
  { key: "orders", name: "work-orders/index", titleKey: "tabs.workOrders", icon: "construct-outline" },
  { key: "copilot", name: "copilot/index", titleKey: "tabs.copilot", icon: "sparkles-outline", special: true },
  { key: "assets", name: "assets/index", titleKey: "tabs.assets", icon: "cube-outline" },
  { key: "me", name: "profile/index", titleKey: "tabs.profile", icon: "person-outline" },
];

export const ALL_ROLE_TAB_ROUTES = Array.from(
  new Set([...HOUSEKEEPER_TABS, ...INSPECTOR_TABS, ...ENGINEER_TABS].map((tab) => tab.name))
);

export const HIDDEN_APP_ROUTES = [
  "notifications/index",
  "lost-found/index",
  "scheduling/index",
  "sop/index",
  "sop/[sopId]",
  "my-rooms/[roomId]",
  "work-orders/[woId]",
];

export function getTabsForRole(role: UserRole): RoleTabDef[] {
  if (role === "engineer" || role === "chief_engineer") {
    return ENGINEER_TABS;
  }

  if (role === "housekeeping_supervisor" || role === "gm" || role === "front_desk") {
    return INSPECTOR_TABS;
  }

  return HOUSEKEEPER_TABS;
}
