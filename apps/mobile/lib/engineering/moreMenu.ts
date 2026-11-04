/* ─── Engineering More menu ─────────────────────────────────────────────────
   What the More tab offers, declared ONCE as a typed catalog (`MORE_CATALOG`). Two views are derived from it:

   - `getEngineeringMoreSections`  the three-section layout the screen renders today (operations / account /
     management). Unchanged until Phase 2 replaces the screen.
   - `getEngineeringMoreGroups`    the V2 information architecture (identity / tools / notifications & sync /
     support / management) that Phases 2-8 build on.

   Every entry is a real Expo Router destination or an implemented action; nothing is a placeholder. Role checks
   here only decide what is SHOWN and are re-checked at press time (`isMoreItemAvailable`) — the API (and the
   destination screen's own guard) enforces every permission. See docs/ENGINEERING_MORE_V2.md. */

import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import { isEngineeringRole, type EngineeringRole } from "@/lib/engineering/roles";
import { canManageTeam } from "@/lib/engineering/teamModel";

/* ── Legacy (rendered today) ─────────────────────────────────────────────── */

export type MoreSectionKey = "operations" | "account" | "management";

/* ── V2 information architecture ──────────────────────────────────────────── */

export type MoreGroupKey = "identity" | "tools" | "alerts" | "support" | "management";

/** Order the groups appear in. */
export const MORE_GROUP_ORDER: readonly MoreGroupKey[] = ["identity", "tools", "alerts", "support", "management"];

export const MORE_GROUP_TITLE_KEYS: Record<MoreGroupKey, string> = {
  identity: "engineeringMore.groups.identity",
  tools: "engineeringMore.groups.tools",
  alerts: "engineeringMore.groups.alerts",
  support: "engineeringMore.groups.support",
  management: "engineeringMore.management",
};

/** Stable identifiers: tests, analytics and later phases refer to rows by these, never by position. */
export type MoreItemKey =
  | "profile"
  | "settings"
  | "security"
  | "rooms"
  | "sop"
  | "schedule"
  | "notifications"
  | "notificationSettings"
  | "sync"
  | "help"
  | "faq"
  | "report"
  | "myReports"
  | "diagnostics"
  | "contactSupervisor"
  | "signOut"
  | "team";

/** Actions that are not a route. `signOut` opens the existing confirmation sheet (which guards unsynced work);
 *  `contactSupervisor` opens the existing ContactSheet. Phase 2 binds both on the More screen. */
export type MoreAction = "signOut" | "contactSupervisor";
export const MORE_ACTIONS: readonly MoreAction[] = ["signOut", "contactSupervisor"];

/** Live counters a row can show. `unread` is wired today; `sync` (pending-action count) is bound in Phase 4. */
export type MoreBadge = "unread" | "sync";

/** Where the Phase 2 hub screen places an entry. `header` = top-right icon, `identity` = profile card / its
 *  connection row, the rest are list sections (`signOut` is the footer action). Entries without a slot are
 *  reached through Settings or Help (e.g. Security, FAQs) and are not hub rows. */
export type MoreHubSlot = "header" | "identity" | "management" | "tools" | "account" | "signOut";
export const MORE_HUB_ORDER: readonly MoreHubSlot[] = ["header", "identity", "management", "tools", "account", "signOut"];

export interface MoreItem {
  key: MoreItemKey;
  labelKey: string;
  /** One-line description shown under the label on the hub screen. */
  subtitleKey?: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  href?: string;
  action?: MoreAction;
  badge?: MoreBadge;
  destructive?: boolean;
  /** This row is an entry point into the Engineering Sync Center. */
  syncEntry?: boolean;
}

export interface MoreSection {
  key: MoreSectionKey;
  titleKey: string;
  items: MoreItem[];
}

export interface MoreGroup {
  key: MoreGroupKey;
  titleKey: string;
  items: MoreItem[];
}

