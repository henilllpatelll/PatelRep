import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import type { BlockedTaskItem } from "@/lib/api/tasks";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { isActionable, type FloorRoom } from "@/lib/housekeeping/supervisor";
import type {
  AttentionSeverity,
  SupervisorAttention,
  SupervisorAttentionItem,
  SupervisorAttentionKind,
  SupervisorPrimaryAction,
} from "@/lib/housekeeping/supervisorAttention";
import { knownValue, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { describeAttention } from "@/lib/housekeeping/supervisorTodayView";
import type { TodaySources } from "@/lib/housekeeping/supervisorToday";
import type { SupervisorHref, SupervisorTarget } from "@/lib/navigation/supervisorRoutes";
import { supervisorHref } from "@/lib/navigation/supervisorRoutes";

/* ─── Supervisor Attention Center — presentation model ──────────────────────
   Pure mapping from the ONE attention list (`buildSupervisorAttention`, shared
   with Today) to what the Attention Center and its detail sheet say. No React,
   no I/O. Nothing here decides what needs attention — that is the model's job;
   this only groups, filters and words it, so Today and the Center cannot drift.

   CATEGORIES partition the list (each item has exactly one):
     rooms    arrival at risk · readiness risk · access restricted
     team     unassigned rooms · shift ended with open rooms · workload
     inspect  rooms awaiting inspection
     issues   unresolved task blockers
     messages (nothing produces a message item yet — see supervisorAttention.ts)
   FILTERS are All, the categories that have items, and Urgent. Urgent is a view
   across categories (critical items), NOT a category: category counts add up to
   All; Urgent is a subset of it. */

type IconName = ComponentProps<typeof Ionicons>["name"];

export type AttentionCategory = "rooms" | "team" | "inspect" | "issues" | "messages";
export type AttentionFilter = "all" | "urgent" | AttentionCategory;

export const CATEGORY_OF: Record<SupervisorAttentionKind, AttentionCategory> = {
  arrival_at_risk: "rooms",
  readiness_risk: "rooms",
  access_restricted: "rooms",
  unassigned_rooms: "team",
  shift_ended_with_open_rooms: "team",
  workload_over_assigned: "team",
  awaiting_inspection: "inspect",
  task_blocker: "issues",
  message: "messages",
};

const CATEGORY_ORDER: AttentionCategory[] = ["rooms", "team", "inspect", "issues", "messages"];

/* ─── The list ────────────────────────────────────────────────────────────── */

export interface AttentionCenter {
  /** Every item, most important first — exactly what Today's preview is cut from. */
  items: SupervisorAttentionItem[];
  counts: Record<AttentionFilter, number>;
  /** Filters worth showing: All, Urgent and categories that have items (an empty selected one is kept by the screen). */
  filters: AttentionFilter[];
  /** Sources whose absence means some issues could not be checked. */
  unverified: SupervisorAttention["unverified"];
}

/** Kinds the model can carry but no screen has wording for yet; they are not counted because they cannot be shown. */
const UNWORDED: ReadonlySet<SupervisorAttentionKind> = new Set<SupervisorAttentionKind>(["message"]);

export function buildAttentionCenter(attention: SupervisorAttention): AttentionCenter {
  const items = attention.items.filter((item) => !UNWORDED.has(item.kind));
  const counts: Record<AttentionFilter, number> = {
    all: items.length,
    urgent: 0,
    rooms: 0,
    team: 0,
    inspect: 0,
    issues: 0,
    messages: 0,
  };
  for (const item of items) {
    counts[CATEGORY_OF[item.kind]] += 1;
    if (item.severity === "critical") counts.urgent += 1;
  }
  const filters: AttentionFilter[] = ["all"];
  if (counts.urgent > 0) filters.push("urgent");
  for (const category of CATEGORY_ORDER) if (counts[category] > 0) filters.push(category);
  return { items, counts, filters, unverified: attention.unverified };
}

/** Items for a filter, in the shared order. Never falls back to another filter: an empty one is empty. */
export function itemsForFilter(center: AttentionCenter, filter: AttentionFilter): SupervisorAttentionItem[] {
  if (filter === "all") return center.items;
  if (filter === "urgent") return center.items.filter((item) => item.severity === "critical");
  return center.items.filter((item) => CATEGORY_OF[item.kind] === filter);
}

/** The filters to draw: the available ones, plus the selected one even when a refresh emptied it. */
export function visibleFilters(center: AttentionCenter, selected: AttentionFilter): AttentionFilter[] {
  return center.filters.includes(selected) ? center.filters : [...center.filters, selected];
}

/* ─── Cards ───────────────────────────────────────────────────────────────── */

export interface AttentionCardView {
  id: string;
  kind: SupervisorAttentionKind;
  category: AttentionCategory;
  severity: AttentionSeverity;
  icon: IconName;
  title: { key: string; params: Record<string, string | number> };
  subtitle: { key: string; params: Record<string, string | number> };
  /** Words for the severity, so it never rests on colour alone. */
  severityLabelKey: string;
  /** The backing data is the last known answer, not verified now. */
  stale: boolean;
  /** Epoch ms of the oldest verified answer behind the card. */
  fetchedAt: number | null;
}

export function describeCard(
  item: SupervisorAttentionItem,
  ctx: { zone: string | null | undefined; language: string; someone: string },
): AttentionCardView | null {
  const row = describeAttention(item, ctx);
  if (!row) return null;
  return {
    id: item.id,
    kind: item.kind,
    category: CATEGORY_OF[item.kind],
    severity: item.severity,
    icon: row.icon,
    title: row.title,
    subtitle: row.subtitle,
    severityLabelKey: `supervisorAttention.severity.${item.severity}`,
    stale: item.source.status === "stale",
    fetchedAt: item.source.fetchedAt,
  };
}

/* ─── Detail ──────────────────────────────────────────────────────────────── */

export interface DetailFact {
  icon: IconName;
  key: string;
  params: Record<string, string | number>;
}

export interface DetailRecord {
  id: string;
  type: "room" | "task" | "staff" | "blocker";
  label: string;
  /** i18n key for the line under the label, when there is one. */
  noteKey?: string;
  noteParams?: Record<string, string | number>;
}

export type DetailPrimary = {
  action: SupervisorPrimaryAction;
  labelKey: string;
  target: SupervisorTarget;
  href: SupervisorHref;
};

export type AttentionDetailView =
  | { state: "gone" }
  | {
      state: "ready";
      id: string;
      kind: SupervisorAttentionKind;
      category: AttentionCategory;
      severity: AttentionSeverity;
      title: { key: string; params: Record<string, string | number> };
      whyKey: string;
      whyParams: Record<string, string | number>;
      facts: DetailFact[];
      records: DetailRecord[];
      /** Records that exist but are not listed (the sheet shows a short list). */
      moreRecords: number;
      /** A restriction is not permission to enter: the sheet says so and offers no way in. */
      restriction: boolean;
      source: { names: string[]; stale: boolean; fetchedAt: number | null };
      primary: DetailPrimary;
    };

/** Rooms listed in a sheet; the rest are counted, not dumped. */
export const DETAIL_RECORD_LIMIT = 8;

interface DetailContext {
  now: number;
  zone: string | null | undefined;
  language: string;
  someone: string;
}

const SOURCE_LABEL_KEY: Record<keyof TodaySources, string> = {
  board: "supervisorAttention.source.board",
  staff: "supervisorAttention.source.staff",
  roster: "supervisorAttention.source.roster",
  inspections: "supervisorAttention.source.inspections",
  blockedTasks: "supervisorAttention.source.blockedTasks",
};

const str = (value: string | number | null | undefined, fallback: string | number = "") => (value === null || value === undefined ? fallback : value);

function boardRooms(sources: TodaySources): Map<string, FloorRoom> {
  const board = knownValue(sources.board, { rooms: [], invalidRows: 0, duplicateRows: 0 });
  return new Map((board?.rooms ?? []).map((room) => [room.roomId, room]));
}

function staffNames(sources: TodaySources): Map<string, string> {
  return new Map((knownValue(sources.staff, []) ?? []).map((member) => [member.userId, member.name]));
}

/** The primary button for an item: where it goes and what it is called. */
export function primaryFor(item: SupervisorAttentionItem): DetailPrimary {
  let target: SupervisorTarget = item.target;
  let labelKey: string;
  switch (item.action) {
    case "inspect_rooms":
      // A single room that is ready for inspection is inspected from Inspect, not the board.
      target = { screen: "inspect" };
      labelKey = "supervisorAttention.action.openInspect";
      break;
    case "assign_rooms":
      // Keep what the item already knows (the unassigned queue, or the person who is over-assigned).
      target = item.target.screen === "team" ? item.target : { screen: "team" };
      labelKey = "supervisorAttention.action.reviewAssignments";
      break;
    case "open_team":
      target = item.target.screen === "team" ? item.target : { screen: "team", assignments: { tab: "team" } };
      labelKey = "supervisorAttention.action.openTeam";
      break;
    case "review_blocker":
      labelKey = "supervisorAttention.action.reviewTask";
      break;
    case "message_staff":
      target = { screen: "notifications" };
      labelKey = "supervisorAttention.action.openNotifications";
      break;
    default: {
      // review_rooms. One room → that room; a bulk queue → the board, never an arbitrary room.
      const single = item.records.length === 1 && item.records[0].type === "room" ? item.records[0] : null;
      if (item.subject.type === "room") labelKey = "supervisorAttention.action.viewRoom";
      else if (single) {
        target = { screen: "rooms", record: { type: "room", id: single.id } };
        labelKey = "supervisorAttention.action.viewRoom";
      } else {
        target = { screen: "rooms" };
        labelKey = "supervisorAttention.action.reviewRooms";
      }
    }
  }
  return { action: item.action, labelKey, target, href: supervisorHref(target) };
}

function roomNote(room: FloorRoom | undefined, names: Map<string, string>): Pick<DetailRecord, "noteKey" | "noteParams"> {
  if (!room) return {};
  const assignee = room.assignedTo ? names.get(room.assignedTo) : null;
  return {
    noteKey: assignee ? "supervisorAttention.record.statusAssigned" : "supervisorAttention.record.statusUnassigned",
    noteParams: { status: statusLabelKey(room.status), name: assignee ?? "" },
  };
}

const KEY_PARAM_PREFIXES = ["roomBoard.statusLabels.", "tasks.hk.blocker.reason."];

/**
 * Params that name a translation (a room status, a blocker reason) are resolved by the UI; every other
 * value is data and passes through untouched. A key with no translation falls back to its last segment.
 */
export function translateParams(t: (key: string, options?: Record<string, unknown>) => string, params: Record<string, string | number>) {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    out[name] = typeof value === "string" && KEY_PARAM_PREFIXES.some((prefix) => value.startsWith(prefix)) ? t(value, { defaultValue: value.split(".").pop() ?? value }) : value;
  }
  return out;
}

