/* ─── Engineering More menu ─────────────────────────────────────────────────
   What the More tab offers. Only destinations that exist today are listed; the
   Management section stays empty (and is not rendered) until Phase 8 adds real
   chief-engineer screens, so there is never a row that leads nowhere. Role
   checks here only decide what is shown — the API enforces every permission. */

import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import { isEngineeringRole } from "@/lib/engineering/roles";

export type MoreSectionKey = "operations" | "account" | "management";

export interface MoreItem {
  key: string;
  labelKey: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  href?: string;
  /** Sign out is an action (opens the confirmation sheet), not a route. */
  action?: "signOut";
  /** Shows the unread notification count. */
  badge?: "unread";
  destructive?: boolean;
}

export interface MoreSection {
  key: MoreSectionKey;
  titleKey: string;
  items: MoreItem[];
}

export function getEngineeringMoreSections(role: string | null | undefined): MoreSection[] {
  if (!isEngineeringRole(role)) return [];
  const sections: MoreSection[] = [
    {
      key: "operations",
      titleKey: "engineeringMore.operations",
      items: [
        { key: "rooms", labelKey: "engineeringMore.rooms", icon: "bed-outline", href: "/(app)/room-status" },
        {
          key: "notifications",
          labelKey: "engineeringMore.notifications",
          icon: "notifications-outline",
          href: "/(app)/notifications",
          badge: "unread",
        },
      ],
    },
    {
      key: "account",
      titleKey: "engineeringMore.account",
      items: [
        { key: "profile", labelKey: "engineeringMore.profile", icon: "person-outline", href: "/(app)/profile/personal" },
        { key: "settings", labelKey: "engineeringMore.settings", icon: "settings-outline", href: "/(app)/profile" },
        { key: "help", labelKey: "engineeringMore.help", icon: "help-circle-outline", href: "/(app)/profile/help" },
        { key: "signOut", labelKey: "engineeringMore.signOut", icon: "log-out-outline", action: "signOut", destructive: true },
      ],
    },
  ];
  // Phase 8 adds Team Overview / Team Assignments for chief_engineer once those screens exist.
  const management: MoreItem[] = [];
  if (role === "chief_engineer" && management.length > 0) {
    sections.push({ key: "management", titleKey: "engineeringMore.management", items: management });
  }
  return sections;
}
