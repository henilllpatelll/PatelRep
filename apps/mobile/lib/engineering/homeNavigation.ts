/* ─── Engineering Home navigation contract ──────────────────────────────────
   Every card, shortcut and "see more" link on the Engineering Home is built here, so the destination can be tested
   against the number or list that led to it. Pure: no React, no i18n, no network.

   Rules this file enforces:
   - A count opens a screen that holds exactly what was counted. The Urgent count spans own, unclaimed and (for a
     manager) everyone's active work, so it opens the `all` Work view narrowed to urgent, never a single queue.
   - A list that shows only part of its items links to every kind of item it contains (work orders and PM).
   - What a role is offered follows apps/api guards (see roles.ts); the server still enforces every action. */

import { ASSETS_LIST_ROUTE, PM_LIST_ROUTE, isSafeRouteId, pmInspectRoute, pmScheduleRoute } from "@/lib/engineering/routes";
import { canActOnWorkOrders } from "@/lib/engineering/roles";
import { defaultView } from "@/lib/engineering/workNavigation";
import type { AttentionItem } from "@/lib/engineering/homeModel";
import type { FocusState } from "@/lib/engineering/homeFocus";
import type { QueueView } from "@/lib/engineering/workQueue";

export const WORK_ROUTE = "/(app)/work-orders";
export const REPORT_ISSUE_ROUTE = "/(app)/work-orders/new";
export const ROOM_STATUS_ROUTE = "/(app)/room-status";
export const ASSET_SCAN_ROUTE = "/(app)/assets/scan";

/** One order's detail. An id that is not a plain path segment (slash, dot, query) opens the Work list instead, never another route. */
export function workOrderPath(id: string | null | undefined): string {
  return isSafeRouteId(id) ? `${WORK_ROUTE}/${id}` : WORK_ROUTE;
}

export interface WorkRoute {
  pathname: typeof WORK_ROUTE;
  params: { view: QueueView; filter?: "urgent" | "in_progress"; nav?: string };
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

/** Scan opens the existing equipment scanner (it already offers manual code entry and the equipment search). */
export const SCAN_ASSET_ROUTE = ASSET_SCAN_ROUTE;
export const ENGINEERING_SYNC_ROUTE = "/(app)/engineering-sync";

export type TechnicianQuickActionKey = "report" | "scan" | "room" | "available" | "pm";
export type ChiefQuickActionKey = "assign" | "team" | "pm" | "assets";
export type QuickActionKey = TechnicianQuickActionKey | ChiefQuickActionKey;

/**
 * Home shortcuts, in order. Reporting an issue, scanning and room status are open to every engineering role. The
 * Available Work queue is the technician's pick-up list, so a role that cannot act on work orders gets PM instead and
 * is never offered a technician-only entry point.
 */
export function quickActionKeys(role?: string | null): TechnicianQuickActionKey[] {
  return canActOnWorkOrders(role) ? ["report", "scan", "room", "available"] : ["report", "scan", "room", "pm"];
}

export const TEAM_OVERVIEW_ROUTE = "/(app)/team";

/** True for the one role that gets the management Home (a GM has its own Home; an engineer gets the technician one). */
export function usesChiefHome(role: string | null | undefined): boolean {
  return role === "chief_engineer";
}

/**
 * Chief Engineer shortcuts. Assign Work opens Available Work (unassigned open/escalated orders, each with its Assign
 * action) rather than a target-less sheet; PM Planning opens the PM Plan view; Assets opens the directory.
 */
export function chiefQuickActionKeys(): ChiefQuickActionKey[] {
  return ["assign", "team", "pm", "assets"];
}

export function chiefQuickActionRoute(key: ChiefQuickActionKey, token?: string): WorkRoute | string | { pathname: string; params: Record<string, string> } {
  switch (key) {
    case "assign":
      return workViewRoute("available", token);
    case "team":
      return TEAM_OVERVIEW_ROUTE;
    case "pm":
      return { pathname: PM_LIST_ROUTE, params: { view: "plan" } };
    case "assets":
      return ASSETS_LIST_ROUTE;
  }
}

export type ChiefSummaryKey = "needsOwner" | "inProgress" | "waiting";

/** The three management counts and the exact queue each one opens (the same selections the Work tiles make). */
export function chiefSummaryRoute(key: ChiefSummaryKey, token?: string): WorkRoute {
  switch (key) {
    case "needsOwner":
      return workViewRoute("available", token);
    case "waiting":
      return workViewRoute("waiting", token);
    case "inProgress":
      return { pathname: WORK_ROUTE, params: token ? { view: "team", filter: "in_progress", nav: token } : { view: "team", filter: "in_progress" } };
  }
}

export function quickActionRoute(key: TechnicianQuickActionKey, token?: string): WorkRoute | string {
  switch (key) {
    case "report":
      return REPORT_ISSUE_ROUTE;
    case "scan":
      return SCAN_ASSET_ROUTE;
    case "room":
      return ROOM_STATUS_ROUTE;
    case "available":
      return workViewRoute("available", token);
    case "pm":
      return PM_LIST_ROUTE;
  }
}

/** Where the primary card's button goes for each state. Never a mutation: starting a repair happens on the order itself. */
export function focusRoute(focus: FocusState, token?: string): WorkRoute | string | null {
  switch (focus.kind) {
    case "continue_repair":
    case "start_next":
      return workOrderPath(focus.wo.id);
    case "resume_pm":
      return pmInspectRoute(focus.pm.draft.scheduleId);
    case "available_work":
    case "caught_up":
    case "caught_up_pm_unknown":
      return workViewRoute("available", token);
    case "none":
      return null;
  }
}

/** The row's destination in Needs Attention. */
export function attentionRoute(item: AttentionItem): string | null {
  switch (item.kind) {
    case "wo":
      return workOrderPath(item.wo.id);
    case "pm":
      return pmScheduleRoute(item.pm.id);
    case "sync":
      return ENGINEERING_SYNC_ROUTE;
  }
}
