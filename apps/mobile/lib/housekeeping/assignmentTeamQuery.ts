import { NONE_KEY, floorKeyOf } from "@/lib/housekeeping/roomBoardFilters";
import { normalizeSearch } from "@/lib/housekeeping/assignmentQuery";
import { ATTENDANCE_RANK, type Attendance, type AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";

/* ─── Supervisor Assignments — Team: search, filter, sort ───────────────────
   Pure. Everything here reads `AssignmentTeamMember`s that Phase 1 already built from the ONE verified model,
   so the Team list cannot disagree with Rooms about who owns what or who is working.

   UNKNOWN IS NEVER ZERO. A person whose remaining minutes are only a lower bound (some rooms have no estimate),
   or whose attendance is unknown, is not sorted as if the missing part were nothing: known values come first and
   unknowns follow in a fixed, documented order (their lower bound, then name, then user id). */

/* ─── State ───────────────────────────────────────────────────────────────── */

export type AttendanceFilter = "all" | "on_shift" | "on_break" | "scheduled" | "not_clocked_in" | "unknown" | "shift_ended";
export type WorkloadFilter = "all" | "none" | "has" | "high_load" | "needs_review";
export type TeamSortKey = "available" | "name" | "most_remaining" | "least_remaining" | "most_rooms" | "most_completed" | "capacity";

export interface TeamFilters {
  attendance: AttendanceFilter;
  workload: WorkloadFilter;
  /** A building name, NONE_KEY for rooms with no building, or null for every building. */
  building: string | null;
  /** `floorKeyOf` keys. Empty = every floor. */
  floors: string[];
}

export interface TeamViewState {
  filters: TeamFilters;
  sort: TeamSortKey;
}

export const EMPTY_TEAM_FILTERS: TeamFilters = { attendance: "all", workload: "all", building: null, floors: [] };
export const DEFAULT_TEAM_VIEW_STATE: TeamViewState = { filters: EMPTY_TEAM_FILTERS, sort: "available" };

export const ATTENDANCE_FILTERS: readonly Exclude<AttendanceFilter, "all">[] = ["on_shift", "on_break", "scheduled", "not_clocked_in", "unknown", "shift_ended"];
export const WORKLOAD_FILTERS: readonly Exclude<WorkloadFilter, "all">[] = ["none", "has", "high_load", "needs_review"];

const ATTENDANCE_OF_FILTER: Record<Exclude<AttendanceFilter, "all">, Attendance> = {
  on_shift: "on_shift",
  on_break: "on_break",
  scheduled: "scheduled_not_clocked_in",
  not_clocked_in: "not_clocked_in",
  unknown: "unknown",
  shift_ended: "shift_ended",
};

export function teamFilterCount(filters: TeamFilters): number {
  return (filters.attendance !== "all" ? 1 : 0) + (filters.workload !== "all" ? 1 : 0) + (filters.building !== null ? 1 : 0) + filters.floors.length;
}

export function isDefaultTeamViewState(state: TeamViewState): boolean {
  return state.sort === "available" && teamFilterCount(state.filters) === 0;
}

/** Filter-button badge: applied narrowing plus a non-default sort. */
export function teamViewBadge(state: TeamViewState): number {
  return teamFilterCount(state.filters) + (state.sort !== "available" ? 1 : 0);
}

/* ─── Predicates ──────────────────────────────────────────────────────────── */

export function isHighLoad(member: AssignmentTeamMember): boolean {
  return member.concerns.includes("overloaded");
}

export function needsReview(member: AssignmentTeamMember): boolean {
  return member.concerns.length > 0;
}

function matchesAttendance(member: AssignmentTeamMember, filter: AttendanceFilter): boolean {
  return filter === "all" || member.attendance === ATTENDANCE_OF_FILTER[filter];
}

function matchesWorkload(member: AssignmentTeamMember, filter: WorkloadFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "none":
      return member.rooms.length === 0;
    case "has":
      return member.rooms.length > 0;
    case "high_load":
      return isHighLoad(member);
    case "needs_review":
      return needsReview(member);
  }
}

/** A person covers a place when at least one of THEIR rooms is in it (building and floor are checked on the same room). */
function matchesCoverage(member: AssignmentTeamMember, filters: TeamFilters): boolean {
  if (filters.building === null && filters.floors.length === 0) return true;
  return member.rooms.some(
    (room) => (filters.building === null || (room.building ?? NONE_KEY) === filters.building) && (filters.floors.length === 0 || filters.floors.includes(floorKeyOf(room))),
  );
}

