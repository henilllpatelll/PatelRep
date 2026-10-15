import type { AttentionItem, HomeModel } from "@/lib/housekeeping/homeModel";
import { attentionGroup, type AttentionGroup, type AttentionPreviewItem } from "@/lib/housekeeping/homeState";

/**
 * The Attention Center's model: the same `HomeModel.attention` items the Home
 * preview draws from (no second source), grouped into a few filters and ordered
 * the same way. Every item lands in exactly one filter, so the filter counts add
 * up to "All" and never double count a room's condition.
 */

export type AttentionFilter = "all" | "urgent" | "access" | "messages" | "other";
export type AttentionBucket = Exclude<AttentionFilter, "all">;

const URGENT_CODES: ReadonlySet<string> = new Set(["reclean", "rush_overdue"]);
/** Rooms the person cannot enter (or cannot yet prove they may). */
const ACCESS_CODES: ReadonlySet<string> = new Set([
  "dnd",
  "do_not_service",
  "service_declined",
  "come_back_later",
  "guest_inside",
  "access_problem",
  "checkout_unverified",
]);

export function bucketOf(item: AttentionItem): AttentionBucket {
  if (item.kind === "supervisor_message") return "messages";
  if (item.severity === "critical" || URGENT_CODES.has(item.code)) return "urgent";
  if (ACCESS_CODES.has(item.code)) return "access";
  return "other";
}

export interface AttentionCenterItem extends AttentionPreviewItem {
  bucket: AttentionBucket;
}

export interface AttentionCenter {
  /** Every item, in display order, once. */
  items: AttentionCenterItem[];
  counts: Record<AttentionFilter, number>;
  /** "All" plus every filter that has something in it. */
  filters: AttentionFilter[];
}

const GROUP_RANK: Record<AttentionGroup, number> = { critical: 0, actionable: 1, message: 2, restricted: 3, info: 4 };
const FILTER_ORDER: AttentionBucket[] = ["urgent", "access", "messages", "other"];

export function buildAttentionCenter(model: HomeModel): AttentionCenter {
  const seen = new Set<string>();
  const byRoom = new Map(model.dashboard.all.map((entry) => [entry.room.id, entry]));
  const items: AttentionCenterItem[] = model.attention
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item, index) => ({ item, index, group: attentionGroup(item) }))
    .sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.index - b.index)
    .map(({ item, group }) => ({
      item,
      group,
      entry: item.roomId ? (byRoom.get(item.roomId) ?? null) : null,
      bucket: bucketOf(item),
    }));

  const counts: Record<AttentionFilter, number> = { all: items.length, urgent: 0, access: 0, messages: 0, other: 0 };
  for (const entry of items) counts[entry.bucket] += 1;
  return {
    items,
    counts,
    filters: ["all", ...FILTER_ORDER.filter((bucket) => counts[bucket] > 0)],
  };
}

/** Items for a filter. A filter that has emptied since it was chosen falls back to All. */
export function itemsForFilter(center: AttentionCenter, filter: AttentionFilter): AttentionCenterItem[] {
  if (filter === "all" || center.counts[filter] === 0) return center.items;
  return center.items.filter((entry) => entry.bucket === filter);
}

export function effectiveFilter(center: AttentionCenter, filter: AttentionFilter): AttentionFilter {
  return filter === "all" || center.counts[filter] > 0 ? filter : "all";
}

/* ─── Where a tap goes ──────────────────────────────────────────────────────── */

export type AttentionTarget =
  | { type: "room"; roomId: string }
  /** The issue-details drawer for this item. */
  | { type: "details"; itemId: string }
  | { type: "message"; notificationId: string }
  | { type: "my_rooms" };

/** Conditions explained in the drawer first: the person waits on these, they cannot work around them. */
const DETAILS_FIRST: ReadonlySet<string> = new Set(["dnd", "do_not_service", "service_declined", "come_back_later", "guest_inside"]);

export interface AttentionActionSpec {
  /** Locale key for the button. */
  labelKey: string;
  target: AttentionTarget;
  /** Also offer a quiet "Details" link that opens the drawer (room items whose primary goes straight to the room). */
  detailsLink: boolean;
}

/**
 * The single most useful destination for an item. Restricted rooms explain
 * themselves (and never offer Start); rooms with work to do open the existing
 * room workflow; a message opens the message drawer.
 */
export function attentionAction(item: AttentionItem): AttentionActionSpec {
  if (item.kind === "supervisor_message") {
    return { labelKey: "home.attentionCenter.action.readMessage", target: { type: "message", notificationId: item.recordId ?? "" }, detailsLink: false };
  }
  const roomTarget: AttentionTarget | null = item.roomId ? { type: "room", roomId: item.roomId } : null;
  if (item.kind === "room" && DETAILS_FIRST.has(item.code)) {
    return { labelKey: "home.attentionCenter.action.viewDetails", target: { type: "details", itemId: item.id }, detailsLink: false };
  }
  switch (item.code) {
    case "reclean":
      return { labelKey: "home.attentionCenter.action.reviewCorrections", target: roomTarget ?? { type: "my_rooms" }, detailsLink: true };
    case "rush_overdue":
    case "work_order":
    case "high_risk":
    case "note":
    case "session_missing":
    case "session_unassigned":
      return { labelKey: "home.attentionCenter.action.openRoom", target: roomTarget ?? { type: "my_rooms" }, detailsLink: item.kind === "room" };
    case "checkout_unverified":
    case "access_problem":
      return { labelKey: "home.attentionCenter.action.viewRoom", target: roomTarget ?? { type: "my_rooms" }, detailsLink: true };
    default:
      // Sync problems: the room when one is named, otherwise the list that holds the unsent work.
      return {
        labelKey: roomTarget ? "home.attentionCenter.action.viewRoom" : "home.attentionCenter.action.openMyRooms",
        target: roomTarget ?? { type: "my_rooms" },
        detailsLink: false,
      };
  }
}