/** The i18n key of a room status label; resolved by the UI. */
export function statusLabelKey(status: string): string {
  return `roomBoard.statusLabels.${status}`;
}

function recordsOf(item: SupervisorAttentionItem, rooms: Map<string, FloorRoom>, names: Map<string, string>): DetailRecord[] {
  const out: DetailRecord[] = [];
  for (const record of item.records) {
    if (record.type === "room") {
      const room = rooms.get(record.id);
      out.push({
        id: record.id,
        type: "room",
        label: record.label ?? room?.roomNumber ?? "",
        ...(item.kind === "access_restricted"
          ? { noteKey: "supervisorAttention.record.doNotDisturb" }
          : item.kind === "unassigned_rooms" || item.kind === "awaiting_inspection"
            ? { noteKey: "supervisorAttention.record.status", noteParams: { status: room ? statusLabelKey(room.status) : "" } }
            : roomNote(room, names)),
      });
    }
  }
  return out;
}

function minutesBetween(from: number, to: number): number {
  return Math.max(1, Math.round(Math.abs(to - from) / 60_000));
}

function factsFor(
  item: SupervisorAttentionItem,
  rooms: Map<string, FloorRoom>,
  names: Map<string, string>,
  blocked: BlockedTaskItem[] | null,
  ctx: DetailContext,
): DetailFact[] {
  const facts: DetailFact[] = [];
  const room = item.subject.type === "room" ? rooms.get(item.subject.id) : undefined;
  const roomAssignment = (): DetailFact => {
    const assignee = room?.assignedTo ? names.get(room.assignedTo) : null;
    return assignee
      ? { icon: "person-outline", key: "supervisorAttention.fact.assignedTo", params: { name: assignee } }
      : { icon: "person-outline", key: room?.assignedTo ? "supervisorAttention.fact.assignedUnknown" : "supervisorAttention.fact.notAssigned", params: {} };
  };

  switch (item.kind) {
    case "arrival_at_risk": {
      if (room) facts.push({ icon: "bed-outline", key: "supervisorAttention.fact.status", params: { status: statusLabelKey(room.status) } });
      const arrivalMs = item.occurredAt ? Date.parse(item.occurredAt) : NaN;
      const time = item.occurredAt ? formatHotelTime(item.occurredAt, ctx.zone, ctx.language) : null;
      if (time) facts.push({ icon: "time-outline", key: "supervisorAttention.fact.arrival", params: { time } });
      if (!Number.isNaN(arrivalMs)) {
        const minutes = minutesBetween(ctx.now, arrivalMs);
        facts.push(
          arrivalMs >= ctx.now
            ? { icon: "hourglass-outline", key: "supervisorAttention.fact.arrivalIn", params: { count: minutes } }
            : { icon: "hourglass-outline", key: "supervisorAttention.fact.arrivalPassed", params: { count: minutes } },
        );
      }
      if (room) facts.push(roomAssignment());
      return facts;
    }
    case "readiness_risk":
      if (room) facts.push({ icon: "bed-outline", key: "supervisorAttention.fact.status", params: { status: statusLabelKey(room.status) } });
      facts.push({ icon: "analytics-outline", key: "supervisorAttention.fact.prediction", params: {} });
      if (room) facts.push(roomAssignment());
      return facts;
    case "task_blocker": {
      const blockerId = item.records.find((record) => record.type === "blocker")?.id;
      const entry = blocked?.find((candidate) => candidate.blocker.id === blockerId);
      if (!entry) return facts;
      facts.push({ icon: "list-outline", key: "supervisorAttention.fact.task", params: { task: str(entry.task.title, "—") } });
      const where = entry.task.room_number ? `${entry.task.room_number}` : entry.task.location_text;
      if (where) facts.push({ icon: "location-outline", key: entry.task.room_number ? "supervisorAttention.fact.room" : "supervisorAttention.fact.location", params: { room: where, location: where } });
      facts.push({ icon: "hand-left-outline", key: "supervisorAttention.fact.blocker", params: { reason: `tasks.hk.blocker.reason.${entry.blocker.reason}` } });
      if (entry.blocker.details?.trim()) facts.push({ icon: "chatbox-ellipses-outline", key: "supervisorAttention.fact.blockerDetails", params: { details: entry.blocker.details.trim() } });
      const owner = entry.task.assigned_to_name?.trim();
      facts.push(
        owner
          ? { icon: "person-outline", key: "supervisorAttention.fact.taskOwner", params: { name: owner } }
          : { icon: "person-outline", key: "supervisorAttention.fact.taskNoOwner", params: {} },
      );
      const reporter = entry.blocker.reported_by_name?.trim();
      const reportedAt = entry.blocker.reported_at ? formatHotelTime(entry.blocker.reported_at, ctx.zone, ctx.language) : null;
      if (reporter || reportedAt) {
        facts.push({
          icon: "time-outline",
          key: reporter && reportedAt ? "supervisorAttention.fact.reportedByAt" : reporter ? "supervisorAttention.fact.reportedBy" : "supervisorAttention.fact.reportedAt",
          params: { name: reporter ?? "", time: reportedAt ?? "" },
        });
      }
      facts.push({ icon: "flag-outline", key: `supervisorAttention.fact.priority.${entry.task.priority}`, params: {} });
      return facts;
    }
    case "shift_ended_with_open_rooms":
      facts.push({ icon: "log-out-outline", key: "supervisorAttention.fact.clockedOut", params: { name: str(item.explain.params.name, ctx.someone) } });
      facts.push({ icon: "bed-outline", key: "supervisorAttention.fact.openRooms", params: { count: str(item.explain.params.count, 0) } });
      return facts;
    case "workload_over_assigned": {
      facts.push({ icon: "bed-outline", key: "supervisorAttention.fact.openRooms", params: { count: str(item.explain.params.count, 0) } });
      const minutes = item.explain.params.minutes;
      if (typeof minutes === "number" && minutes > 0) facts.push({ icon: "hourglass-outline", key: "supervisorAttention.fact.estimatedWork", params: { count: Math.round(minutes) } });
      return facts;
    }
    case "unassigned_rooms":
    case "awaiting_inspection":
    case "access_restricted":
      facts.push({ icon: "bed-outline", key: `supervisorAttention.fact.count.${item.kind}`, params: { count: item.records.length } });
      return facts;
    default:
      return facts;
  }
}

