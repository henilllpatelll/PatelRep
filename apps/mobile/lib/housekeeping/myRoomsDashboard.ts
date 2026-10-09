import type { Room } from "@/stores/appStore";
import { buildSmartQueue, estimateCleanMinutes } from "@/lib/ai/briefing";
import {
  hasBlockingNote,
  hasOpenWorkOrder,
  isBlocked,
  isDepartureClean,
} from "@/lib/housekeeping/roomWorkflow";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";

/**
 * My Rooms dashboard model — the single source of truth for how an assigned
 * room is classified, counted, ordered and grouped. The screen only renders
 * what this module returns, so the Route, Floors and Done tabs and the
 * progress summary can never disagree.
 *
 * Nothing here invents backend statuses: it reads the room status the API
 * returns (DIRTY, PICKUP, OCCUPIED, IN_PROGRESS, CLEAN, INSPECTED, OOO,
 * OUT_OF_ORDER, OUT_OF_SERVICE) plus the persistent clean-session records.
 *
 * ── Progress semantics ─────────────────────────────────────────────────────
 *  assigned     every room assigned to this attendant for the shift
 *  unavailable  OOO / OUT_OF_ORDER / OUT_OF_SERVICE — cannot be worked now
 *  serviceable  assigned − unavailable. This is the completion DENOMINATOR, so
 *               a room that cannot be cleaned never inflates (or deflates) it.
 *  completed    CLEAN (submitted, awaiting inspection) + INSPECTED (passed)
 *  remaining    serviceable − completed: everything still to do, INCLUDING the
 *               active room and rooms that need attention
 *  percent      round(completed / serviceable × 100); 0 when serviceable is 0
 *
 * Every assigned room lands in exactly ONE category, so these mutually
 * exclusive counts always sum to `assigned`:
 *  current + upNext + attention + submitted + inspected + unavailable
 * and  remaining = current + upNext + attention,  workable = current + upNext.
 */

export type DashboardTab = "route" | "floors" | "done";

export type RoomCategory =
  | "current"
  | "up_next"
  | "attention"
  | "submitted"
  | "inspected"
  | "unavailable";

export type AttentionReason =
  | "dnd"
  | "declined"
  | "checkout_unverified"
  | "blocker"
  | "reclean"
  | "work_order"
  | "risk"
  | "note";

/** Order attention rooms by how firmly they block entry. */
const ATTENTION_RANK: Record<AttentionReason, number> = {
  dnd: 0,
  declined: 1,
  checkout_unverified: 2,
  blocker: 3,
  reclean: 4,
  work_order: 5,
  risk: 6,
  note: 7,
};

export type AccessKind =
  | "dnd"
  | "do_not_service"
  | "checkout_verified"
  | "scheduled_checkout"
  | "checkout_not_verified"
  | "occupied"
  | "vacant";

export interface AccessState {
  kind: AccessKind;
  /** Formatted-time source: actual checkout, scheduled checkout or DND retry. */
  at?: string | null;
}

export type CurrentSessionState =
  /** A session record exists and the server has not confirmed the start yet. */
  | "starting"
  | "active"
  /** Finished on this device; waiting for the server to confirm. */
  | "completing"
  /** Server rejected something; local work is kept for recovery. */
  | "conflict"
  /** The room says IN_PROGRESS but this device holds no session for it. */
  | "missing";

export interface CurrentSessionView {
  state: CurrentSessionState;
  startedAt: string | null;
  checklistDone: number;
  checklistTotal: number;
  pendingSync: boolean;
}

export interface RoomEntry {
  /** The room with its effective status applied (see effectiveStatus). */
  room: Room;
  category: RoomCategory;
  attention: AttentionReason | null;
  access: AccessState;
  rush: boolean;
  neededBy: string | null;
  estimateMinutes: number;
  /** Only for category "current". */
  session: CurrentSessionView | null;
}

