import type { BlockedTaskItem } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { isActionable, isBehindSchedule, isOutOfOrder, type FloorRoom } from "@/lib/housekeeping/supervisor";
import { fetchedAtOf, knownValue } from "@/lib/housekeeping/supervisorSources";
import { buildTeamPulse } from "@/lib/housekeeping/supervisorTeam";
import type { BoardSnapshot, TodaySources } from "@/lib/housekeeping/supervisorToday";
import type { SupervisorRecordType, SupervisorTarget } from "@/lib/navigation/supervisorRoutes";

/* ─── Supervisor attention items ────────────────────────────────────────────
   "Needs your attention" for a supervisor, built ONLY from verified records.

   - Identity: every id is derived from a real record id (or a named queue), so
     it is stable across refreshes and independent of notification read state —
     an item stays until the underlying issue is resolved, not until it is seen.
   - Nothing is invented: no deadline unless the record has one, no urgency beyond
     the rules below, no confidence figures.
   - Individual records get their own item (arrival at risk, blocker, staff
     concern); bulk queues (unassigned, awaiting inspection, access restricted)
     are one item carrying every record reference.
   - A room that is already an arrival risk is not ALSO reported as a generic
     readiness risk (same underlying issue); distinct issues stay distinct.
   - `message` is part of the contract but nothing produces it yet: a message
     needs a persisted source that is independent of notification read state.   */

export type SupervisorAttentionKind =
  | "arrival_at_risk"
  | "readiness_risk"
  | "task_blocker"
  | "shift_ended_with_open_rooms"
  | "workload_over_assigned"
  | "unassigned_rooms"
  | "awaiting_inspection"
  | "access_restricted"
  | "message";

export type AttentionSeverity = "critical" | "high" | "normal";

/** What the primary button would do. Every action here opens a workflow; none writes without confirmation. */
export type SupervisorPrimaryAction =
  | "review_rooms"
  | "assign_rooms"
  | "inspect_rooms"
  | "review_blocker"
  | "open_team"
  | "message_staff";

export interface AttentionRecordRef {
  type: SupervisorRecordType;
  id: string;
  /** Human label straight from the record (e.g. the room number), when it has one. */
  label: string | null;
}

export interface AttentionSource {
  /** Every resource the item rests on. */
  names: Array<keyof TodaySources>;
  /** `stale` when ANY backing resource is the last known answer rather than verified now. */
  status: "available" | "stale";
  /** The oldest verified time among the backing resources. */
  fetchedAt: number | null;
}

export interface SupervisorAttentionItem {
  id: string;
  kind: SupervisorAttentionKind;
  severity: AttentionSeverity;
  /** The thing the item is about; items sharing a subject are one issue for preview purposes. */
  subject: { type: "room" | "queue" | "task" | "staff"; id: string };
  records: AttentionRecordRef[];
  /** i18n key + interpolation data. The key is resolved by the Attention UI (Phase 3). */
  explain: { key: string; params: Record<string, string | number | null> };
  source: AttentionSource;
  target: SupervisorTarget;
  action: SupervisorPrimaryAction;
  /** A real timestamp from the record (reported / expected arrival), else null. */
  occurredAt: string | null;
}

export interface SupervisorAttention {
  /** Every distinct issue, most important first. */
  items: SupervisorAttentionItem[];
  /** Resources whose absence means issues of that type could not be checked. */
  unverified: Array<keyof TodaySources>;
}

/** Arrival-risk window: a same-day expected arrival within this long (or already past) with the room not ready. */
export const ARRIVAL_RISK_WINDOW_MS = 120 * 60_000;
/** Within this long of arrival (or past it) the item is critical. */
export const ARRIVAL_CRITICAL_WINDOW_MS = 60 * 60_000;

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, normal: 2 };
const KIND_RANK: Record<SupervisorAttentionKind, number> = {
  arrival_at_risk: 0,
  task_blocker: 1,
  shift_ended_with_open_rooms: 2,
  readiness_risk: 3,
  unassigned_rooms: 4,
  workload_over_assigned: 5,
  awaiting_inspection: 6,
  access_restricted: 7,
  message: 8,
};

