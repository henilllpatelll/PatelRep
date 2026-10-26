import { buildFilterOptions, isQuickActive, queueOf, runAssignmentQuery, toggleQuickView, type AssignmentQueryInput } from "@/lib/housekeeping/assignmentQuery";
import {
  DEFAULT_VIEW_STATE,
  buildActiveChips,
  buildHeaderMetrics,
  buildListItems,
  buildRoomCard,
  dataStateOf,
  describeSheetActions,
  freshnessNotices,
  operationalDateLabel,
  removeActiveChip,
  sectionOf,
  viewStateBadge,
  type AssignmentViewState,
  type CardContext,
} from "@/lib/housekeeping/assignmentRoomsView";
import { EMPTY_ASSIGNMENT_FILTERS } from "@/lib/housekeeping/assignmentQuery";
import { loadingSource } from "@/lib/housekeeping/supervisorSources";
import { makeTranslator } from "../helpers/i18n";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

const t = makeTranslator("en");
const FAILED = { status: "failed", failure: { kind: "error", status: 500 } } as const;
const TODAY_SOON = new Date(NOW + 90 * 60_000).toISOString();
const TODAY_PASSED = new Date(NOW - 60 * 60_000).toISOString();
const open = { allowed: true, blockedBy: null } as const;
const paused = { allowed: false, blockedBy: "offline" } as const;
const ctx = (gate: CardContext["gate"] = open): CardContext => ({ now: NOW, timeZone: ZONE, language: "en", gate, t });
const place = (number: string, floor: number, building: string) => ({ id: `r${number}`, room_number: number, floor, building, room_types: { code: "K", base_clean_minutes: 30 } });

/** A hotel that exercises every Rooms-tab rule. */
const raw = [
  rawRoom("101", "DIRTY", { clean_type: "DEP", clean_type_label: "Departure" }),
  rawRoom("102", "OCCUPIED", { fo_status: "OCC", assigned_to: "hk-1", assignment_id: "as-102", assignment_date: HOTEL_DATE, clean_type: "FULL", clean_type_label: "Stayover" }),
  rawRoom("103", "PICKUP", { assigned_to: "ghost-9", assignment_id: "as-103", clean_type: "LIGHT", clean_type_label: "Pickup" }),
  rawRoom("104", "IN_PROGRESS", { assigned_to: "hk-2", assignment_id: "as-104" }),
  rawRoom("105", "CLEAN", { assigned_to: "hk-2", assignment_id: "as-105" }),
  rawRoom("106", "INSPECTED"),
  rawRoom("107", "OOO"),
  rawRoom("108", "DIRTY", { dnd_flag: true }),
  rawRoom("109", "DIRTY", { checkin_time: TODAY_SOON, clean_type: "DEP", clean_type_label: "Departure" }),
  rawRoom("110", "DIRTY", { checkin_time: TODAY_PASSED, vip_flag: true }),
  rawRoom("201", "DIRTY", { priority: 2, rooms: place("201", 2, "B") }),
  rawRoom("202", "IN_PROGRESS", { rooms: place("202", 2, "B") }),
  rawRoom("203", "DIRTY", { do_not_service: true, rooms: place("203", 2, "B") }),
];
const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break")]) });
const queue = queueOf(model.rooms ?? []);
const byNumber = (number: string) => (model.rooms ?? []).find((entry) => entry.room.roomNumber === number)!;
const numbers = (list: readonly { room: { roomNumber: string } }[]) => list.map((entry) => entry.room.roomNumber);
const run = (patch: Partial<AssignmentQueryInput> = {}) =>
  runAssignmentQuery({ rooms: queue, search: "", filters: EMPTY_ASSIGNMENT_FILTERS, scope: "all", sort: "priority", ...patch });

