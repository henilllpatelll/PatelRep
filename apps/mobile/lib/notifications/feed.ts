import type { AppNotification } from "@/lib/api/notifications";
import { redact } from "@/lib/ai/history";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";

/**
 * The inbox as a list. Everything here is arithmetic on the notifications the server already
 * delivered: nothing is generated, ranked by a model or marked important by wording. Urgency is whatever
 * the producer's reviewed event type says (see KIND_BY_TYPE); an unknown type is plain "other".
 */

export type FeedFilter = "all" | "unread";

export type FeedKind = "priority" | "maintenance" | "task" | "room" | "message" | "other";

const KIND_BY_TYPE: Record<string, FeedKind> = {
  task_assigned_urgent: "priority",
  escalation_tier1: "priority",
  escalation_tier2: "priority",
  escalation_auto: "priority",
  escalation_auto_asset: "priority",
  re_clean_dispatched: "priority",
  wo_assignment: "maintenance",
  work_order_complete: "maintenance",
  guest_request_wo_completed: "maintenance",
  asset_risk_high: "maintenance",
  task_assigned: "task",
  task_reassigned: "task",
  task_cancelled: "task",
  task_blocked: "task",
  task_blocker_resolved: "task",
  room_assignment: "room",
  room_checked_out: "room",
  room_risk_high: "room",
  room_stayover: "room",
  direct_message: "message",
  broadcast: "message",
  logbook_mention: "message",
  shift_summary: "message",
};

export function kindOf(type: string | null | undefined): FeedKind {
  return (type && KIND_BY_TYPE[type]) || "other";
}

const PREVIEW_CHARS = 140;

/**
 * The line shown in the list. Contact details are masked and the text is shortened; the full message is
 * only on screen once the person opens it. (The server does not put guest names in notification text;
 * this is the safety net for anything that slips into free text.)
 */
export function previewOf(body: string | null | undefined): string {
  const flat = redact(String(body ?? "")).replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : flat;
}

export interface FeedItem {
  notification: AppNotification;
  kind: FeedKind;
  unread: boolean;
  preview: string;
}

function time(notification: AppNotification): number {
  const value = Date.parse(notification.created_at);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Union of the unread list and the full list, once per id (the full list's copy wins, but a row either
 * list knows is unread stays unread), newest first. Rows are never hidden for looking alike: each one is a
 * separate server record with its own read state, so hiding one would leave an unread row nobody can see.
 */
export function mergeFeed(unread: AppNotification[], all: AppNotification[] | null): AppNotification[] {
  const byId = new Map<string, AppNotification>();
  for (const row of all ?? []) byId.set(row.id, row);
  for (const row of unread) {
    const existing = byId.get(row.id);
    byId.set(row.id, existing ? { ...existing, is_read: existing.is_read && row.is_read } : row);
  }
  return [...byId.values()].sort((a, b) => time(b) - time(a));
}

export function buildFeedItems(rows: AppNotification[], filter: FeedFilter): FeedItem[] {
  return rows
    .filter((row) => filter === "all" || !row.is_read)
    .map((notification) => ({ notification, kind: kindOf(notification.type), unread: !notification.is_read, preview: previewOf(notification.body) }));
}

export type FeedDay = "today" | "yesterday" | "earlier";

export interface FeedGroup {
  day: FeedDay;
  items: FeedItem[];
}

/** Today / Yesterday / Earlier by the HOTEL's calendar day, so a night shift reads its own days. */
export function groupByDay(items: FeedItem[], timeZone: string | null | undefined, now: Date = new Date()): FeedGroup[] {
  const todayKey = hotelDateKey(now, timeZone);
  const yesterdayKey = hotelDateKey(new Date(now.getTime() - 24 * 60 * 60_000), timeZone);
  const buckets: Record<FeedDay, FeedItem[]> = { today: [], yesterday: [], earlier: [] };
  for (const item of items) {
    const key = hotelDateKey(item.notification.created_at, timeZone);
    const day: FeedDay = key && key === todayKey ? "today" : key && key === yesterdayKey ? "yesterday" : "earlier";
    buckets[day].push(item);
  }
  return (["today", "yesterday", "earlier"] as const).filter((day) => buckets[day].length > 0).map((day) => ({ day, items: buckets[day] }));
}
