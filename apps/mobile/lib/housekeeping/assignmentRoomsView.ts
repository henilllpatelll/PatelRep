import { formatHotelTime, formatShiftDate } from "@/lib/housekeeping/hotelTime";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import type { PriorityReason } from "@/lib/housekeeping/assignmentPriority";
import {
  EMPTY_ASSIGNMENT_FILTERS,
  assignmentFilterCount,
  type AssignmentFilterOptions,
  type AssignmentFilters,
  type AssignmentScope,
  type AssignmentSortKey,
} from "@/lib/housekeeping/assignmentQuery";
import { selectSummary, selectUrgent } from "@/lib/housekeeping/assignmentSelectors";
import type { BoardAvailability, MutationGate, RoomBoardModel } from "@/lib/housekeeping/roomBoardState";

/* ─── Supervisor Assignments — the Rooms tab, as the screen shows it ────────
   Pure view layer over `AssignmentsModel`. No React, no I/O. It decides WHAT is shown and what is left out;
   the components only draw it. Strings come through a caller-supplied `translate` so the rules are
   unit-testable in one place.

   Nothing is invented: an estimate, deadline, name or floor with no recorded fact behind it is omitted (or
   named as unknown), never filled in. The headline numbers are Phase 1 selector results, not recounts. */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Header ──────────────────────────────────────────────────────────────── */

export interface HeaderMetrics {
  /** Rooms the supervisor can hand out right now with nothing in the way. null = the board is unknown. */
  unassigned: number | null;
  /** Remaining work with a soft block (DND, declined, return later, discrepancy), owned or not. */
  blocked: number | null;
  /** People verifiably working. null = attendance cannot be verified — never shown as zero. */
  onShift: number | null;
  /** Remaining work with a priority tier above routine, owned or not. */
  urgent: number | null;
}

export function buildHeaderMetrics(model: AssignmentsModel): HeaderMetrics {
  const summary = selectSummary(model);
  if (!summary || !model.rooms) return { unassigned: null, blocked: null, onShift: null, urgent: null };
  // Attendance is a roster fact. A failed, stale or missing roster (or staff list) is "unknown", not zero.
  const onShift =
    model.rosterTrust === "verified" && model.staffListKnown && model.team
      ? model.team.filter((member) => member.attendance === "on_shift").length
      : null;
  return {
    unassigned: summary.autoAssignable,
    blocked: summary.softBlocked,
    onShift,
    urgent: selectUrgent(model.rooms).length,
  };
}

/** "Thursday, October 22" for the hotel's operational date. */
export function operationalDateLabel(model: Pick<AssignmentsModel, "hotelDate">, language: string): string | null {
  return formatShiftDate(model.hotelDate, language);
}

/* ─── Freshness ───────────────────────────────────────────────────────────── */

/** Everything the screen may do with the data it holds. */
export type RoomsDataState = "loading" | "live" | "stale" | "previous_day" | "unavailable";

export function dataStateOf(availability: BoardAvailability): RoomsDataState {
  switch (availability.kind) {
    case "loading":
      return "loading";
    case "ready":
    case "verified_empty":
      return "live";
    case "stale":
      return "stale";
    case "previous_day":
      return "previous_day";
    case "unavailable":
      return "unavailable";
  }
}

/** A banner is owed whenever what is on screen is not freshly verified, or an auxiliary source failed. */
export interface FreshnessNotice {
  kind: "not_live" | "aux_partial";
  /** Name of the state string to show. */
  key: "staleOffline" | "staleFailed" | "staleAge" | "previousDay" | "auxPartial";
}

export function freshnessNotices(model: AssignmentsModel): FreshnessNotice[] {
  const notices: FreshnessNotice[] = [];
  const { availability } = model;
  if (availability.kind === "stale") {
    notices.push({
      kind: "not_live",
      key: availability.reason === "offline" ? "staleOffline" : availability.reason === "refresh_failed" ? "staleFailed" : "staleAge",
    });
  } else if (availability.kind === "previous_day") {
    notices.push({ kind: "not_live", key: "previousDay" });
  }
  // Rooms are intact without these; only credit figures / "scheduled" / roster-based counts are withheld. When the
  // board itself is not live, that notice already says nothing is current, so this one would only repeat it.
  if (notices.length === 0 && model.rooms && (model.settings.trust !== "verified" || model.schedule.trust !== "verified" || model.rosterTrust !== "verified")) {
    notices.push({ kind: "aux_partial", key: "auxPartial" });
  }
  return notices;
}

/* ─── Sections ────────────────────────────────────────────────────────────── */