/**
 * Re-resolve one item against the CURRENT attention list. A resolved or reassigned issue comes back as `gone`,
 * so an open sheet can never keep offering an action on something that changed underneath it.
 */
export function resolveAttentionDetail(
  attention: SupervisorAttention,
  sources: TodaySources,
  itemId: string,
  ctx: DetailContext,
): AttentionDetailView {
  const item = attention.items.find((candidate) => candidate.id === itemId);
  if (!item) return { state: "gone" };
  const rooms = boardRooms(sources);
  const names = staffNames(sources);
  const blocked = knownValue(sources.blockedTasks, []);
  const card = describeAttention(item, { zone: ctx.zone, language: ctx.language, someone: ctx.someone });
  if (!card) return { state: "gone" };
  const all = recordsOf(item, rooms, names);
  const stillOpen = (record: DetailRecord) => {
    if (item.kind !== "shift_ended_with_open_rooms" && item.kind !== "workload_over_assigned") return true;
    const room = rooms.get(record.id);
    return !room || isActionable(room.status);
  };
  const listed = all.filter(stillOpen);
  return {
    state: "ready",
    id: item.id,
    kind: item.kind,
    category: CATEGORY_OF[item.kind],
    severity: item.severity,
    title: card.title,
    whyKey: `supervisorAttention.why.${item.kind}`,
    whyParams: { ...(item.explain.params as Record<string, string | number>), count: item.records.filter((r) => r.type === "room").length },
    facts: factsFor(item, rooms, names, blocked, ctx),
    records: listed.slice(0, DETAIL_RECORD_LIMIT),
    moreRecords: Math.max(0, listed.length - DETAIL_RECORD_LIMIT),
    restriction: item.kind === "access_restricted",
    source: {
      names: item.source.names.map((name) => SOURCE_LABEL_KEY[name]),
      stale: item.source.status === "stale",
      fetchedAt: item.source.fetchedAt,
    },
    primary: primaryFor(item),
  };
}