describe("header metrics", () => {
  it("counts only what can be handed out now, and names the held-back rooms separately", () => {
    const metrics = buildHeaderMetrics(model);
    // Unassigned = unowned, to clean, nothing in the way: 101, 109, 110, 201 (203 declined and 108 DND are held back; 202 is under way).
    expect(metrics.unassigned).toBe(4);
    expect(metrics.blocked).toBe(2);
    expect(metrics.urgent).toBe(3);
    expect(metrics.onShift).toBe(1);
  });

  it("an unverifiable roster is unknown, never zero on shift", () => {
    const failed = assignmentsOf({ raw, roster: FAILED });
    expect(buildHeaderMetrics(failed).onShift).toBeNull();
    const loading = assignmentsOf({ raw, roster: loadingSource() });
    expect(buildHeaderMetrics(loading).onShift).toBeNull();
    // ...while a verified roster with nobody clocked in IS a real zero.
    expect(buildHeaderMetrics(assignmentsOf({ raw, roster: rosterOf([]) })).onShift).toBe(0);
  });

  it("an unknown board has no counts at all", () => {
    const earlier = assignmentsOf({ raw, boardDate: "2026-10-15" });
    expect(buildHeaderMetrics(earlier)).toEqual({ unassigned: null, blocked: null, onShift: null, urgent: null });
  });

  it("labels the hotel's operational date, not the phone's", () => {
    expect(operationalDateLabel(model, "en")).toBe("Friday, October 16");
    expect(operationalDateLabel(model, "es")?.toLowerCase()).toContain("octubre");
  });
});

describe("freshness", () => {
  it("only a verified board is live; every other state says what it is", () => {
    expect(dataStateOf({ kind: "ready", verifiedAt: NOW })).toBe("live");
    expect(dataStateOf({ kind: "stale", reason: "offline", verifiedAt: NOW, failure: null })).toBe("stale");
    expect(dataStateOf({ kind: "unavailable", cause: "error", failure: null })).toBe("unavailable");
    expect(dataStateOf({ kind: "previous_day", boardDate: "a", hotelDate: "b", verifiedAt: null })).toBe("previous_day");
  });

  it("a stale board and a failed auxiliary source each owe the supervisor a notice", () => {
    expect(freshnessNotices(model).map((notice) => notice.kind)).toEqual([]);
    const stale = assignmentsOf({ raw, fetchedAt: NOW - 60 * 60_000 });
    expect(freshnessNotices(stale).some((notice) => notice.kind === "not_live")).toBe(true);
    const noSettings = assignmentsOf({ raw, settings: FAILED });
    expect(freshnessNotices(noSettings).map((notice) => notice.key)).toContain("auxPartial");
    // A board that is not live already says nothing is current; the auxiliary notice would only repeat it.
    const both = assignmentsOf({ raw, fetchedAt: NOW - 60 * 60_000, settings: FAILED });
    expect(freshnessNotices(both).map((notice) => notice.kind)).toEqual(["not_live"]);
  });
});

describe("search", () => {
  it("matches room number, floor, building and the assigned person, case-insensitively and ignoring extra spaces", () => {
    expect(numbers(run({ search: "  10  " }).visible).slice(0, 3).every((n) => n.includes("10"))).toBe(true);
    expect(numbers(run({ search: "FLOOR 2" }).visible).sort()).toEqual(["201", "202", "203"]);
    expect(numbers(run({ search: "building b" }).visible).sort()).toEqual(["201", "202", "203"]);
    expect(numbers(run({ search: "ana torres" }).visible)).toEqual(["102"]);
    expect(numbers(run({ search: "  AnA   " }).visible)).toEqual(["102"]);
  });

  it("a room-number match outranks a match on another field", () => {
    // "2" is the room number prefix of 201-203 and also part of the floor/other text of others.
    const result = numbers(run({ search: "2", sort: "roomNumber" }).visible);
    expect(result.slice(0, 3)).toEqual(["201", "202", "203"]);
  });

  it("clearing the search restores the whole queue; an empty result says it was the search", () => {
    expect(run({ search: "" }).visible).toHaveLength(queue.length);
    const none = run({ search: "zzz" });
    expect(none.visible).toEqual([]);
    expect(none.emptyReason).toBe("search");
  });

  it("an assignee the staff list cannot name stays searchable by room and still counts as assigned", () => {
    const ghost = byNumber("103");
    expect(ghost.ownership.assigned).toBe(true);
    expect(ghost.ownership.name).toBeNull();
    expect(numbers(run({ search: "103" }).visible)).toEqual(["103"]);
  });
});