/**
 *   urgent      unowned, assignable now, and a priority tier above routine
 *   unassigned  unowned and assignable now
 *   assigned    owned (including a room being cleaned)
 *   blocked     cannot be handed out as it stands: a soft block, or work with no owner that is already under way
 */
export type RoomSection = "urgent" | "unassigned" | "assigned" | "blocked";

export const SECTION_ORDER: readonly RoomSection[] = ["urgent", "unassigned", "assigned", "blocked"];

export function sectionOf(entry: AssignmentRoom): RoomSection {
  const { eligibility, ownership, priority } = entry;
  // A soft block holds a room back whether or not someone owns it; the supervisor must look at it first.
  if (eligibility.softBlocks.length > 0 && !ownership.assigned) return "blocked";
  if (ownership.assigned) return "assigned";
  if (!eligibility.canAssign) return "blocked";
  return priority.tier !== "routine" ? "urgent" : "unassigned";
}

export type RoomsListItem =
  | { type: "section"; key: string; section: RoomSection; count: number }
  | { type: "room"; key: string; entry: AssignmentRoom; section: RoomSection };

/**
 * Sectioned in the order above while the list is in priority order (rooms keep the model's own order inside
 * each section). Any other sort is one flat list: re-sorting by room number would scatter the sections.
 */
export function buildListItems(visible: readonly AssignmentRoom[], grouped: boolean): RoomsListItem[] {
  if (!grouped) return visible.map((entry) => ({ type: "room", key: `room:${entry.room.roomId}`, entry, section: sectionOf(entry) }));
  const buckets = new Map<RoomSection, AssignmentRoom[]>(SECTION_ORDER.map((section) => [section, []]));
  for (const entry of visible) buckets.get(sectionOf(entry))?.push(entry);
  const items: RoomsListItem[] = [];
  for (const section of SECTION_ORDER) {
    const rooms = buckets.get(section) ?? [];
    if (rooms.length === 0) continue;
    items.push({ type: "section", key: `section:${section}`, section, count: rooms.length });
    for (const entry of rooms) items.push({ type: "room", key: `room:${entry.room.roomId}`, entry, section });
  }
  return items;
}

/* ─── Room card ───────────────────────────────────────────────────────────── */

export type CardCtaKind = "assign" | "view_assignment" | "view_reason" | "view";
export type ChipTone = "alert" | "warn" | "neutral";

export interface CardChip {
  key: PriorityReason;
  label: string;
  tone: ChipTone;
}

export interface RoomCardModel {
  roomId: string;
  roomNumber: string;
  section: RoomSection;
  /** The status exactly as the backend sent it — drives the protected status colours. */
  rawStatus: string;
  statusLabel: string;
  /** "Floor 3 · Building B" — only the parts the backend recorded. */
  location: string;
  /** "Departure · 35 min estimated" — only what is recorded; null when nothing is. */
  detail: string | null;
  chips: CardChip[];
  assignee: { kind: "none" | "named" | "unnamed"; text: string };
  /** "Guest arrives 12:30 PM" / "Arrival passed 11:00 AM", from a recorded arrival only. */
  deadline: string | null;
  /** Why the room is held back, in words; null when nothing is. */
  blocker: string | null;
  cta: { kind: CardCtaKind; label: string };
  accessibilityLabel: string;
  /** Everything the card draws, so a memoised card re-renders only when something visible changed. */
  signature: string;
}

export interface CardContext {
  now: number;
  timeZone: string | null | undefined;
  language: string;
  /** Whether assignment writes may run right now; when not, no card offers to assign. */
  gate: MutationGate;
  t: Translate;
}

const CHIP_TONE: Record<PriorityReason, ChipTone> = {
  guest_waiting: "alert",
  reclean_requested: "alert",
  rush: "alert",
  arrival_passed: "alert",
  arrival_today: "warn",
  vip: "warn",
  high_risk: "warn",
};

/** `arrival_today` is expressed by the deadline line, so it is not repeated as a chip. */
const CHIP_REASONS = (reasons: readonly PriorityReason[]) => reasons.filter((reason) => reason !== "arrival_today");
export const MAX_CARD_CHIPS = 3;

export function locationText(entry: AssignmentRoom, t: Translate): string {
  const { room } = entry;
  const parts: string[] = [];
  if (room.floorKnown) parts.push(t("assignments.v2.card.floor", { floor: room.floor }));
  if (room.building) parts.push(t("assignments.v2.card.building", { building: room.building }));
  return parts.join(" · ");
}