function sourceOf(sources: TodaySources, ...names: Array<keyof TodaySources>): AttentionSource {
  const times = names.map((name) => fetchedAtOf(sources[name])).filter((time): time is number => time !== null);
  return {
    names,
    status: names.some((name) => sources[name].status === "stale") ? "stale" : "available",
    fetchedAt: times.length > 0 ? Math.min(...times) : null,
  };
}

const roomRef = (room: FloorRoom): AttentionRecordRef => ({ type: "room", id: room.roomId, label: room.roomNumber });

function inService(room: FloorRoom): boolean {
  return !isOutOfOrder(room.status);
}

function notReady(room: FloorRoom): boolean {
  return room.status !== "INSPECTED";
}

function roomItems(rooms: FloorRoom[], source: AttentionSource, now: number, timeZone: string | null): SupervisorAttentionItem[] {
  const items: SupervisorAttentionItem[] = [];
  const today = hotelDateKey(new Date(now), timeZone);
  const arrivalRooms = new Set<string>();

  for (const room of rooms) {
    if (!inService(room) || !notReady(room)) continue;
    // Expected arrival: only for a room the front office shows vacant, with a same-day arrival time on the record.
    if (room.foStatus !== "VAC" || !room.checkinTime) continue;
    const arrivalMs = Date.parse(room.checkinTime);
    if (Number.isNaN(arrivalMs) || hotelDateKey(room.checkinTime, timeZone) !== today) continue;
    const untilArrival = arrivalMs - now;
    if (untilArrival > ARRIVAL_RISK_WINDOW_MS) continue;
    arrivalRooms.add(room.roomId);
    items.push({
      id: `room:${room.roomId}:arrival_at_risk`,
      kind: "arrival_at_risk",
      severity: untilArrival <= ARRIVAL_CRITICAL_WINDOW_MS ? "critical" : "high",
      subject: { type: "room", id: room.roomId },
      records: [roomRef(room)],
      explain: {
        key: "supervisor.today.attention.arrivalAtRisk",
        params: { room: room.roomNumber, status: room.status, arrivalAt: room.checkinTime },
      },
      source,
      target: { screen: "rooms", record: { type: "room", id: room.roomId } },
      action: room.status === "CLEAN" ? "inspect_rooms" : "review_rooms",
      occurredAt: room.checkinTime,
    });
  }

  for (const room of rooms) {
    if (!inService(room) || !notReady(room) || !room.highRisk || arrivalRooms.has(room.roomId)) continue;
    items.push({
      id: `room:${room.roomId}:readiness_risk`,
      kind: "readiness_risk",
      severity: "high",
      subject: { type: "room", id: room.roomId },
      records: [roomRef(room)],
      explain: {
        key: "supervisor.today.attention.readinessRisk",
        params: { room: room.roomNumber, status: room.status },
      },
      source,
      target: { screen: "rooms", record: { type: "room", id: room.roomId } },
      action: "review_rooms",
      occurredAt: null,
    });
  }

  const queue = (
    kind: SupervisorAttentionKind,
    queueRooms: FloorRoom[],
    severity: AttentionSeverity,
    target: SupervisorTarget,
    action: SupervisorPrimaryAction,
  ) => {
    if (queueRooms.length === 0) return;
    items.push({
      id: `queue:${kind}`,
      kind,
      severity,
      subject: { type: "queue", id: kind },
      records: queueRooms.map(roomRef),
      explain: { key: `supervisor.today.attention.${kind}`, params: { count: queueRooms.length } },
      source,
      target,
      action,
      occurredAt: null,
    });
  };

  const unassigned = rooms.filter((room) => isActionable(room.status) && !room.assignedTo);
  queue("unassigned_rooms", unassigned, unassigned.some((room) => isBehindSchedule(room, now, timeZone)) ? "high" : "normal", { screen: "team" }, "assign_rooms");
  queue("awaiting_inspection", rooms.filter((room) => room.status === "CLEAN"), "normal", { screen: "inspect" }, "inspect_rooms");
  queue(
    "access_restricted",
    rooms.filter((room) => room.dnd && inService(room) && notReady(room)),
    "normal",
    { screen: "rooms" },
    "review_rooms",
  );
  return items;
}