/* ─── What the list says ──────────────────────────────────────────────────── */

export type AttentionListState =
  | "loading"
  | "list"
  /** Items exist, but none in the selected filter. */
  | "filter_empty"
  /** Verified, nothing active. The only state allowed to say "all caught up". */
  | "caught_up"
  /** Nothing to show, but the answer is old or incomplete, so "all clear" is not claimed. */
  | "unconfirmed_empty"
  /** Nothing was ever verified (sources failed). Unknown, never zero. */
  | "unavailable";

export function attentionListState(
  center: AttentionCenter,
  filter: AttentionFilter,
  sources: Pick<TodaySources, "board" | "blockedTasks">,
): AttentionListState {
  if (itemsForFilter(center, filter).length > 0) return "list";
  if (center.counts.all > 0) return "filter_empty";
  const { board, blockedTasks } = sources;
  if (board.status === "loading" || blockedTasks.status === "loading") return "loading";
  const verified = (state: SourceState<unknown>) => state.status === "available" || state.status === "empty";
  const stale = board.status === "stale" || blockedTasks.status === "stale";
  if (!verified(board) && !verified(blockedTasks) && !stale) return "unavailable";
  if (center.unverified.length > 0 || stale || !verified(board) || !verified(blockedTasks)) return "unconfirmed_empty";
  return "caught_up";
}

export interface PartialNotice {
  key: string;
}

/** One plain line per source that could not be read, so a missing item is explainable. */
export function partialNotices(center: AttentionCenter, sources: TodaySources): PartialNotice[] {
  const notices: PartialNotice[] = [];
  const forbidden = center.unverified.some((name) => {
    const state = sources[name];
    return state.status === "failed" && state.failure.kind === "forbidden";
  });
  for (const name of center.unverified) {
    if (name === "board" || name === "blockedTasks" || name === "roster") notices.push({ key: `supervisorAttention.partialSource.${name}` });
  }
  if (forbidden) notices.push({ key: "supervisorAttention.forbidden" });
  return notices;
}