function blockerText(entry: AssignmentRoom, ctx: CardContext): string | null {
  const { eligibility, ownership } = entry;
  const { t, timeZone, language } = ctx;
  if (eligibility.hardBlock === "in_progress") {
    return ownership.assigned ? t("assignments.v2.blocker.in_progress") : t("assignments.v2.blocker.in_progress_unowned");
  }
  if (eligibility.hardBlock) return t(`assignments.v2.blocker.${eligibility.hardBlock}`);
  if (eligibility.softBlocks.length === 0) return null;
  return eligibility.softBlocks
    .map((block: SoftBlock) =>
      block === "return_later"
        ? t("assignments.v2.blocker.return_later", { time: formatHotelTime(eligibility.returnLaterUntil, timeZone, language) ?? "—" })
        : t(`assignments.v2.blocker.${block}`),
    )
    .join(" · ");
}

function deadlineText(entry: AssignmentRoom, ctx: CardContext): string | null {
  const at = entry.priority.arrivalAt;
  if (at === null) return null;
  const time = formatHotelTime(new Date(at), ctx.timeZone, ctx.language);
  if (!time) return null;
  return ctx.t(at > ctx.now ? "assignments.v2.card.arrival" : "assignments.v2.card.arrivalPassed", { time });
}

function detailText(entry: AssignmentRoom, t: Translate): string | null {
  const { room, estimate } = entry;
  const parts: string[] = [];
  const type = room.cleanTypeLabel ?? room.cleanType;
  if (type) parts.push(type);
  if (estimate) parts.push(t("assignments.v2.card.estimate", { minutes: Math.round(estimate.minutes) }));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ctaOf(entry: AssignmentRoom, section: RoomSection, ctx: CardContext): RoomCardModel["cta"] {
  const { t } = ctx;
  if (section === "blocked") return { kind: "view_reason", label: t("assignments.v2.card.viewReason") };
  if (section === "assigned") return { kind: "view_assignment", label: t("assignments.v2.card.viewAssignment") };
  // While changes are paused nothing offers to assign; the card only opens the room.
  if (!ctx.gate.allowed) return { kind: "view", label: t("assignments.v2.card.view") };
  return { kind: "assign", label: t("assignments.v2.card.assign") };
}

export function buildRoomCard(entry: AssignmentRoom, ctx: CardContext): RoomCardModel {
  const { room, ownership, priority } = entry;
  const { t } = ctx;
  const section = sectionOf(entry);
  const statusCode = room.statusInfo.code ?? "UNKNOWN";
  const statusLabel = t(`roomBoard.card.status.${statusCode}`);
  const location = locationText(entry, t);
  const detail = detailText(entry, t);
  const chips: CardChip[] = CHIP_REASONS(priority.reasons)
    .slice(0, MAX_CARD_CHIPS)
    .map((key) => ({ key, label: t(`assignments.v2.priority.${key}`), tone: CHIP_TONE[key] }));
  const assignee: RoomCardModel["assignee"] = ownership.assigned
    ? ownership.name
      ? { kind: "named", text: ownership.name }
      : { kind: "unnamed", text: t("assignments.v2.card.assigneeUnknown") }
    : { kind: "none", text: t("assignments.v2.card.unassigned") };
  const deadline = deadlineText(entry, ctx);
  const blocker = blockerText(entry, ctx);
  const cta = ctaOf(entry, section, ctx);

  const spoken = [
    t("assignments.v2.card.roomLabel", { room: room.roomNumber }),
    statusLabel,
    location,
    detail,
    chips.map((chip) => chip.label).join(", "),
    assignee.text,
    deadline,
    blocker,
  ]
    .filter((part): part is string => Boolean(part))
    .join(". ");

  return {
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    section,
    rawStatus: room.statusInfo.raw,
    statusLabel,
    location,
    detail,
    chips,
    assignee,
    deadline,
    blocker,
    cta,
    accessibilityLabel: `${spoken}. ${cta.label}`,
    signature: [room.roomId, room.roomNumber, room.statusInfo.raw, section, location, detail, chips.map((chip) => chip.key).join(","), assignee.kind, assignee.text, deadline, blocker, cta.kind].join("|"),
  };
}

/* ─── Room sheet: what may be done from here ──────────────────────────────── */

export type SheetAssign = "assign" | "review_assign" | null;

export interface RoomSheetActions {
  /** Assign an unowned room: plain, or only with an acknowledgement (soft-blocked). null = not offered. */
  assign: SheetAssign;
  reassign: boolean;
  remove: boolean;
  /** Why nothing can be changed, when that is the case. */
  frozen: "in_progress" | "awaiting_inspection" | "guest_ready" | "out_of_service" | "unknown_status" | null;
  /** Writes are paused (offline / stale / unverified): the actions above are shown but disabled. */
  paused: boolean;
}

/**
 * Derived ONLY from the Phase 1 eligibility, so the sheet can never offer what the rules refuse: a room being
 * cleaned, submitted, inspected or out of service offers no assign / reassign / remove at all.
 */
export function describeSheetActions(entry: AssignmentRoom, gate: MutationGate): RoomSheetActions {
  const { eligibility } = entry;
  return {
    assign: eligibility.canAssign ? (eligibility.softBlocks.length > 0 ? "review_assign" : "assign") : null,
    reassign: eligibility.canReassign,
    remove: eligibility.canRemove,
    frozen: eligibility.hardBlock,
    paused: !gate.allowed,
  };
}

/** The Room Board detail context for the same model, so the shared detail model reads one source of truth. */
export function detailContextOf(
  board: RoomBoardModel,
  gate: MutationGate,
  verifiedClock: string | null,
  live: boolean,
) {
  return {
    now: board.generatedAt,
    timeZone: board.timeZone,
    gate,
    verifiedClock,
    live,
    rosterTrust: board.rosterTrust,
    staff: board.staff,
    staffNamesKnown: board.staffNamesKnown,
    lateCheckoutsKnown: board.lateCheckoutsKnown,
  };
}

/* ─── View state: scope + filters + sort, as the screen and the sheet share them ─ */

export interface AssignmentViewState {
  scope: AssignmentScope;
  filters: AssignmentFilters;
  sort: AssignmentSortKey;
}

export const DEFAULT_VIEW_STATE: AssignmentViewState = { scope: "all", filters: EMPTY_ASSIGNMENT_FILTERS, sort: "priority" };

/**
 * What the filter button's badge counts: everything applied that the quick chips (All / Unassigned / Urgent)
 * do not already show, plus a non-default sort.
 */
export function viewStateBadge(state: AssignmentViewState): number {
  const { scope, filters, sort } = state;
  const priority = filters.priority !== "any" && filters.priority !== "urgent" ? 1 : 0;
  const scopeOnly = scope === "assigned" || scope === "blocked" ? 1 : 0;
  return assignmentFilterCount({ ...filters, priority: "any" }) + priority + scopeOnly + (sort !== "priority" ? 1 : 0);
}

export function isDefaultViewState(state: AssignmentViewState): boolean {
  return state.scope === "all" && state.sort === "priority" && assignmentFilterCount(state.filters) === 0;
}

/** One removable chip per applied narrowing the quick chips do not already show. */
export type ActiveChip =
  | { id: string; kind: "scope"; scope: "assigned" | "blocked" }
  | { id: string; kind: "priority"; priority: "vip" | "at_risk" }
  | { id: string; kind: "building"; building: string }
  | { id: string; kind: "floor"; floorKey: string; building: string | null; floor: number | null }
  | { id: string; kind: "cleanType"; key: string; label: string | null }
  | { id: string; kind: "status"; code: string };

export function buildActiveChips(state: AssignmentViewState, options: AssignmentFilterOptions): ActiveChip[] {
  const { scope, filters } = state;
  const chips: ActiveChip[] = [];
  if (scope === "assigned" || scope === "blocked") chips.push({ id: `scope:${scope}`, kind: "scope", scope });
  if (filters.priority === "vip" || filters.priority === "at_risk") chips.push({ id: `priority:${filters.priority}`, kind: "priority", priority: filters.priority });
  if (filters.building !== null) chips.push({ id: `building:${filters.building}`, kind: "building", building: filters.building });
  for (const key of filters.floors) {
    const floor = options.floors.find((candidate) => candidate.key === key);
    chips.push({ id: `floor:${key}`, kind: "floor", floorKey: key, building: floor?.building ?? null, floor: floor?.floor ?? null });
  }
  for (const key of filters.cleanTypes) {
    chips.push({ id: `cleanType:${key}`, kind: "cleanType", key, label: options.cleanTypes.find((option) => option.key === key)?.label ?? null });
  }
  for (const code of filters.statuses) chips.push({ id: `status:${code}`, kind: "status", code });
  return chips;
}

export function removeActiveChip(state: AssignmentViewState, chip: ActiveChip): AssignmentViewState {
  const { filters } = state;
  switch (chip.kind) {
    case "scope":
      return { ...state, scope: "all" };
    case "priority":
      return { ...state, filters: { ...filters, priority: "any" } };
    case "building":
      // Floors belong to a building; dropping the building keeps none of them silently pointing elsewhere.
      return { ...state, filters: { ...filters, building: null } };
    case "floor":
      return { ...state, filters: { ...filters, floors: filters.floors.filter((key) => key !== chip.floorKey) } };
    case "cleanType":
      return { ...state, filters: { ...filters, cleanTypes: filters.cleanTypes.filter((key) => key !== chip.key) } };
    case "status":
      return { ...state, filters: { ...filters, statuses: filters.statuses.filter((code) => code !== chip.code) } };
  }
}