export interface DashboardProgress {
  assigned: number;
  unavailable: number;
  serviceable: number;
  completed: number;
  submitted: number;
  inspected: number;
  remaining: number;
  workable: number;
  current: number;
  upNext: number;
  attention: number;
  percent: number;
}

export interface DashboardModel {
  current: RoomEntry[];
  upNext: RoomEntry[];
  attention: RoomEntry[];
  submitted: RoomEntry[];
  inspected: RoomEntry[];
  unavailable: RoomEntry[];
  /** Every assigned room, in natural room-number order (feeds the Floors tab). */
  all: RoomEntry[];
  progress: DashboardProgress;
}

export type SessionMap = Record<string, LocalCleanSession | undefined>;

/* ─── Small shared helpers ──────────────────────────────────────────────────── */

export function compareRoomNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Rush = backend priority 1–2 (the same rule the housekeeping board uses). */
export function isRush(room: Room): boolean {
  return typeof room.priority === "number" && room.priority <= 2;
}

/** A usable supervisor/auto-assign order: a positive whole number. */
export function getSequenceOrder(room: Room): number | null {
  const value = room.sequence_order;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * The status the dashboard should treat the room as having.
 *
 * Once the server has CONFIRMED a clean session as completed, a list that still
 * says IN_PROGRESS is merely stale (the refresh has not landed yet), so the
 * room counts as submitted immediately — no waiting on the next poll. This is
 * limited to IN_PROGRESS on purpose: a later reclean puts the room back to
 * DIRTY, and the retained completed record must not mask that.
 */
export function effectiveStatus(room: Room, session: LocalCleanSession | undefined): Room["status"] {
  if (session?.completionConfirmed && room.status === "IN_PROGRESS") return "CLEAN";
  return room.status;
}

function isLiveSession(session: LocalCleanSession | undefined): session is LocalCleanSession {
  return Boolean(session && !session.completionConfirmed);
}

/* ─── Access state & attention ──────────────────────────────────────────────── */

/**
 * What we can actually say about getting into the room. A scheduled checkout
 * that has passed is NOT a verified checkout — only `actual_checkout_at` is.
 */
export function getAccessState(room: Room, now: Date = new Date()): AccessState {
  if (room.dnd_flag) return { kind: "dnd", at: room.dnd_retry_at ?? null };
  if (room.do_not_service) return { kind: "do_not_service" };
  if (room.actual_checkout_at) return { kind: "checkout_verified", at: room.actual_checkout_at };
  if (isDepartureClean(room)) {
    const scheduled = parseTime(room.checkout_time);
    if (scheduled !== null && scheduled > now.getTime()) {
      return { kind: "scheduled_checkout", at: room.checkout_time ?? null };
    }
    return { kind: "checkout_not_verified", at: room.checkout_time ?? null };
  }
  if (room.status === "OCCUPIED" || room.fo_status === "OCC") return { kind: "occupied" };
  return { kind: "vacant" };
}

/** Why a room needs follow-up before normal service, or null if it does not. */
export function getAttentionReason(room: Room): AttentionReason | null {
  if (room.dnd_flag) return "dnd";
  if (room.do_not_service) return "declined";
  if (isDepartureClean(room) && !room.actual_checkout_at) return "checkout_unverified";
  const note = room.latest_note?.trim();
  if (note?.startsWith("BLOCKER: ")) return "blocker";
  if (room.reclean_requested_at && (room.reclean_corrections?.length ?? 0) > 0) return "reclean";
  // A verified-vacant departure can be cleaned around notes and open work orders.
  const vacantDeparture = isDepartureClean(room) && Boolean(room.actual_checkout_at);
  if (!vacantDeparture && hasOpenWorkOrder(room)) return "work_order";
  if (room.risk_level === "HIGH") return "risk";
  if (!vacantDeparture && hasBlockingNote(room)) return "note";
  return null;
}

/* ─── Classification ────────────────────────────────────────────────────────── */

function sessionView(room: Room, session: LocalCleanSession | undefined): CurrentSessionView {
  if (!isLiveSession(session)) {
    return { state: "missing", startedAt: null, checklistDone: 0, checklistTotal: 0, pendingSync: false };
  }
  const done = session.checklist.filter((item) => item.checked).length;
  const state: CurrentSessionState = session.conflict
    ? "conflict"
    : session.completeRequestedAt
      ? "completing"
      : session.startConfirmed
        ? "active"
        : "starting";
  const pendingSync =
    !session.conflict &&
    (!session.startConfirmed || Object.keys(session.pendingItems).length > 0 || session.completeRequestedAt !== null);
  return {
    state,
    startedAt: session.startedAt,
    checklistDone: done,
    checklistTotal: session.checklist.length,
    pendingSync,
  };
}

export function categorizeRoom(room: Room, session: LocalCleanSession | undefined): RoomCategory {
  const status = effectiveStatus(room, session);
  if (isBlocked({ ...room, status })) return "unavailable";
  if (status === "CLEAN") return "submitted";
  if (status === "INSPECTED") return "inspected";
  if (isLiveSession(session) || status === "IN_PROGRESS") return "current";
  return getAttentionReason(room) ? "attention" : "up_next";
}

function toEntry(room: Room, session: LocalCleanSession | undefined, now: Date): RoomEntry {
  const status = effectiveStatus(room, session);
  const viewRoom = status === room.status ? room : { ...room, status };
  const category = categorizeRoom(room, session);
  return {
    room: viewRoom,
    category,
    attention: category === "attention" ? getAttentionReason(room) : null,
    access: getAccessState(viewRoom, now),
    rush: isRush(room),
    neededBy: room.priority_needed_by ?? null,
    estimateMinutes: estimateCleanMinutes(viewRoom),
    session: category === "current" ? sessionView(room, session) : null,
  };
}

/* ─── Ordering ──────────────────────────────────────────────────────────────── */

/**
 * Suggested route for rooms that are safe to work. Precedence:
 *  1. Supervisor / auto-assign `sequence_order` (valid, ascending). It orders
 *     eligible work only — attention rooms never reach this function, so a
 *     sequence number can never override an access restriction.
 *  2. Unsequenced rooms: rush (priority ≤ 2) first, by priority then
 *     needed-by; everything else follows the existing smart-queue ranking
 *     (buildSmartQueue — deterministic local logic, not AI).
 *  3. Floor, then natural room number, whenever the above cannot separate rooms.
 */
export function orderUpNext(entries: RoomEntry[], now: Date = new Date()): RoomEntry[] {
  const rooms = entries.map((entry) => entry.room);
  const smartRank = new Map<string, number>();
  buildSmartQueue(rooms, now, () => true).forEach((item) => smartRank.set(item.room.id, item.position));

  const stable = (a: RoomEntry, b: RoomEntry) =>
    (smartRank.get(a.room.id) ?? Number.MAX_SAFE_INTEGER) - (smartRank.get(b.room.id) ?? Number.MAX_SAFE_INTEGER) ||
    (a.room.floor ?? 0) - (b.room.floor ?? 0) ||
    compareRoomNumbers(a.room.room_number, b.room.room_number);

  const sequenced = entries.filter((e) => getSequenceOrder(e.room) !== null);
  const unsequenced = entries.filter((e) => getSequenceOrder(e.room) === null);

  sequenced.sort((a, b) => (getSequenceOrder(a.room) ?? 0) - (getSequenceOrder(b.room) ?? 0) || stable(a, b));

  const rush = unsequenced.filter((e) => e.rush);
  rush.sort(
    (a, b) =>
      (a.room.priority ?? 0) - (b.room.priority ?? 0) ||
      (parseTime(a.neededBy) ?? Number.MAX_SAFE_INTEGER) - (parseTime(b.neededBy) ?? Number.MAX_SAFE_INTEGER) ||
      stable(a, b),
  );
  const regular = unsequenced.filter((e) => !e.rush).sort(stable);

  return [...sequenced, ...rush, ...regular];
}

function orderAttention(entries: RoomEntry[]): RoomEntry[] {
  return [...entries].sort((a, b) => {
    const rank = ATTENTION_RANK[a.attention ?? "note"] - ATTENTION_RANK[b.attention ?? "note"];
    if (rank !== 0) return rank;
    const retry = (parseTime(a.room.dnd_retry_at) ?? Number.MAX_SAFE_INTEGER) - (parseTime(b.room.dnd_retry_at) ?? Number.MAX_SAFE_INTEGER);
    if (retry !== 0) return retry;
    return compareRoomNumbers(a.room.room_number, b.room.room_number);
  });
}

/** Active rooms: the one with a real local session first, then by start time. */
function orderCurrent(entries: RoomEntry[]): RoomEntry[] {
  return [...entries].sort((a, b) => {
    const aMissing = a.session?.state === "missing" ? 1 : 0;
    const bMissing = b.session?.state === "missing" ? 1 : 0;
    if (aMissing !== bMissing) return aMissing - bMissing;
    return (parseTime(a.session?.startedAt) ?? 0) - (parseTime(b.session?.startedAt) ?? 0);
  });
}

/* ─── Build ─────────────────────────────────────────────────────────────────── */

export function buildDashboard(rooms: Room[], sessions: SessionMap, now: Date = new Date()): DashboardModel {
  // A room id can only appear once, whatever the source delivered.
  const seen = new Set<string>();
  const unique = rooms.filter((room) => {
    if (seen.has(room.id)) return false;
    seen.add(room.id);
    return true;
  });

  const entries = unique.map((room) => toEntry(room, sessions[room.id], now));
  const byCategory = (category: RoomCategory) => entries.filter((e) => e.category === category);

  const current = orderCurrent(byCategory("current"));
  const upNext = orderUpNext(byCategory("up_next"), now);
  const attention = orderAttention(byCategory("attention"));
  const byNumber = (a: RoomEntry, b: RoomEntry) => compareRoomNumbers(a.room.room_number, b.room.room_number);
  const submitted = byCategory("submitted").sort(byNumber);
  const inspected = byCategory("inspected").sort(byNumber);
  const unavailable = byCategory("unavailable").sort(byNumber);

  const assigned = entries.length;
  const serviceable = assigned - unavailable.length;
  const completed = submitted.length + inspected.length;
  const progress: DashboardProgress = {
    assigned,
    unavailable: unavailable.length,
    serviceable,
    completed,
    submitted: submitted.length,
    inspected: inspected.length,
    remaining: serviceable - completed,
    workable: current.length + upNext.length,
    current: current.length,
    upNext: upNext.length,
    attention: attention.length,
    percent: serviceable > 0 ? Math.round((completed / serviceable) * 100) : 0,
  };

  return {
    current,
    upNext,
    attention,
    submitted,
    inspected,
    unavailable,
    all: [...entries].sort(byNumber),
    progress,
  };
}

/* ─── Floors ────────────────────────────────────────────────────────────────── */

export interface FloorSection {
  key: string;
  floor: number | null;
  rooms: RoomEntry[];
  /** completed / serviceable for the whole floor (not narrowed by search). */
  completed: number;
  serviceable: number;
  unavailable: number;
}

export interface BuildingSection {
  key: string;
  /** null = the hotel exposes no building data, or rooms with none recorded. */
  building: string | null;
  /** True for the group collecting rooms that have no building when others do. */
  unassigned: boolean;
  floors: FloorSection[];
}

function normalizeBuilding(room: Room): string | null {
  const value = room.building?.trim();
  return value ? value : null;
}

/**
 * Group by the building the API reports. Buildings are never inferred from
 * room numbers: when no room carries one, rooms group by floor alone. `query`
 * narrows the visible rooms by room number (case-insensitive substring) and
 * drops sections left empty, but floor counts always describe the whole floor.
 */
export function buildFloorSections(all: RoomEntry[], query = ""): BuildingSection[] {
  const q = query.trim().toLowerCase();
  const hasTopology = all.some((entry) => normalizeBuilding(entry.room) !== null);

  const buildings = new Map<string, { building: string | null; unassigned: boolean; floors: Map<string, RoomEntry[]> }>();
  for (const entry of all) {
    const name = hasTopology ? normalizeBuilding(entry.room) : null;
    const buildingKey = hasTopology ? (name ?? "\u0000unassigned") : "\u0000none";
    let group = buildings.get(buildingKey);
    if (!group) {
      group = { building: name, unassigned: hasTopology && name === null, floors: new Map() };
      buildings.set(buildingKey, group);
    }
    const floorKey = entry.room.floor == null ? "_" : String(entry.room.floor);
    const list = group.floors.get(floorKey) ?? [];
    list.push(entry);
    group.floors.set(floorKey, list);
  }

  const sections: BuildingSection[] = [];
  for (const [buildingKey, group] of buildings) {
    const floors: FloorSection[] = [];
    for (const [floorKey, list] of group.floors) {
      const floor = floorKey === "_" ? null : Number(floorKey);
      const unavailable = list.filter((e) => e.category === "unavailable").length;
      const completed = list.filter((e) => e.category === "submitted" || e.category === "inspected").length;
      const rooms = q ? list.filter((e) => e.room.room_number.toLowerCase().includes(q)) : list;
      if (rooms.length === 0) continue;
      floors.push({
        key: `${buildingKey}|${floorKey}`,
        floor,
        rooms: [...rooms].sort((a, b) => compareRoomNumbers(a.room.room_number, b.room.room_number)),
        completed,
        serviceable: list.length - unavailable,
        unavailable,
      });
    }
    if (floors.length === 0) continue;
    floors.sort((a, b) => (a.floor ?? Number.MAX_SAFE_INTEGER) - (b.floor ?? Number.MAX_SAFE_INTEGER));
    sections.push({ key: buildingKey, building: group.building, unassigned: group.unassigned, floors });
  }

  return sections.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return compareRoomNumbers(a.building ?? "", b.building ?? "");
  });
}