export function searchTeam(team: readonly AssignmentTeamMember[], query: string): AssignmentTeamMember[] {
  const needle = normalizeSearch(query);
  if (!needle) return [...team];
  const words = needle.split(" ");
  // Every typed word must appear in the person's name ("ana tor" finds Ana Torres). A person with no usable name
  // can only be reached by clearing the search.
  return team.filter((member) => {
    const name = member.name?.toLowerCase();
    return name !== undefined && words.every((word) => name.includes(word));
  });
}

/* ─── Options ─────────────────────────────────────────────────────────────── */

export interface TeamFilterOptions {
  /** Attendance states somebody is actually in (plus nothing else): a state nobody has is not offered. */
  attendance: Exclude<AttendanceFilter, "all">[];
  buildings: string[];
  floors: { key: string; building: string | null; floor: number | null }[];
  /** At least one person has a trustworthy capacity percentage, so "Capacity concern" means something. */
  capacitySort: boolean;
}

export function buildTeamFilterOptions(team: readonly AssignmentTeamMember[]): TeamFilterOptions {
  const present = new Set<Attendance>();
  const buildings = new Set<string>();
  const floors = new Map<string, { key: string; building: string | null; floor: number | null }>();
  let capacitySort = false;
  for (const member of team) {
    present.add(member.attendance);
    if (member.load.capacity.utilization !== null) capacitySort = true;
    for (const room of member.rooms) {
      buildings.add(room.building ?? NONE_KEY);
      const key = floorKeyOf(room);
      if (!floors.has(key)) floors.set(key, { key, building: room.building, floor: room.floorKnown ? room.floor : null });
    }
  }
  const nullsLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);
  const byBuilding = (a: string, b: string) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  return {
    attendance: ATTENDANCE_FILTERS.filter((filter) => present.has(ATTENDANCE_OF_FILTER[filter])),
    buildings: [...buildings].sort(byBuilding),
    floors: [...floors.values()].sort((a, b) => {
      if (a.building !== b.building) return a.building === null ? 1 : b.building === null ? -1 : byBuilding(a.building, b.building);
      return nullsLast(a.floor, b.floor);
    }),
    capacitySort,
  };
}

/* ─── Sort ────────────────────────────────────────────────────────────────── */

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