function blockerItems(blocked: BlockedTaskItem[], source: AttentionSource): SupervisorAttentionItem[] {
  const items: SupervisorAttentionItem[] = [];
  for (const entry of blocked) {
    if (entry.blocker.status !== "active") continue;
    items.push({
      id: `blocker:${entry.blocker.id}`,
      kind: "task_blocker",
      severity: entry.task.priority === "urgent" ? "critical" : "high",
      subject: { type: "task", id: entry.task.id },
      records: [
        { type: "blocker", id: entry.blocker.id, label: null },
        { type: "task", id: entry.task.id, label: entry.task.room_number ?? entry.task.title ?? null },
      ],
      explain: {
        key: "supervisor.today.attention.taskBlocker",
        params: { reason: entry.blocker.reason, task: entry.task.title, room: entry.task.room_number },
      },
      source,
      target: { screen: "tasks", record: { type: "task", id: entry.task.id } },
      action: "review_blocker",
      occurredAt: entry.blocker.reported_at,
    });
  }
  return items;
}

function staffItems(board: BoardSnapshot, sources: TodaySources): SupervisorAttentionItem[] {
  const pulse = buildTeamPulse(board.rooms, knownValue(sources.staff, []), sources.roster);
  const items: SupervisorAttentionItem[] = [];
  for (const member of pulse.members) {
    if (!member.concern || !member.load) continue;
    const openRooms = member.load.rooms.filter((room) => isActionable(room.status));
    const ended = member.concern === "shift_ended_with_open_rooms";
    items.push({
      id: `staff:${member.userId}:${member.concern}`,
      kind: ended ? "shift_ended_with_open_rooms" : "workload_over_assigned",
      severity: "high",
      subject: { type: "staff", id: member.userId },
      records: [{ type: "staff", id: member.userId, label: member.name }, ...openRooms.map(roomRef)],
      explain: {
        key: `supervisor.today.attention.${ended ? "shiftEndedWithOpenRooms" : "workloadOverAssigned"}`,
        params: { name: member.name, count: openRooms.length, minutes: member.load.minutesLeft },
      },
      // A recorded clock-out rests on the roster as well as the board's assignments.
      source: ended ? sourceOf(sources, "board", "roster") : sourceOf(sources, "board"),
      target: { screen: "team", record: { type: "staff", id: member.userId } },
      action: ended ? "open_team" : "assign_rooms",
      occurredAt: null,
    });
  }
  return items;
}

export function compareAttention(a: SupervisorAttentionItem, b: SupervisorAttentionItem): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.occurredAt ?? "~").localeCompare(b.occurredAt ?? "~") ||
    a.id.localeCompare(b.id)
  );
}

export function buildSupervisorAttention(
  sources: TodaySources,
  options: { now: number; timeZone: string | null },
): SupervisorAttention {
  const board = knownValue(sources.board, { rooms: [], invalidRows: 0, duplicateRows: 0 });
  const blocked = knownValue(sources.blockedTasks, []);
  const unverified: Array<keyof TodaySources> = [];
  const byId = new Map<string, SupervisorAttentionItem>();
  const add = (list: SupervisorAttentionItem[]) => {
    for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item);
  };

  if (board) {
    add(roomItems(board.rooms, sourceOf(sources, "board"), options.now, options.timeZone));
    add(staffItems(board, sources));
  } else unverified.push("board");

  // An over-assigned load needs only the board, but a recorded clock-out cannot be checked without the roster.
  if (knownValue(sources.roster, []) === null) unverified.push("roster");

  if (blocked) add(blockerItems(blocked, sourceOf(sources, "blockedTasks")));
  else unverified.push("blockedTasks");

  return { items: [...byId.values()].sort(compareAttention), unverified };
}

/**
 * The Home preview: the first `limit` items with at most one per subject (a room never appears twice),
 * plus how many distinct items did not fit. Nothing is dropped from `SupervisorAttention.items`.
 */
export function selectAttentionPreview(
  attention: SupervisorAttention,
  limit = 3,
): { items: SupervisorAttentionItem[]; hiddenCount: number } {
  const seen = new Set<string>();
  const items: SupervisorAttentionItem[] = [];
  for (const item of attention.items) {
    const key = `${item.subject.type}:${item.subject.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (items.length < limit) items.push(item);
  }
  return { items, hiddenCount: Math.max(0, attention.items.length - items.length) };
}