interface CatalogEntry extends MoreItem {
  group: MoreGroupKey;
  /** Roles the row is shown to. */
  roles: readonly EngineeringRole[];
  /** Section in today's three-section screen; absent rows are V2-only. */
  legacy?: MoreSectionKey;
  /** Placement(s) on the Phase 2 hub screen. */
  hub?: readonly MoreHubSlot[];
  /** Extra predicate mirroring the server guard, so the UI never offers what the API refuses. */
  guard?: (role: string | null | undefined) => boolean;
}

const BOTH: readonly EngineeringRole[] = ["engineer", "chief_engineer"];
const CHIEF: readonly EngineeringRole[] = ["chief_engineer"];

/** Declaration order is the display order within a group and within a legacy section. */
export const MORE_CATALOG: readonly CatalogEntry[] = [
  // Identity & account
  { key: "profile", group: "identity", hub: ["identity"], legacy: "account", roles: BOTH, labelKey: "engineeringMore.profile", icon: "person-outline", href: "/(app)/profile/personal" },
  { key: "settings", group: "identity", hub: ["header", "account"], subtitleKey: "engineeringMore.sub.settings", legacy: "account", roles: BOTH, labelKey: "engineeringMore.settings", icon: "settings-outline", href: "/(app)/profile" },
  { key: "security", group: "identity", roles: BOTH, labelKey: "engineeringMore.security", icon: "shield-checkmark-outline", href: "/(app)/profile/security" },
  { key: "signOut", group: "identity", hub: ["signOut"], legacy: "account", roles: BOTH, labelKey: "engineeringMore.signOut", icon: "log-out-outline", action: "signOut", destructive: true },
  // Engineering tools
  { key: "rooms", group: "tools", hub: ["tools"], subtitleKey: "engineeringMore.sub.rooms", legacy: "operations", roles: BOTH, labelKey: "engineeringMore.rooms", icon: "bed-outline", href: "/(app)/room-status" },
  { key: "sop", group: "tools", hub: ["tools"], subtitleKey: "engineeringMore.sub.sop", roles: BOTH, labelKey: "engineeringMore.sop", icon: "document-text-outline", href: "/(app)/sop" },
  { key: "schedule", group: "tools", hub: ["tools"], subtitleKey: "engineeringMore.sub.schedule", roles: BOTH, labelKey: "engineeringMore.schedule", icon: "calendar-number-outline", href: "/(app)/scheduling" },
  // Notifications & synchronization
  { key: "notifications", group: "alerts", hub: ["header"], legacy: "operations", roles: BOTH, labelKey: "engineeringMore.notifications", icon: "notifications-outline", href: "/(app)/notifications", badge: "unread" },
  { key: "notificationSettings", group: "alerts", legacy: "operations", roles: BOTH, labelKey: "engineeringMore.notificationSettings", icon: "options-outline", href: "/(app)/profile/notifications" },
  { key: "sync", group: "alerts", hub: ["identity"], legacy: "operations", roles: BOTH, labelKey: "engineeringMore.sync", icon: "sync-outline", href: "/(app)/engineering-sync", badge: "sync", syncEntry: true },
  // Support
  { key: "help", group: "support", hub: ["account"], subtitleKey: "engineeringMore.sub.help", legacy: "account", roles: BOTH, labelKey: "engineeringMore.help", icon: "help-circle-outline", href: "/(app)/profile/help" },
  { key: "faq", group: "support", roles: BOTH, labelKey: "engineeringMore.faq", icon: "chatbubble-ellipses-outline", href: "/(app)/profile/faq" },
  { key: "report", group: "support", roles: BOTH, labelKey: "engineeringMore.report", icon: "alert-circle-outline", href: "/(app)/profile/report" },
  { key: "myReports", group: "support", roles: BOTH, labelKey: "engineeringMore.myReports", icon: "documents-outline", href: "/(app)/profile/my-reports" },
  { key: "diagnostics", group: "support", roles: BOTH, labelKey: "engineeringMore.diagnostics", icon: "pulse-outline", href: "/(app)/profile/diagnostics" },
  { key: "contactSupervisor", group: "support", roles: BOTH, labelKey: "engineeringMore.contactSupervisor", icon: "call-outline", action: "contactSupervisor" },
  // Management: Team Overview carries technician workload and Assign Technician, so they are not separate rows.
  { key: "team", group: "management", hub: ["management"], subtitleKey: "engineeringMore.sub.team", legacy: "management", roles: CHIEF, guard: canManageTeam, labelKey: "engineeringMore.team", icon: "people-outline", href: "/(app)/team" },
];

