import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import type { AttentionCode, AttentionItem, HomeModel, RecentSubmission } from "@/lib/housekeeping/homeModel";
import type { Recommendation } from "@/lib/housekeeping/homeRecommendation";

/**
 * Which Home layout the housekeeper sees. One pure function over the shared
 * HomeModel: components render the answer and never re-derive it, so the nine
 * dashboard states below can not drift from the numbers on My Rooms.
 */

export type HomeStateKind =
  /** First load, or the hotel's day just rolled over. */
  | "loading"
  /** State 7 without a cache: no trustworthy answer about today's rooms. */
  | "unavailable"
  /** State 6: the server confirmed zero assignments. */
  | "no_assignments"
  /** State 9. */
  | "clocked_out"
  /** State 8. */
  | "on_break"
  /** State 1. */
  | "before_shift"
  /** State 3: an open cleaning session leads. */
  | "cleaning"
  /** State 4: a room was just finished. */
  | "submitted"
  /** State 5: nothing to start, or something critical, so issues lead. */
  | "attention"
  /** State 2: started, no active room. */
  | "idle";

/** State 7 when rooms are cached: the work stays visible, the reason is stated. */
export type ConnectionNoticeKind = "offline" | "refresh_failed" | "stale";

export interface ConnectionNotice {
  kind: ConnectionNoticeKind;
  /** ISO time of the last authoritative refresh; null if there has been none. */
  lastRefreshAt: string | null;
}

export interface HomeView {
  kind: HomeStateKind;
  notice: ConnectionNotice | null;
  /** The room that leads the screen: the open session, or the next room to start. */
  lead: Recommendation | null;
  /** Every assigned room is handled; clock-out is the only thing left. */
  allDone: boolean;
  /** The shift has not been started but work is already open: offer Start Shift quietly. */
  startNudge: boolean;
  /** Rooms and progress can be described (the board is usable). */
  boardUsable: boolean;
}

/**
 * Typed integration points for destinations a later phase upgrades (progress
 * details, the Attention Center). An absent entry means "not built yet": the
 * affordance is hidden or falls back to the existing route, never a dead tap.
 */
export interface HomeDestinations {
  progressDetails?: () => void;
  attentionCenter?: () => void;
}

/** The room that leads Home: the open session, or the next room to start (a room only waiting to send does not lead). */
export function leadOf(model: HomeModel): Recommendation | null {
  const active = model.activeRoom;
  return active && !active.completing ? model.recommendation : model.nextRoom;
}

export function resolveHomeState(model: HomeModel): HomeView {
  const board = model.board.state;
  const lifecycle = model.lifecycle.state;
  const boardUsable = board === "ready" || board === "empty";
  const active = model.activeRoom;
  const working = active && !active.completing ? active : null;
  const lead = leadOf(model);
  const allDone = boardUsable && model.dashboard.progress.serviceable > 0 && model.dashboard.progress.remaining === 0;

  let kind: HomeStateKind;
  if (lifecycle === "on_break") kind = "on_break";
  else if (lifecycle === "ended") kind = "clocked_out";
  else if (board === "loading" || board === "stale_date") kind = "loading";
  else if (board === "unavailable") kind = "unavailable";
  else if (board === "empty") kind = "no_assignments";
  else if (working) kind = "cleaning";
  else if (lifecycle === "not_started") kind = "before_shift";
  else if (active?.completing || model.recentSubmission) kind = "submitted";
  else if (!lead && !allDone) kind = "attention";
  else if (model.attention.some((item) => item.severity === "critical")) kind = "attention";
  else kind = "idle";

  return {
    kind,
    notice: boardUsable ? resolveNotice(model) : null,
    lead,
    allDone,
    startNudge: lifecycle === "not_started" && (kind === "cleaning" || kind === "no_assignments"),
    boardUsable,
  };
}

function resolveNotice(model: HomeModel): ConnectionNotice | null {
  const { board, sync } = model;
  if (!sync.online) return { kind: "offline", lastRefreshAt: board.lastRefreshAt };
  if (board.fetchError !== null) return { kind: "refresh_failed", lastRefreshAt: board.lastRefreshAt };
  if (board.freshness === "stale" || board.freshness === "cached") return { kind: "stale", lastRefreshAt: board.lastRefreshAt };
  return null;
}