/* ─── Screen states ─────────────────────────────────────────────────────────── */

export type ListState = "loading" | "error" | "empty" | "ready";

export interface ListStateInput {
  /** First load has not finished. */
  loading: boolean;
  roomCount: number;
  /** The most recent fetch failed (message), or null. */
  fetchError: string | null;
}

/**
 * A failed fetch with nothing to show is an ERROR with a retry — never an
 * "empty / all done" success. With cached rooms it stays "ready" and the
 * screen shows a stale-data banner instead.
 */
export function resolveListState({ loading, roomCount, fetchError }: ListStateInput): ListState {
  if (loading) return "loading";
  if (roomCount === 0) return fetchError ? "error" : "empty";
  return "ready";
}

/* ─── Persisted tab ─────────────────────────────────────────────────────────── */

let lastTab: DashboardTab = "route";

/** The tab last used this app session; My Rooms opens on Route until changed. */
export function getLastTab(): DashboardTab {
  return lastTab;
}

export function setLastTab(tab: DashboardTab): void {
  lastTab = tab;
}

/* ─── Time ──────────────────────────────────────────────────────────────────── */

/** Whole minutes between a real session timestamp and `now`; never negative. */
export function elapsedMinutes(startedAt: string | null | undefined, now: Date = new Date()): number | null {
  const start = parseTime(startedAt);
  if (start === null) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / 60_000));
}

/** `YYYY-MM-DD` → a local Date at noon (no timezone drift when formatted). */
export function parseShiftDate(value: string | null | undefined): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}
