import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import { paletteV2, touchV2 } from "@/components/shared/tokensV2";
import type { ThemeTokens } from "@/components/shared/tokens";
import type { RoleTabDef, RoleTabKey } from "./roleTabs";

/** Design System V2 bottom-navigation presentation. Pure (no React) so it is unit-tested directly.
 *
 *  Visual only: it never decides which tabs exist or who may see them — `roleTabs.ts` stays the one
 *  source of destinations. Everything here is applied only when the V2 preview flag is on. */

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Icon per destination. Distinct within every role's bar (the legacy set used the same grid glyph
 *  for both Home and Room Board). Outline when idle, filled when focused. */
const V2_TAB_ICON: Record<RoleTabKey, IconName> = {
  home: "home-outline",
  rooms: "bed-outline",
  inspect: "shield-checkmark-outline",
  orders: "construct-outline",
  work: "construct-outline",
  more: "ellipsis-horizontal-circle-outline",
  copilot: "sparkles-outline",
  tasks: "checkmark-circle-outline",
  assets: "cube-outline",
  me: "person-outline",
  board: "grid-outline",
  assignments: "people-outline",
  pm: "calendar-outline",
  requests: "chatbubble-ellipses-outline",
  "room-status": "bed-outline",
  lost: "search-outline",
  alerts: "warning-outline",
  staff: "people-circle-outline",
  logbook: "book-outline",
};

export function getTabIconV2(tab: Pick<RoleTabDef, "key">, focused: boolean): IconName {
  const outline = V2_TAB_ICON[tab.key];
  return (focused ? outline.replace(/-outline$/, "") : outline) as IconName;
}

/** Selected-item color on the dark navigation surface. The V2 dark-mode blue is the one that clears
 *  4.5:1 on the slate bar in BOTH modes (the light-mode blue does not), so the bar uses it always. */
export const NAV_ACTIVE_V2 = paletteV2.dark.primary;

/** The bar above the device's bottom inset. The item area is this minus the 6 dp top padding (58 dp:
 *  a 30 dp pill, the label and breathing room), so labels are never clipped. */
export const TAB_BAR_CONTENT_HEIGHT = 64;
/** Five or more tabs get a narrower pill so six items still fit a 320 dp phone. */
export const CROWDED_TAB_COUNT = 5;
const MIN_BOTTOM_PAD = 8;

export function tabBarMetricsV2(bottomInset: number) {
  const pad = Math.max(bottomInset, MIN_BOTTOM_PAD);
  return { height: TAB_BAR_CONTENT_HEIGHT + pad, paddingBottom: pad, paddingTop: 6 };
}

/** `screenOptions` for the app `<Tabs>` under V2. */
export function buildTabScreenOptionsV2(theme: ThemeTokens, bottomInset: number, tabCount: number) {
  const m = tabBarMetricsV2(bottomInset);
  return {
    tabBarActiveTintColor: NAV_ACTIVE_V2,
    tabBarInactiveTintColor: theme.shell.ink2,
    tabBarLabelStyle: { fontSize: tabCount >= CROWDED_TAB_COUNT ? 11 : 12, fontWeight: "600" as const, marginTop: 2 },
    tabBarItemStyle: { minHeight: touchV2.min, paddingTop: 2 },
    tabBarStyle: {
      backgroundColor: theme.shell.bg,
      borderTopColor: theme.shell.line,
      borderTopWidth: 1,
      height: m.height,
      paddingTop: m.paddingTop,
      paddingBottom: m.paddingBottom,
      elevation: 0,
      shadowOpacity: 0,
    },
    // Unread badge: sits on the icon's top-right corner, not floating off the tab edge.
    tabBarBadgeStyle: {
      backgroundColor: theme.destructiveAction,
      color: theme.onDestructive,
      fontSize: 11,
      fontWeight: "700" as const,
      minWidth: 18,
      height: 18,
      lineHeight: 16,
      borderRadius: 9,
      marginLeft: 6,
      marginTop: -2,
    },
  };
}
