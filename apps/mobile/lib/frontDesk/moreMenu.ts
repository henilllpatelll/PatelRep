import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

/* ─── Front Desk More (Design System V2, Phase 6) ──────────────────────────────
   Front Desk has five tabs (Home, Requests, Rooms, Logbook, More). Lost & Found and
   Profile were tabs in the legacy six-tab bar; they live here now. Every entry is a route that already exists, so
   no URL, deep link or notification destination changes. Role access is still enforced by each screen and the API;
   this list only decides what is shown. */

type IconName = ComponentProps<typeof Ionicons>["name"];

export type FrontDeskMoreKey = "lost" | "notifications" | "profile" | "help";

export interface FrontDeskMoreItem {
  key: FrontDeskMoreKey;
  icon: IconName;
  labelKey: string;
  subtitleKey: string;
  href: string;
  group: "tools" | "account";
}

export const FRONT_DESK_MORE_ITEMS: readonly FrontDeskMoreItem[] = [
  { key: "lost", icon: "search-outline", labelKey: "tabs.lostFound", subtitleKey: "frontDeskMore.lostSub", href: "/(app)/lost-found", group: "tools" },
  { key: "notifications", icon: "notifications-outline", labelKey: "frontDeskMore.notifications", subtitleKey: "frontDeskMore.notificationsSub", href: "/(app)/notifications", group: "account" },
  { key: "profile", icon: "person-circle-outline", labelKey: "frontDeskMore.profile", subtitleKey: "frontDeskMore.profileSub", href: "/(app)/profile", group: "account" },
  { key: "help", icon: "help-circle-outline", labelKey: "frontDeskMore.help", subtitleKey: "frontDeskMore.helpSub", href: "/(app)/profile/help", group: "account" },
];

/** Routes a Front Desk person reaches from More. While one of them is on screen, the More tab stays the selected one. */
const MORE_CHILD_PREFIXES = ["/lost-found", "/profile", "/notifications"];

export function isFrontDeskMoreChild(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MORE_CHILD_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
