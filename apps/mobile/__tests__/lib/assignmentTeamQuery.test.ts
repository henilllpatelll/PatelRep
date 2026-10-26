import {
  DEFAULT_TEAM_VIEW_STATE,
  EMPTY_TEAM_FILTERS,
  buildTeamChips,
  buildTeamFilterOptions,
  effectiveSort,
  removeTeamChip,
  runTeamQuery,
  searchTeam,
  sortTeam,
  teamFilterCount,
  type TeamFilters,
} from "@/lib/housekeeping/assignmentTeamQuery";
import type { AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import { availableSource } from "@/lib/housekeeping/supervisorSources";
import { assignmentsOf, rosterOf, rosterRow, shift } from "../helpers/assignmentFixtures";
import { NOW, rawRoom } from "../helpers/roomBoardFixtures";

/* A small hotel with every kind of person: owners, an idle on-shift attendant, someone on break, someone clocked out,
   and a scheduled attendant who has not clocked in. Names come from the shared STAFF fixture. */

const board = [
  rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "a1" }),
  rawRoom("102", "DIRTY", { assigned_to: "hk-1", assignment_id: "a2" }),
  rawRoom("103", "DIRTY", { assigned_to: "hk-1", assignment_id: "a3" }),
  rawRoom("104", "IN_PROGRESS", { assigned_to: "hk-2", assignment_id: "a4" }),
  rawRoom("205", "CLEAN", { assigned_to: "hk-2", assignment_id: "a5", inspection_required: true }),
];

const model = (options: Parameters<typeof assignmentsOf>[0] = {}) =>
  assignmentsOf({ raw: board, roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "ended")]), ...options });

const team = (options?: Parameters<typeof assignmentsOf>[0]): AssignmentTeamMember[] => model(options).team ?? [];
const ids = (members: readonly AssignmentTeamMember[]) => members.map((member) => member.userId);
const query = (members: AssignmentTeamMember[], over: Partial<Parameters<typeof runTeamQuery>[0]> = {}) =>
  runTeamQuery({ team: members, search: "", filters: EMPTY_TEAM_FILTERS, sort: "name", rosterVerified: true, ...over });

describe("search", () => {
  it("finds a housekeeper by any part of their name, case-insensitively", () => {
    expect(ids(searchTeam(team(), "TORRES"))).toEqual(["hk-1"]);
    expect(ids(searchTeam(team(), "  ben  "))).toEqual(["hk-2"]);
  });

  it("every typed word must match: 'ana tor' finds Ana Torres, 'ana ort' finds nobody", () => {
    expect(ids(searchTeam(team(), "ana tor"))).toEqual(["hk-1"]);
    expect(searchTeam(team(), "ana ort")).toEqual([]);
  });

  it("an empty search keeps everyone; a person with no usable name is reachable only without a search", () => {
    const withUnnamed = team({ raw: [...board, rawRoom("301", "DIRTY", { assigned_to: "ghost", assignment_id: "a9" })] });
    expect(withUnnamed).toHaveLength(4);
    expect(searchTeam(withUnnamed, "")).toHaveLength(4);
    expect(ids(searchTeam(withUnnamed, "ghost"))).toEqual([]);
  });
});

