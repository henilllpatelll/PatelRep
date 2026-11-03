/* ─── Engineering Home navigation contract ──────────────────────────────────
   Every card, shortcut and "see more" link on the Engineering Home is built here, so the destination can be tested
   against the number or list that led to it. Pure: no React, no i18n, no network.

   Rules this file enforces:
   - A count opens a screen that holds exactly what was counted. The Urgent count spans own, unclaimed and (for a
     manager) everyone's active work, so it opens the `all` Work view narrowed to urgent, never a single queue.
   - A list that shows only part of its items links to every kind of item it contains (work orders and PM).
   - What a role is offered follows apps/api guards (see roles.ts); the server still enforces every action. */

import { PM_LIST_ROUTE, ASSETS_LIST_ROUTE } from "@/lib/engineering/routes";
import { canActOnWorkOrders } from "@/lib/engineering/roles";
import { defaultView } from "@/lib/engineering/workNavigation";
import type { AttentionItem } from "@/lib/engineering/homeModel";
import type { QueueView } from "@/lib/engineering/workQueue";

export const WORK_ROUTE = "/(app)/work-orders";
export const REPORT_ISSUE_ROUTE = "/(app)/work-orders/new";
export const ROOM_STATUS_ROUTE = "/(app)/room-status";
export const ASSET_SCAN_ROUTE = "/(app)/assets/scan";

export interface WorkRoute {
  pathname: typeof WORK_ROUTE;
  params: { view: QueueView; filter?: "urgent"; nav?: string };
}

/**
 * A Work screen on one view. Work is a tab that stays mounted, so a link that repeats the previous params would not
 * re-apply them after the person moved around inside Work. Pass a fresh `token` per tap to make each tap count.
 */
export function workViewRoute(view: QueueView, token?: string): WorkRoute {
  return { pathname: WORK_ROUTE, params: token ? { view, nav: token } : { view } };
}

/** Home's Urgent card: every active emergency/urgent order this person can read, in any status and with any owner. */
export function urgentWorkRoute(token?: string): WorkRoute {
  return { pathname: WORK_ROUTE, params: token ? { view: "all", filter: "urgent", nav: token } : { view: "all", filter: "urgent" } };
}

/** My Jobs exists only for a role that can hold an assignment; a manager has no personal queue to count or open. */
export function showsMyJobs(role: string | null | undefined): boolean {
  return canActOnWorkOrders(role);
}

/** My Jobs opens My Work. For a role without one, the role's own default Work view. */
export function myJobsRoute(role: string | null | undefined, token?: string): WorkRoute {
  return workViewRoute(showsMyJobs(role) ? "mine" : defaultView(role), token);
}

/** The open job's detail is the screen that offers (or withholds) every repair action; Home only ever links there. */
export function continueLabelKey(role: string | null | undefined): "continueRepair" | "viewOrder" {
  return canActOnWorkOrders(role) ? "continueRepair" : "viewOrder";
}

/** Scan opens the existing equipment scanner (manual code entry and the equipment list are inside it). */
export const SCAN_ASSET_ROUTE = ASSET_SCAN_ROUTE;
/** Manual fallback for Scan: the equipment directory and its search. */
export const FIND_ASSET_ROUTE = ASSETS_LIST_ROUTE;

export type QuickActionKey = "report" | "room" | "scan" | "pm";

/** Technician shortcuts, in order. Reporting an issue is open to every signed-in role (POST /work-orders has no role guard). */
export function quickActionKeys(): QuickActionKey[] {
  return ["report", "room", "scan", "pm"];
}

export function quickActionRoute(key: QuickActionKey): string {
  switch (key) {
    case "report":
      return REPORT_ISSUE_ROUTE;
    case "room":
      return ROOM_STATUS_ROUTE;
    case "scan":
      return SCAN_ASSET_ROUTE;
    case "pm":
      return PM_LIST_ROUTE;
  }
}

export interface OverflowLink {
  kind: "wo" | "pm";
  /** How many items of this kind are not shown in the list. */
  count: number;
  route: WorkRoute | string;
}

/**
 * "See the rest" links for an attention list that shows only its first items. One link per kind that was cut, so a
 * hidden PM schedule is reachable even when every hidden work order is not (and the reverse). Work orders open the
 * `all` view because the list mixes emergencies, unassigned urgent work, past-due work and held work.
 */
export function attentionOverflowLinks(hidden: readonly AttentionItem[], token?: string): OverflowLink[] {
  const wo = hidden.filter((item) => item.kind === "wo").length;
  const pm = hidden.length - wo;
  const links: OverflowLink[] = [];
  if (wo > 0) links.push({ kind: "wo", count: wo, route: workViewRoute("all", token) });
  if (pm > 0) links.push({ kind: "pm", count: pm, route: PM_LIST_ROUTE });
  return links;
}