const LEGACY_TITLE_KEYS: Record<MoreSectionKey, string> = {
  operations: "engineeringMore.operations",
  account: "engineeringMore.account",
  management: "engineeringMore.management",
};
const LEGACY_ORDER: readonly MoreSectionKey[] = ["operations", "account", "management"];
/** Row order inside today's sections (Sign out stays last). */
const LEGACY_ITEM_ORDER: readonly MoreItemKey[] = ["rooms", "notifications", "notificationSettings", "sync", "profile", "settings", "help", "signOut", "team"];

function visible(entry: CatalogEntry, role: string | null | undefined): boolean {
  return isEngineeringRole(role) && entry.roles.includes(role) && (entry.guard ? entry.guard(role) : true);
}

function toItem(entry: CatalogEntry): MoreItem {
  const { group: _group, roles: _roles, legacy: _legacy, hub: _hub, guard: _guard, ...item } = entry;
  return item;
}

/** Defence in depth: the press handler asks again, so a stale or forged item can never open a management screen.
 *  The destination screen and the API still enforce the permission independently. */
export function isMoreItemAvailable(role: string | null | undefined, key: MoreItemKey): boolean {
  const entry = MORE_CATALOG.find((e) => e.key === key);
  return !!entry && visible(entry, role);
}

/** V2 groups for the role. Empty groups are dropped. */
export function getEngineeringMoreGroups(role: string | null | undefined): MoreGroup[] {
  if (!isEngineeringRole(role)) return [];
  return MORE_GROUP_ORDER.map((key) => ({
    key,
    titleKey: MORE_GROUP_TITLE_KEYS[key],
    items: MORE_CATALOG.filter((e) => e.group === key && visible(e, role)).map(toItem),
  })).filter((group) => group.items.length > 0);
}

/** The layout the screen renders today. Kept identical until Phase 2. */
export function getEngineeringMoreSections(role: string | null | undefined): MoreSection[] {
  if (!isEngineeringRole(role)) return [];
  return LEGACY_ORDER.map((key) => ({
    key,
    titleKey: LEGACY_TITLE_KEYS[key],
    items: MORE_CATALOG.filter((e) => e.legacy === key && visible(e, role))
      .sort((a, b) => LEGACY_ITEM_ORDER.indexOf(a.key) - LEGACY_ITEM_ORDER.indexOf(b.key))
      .map(toItem),
  })).filter((section) => section.items.length > 0);
}

export type MoreHub = Record<MoreHubSlot, MoreItem[]>;

/** The Phase 2 hub layout for the role, derived from the same catalog (no second registry). Slots with nothing
 *  visible are empty arrays, so the Management section simply does not exist for a regular engineer. */
export function getEngineeringMoreHub(role: string | null | undefined): MoreHub {
  const hub = Object.fromEntries(MORE_HUB_ORDER.map((slot) => [slot, [] as MoreItem[]])) as MoreHub;
  if (!isEngineeringRole(role)) return hub;
  for (const entry of MORE_CATALOG) {
    if (!visible(entry, role)) continue;
    for (const slot of entry.hub ?? []) hub[slot].push(toItem(entry));
  }
  return hub;
}
