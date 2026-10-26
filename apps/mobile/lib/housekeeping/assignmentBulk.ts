import type { AssignmentRoom } from "@/lib/housekeeping/assignmentModel";
import type { HardBlock, SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import { floorKeyOf, NONE_KEY } from "@/lib/housekeeping/roomBoardFilters";

/* ─── Supervisor Assignments — bulk room selection ──────────────────────────
   Pure. Which rooms a supervisor may pick for a bulk assignment, how a selection is grown and shrunk, and what
   it adds up to. Selecting a room changes NOTHING: a selection becomes proposed changes only when it is
   allocated, and those are published only from the reviewed draft.

   ELIGIBILITY IS NOT RE-INVENTED. A room is bulk-selectable exactly when Phase 1 says it is `autoAssignable`:
   nobody owns it, no hard block applies (not being cleaned, submitted, inspected, out of service or unknown) and
   no soft block applies (DND, declined service, return-later, occupancy discrepancy). A soft-blocked room needs a
   per-room acknowledgement, which a bulk publication never carries — so it cannot be selected, only explained.

   A selection holds room ids, not rooms: it survives scrolling, searching and filtering. Each refresh re-derives
   from the live model which selected rooms are still eligible; the others stay visibly SELECTED-BUT-INVALID and
   are left out of the assignment until the supervisor removes them (`selectionSummary.invalid`). */

/** The most rooms one selection may hold: one publication carries at most MAX_BATCH_CHANGES. */
export const MAX_BULK_SELECTION = MAX_BATCH_CHANGES;

/* ─── Eligibility ─────────────────────────────────────────────────────────── */

export type BulkExclusion =
  | { kind: "assigned"; ownerName: string | null }
  | { kind: "hard"; block: HardBlock }
  | { kind: "soft"; blocks: SoftBlock[] };

export interface BulkEligibility {
  selectable: boolean;
  /** Why not, or null when selectable. */
  exclusion: BulkExclusion | null;
}

export function bulkEligibility(entry: AssignmentRoom): BulkEligibility {
  const { eligibility, ownership } = entry;
  if (eligibility.autoAssignable) return { selectable: true, exclusion: null };
  if (eligibility.hardBlock) return { selectable: false, exclusion: { kind: "hard", block: eligibility.hardBlock } };
  if (ownership.assigned) return { selectable: false, exclusion: { kind: "assigned", ownerName: ownership.name } };
  return { selectable: false, exclusion: { kind: "soft", blocks: [...eligibility.softBlocks] } };
}

/** The rooms of `entries` a supervisor may select, in the order given (the model's priority order). */
export function selectableIn(entries: readonly AssignmentRoom[]): AssignmentRoom[] {
  return entries.filter((entry) => bulkEligibility(entry).selectable);
}

/** Rooms nobody owns that selection cannot take (held back or being worked). The "blocked" count in the bar. */
export function blockedIn(entries: readonly AssignmentRoom[]): AssignmentRoom[] {
  return entries.filter((entry) => {
    const { selectable, exclusion } = bulkEligibility(entry);
    return !selectable && exclusion !== null && exclusion.kind !== "assigned" && !entry.ownership.assigned;
  });
}

/* ─── Growing and shrinking a selection ───────────────────────────────────── */

export type SelectionRefusal = "not_selectable" | "limit";

export interface SelectionChange {
  selected: ReadonlySet<string>;
  refused?: SelectionRefusal;
  /** More rooms were asked for than the limit allows; the first ones (in priority order) were taken. */
  truncated?: boolean;
}

/**
 * Toggles one room. A room can be added only while it is selectable and the limit is not reached; a selected room can
 * always be removed (including one that has since become ineligible).
 */
export function toggleRoom(selected: ReadonlySet<string>, entry: AssignmentRoom, limit: number = MAX_BULK_SELECTION): SelectionChange {
  const id = entry.room.roomId;
  if (selected.has(id)) {
    const next = new Set(selected);
    next.delete(id);
    return { selected: next };
  }
  if (!bulkEligibility(entry).selectable) return { selected, refused: "not_selectable" };
  if (selected.size >= limit) return { selected, refused: "limit" };
  return { selected: new Set(selected).add(id) };
}

/** Adds every SELECTABLE room of `entries` (never an ineligible one), up to the limit, in the order given. */
export function addRooms(selected: ReadonlySet<string>, entries: readonly AssignmentRoom[], limit: number = MAX_BULK_SELECTION): SelectionChange {
  const next = new Set(selected);
  let truncated = false;
  for (const entry of selectableIn(entries)) {
    if (next.has(entry.room.roomId)) continue;
    if (next.size >= limit) {
      truncated = true;
      break;
    }
    next.add(entry.room.roomId);
  }
  return truncated ? { selected: next, truncated } : { selected: next };
}

export function removeRooms(selected: ReadonlySet<string>, roomIds: Iterable<string>): ReadonlySet<string> {
  const next = new Set(selected);
  for (const id of roomIds) next.delete(id);
  return next;
}

/* ─── Scopes: matching filters, a floor, a building ───────────────────────── */

export type BulkScope = { kind: "floor"; key: string } | { kind: "building"; building: string | null };

export interface ScopeGroup {
  id: string;
  scope: BulkScope;
  building: string | null;
  /** null = the rooms have no recorded floor. */
  floor: number | null;
  /** Selectable rooms in this group (hotel-wide: the group ignores the current search and filters). */
  eligible: number;
  total: number;
}

function groupsBy(queue: readonly AssignmentRoom[], keyOf: (entry: AssignmentRoom) => string, make: (entry: AssignmentRoom) => Omit<ScopeGroup, "eligible" | "total">): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  for (const entry of queue) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? { ...make(entry), eligible: 0, total: 0 };
    group.total += 1;
    if (bulkEligibility(entry).selectable) group.eligible += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Floors that have at least one selectable room, read from the rooms themselves (nothing is hard-coded). */
export function floorGroups(queue: readonly AssignmentRoom[]): ScopeGroup[] {
  return groupsBy(
    queue,
    (entry) => floorKeyOf(entry.room),
    (entry) => ({
      id: `floor:${floorKeyOf(entry.room)}`,
      scope: { kind: "floor", key: floorKeyOf(entry.room) },
      building: entry.room.building,
      floor: entry.room.floorKnown ? entry.room.floor : null,
    }),
  )
    .filter((group) => group.eligible > 0)
    .sort((a, b) => (a.building ?? "").localeCompare(b.building ?? "") || (a.floor ?? Number.POSITIVE_INFINITY) - (b.floor ?? Number.POSITIVE_INFINITY));
}

/** Buildings that have at least one selectable room. Only offered when the hotel records more than one. */
export function buildingGroups(queue: readonly AssignmentRoom[]): ScopeGroup[] {
  const groups = groupsBy(
    queue,
    (entry) => entry.room.building ?? NONE_KEY,
    (entry) => ({ id: `building:${entry.room.building ?? NONE_KEY}`, scope: { kind: "building", building: entry.room.building }, building: entry.room.building, floor: null }),
  )
    .filter((group) => group.eligible > 0)
    .sort((a, b) => (a.building ?? "").localeCompare(b.building ?? ""));
  return groups.length > 1 ? groups : [];
}

export function roomsInScope(queue: readonly AssignmentRoom[], scope: BulkScope): AssignmentRoom[] {
  return queue.filter((entry) => (scope.kind === "floor" ? floorKeyOf(entry.room) === scope.key : (entry.room.building ?? null) === scope.building));
}

/** How much of a scope's SELECTABLE rooms is selected: drives the chip's checked state and what pressing it does. */
export function scopeState(queue: readonly AssignmentRoom[], scope: BulkScope, selected: ReadonlySet<string>): "all" | "some" | "none" {
  const eligible = selectableIn(roomsInScope(queue, scope));
  const chosen = eligible.filter((entry) => selected.has(entry.room.roomId)).length;
  return eligible.length > 0 && chosen === eligible.length ? "all" : chosen > 0 ? "some" : "none";
}

/** Pressing a scope selects all its eligible rooms, or — when they are all selected already — clears them. */
export function toggleScope(selected: ReadonlySet<string>, queue: readonly AssignmentRoom[], scope: BulkScope, limit: number = MAX_BULK_SELECTION): SelectionChange {
  const inScope = roomsInScope(queue, scope);
  if (scopeState(queue, scope, selected) === "all") return { selected: removeRooms(selected, inScope.map((entry) => entry.room.roomId)) };
  return addRooms(selected, inScope, limit);
}

/* ─── What a selection adds up to ─────────────────────────────────────────── */

export interface SelectionMinutes {
  /** Sum of the KNOWN estimates; null when no selected room has one. */
  minutes: number | null;
  /** Some selected rooms have no estimate, so `minutes` is a lower bound ("at least"). */
  partial: boolean;
  missing: number;
}

export function totalMinutes(entries: readonly AssignmentRoom[]): SelectionMinutes {
  let minutes = 0;
  let known = 0;
  for (const entry of entries) {
    if (entry.estimate) {
      minutes += entry.estimate.minutes;
      known += 1;
    }
  }
  const missing = entries.length - known;
  return { minutes: known === 0 ? null : Math.round(minutes), partial: known > 0 && missing > 0, missing };
}

export interface InvalidSelected {
  roomId: string;
  roomNumber: string;
  /** null = the room has left the board altogether. */
  exclusion: BulkExclusion | null;
}

export interface SelectionSummary {
  /** Selected ids, valid or not. */
  selectedCount: number;
  /** The selected rooms that are still eligible, in the model's priority order. */
  valid: AssignmentRoom[];
  invalid: InvalidSelected[];
  minutes: SelectionMinutes;
}

/** Re-derives a selection against the LIVE model: eligible rooms are `valid`, the rest are `invalid` with the reason. */
export function selectionSummary(rooms: readonly AssignmentRoom[] | null, selected: ReadonlySet<string>): SelectionSummary {
  const byId = new Map((rooms ?? []).map((entry) => [entry.room.roomId, entry] as const));
  const valid: AssignmentRoom[] = [];
  const invalid: InvalidSelected[] = [];
  for (const entry of rooms ?? []) if (selected.has(entry.room.roomId) && bulkEligibility(entry).selectable) valid.push(entry);
  for (const id of selected) {
    const entry = byId.get(id);
    if (entry && bulkEligibility(entry).selectable) continue;
    invalid.push({ roomId: id, roomNumber: entry?.room.roomNumber ?? "", exclusion: entry ? bulkEligibility(entry).exclusion : null });
  }
  return { selectedCount: selected.size, valid, invalid, minutes: totalMinutes(valid) };
}