describe("filters", () => {
  it("offers only floors, buildings, cleaning types and statuses the rooms actually have", () => {
    const options = buildFilterOptions(queue);
    expect(options.buildings).toEqual(["A", "B"]);
    expect(options.floors.map((floor) => floor.key)).toEqual(["A|1", "B|2"]);
    expect(options.cleanTypes.map((type) => type.label)).toEqual(["Departure", "Pickup", "Stayover", null]);
    expect(options.statuses).toEqual(["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS"]);
    expect(options.hasVip).toBe(true);
    expect(options.hasDeadline).toBe(true);
    expect(buildFilterOptions(queueOf(assignmentsOf({ raw: [rawRoom("101", "DIRTY")] }).rooms ?? [])).hasVip).toBe(false);
  });

  it("combines: building + cleaning type + status + search narrow together, and clearing them restores everything", () => {
    const narrowed = run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A", cleanTypes: ["DEP"], statuses: ["DIRTY"] } });
    expect(numbers(narrowed.visible).sort()).toEqual(["101", "109"]);
    expect(numbers(run({ search: "109", filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A", cleanTypes: ["DEP"] } }).visible)).toEqual(["109"]);
    // Room 201 exists, but not in building A: the filters, not the search, leave nothing.
    expect(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A", cleanTypes: ["DEP"] }, search: "201" }).emptyReason).toBe("filters");
    expect(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A" }, search: "zzz" }).emptyReason).toBe("search");
    expect(run({ filters: EMPTY_ASSIGNMENT_FILTERS }).visible).toHaveLength(queue.length);
  });

  it("priority is its own axis: urgent, VIP and at-risk compose with the assignment scope", () => {
    expect(numbers(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "urgent" } }).visible).sort()).toEqual(["109", "110", "201"]);
    expect(numbers(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "vip" } }).visible)).toEqual(["110"]);
    expect(numbers(run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "at_risk" } }).visible)).toEqual(["110"]);
    const both = run({ scope: "unassigned", filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "urgent" } });
    expect(numbers(both.visible).sort()).toEqual(["109", "110", "201"]);
    expect(numbers(run({ scope: "assigned", filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "urgent" } }).visible)).toEqual([]);
  });

  it("the blocked scope is exactly the rooms held back", () => {
    expect(numbers(run({ scope: "blocked" }).visible).sort()).toEqual(["108", "203"]);
  });
});

describe("quick views", () => {
  const state = { scope: "all", priority: "any" } as const;

  it("Unassigned and Urgent toggle independently; All clears both", () => {
    const unassigned = toggleQuickView("unassigned", state);
    expect(unassigned).toEqual({ scope: "unassigned", priority: "any" });
    const both = toggleQuickView("urgent", unassigned);
    expect(both).toEqual({ scope: "unassigned", priority: "urgent" });
    expect(isQuickActive("unassigned", both) && isQuickActive("urgent", both)).toBe(true);
    expect(toggleQuickView("urgent", both)).toEqual({ scope: "unassigned", priority: "any" });
    expect(toggleQuickView("unassigned", both)).toEqual({ scope: "all", priority: "urgent" });
    expect(toggleQuickView("all", both)).toEqual({ scope: "all", priority: "any" });
    expect(isQuickActive("all", state)).toBe(true);
  });

  it("each chip's count is what pressing it would show, given everything else applied", () => {
    const result = run();
    // The Unassigned chip equals the header: 101, 109, 110 and 201 can be handed out; 108, 202 and 203 are held back.
    expect(result.quickCounts).toEqual({ all: queue.length, unassigned: 4, urgent: 3 });
    expect(result.quickCounts.unassigned).toBe(buildHeaderMetrics(model).unassigned);
    const withUrgent = run({ filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "urgent" } });
    // Pressing Unassigned while Urgent is applied shows urgent AND unassigned rooms.
    expect(withUrgent.quickCounts.unassigned).toBe(3);
    expect(withUrgent.quickCounts.all).toBe(queue.length);
  });
});