/** The submission banner's subject: a finished room, or one waiting to send. */
export function submissionFor(model: HomeModel): RecentSubmission | null {
  const active = model.activeRoom;
  if (active?.completing) {
    return {
      roomId: active.room.id,
      roomNumber: active.room.room_number,
      at: active.startedAt ?? "",
      confirmed: false,
      inspected: false,
    };
  }
  return model.recentSubmission;
}

/**
 * Quick Mark Clean from Home is only for an open, confirmed-or-local session on
 * a non-departure room (departures need the linen counts on the detail screen).
 * It still goes through the hold-to-confirm sheet, which enforces the checklist.
 */
export function canQuickMarkClean(model: HomeModel): boolean {
  const active = model.activeRoom;
  return Boolean(
    active &&
      active.sessionState === "active" &&
      active.room.status === "IN_PROGRESS" &&
      active.room.clean_type !== "DEP",
  );
}

/* ─── Needs your attention ──────────────────────────────────────────────────── */

/** Rooms the person can not enter right now; they wait, they are not worked. */
const RESTRICTED: ReadonlySet<AttentionCode> = new Set(["dnd", "do_not_service", "service_declined", "come_back_later", "guest_inside"]);

const ANNOTATION_CODES: ReadonlySet<AttentionCode> = new Set(["reclean", "rush_overdue"]);

export type AttentionGroup = "critical" | "actionable" | "message" | "restricted" | "info";

export function attentionGroup(item: AttentionItem): AttentionGroup {
  if (item.severity === "critical") return "critical";
  if (item.kind === "supervisor_message") return "message";
  if (RESTRICTED.has(item.code)) return "restricted";
  return item.severity === "warning" ? "actionable" : "info";
}

const GROUP_RANK: Record<AttentionGroup, number> = { critical: 0, actionable: 1, message: 2, restricted: 3, info: 4 };

export interface AttentionPreviewItem {
  item: AttentionItem;
  group: AttentionGroup;
  entry: RoomEntry | null;
}

export interface AttentionPreview {
  shown: AttentionPreviewItem[];
  /** Items not shown. They are counted, never dropped. */
  remaining: number;
  total: number;
}

export const ATTENTION_PREVIEW_LIMIT = 2;

/**
 * A small preview: work the person can resolve first, then the supervisor's
 * message, then rooms they simply have to wait on. The same condition never
 * appears twice.
 */
export function buildAttentionPreview(
  model: HomeModel,
  limit = ATTENTION_PREVIEW_LIMIT,
  /** Rooms already shown as the lead or Up Next card. */
  onScreenRoomIds: ReadonlySet<string> = new Set(),
): AttentionPreview {
  const seen = new Set<string>();
  const unique = model.attention.filter((item) => {
    // Reclean / overdue rush annotate work that is already on screen; listing it again is a duplicate.
    if (item.roomId && onScreenRoomIds.has(item.roomId) && ANNOTATION_CODES.has(item.code)) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const byRoom = new Map(model.dashboard.all.map((entry) => [entry.room.id, entry]));
  const ranked = unique
    .map((item, index) => ({ item, index, group: attentionGroup(item) }))
    .sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.index - b.index);
  // The supervisor's instruction always gets a slot: other items must not push it behind "View all".
  const shown = ranked.slice(0, limit);
  const message = ranked.find((row) => row.group === "message");
  if (message && limit > 0 && !shown.includes(message)) shown[shown.length - 1] = message;
  return {
    shown: shown.map(({ item, group }) => ({
      item,
      group,
      entry: item.roomId ? (byRoom.get(item.roomId) ?? null) : null,
    })),
    remaining: Math.max(0, ranked.length - shown.length),
    total: ranked.length,
  };
}

/* ─── Up next ───────────────────────────────────────────────────────────────── */

/** The room after the lead one, from the shared cleaning order. Never the lead room again. */
export function selectUpNext(model: HomeModel, lead: Recommendation | null): RoomEntry | null {
  const leadId = lead?.room.id ?? model.activeRoom?.room.id ?? null;
  return model.dashboard.upNext.find((entry) => entry.room.id !== leadId) ?? null;
}

/* ─── Counts line ───────────────────────────────────────────────────────────── */

export interface ProgressCounts {
  toClean: number;
  inProgress: number;
  needAttention: number;
}

/** "5 To clean · 1 In progress · 2 Need attention": disjoint buckets, so they never double count. */
export function progressCounts(model: HomeModel): ProgressCounts {
  const { actionRequired, handledExceptions } = model.progress;
  return {
    toClean: actionRequired.ready,
    inProgress: actionRequired.active,
    needAttention: actionRequired.attention + handledExceptions,
  };
}
