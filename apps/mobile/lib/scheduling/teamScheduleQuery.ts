import { normalizeSearch } from "@/lib/housekeeping/assignmentQuery";
import { compareNames, type DisplayStatus, type RosterPerson, type ShiftGroup } from "@/lib/scheduling/teamScheduleModel";

/* ─── Team Schedule — search, filter, sort ──────────────────────────────────
   Pure, client-side over the people already loaded (the server already limited them to this supervisor's
   department). Filters survive switching between Today and Week and moving to another day; only the options that
   exist on the current day are offered. */

export type StatusFilter = "all" | DisplayStatus;
export type TeamSortKey = "start" | "name" | "status";

export interface ScheduleFilters {
  status: StatusFilter;
  /** A role id from `RosterPerson.roles`, or null for every role. */
  role: string | null;
  /** A `DayShift.windowKey`, or null for every shift. */
  shiftKey: string | null;
}

export interface ScheduleViewState {
  query: string;
  filters: ScheduleFilters;
  sort: TeamSortKey;
}

export const EMPTY_FILTERS: ScheduleFilters = { status: "all", role: null, shiftKey: null };
export const DEFAULT_VIEW_STATE: ScheduleViewState = { query: "", filters: EMPTY_FILTERS, sort: "start" };

export const STATUS_FILTERS: readonly DisplayStatus[] = ["on_shift", "on_break", "scheduled", "not_clocked_in", "shift_ended", "unknown"];

export function filterCount(filters: ScheduleFilters): number {
  return (filters.status !== "all" ? 1 : 0) + (filters.role !== null ? 1 : 0) + (filters.shiftKey !== null ? 1 : 0);
}

/** Filter-button badge: applied narrowing plus a non-default sort. */
export function viewBadge(state: ScheduleViewState): number {
  return filterCount(state.filters) + (state.sort !== "start" ? 1 : 0);
}

export function isDefaultView(state: ScheduleViewState): boolean {
  return normalizeSearch(state.query) === "" && viewBadge(state) === 0;
}

/** Every typed word must appear in the person's name ("ana tor" finds Ana Torres). A nameless person needs a clear search. */
export function searchPeople(people: readonly RosterPerson[], query: string): RosterPerson[] {
  const needle = normalizeSearch(query);
  if (!needle) return [...people];
  const words = needle.split(" ");
  return people.filter((person) => {
    const name = person.name?.toLowerCase();
    return name !== undefined && words.every((word) => name.includes(word));
  });
}

export function matchesFilters(person: RosterPerson, filters: ScheduleFilters): boolean {
  if (filters.status !== "all" && person.status !== filters.status) return false;
  if (filters.role !== null && !person.roles.includes(filters.role)) return false;
  if (filters.shiftKey !== null && !person.shifts.some((shift) => shift.windowKey === filters.shiftKey)) return false;
  return true;
}

/** Needs-a-look first, then who is working, then who is done. */
const STATUS_RANK: Record<DisplayStatus, number> = { not_clocked_in: 0, unknown: 1, scheduled: 2, on_shift: 3, on_break: 4, shift_ended: 5 };

function compare(sort: TeamSortKey): (a: RosterPerson, b: RosterPerson) => number {
  const tie = (a: RosterPerson, b: RosterPerson) => compareNames(a.name, b.name) || a.userId.localeCompare(b.userId);
  switch (sort) {
    case "name":
      return tie;
    case "status":
      return (a, b) => (a.status === null ? 9 : STATUS_RANK[a.status]) - (b.status === null ? 9 : STATUS_RANK[b.status]) || (a.firstStartMs ?? Infinity) - (b.firstStartMs ?? Infinity) || tie(a, b);
    default:
      return (a, b) => (a.firstStartMs ?? Infinity) - (b.firstStartMs ?? Infinity) || tie(a, b);
  }
}

/** Search → filters → sort. The result is a new array; the input is never reordered. */
export function applyView(people: readonly RosterPerson[], state: ScheduleViewState): RosterPerson[] {
  return searchPeople(people, state.query).filter((person) => matchesFilters(person, state.filters)).sort(compare(state.sort));
}

/** Drops a shift filter that no longer exists on the day being shown, so it cannot empty the list invisibly. */
export function pruneFilters(filters: ScheduleFilters, options: FilterOptions): ScheduleFilters {
  return {
    status: filters.status === "all" || options.statuses.includes(filters.status) ? filters.status : "all",
    role: filters.role === null || options.roles.includes(filters.role) ? filters.role : null,
    shiftKey: filters.shiftKey === null || options.shifts.some((shift) => shift.key === filters.shiftKey) ? filters.shiftKey : null,
  };
}

export interface FilterOptions {
  statuses: DisplayStatus[];
  roles: string[];
  shifts: { key: string; name: string | null; startLabel: string; endLabel: string; endsNextDay: boolean }[];
}

/** Only values somebody actually has today are offered. */
export function buildFilterOptions(people: readonly RosterPerson[], groups: readonly ShiftGroup[]): FilterOptions {
  const present = new Set<DisplayStatus>();
  const roles = new Set<string>();
  for (const person of people) {
    if (person.status !== null) present.add(person.status);
    for (const role of person.roles) roles.add(role);
  }
  return {
    statuses: STATUS_FILTERS.filter((status) => present.has(status)),
    roles: [...roles].sort((a, b) => a.localeCompare(b)),
    shifts: groups.map((group) => ({ key: group.key, name: group.name, startLabel: group.startLabel, endLabel: group.endLabel, endsNextDay: group.endsNextDay })),
  };
}

/** The shift groups after the same search/filters, so Week and Today agree about who is shown. */
export function filterGroups(groups: readonly ShiftGroup[], visible: ReadonlySet<string>, filters: ScheduleFilters): ShiftGroup[] {
  return groups
    .filter((group) => filters.shiftKey === null || group.key === filters.shiftKey)
    .map((group) => ({ ...group, members: group.members.filter((member) => visible.has(member.person.userId)) }))
    .filter((group) => group.members.length > 0);
}