describe("default sort is the Phase 1 priority model", () => {
  it("highest tier first, then the earliest recorded arrival; nothing is ranked by invented urgency", () => {
    const order = numbers(run().visible);
    // 110 (arrival passed, high) · 201 (rush, high) · 109 (arrival soon, elevated) lead; routine rooms follow in room-number order.
    expect(order.slice(0, 3)).toEqual(["110", "201", "109"]);
    expect(order.slice(3)).toEqual([...order.slice(3)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });

  it("deadline sort puts recorded arrivals first, earliest first, and rooms without one last", () => {
    const order = numbers(run({ sort: "deadline" }).visible);
    expect(order.slice(0, 2)).toEqual(["110", "109"]);
  });

  it("a room with no recorded arrival has no deadline text", () => {
    expect(buildRoomCard(byNumber("101"), ctx()).deadline).toBeNull();
    expect(buildRoomCard(byNumber("109"), ctx()).deadline).toMatch(/^Guest arrives /);
    expect(buildRoomCard(byNumber("110"), ctx()).deadline).toMatch(/^Guest arrival passed/);
  });
});

describe("sections and cards", () => {
  it("groups by what the supervisor can do: urgent first, blocked rooms never mixed with actionable ones", () => {
    const items = buildListItems(run().visible, true);
    const headers = items.filter((item) => item.type === "section").map((item) => (item.type === "section" ? item.section : ""));
    expect(headers).toEqual(["urgent", "unassigned", "assigned", "blocked"]);
    expect(sectionOf(byNumber("108"))).toBe("blocked");
    expect(sectionOf(byNumber("203"))).toBe("blocked");
    // An unowned room already being cleaned cannot be handed out either.
    expect(sectionOf(byNumber("202"))).toBe("blocked");
    expect(sectionOf(byNumber("104"))).toBe("assigned");
    expect(sectionOf(byNumber("101"))).toBe("unassigned");
    expect(sectionOf(byNumber("201"))).toBe("urgent");
  });

  it("any other sort is one flat list", () => {
    expect(buildListItems(run({ sort: "roomNumber" }).visible, false).every((item) => item.type === "room")).toBe(true);
  });

  it("a blocked room offers 'View reason' and states why; it never offers Assign", () => {
    const dnd = buildRoomCard(byNumber("108"), ctx());
    expect(dnd.cta).toEqual({ kind: "view_reason", label: "View reason" });
    expect(dnd.blocker).toBe("Do not disturb");
    expect(buildRoomCard(byNumber("203"), ctx()).blocker).toBe("Guest declined service");
  });

  it("an unassigned, eligible room offers Assign — unless changes are paused", () => {
    expect(buildRoomCard(byNumber("101"), ctx()).cta.kind).toBe("assign");
    expect(buildRoomCard(byNumber("101"), ctx(paused)).cta).toEqual({ kind: "view", label: "View room" });
  });

  it("an assigned room with an unknown employee name stays assigned, and a room being cleaned is protected", () => {
    const ghost = buildRoomCard(byNumber("103"), ctx());
    expect(ghost.assignee.kind).toBe("unnamed");
    expect(ghost.assignee.text).toBe("Assigned · name unavailable");
    expect(ghost.cta.kind).toBe("view_assignment");
    const cleaning = buildRoomCard(byNumber("104"), ctx());
    expect(cleaning.assignee).toEqual({ kind: "named", text: "Ben Ortiz" });
    expect(cleaning.blocker).toBe("Being cleaned now");
    expect(cleaning.cta.kind).toBe("view_assignment");
  });

  it("never invents an estimate or a cleaning type", () => {
    const bare = assignmentsOf({ raw: [rawRoom("301", "DIRTY", { rooms: { id: "r301", room_number: "301", floor: 3, building: "B", room_types: { code: "Q" } } })] }).rooms![0];
    expect(bare.estimate).toBeNull();
    expect(buildRoomCard(bare, ctx()).detail).toBeNull();
    // ...while a room whose type configures minutes says so.
    expect(buildRoomCard(byNumber("201"), ctx()).detail).toBe("30 min estimated");
    const typed = buildRoomCard(byNumber("101"), ctx());
    expect(typed.detail).toMatch(/^Departure/);
    expect(typed.location).toBe("Floor 1 · Building A");
  });

  it("priority chips carry the recorded reason in words", () => {
    expect(buildRoomCard(byNumber("201"), ctx()).chips.map((chip) => chip.label)).toEqual(["Rush"]);
    expect(buildRoomCard(byNumber("110"), ctx()).chips.map((chip) => chip.label)).toEqual(["Arrival passed", "VIP"]);
  });
});

describe("room sheet actions come only from the eligibility rules", () => {
  it("an eligible unassigned room can be assigned; a held-back one only with review", () => {
    expect(describeSheetActions(byNumber("101"), open)).toMatchObject({ assign: "assign", reassign: false, remove: false, frozen: null });
    expect(describeSheetActions(byNumber("108"), open)).toMatchObject({ assign: "review_assign" });
  });

  it("an assigned, unstarted room can be reassigned or unassigned", () => {
    expect(describeSheetActions(byNumber("102"), open)).toMatchObject({ assign: null, reassign: true, remove: true });
  });

  it("a room being cleaned, submitted, inspected or out of service offers nothing", () => {
    const all = assignmentsOf({ raw }).rooms ?? [];
    for (const number of ["104", "105", "106", "107"]) {
      const entry = all.find((candidate) => candidate.room.roomNumber === number)!;
      expect(describeSheetActions(entry, open)).toMatchObject({ assign: null, reassign: false, remove: false });
      expect(describeSheetActions(entry, open).frozen).not.toBeNull();
    }
  });

  it("paused writes are reported so the sheet can disable its buttons", () => {
    expect(describeSheetActions(byNumber("101"), paused).paused).toBe(true);
  });
});

describe("view state", () => {
  it("quick-chip states do not count toward the filter badge; real filters and a non-default sort do", () => {
    expect(viewStateBadge(DEFAULT_VIEW_STATE)).toBe(0);
    expect(viewStateBadge({ ...DEFAULT_VIEW_STATE, scope: "unassigned", filters: { ...EMPTY_ASSIGNMENT_FILTERS, priority: "urgent" } })).toBe(0);
    expect(viewStateBadge({ ...DEFAULT_VIEW_STATE, filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A", priority: "vip" }, sort: "roomNumber" })).toBe(3);
  });

  it("every applied narrowing has a removable chip, and removing it restores that axis", () => {
    const options = buildFilterOptions(queue);
    const state: AssignmentViewState = {
      scope: "blocked",
      sort: "priority",
      filters: { ...EMPTY_ASSIGNMENT_FILTERS, building: "A", floors: ["A|1"], cleanTypes: ["DEP"], statuses: ["DIRTY"], priority: "vip" },
    };
    const chips = buildActiveChips(state, options);
    expect(chips.map((chip) => chip.kind)).toEqual(["scope", "priority", "building", "floor", "cleanType", "status"]);
    // Removing one chip restores only its own axis.
    expect(removeActiveChip(state, chips[0])).toEqual({ ...state, scope: "all" });
    expect(removeActiveChip(state, chips[2]).filters).toEqual({ ...state.filters, building: null });
    // Removing all of them restores the default view.
    expect(chips.reduce<AssignmentViewState>((current, chip) => removeActiveChip(current, chip), state)).toEqual({ ...state, scope: "all", filters: EMPTY_ASSIGNMENT_FILTERS });
  });

  it("a room is dropped from the queue only by the dataset rule, not by a filter", () => {
    expect(numbers(queue)).not.toContain("105");
    expect(numbers(queue)).not.toContain("106");
    expect(numbers(queue)).not.toContain("107");
  });
});