function byName(a: AssignmentTeamMember, b: AssignmentTeamMember): number {
  return (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || collator.compare(a.name ?? "", b.name ?? "") || a.userId.localeCompare(b.userId);
}

/**
 * Remaining estimated minutes, as a comparable. `known` is true only when every remaining room has an estimate;
 * otherwise `value` is just the lower bound (what the estimates that exist add up to).
 */
function remaining(member: AssignmentTeamMember): { known: boolean; value: number } {
  const { minutes } = member.load;
  return { known: minutes.minutesComplete, value: minutes.remainingMinutes };
}

/** Known totals first (in the requested direction), then incomplete ones by their lower bound the same way, then name. */
function byRemaining(direction: 1 | -1) {
  return (a: AssignmentTeamMember, b: AssignmentTeamMember): number => {
    const x = remaining(a);
    const y = remaining(b);
    if (x.known !== y.known) return x.known ? -1 : 1;
    return (x.value - y.value) * direction || byName(a, b);
  };
}

/** Utilization high → low; people whose lower bound already proves "over" next; unknown last. */
function capacityRank(member: AssignmentTeamMember): number {
  const { capacity } = member.load;
  if (capacity.utilization !== null) return 0;
  return capacity.state === "over" ? 1 : 2;
}

function compareCapacity(a: AssignmentTeamMember, b: AssignmentTeamMember): number {
  return (
    capacityRank(a) - capacityRank(b) ||
    (b.load.capacity.utilization ?? 0) - (a.load.capacity.utilization ?? 0) ||
    byName(a, b)
  );
}

/**
 * "Most available": working people first (ATTENDANCE_RANK), then the least remaining work. Meaningful only when
 * attendance is verified — see `effectiveSort`.
 */
function compareAvailable(a: AssignmentTeamMember, b: AssignmentTeamMember): number {
  return ATTENDANCE_RANK[a.attendance] - ATTENDANCE_RANK[b.attendance] || byRemaining(1)(a, b) || a.load.minutes.remainingRooms - b.load.minutes.remainingRooms || byName(a, b);
}

/**
 * The sort that is actually applied. "Most available" needs verified attendance to mean anything; without it
 * the list falls back to name order rather than pretending to rank availability.
 */
export function effectiveSort(sort: TeamSortKey, rosterVerified: boolean): TeamSortKey {
  return sort === "available" && !rosterVerified ? "name" : sort;
}

export function sortTeam(team: readonly AssignmentTeamMember[], sort: TeamSortKey): AssignmentTeamMember[] {
  const list = [...team];
  switch (sort) {
    case "available":
      return list.sort(compareAvailable);
    case "name":
      return list.sort(byName);
    case "most_remaining":
      return list.sort(byRemaining(-1));
    case "least_remaining":
      return list.sort(byRemaining(1));
    case "most_rooms":
      return list.sort((a, b) => b.rooms.length - a.rooms.length || byName(a, b));
    case "most_completed":
      return list.sort((a, b) => b.load.minutes.completed - a.load.minutes.completed || byName(a, b));
    case "capacity":
      return list.sort(compareCapacity);
  }
}

/* ─── Query ───────────────────────────────────────────────────────────────── */

export interface TeamQueryInput {
  team: readonly AssignmentTeamMember[];
  search: string;
  filters: TeamFilters;
  sort: TeamSortKey;
  rosterVerified: boolean;
}

export interface TeamQueryResult {
  visible: AssignmentTeamMember[];
  total: number;
  searching: boolean;
  /** Why nothing is listed, when nothing is: the search, or the filters. null = the team itself is empty or something is listed. */
  emptyReason: "search" | "filters" | null;
  /** The sort that was applied (it differs from the chosen one when attendance cannot be verified). */
  sortUsed: TeamSortKey;
}

export function runTeamQuery({ team, search, filters, sort, rosterVerified }: TeamQueryInput): TeamQueryResult {
  const narrowed = team.filter((member) => matchesAttendance(member, filters.attendance) && matchesWorkload(member, filters.workload) && matchesCoverage(member, filters));
  const searched = searchTeam(narrowed, search);
  const sortUsed = effectiveSort(sort, rosterVerified);
  const visible = sortTeam(searched, sortUsed);
  const searching = normalizeSearch(search).length > 0;
  // The filters alone emptied the team, or they left people and the search emptied them.
  const emptyReason: TeamQueryResult["emptyReason"] = visible.length > 0 || team.length === 0 ? null : narrowed.length === 0 ? "filters" : "search";
  return { visible, total: team.length, searching, emptyReason, sortUsed };
}

/* ─── Active chips ────────────────────────────────────────────────────────── */

export type TeamChip =
  | { id: string; kind: "attendance"; value: Exclude<AttendanceFilter, "all"> }
  | { id: string; kind: "workload"; value: Exclude<WorkloadFilter, "all"> }
  | { id: string; kind: "building"; building: string }
  | { id: string; kind: "floor"; floorKey: string; building: string | null; floor: number | null };

export function buildTeamChips(state: TeamViewState, options: TeamFilterOptions): TeamChip[] {
  const { filters } = state;
  const chips: TeamChip[] = [];
  if (filters.attendance !== "all") chips.push({ id: `attendance:${filters.attendance}`, kind: "attendance", value: filters.attendance });
  if (filters.workload !== "all") chips.push({ id: `workload:${filters.workload}`, kind: "workload", value: filters.workload });
  if (filters.building !== null) chips.push({ id: `building:${filters.building}`, kind: "building", building: filters.building });
  for (const key of filters.floors) {
    const floor = options.floors.find((candidate) => candidate.key === key);
    chips.push({ id: `floor:${key}`, kind: "floor", floorKey: key, building: floor?.building ?? null, floor: floor?.floor ?? null });
  }
  return chips;
}

export function removeTeamChip(state: TeamViewState, chip: TeamChip): TeamViewState {
  const { filters } = state;
  switch (chip.kind) {
    case "attendance":
      return { ...state, filters: { ...filters, attendance: "all" } };
    case "workload":
      return { ...state, filters: { ...filters, workload: "all" } };
    case "building":
      return { ...state, filters: { ...filters, building: null } };
    case "floor":
      return { ...state, filters: { ...filters, floors: filters.floors.filter((key) => key !== chip.floorKey) } };
  }
}

/** Counts per attendance filter over the WHOLE team (not the narrowed list), for the filter sheet's hints. */
export function attendanceCounts(team: readonly AssignmentTeamMember[]): Record<Exclude<AttendanceFilter, "all">, number> {
  const counts = Object.fromEntries(ATTENDANCE_FILTERS.map((filter) => [filter, 0])) as Record<Exclude<AttendanceFilter, "all">, number>;
  for (const member of team) {
    const filter = ATTENDANCE_FILTERS.find((candidate) => ATTENDANCE_OF_FILTER[candidate] === member.attendance);
    if (filter) counts[filter] += 1;
  }
  return counts;
}