describe("filters", () => {
  const run = (filters: Partial<TeamFilters>) => ids(query(team(), { filters: { ...EMPTY_TEAM_FILTERS, ...filters } }).visible);

  it("attendance: each state selects only people in that verified state", () => {
    expect(run({ attendance: "on_shift" })).toEqual(["hk-1"]);
    expect(run({ attendance: "on_break" })).toEqual(["hk-2"]);
    expect(run({ attendance: "shift_ended" })).toEqual(["hk-3"]);
    expect(run({ attendance: "unknown" })).toEqual([]);
  });

  it("'Scheduled' is scheduled-but-not-clocked-in, distinct from clocked in and from not scheduled", () => {
    const members = team({
      roster: rosterOf([rosterRow("hk-1", "active")]),
      schedule: availableSource([shift("hk-2")], NOW),
    });
    expect(ids(query(members, { filters: { ...EMPTY_TEAM_FILTERS, attendance: "scheduled" } }).visible)).toEqual(["hk-2"]);
    expect(ids(query(members, { filters: { ...EMPTY_TEAM_FILTERS, attendance: "not_clocked_in" } }).visible)).toEqual(["hk-3"]);
  });

  it("workload: no assignments / has assignments", () => {
    expect(run({ workload: "none" })).toEqual(["hk-3"]);
    expect(run({ workload: "has" })).toEqual(["hk-1", "hk-2"]);
  });

  it("high load needs evidence: more rooms than a colleague is not enough, an exceeded credit target is", () => {
    expect(run({ workload: "high_load" })).toEqual([]);
    const heavy = team({
      raw: Array.from({ length: 7 }, (_, index) => rawRoom(`40${index}`, "DIRTY", { assigned_to: "hk-1", assignment_id: `h${index}`, clean_type: "DEP" })),
    });
    // 7 departures × 3 credits = 21 against a target of 16 (more than 2 over) → a verified overload.
    expect(ids(query(heavy, { filters: { ...EMPTY_TEAM_FILTERS, workload: "high_load" } }).visible)).toEqual(["hk-1"]);
  });

  it("needs review: a clocked-out person with open rooms qualifies", () => {
    const members = team({ raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-3", assignment_id: "x" })] });
    expect(ids(query(members, { filters: { ...EMPTY_TEAM_FILTERS, workload: "needs_review" } }).visible)).toEqual(["hk-3"]);
  });

  it("coverage: building and floor are checked against the SAME room", () => {
    expect(run({ building: "A" })).toEqual(["hk-1", "hk-2"]);
    expect(run({ building: "A", floors: ["A|2"] })).toEqual(["hk-2"]);
    expect(run({ floors: ["A|1"] })).toEqual(["hk-1", "hk-2"]);
    expect(run({ building: "B" })).toEqual([]);
  });

  it("filters and search combine, and say which one emptied the list", () => {
    const both = query(team(), { search: "ana", filters: { ...EMPTY_TEAM_FILTERS, attendance: "on_shift" } });
    expect(ids(both.visible)).toEqual(["hk-1"]);
    const searchEmptied = query(team(), { search: "zzz" });
    expect(searchEmptied).toMatchObject({ visible: [], emptyReason: "search", searching: true });
    const filtersEmptied = query(team(), { filters: { ...EMPTY_TEAM_FILTERS, attendance: "unknown" } });
    expect(filtersEmptied.emptyReason).toBe("filters");
    expect(query([]).emptyReason).toBeNull();
  });

  it("options only offer attendance states somebody is in, and capacity sort only with a reliable percentage", () => {
    const options = buildTeamFilterOptions(team());
    expect(options.attendance).toEqual(["on_shift", "on_break", "shift_ended"]);
    expect(options.capacitySort).toBe(true);
    expect(buildTeamFilterOptions(team({ settings: { status: "failed", error: new Error("x"), data: null, fetchedAt: null } as never })).capacitySort).toBe(false);
  });

  it("counts, chips and removing a chip", () => {
    const filters: TeamFilters = { attendance: "on_shift", workload: "has", building: "A", floors: ["A|1"] };
    expect(teamFilterCount(filters)).toBe(4);
    const options = buildTeamFilterOptions(team());
    const chips = buildTeamChips({ filters, sort: "name" }, options);
    expect(chips.map((chip) => chip.id)).toEqual(["attendance:on_shift", "workload:has", "building:A", "floor:A|1"]);
    const afterFloor = removeTeamChip({ filters, sort: "name" }, chips[3]);
    expect(afterFloor.filters.floors).toEqual([]);
    expect(removeTeamChip({ filters, sort: "name" }, chips[0]).filters.attendance).toBe("all");
  });
});

describe("sorting", () => {
  it("name A–Z is stable and puts unnamed people last", () => {
    const withUnnamed = team({ raw: [...board, rawRoom("301", "DIRTY", { assigned_to: "ghost", assignment_id: "a9" })] });
    expect(ids(sortTeam(withUnnamed, "name"))).toEqual(["hk-1", "hk-2", "hk-3", "ghost"]);
  });

  it("most available: working people first, then the least remaining work", () => {
    // hk-1 on shift (3 rooms), hk-2 on break (1 open), hk-3 ended: attendance outranks workload.
    expect(ids(sortTeam(team(), "available"))).toEqual(["hk-1", "hk-2", "hk-3"]);
    // Two people on shift: the one with less remaining work is more available.
    const both = team({ roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active")]) });
    expect(ids(sortTeam(both, "available")).slice(0, 2)).toEqual(["hk-2", "hk-1"]);
  });

  it("an idle person on shift is the most available of all", () => {
    const members = team({ roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-3", "active")]) });
    expect(ids(sortTeam(members, "available"))[0]).toBe("hk-3");
  });

  it("'most available' without a verified roster falls back to name — it never ranks unknown attendance", () => {
    expect(effectiveSort("available", false)).toBe("name");
    expect(effectiveSort("available", true)).toBe("available");
    expect(effectiveSort("most_rooms", false)).toBe("most_rooms");
    expect(query(team(), { sort: "available", rosterVerified: false }).sortUsed).toBe("name");
  });

  it("remaining workload: unknown totals are not treated as zero — complete totals come first in either direction", () => {
    // 101 has an estimate (30 min via room type); 'noest' has none, so hk-1's total is only a lower bound.
    const noEstimate = rawRoom("150", "DIRTY", { assigned_to: "hk-1", assignment_id: "n1", rooms: { id: "room-150", room_number: "150", floor: 1, building: "A", room_types: { code: "K" } } });
    const members = team({
      raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "p1" }), rawRoom("102", "DIRTY", { assigned_to: "hk-2", assignment_id: "p2" }), noEstimate],
    });
    const hk1 = members.find((member) => member.userId === "hk-1");
    expect(hk1?.load.minutes.minutesComplete).toBe(false);
    expect(ids(sortTeam(members, "least_remaining"))).toEqual(["hk-3", "hk-2", "hk-1"]);
    expect(ids(sortTeam(members, "most_remaining"))).toEqual(["hk-2", "hk-3", "hk-1"]);
  });

  it("most assigned and most completed rooms, with name as the tie-break", () => {
    expect(ids(sortTeam(team(), "most_rooms"))).toEqual(["hk-1", "hk-2", "hk-3"]);
    expect(ids(sortTeam(team(), "most_completed"))).toEqual(["hk-2", "hk-1", "hk-3"]);
  });

  it("capacity concern: reliable percentages high → low, then unknown last", () => {
    const heavy = team({
      raw: [
        ...Array.from({ length: 4 }, (_, index) => rawRoom(`40${index}`, "DIRTY", { assigned_to: "hk-2", assignment_id: `h${index}`, clean_type: "DEP" })),
        rawRoom("501", "DIRTY", { assigned_to: "hk-1", assignment_id: "z1", clean_type: "LIGHT" }),
      ],
    });
    expect(ids(sortTeam(heavy, "capacity"))).toEqual(["hk-2", "hk-1", "hk-3"]);
  });

  it("default state is 'most available' with no filters", () => {
    expect(DEFAULT_TEAM_VIEW_STATE.sort).toBe("available");
    expect(teamFilterCount(DEFAULT_TEAM_VIEW_STATE.filters)).toBe(0);
  });
});
