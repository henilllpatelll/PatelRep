import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Push categories this build can label and switch. The SERVER decides which of them a person sees (by role)
 * and what each saved value is; this table only supplies the icon. It must list every key in
 * `apps/api/services/notify.py` CATEGORIES (a test reads that file), so a legitimate server category is never
 * silently hidden. A newer server may list more: those are not shown as switches because their meaning is unknown.
 */
export const CATEGORY_ICONS: Record<string, IconName> = {
  room_assignments: "bed-outline",
  work_orders: "construct-outline",
  tasks: "checkmark-circle-outline",
  schedule: "calendar-outline",
};

export function isKnownCategory(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, key);
}
