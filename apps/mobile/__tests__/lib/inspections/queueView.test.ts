import { buildQueue, type QueueItem } from "@/lib/inspections/queue";
import {
  DEFAULT_QUEUE_DRAFT,
  EMPTY_QUEUE_FILTERS,
  activeCount,
  buildAvailability,
  buildChips,
  cleanKindOf,
  compareLocation,
  floorKeyOf,
  matchesFilters,
  parseFloorKey,
  previewCount,
  priorityFacts,
  removeChip,
  selectQueue,
  sortQueue,
  unavailableApplied,
  type QueueContext,
  type QueueFilters,
  type QueueSort,
} from "@/lib/inspections/queueView";
import { readyRoom } from "../../helpers/inspectionFixtures";

const NOW = Date.parse("2026-10-20T18:00:00Z"); // 1:00 PM in Chicago
const ctx: QueueContext = { now: NOW, timeZone: "America/Chicago" };

/** Minutes before NOW, as an ISO string. */
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const at = (iso: string) => iso;

function queue(...rooms: ReturnType<typeof readyRoom>[]): QueueItem[] {
  return buildQueue(rooms);
}
const numbers = (items: readonly QueueItem[]) => items.map((item) => item.roomNumber);
const filters = (partial: Partial<QueueFilters>): QueueFilters => ({ ...EMPTY_QUEUE_FILTERS, ...partial });

describe("priority facts come only from recorded times", () => {
  it("an arrival later today is not overdue; one that has passed is", () => {
    const [soon, passed] = queue(
      readyRoom("a", { arrival_at: at("2026-10-20T20:00:00Z") }),
      readyRoom("b", { arrival_at: at("2026-10-20T16:00:00Z") }),
    );
    expect(priorityFacts(soon, ctx)).toMatchObject({ arrivalUpcoming: true, overdue: false });
    expect(priorityFacts(passed, ctx)).toMatchObject({ arrivalPassed: true, overdue: true });
  });

  it("an arrival left over from another day is ignored, not read as overdue", () => {
    const [stale, tomorrow] = queue(
      readyRoom("a", { arrival_at: "2026-10-19T15:00:00Z" }),
      readyRoom("b", { arrival_at: "2026-10-21T15:00:00Z" }),
    );
    expect(priorityFacts(stale, ctx)).toMatchObject({ arrivalTodayMs: null, overdue: false });
    expect(priorityFacts(tomorrow, ctx)).toMatchObject({ arrivalTodayMs: null, overdue: false });
  });

  it("the hotel's day, not the phone's: 1 AM UTC is still yesterday in Chicago", () => {
    const [item] = queue(readyRoom("a", { arrival_at: "2026-10-21T01:00:00Z" })); // 8 PM Oct 20 in Chicago
    expect(priorityFacts(item, ctx).arrivalUpcoming).toBe(true);
  });

  it("VIP is a flag, not urgency; an unsent flag is unknown, not 'not VIP'", () => {
    const [vip, plain, unknown] = queue(readyRoom("a", { vip: true }), readyRoom("b", { vip: false }), readyRoom("c"));
    expect(priorityFacts(vip, ctx)).toMatchObject({ vip: true, overdue: false });
    expect(priorityFacts(plain, ctx).vip).toBe(false);
    expect(unknown.vip).toBeNull();
  });

  it("only a stored priority below the default 5 is elevated", () => {
    const [high, normal, none] = queue(readyRoom("a", { priority: 2 }), readyRoom("b", { priority: 5 }), readyRoom("c", { priority: null }));
    expect(priorityFacts(high, ctx).elevatedPriority).toBe(2);
    expect(priorityFacts(normal, ctx).elevatedPriority).toBeNull();
    expect(priorityFacts(none, ctx).elevatedPriority).toBeNull();
  });

  it("a needed-by time that has passed today is overdue", () => {
    const [late] = queue(readyRoom("a", { priority_needed_by: "2026-10-20T17:00:00Z" }));
    expect(priorityFacts(late, ctx)).toMatchObject({ neededByPassed: true, overdue: true });
  });
});

describe("priority-first order", () => {
  const failure = { inspection_id: "i", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean" as const, items: [] };

  it("overdue → elevated priority → arrival today → reinspection → VIP → longest waiting", () => {
    const items = queue(
      readyRoom("long-wait", { room_number: "110", cleaned_at: ago(120) }),
      readyRoom("vip", { room_number: "111", vip: true, cleaned_at: ago(10) }),
      readyRoom("reinspect", { room_number: "112", previous_failure: failure, cleaned_at: ago(10) }),
      readyRoom("arrival", { room_number: "113", arrival_at: "2026-10-20T22:00:00Z", cleaned_at: ago(10) }),
      readyRoom("elevated", { room_number: "114", priority: 1, cleaned_at: ago(10) }),
      readyRoom("overdue", { room_number: "115", arrival_at: "2026-10-20T15:00:00Z", cleaned_at: ago(5) }),
    );
    expect(numbers(sortQueue(items, "priority", ctx))).toEqual(["115", "114", "113", "112", "111", "110"]);
  });

  it("an arrival later today does not outrank an explicit urgent priority", () => {
    const items = queue(readyRoom("a", { room_number: "101", arrival_at: "2026-10-20T22:00:00Z" }), readyRoom("b", { room_number: "102", priority: 3 }));
    expect(numbers(sortQueue(items, "priority", ctx))).toEqual(["102", "101"]);
  });

  it("earlier arrivals come first, and rooms with no arrival come after those with one", () => {
    const items = queue(
      readyRoom("a", { room_number: "101" }),
      readyRoom("b", { room_number: "102", arrival_at: "2026-10-20T23:00:00Z" }),
      readyRoom("c", { room_number: "103", arrival_at: "2026-10-20T20:00:00Z" }),
    );
    expect(numbers(sortQueue(items, "priority", ctx))).toEqual(["103", "102", "101"]);
  });

  it("unknown clean times sort last among otherwise equal rooms, never first as '0 minutes'", () => {
    const items = queue(readyRoom("a", { room_number: "101", cleaned_at: null }), readyRoom("b", { room_number: "102", cleaned_at: ago(30) }));
    expect(numbers(sortQueue(items, "priority", ctx))).toEqual(["102", "101"]);
    expect(numbers(sortQueue(items, "waiting", ctx))).toEqual(["102", "101"]);
  });

  it("is deterministic: any input order gives the same result, and equal rooms fall back to location then id", () => {
    const rooms = [
      readyRoom("z", { room_number: "201", floor: 2 }),
      readyRoom("y", { room_number: "201", floor: 2 }),
      readyRoom("x", { room_number: "101", floor: 1 }),
    ];
    const forward = sortQueue(queue(...rooms), "priority", ctx).map((i) => i.roomId);
    const backward = sortQueue(queue(...[...rooms].reverse()), "priority", ctx).map((i) => i.roomId);
    expect(forward).toEqual(backward);
    expect(forward).toEqual(["x", "y", "z"]);
  });
});

describe("the other sorts", () => {
  const rooms = queue(
    readyRoom("a", { room_number: "1002", floor: 10, cleaned_at: ago(5) }),
    readyRoom("b", { room_number: "205", floor: 2, cleaned_at: ago(50) }),
    readyRoom("c", { room_number: "2A", floor: 2, cleaned_at: ago(20) }),
    readyRoom("d", { room_number: "99", floor: 1, cleaned_at: ago(35) }),
  );

  it("longest waiting first", () => {
    expect(numbers(sortQueue(rooms, "waiting", ctx))).toEqual(["205", "99", "2A", "1002"]);
  });

  it("room number is natural: numeric where numeric, alphanumeric kept sane", () => {
    expect(numbers(sortQueue(rooms, "room", ctx))).toEqual(["2A", "99", "205", "1002"]);
  });

  it("floor sorts by floor number, not as text (2 before 10)", () => {
    expect(numbers(sortQueue(rooms, "floor", ctx))).toEqual(["99", "2A", "205", "1002"]);
  });

  it("does not mutate its input", () => {
    const before = numbers(rooms);
    sortQueue(rooms, "waiting", ctx);
    expect(numbers(rooms)).toEqual(before);
  });

  it("two rooms with the same number in different buildings stay distinct and ordered by building", () => {
    const items = queue(readyRoom("b-101", { room_number: "101", building: "B" }), readyRoom("a-101", { room_number: "101", building: "A" }));
    expect(sortQueue(items, "room", ctx).map((i) => i.roomId)).toEqual(["a-101", "b-101"].sort((x, y) => x.localeCompare(y)));
    expect(items.map((i) => i.roomId).sort()).toEqual(["a-101", "b-101"]);
    expect(compareLocation(items.find((i) => i.roomId === "a-101")!, items.find((i) => i.roomId === "b-101")!)).toBeLessThan(0);
  });
});

describe("availability: a filter with no data behind it is disabled, not a false zero", () => {
  it("arrival, VIP and overdue need recorded data", () => {
    const none = buildAvailability(queue(readyRoom("a")));
    expect(none.priority).toEqual({ arrival: false, vip: false, overdue: false });
    const some = buildAvailability(queue(readyRoom("a", { arrival_at: "2026-10-20T20:00:00Z", vip: false })));
    expect(some.priority).toEqual({ arrival: true, vip: true, overdue: true });
  });

  it("an empty VIP list is still available when the server reports the flag", () => {
    expect(buildAvailability(queue(readyRoom("a", { vip: false }))).priority.vip).toBe(true);
  });

  it("departure and stayover come from the clean type; unknown types enable neither", () => {
    expect(buildAvailability(queue(readyRoom("a", { clean_type: "DEP" }))).clean).toEqual({ departure: true, stayover: false });
    expect(buildAvailability(queue(readyRoom("a", { clean_type: "FULL" }), readyRoom("b", { clean_type: "LIGHT" }))).clean).toEqual({ departure: false, stayover: true });
    expect(buildAvailability(queue(readyRoom("a", { clean_type: "???" }), readyRoom("b", { clean_type: null }))).clean).toEqual({ departure: false, stayover: false });
    expect(cleanKindOf("dep")).toBe("departure");
    expect(cleanKindOf(null)).toBeNull();
  });

  it("floors are real building/floor identities, sorted, and mark a multi-building hotel", () => {
    const single = buildAvailability(queue(readyRoom("a", { floor: 10 }), readyRoom("b", { floor: 2 }), readyRoom("c", { floor: 2 })));
    expect(single.floors.map((f) => f.floor)).toEqual([2, 10]);
    expect(single.multiBuilding).toBe(false);
    const multi = buildAvailability(queue(readyRoom("a", { floor: 2, building: "B" }), readyRoom("b", { floor: 2, building: "A" }), readyRoom("c", { floor: 1, building: "B" })));
    expect(multi.multiBuilding).toBe(true);
    expect(multi.floors.map((f) => f.key)).toEqual(["A|2", "B|1", "B|2"]);
  });

  it("floor keys round-trip", () => {
    const [item] = queue(readyRoom("a", { floor: 3, building: "East" }));
    expect(parseFloorKey(floorKeyOf(item))).toEqual({ building: "East", floor: 3 });
    const [bare] = queue(readyRoom("b", { floor: null }));
    expect(parseFloorKey(floorKeyOf(bare))).toEqual({ building: null, floor: null });
  });

  it("an applied filter whose data disappeared is reported and not applied", () => {
    const items = queue(readyRoom("a"), readyRoom("b"));
    const availability = buildAvailability(items);
    const applied = filters({ priority: ["vip"], clean: ["departure"] });
    expect(unavailableApplied(applied, availability)).toEqual(["priority:vip"]);
    expect(items.every((item) => matchesFilters(item, filters({ priority: ["vip"] }), availability, ctx))).toBe(true); // ignored, so nothing is hidden
  });
});

describe("filters: OR inside a category, AND across categories", () => {
  const items = queue(
    readyRoom("a", { room_number: "201", floor: 2, vip: true, clean_type: "DEP", arrival_at: "2026-10-20T20:00:00Z" }),
    readyRoom("b", { room_number: "202", floor: 2, vip: false, clean_type: "LIGHT", arrival_at: "2026-10-20T15:00:00Z" }),
    readyRoom("c", { room_number: "301", floor: 3, vip: true, clean_type: "DEP" }),
    readyRoom("d", { room_number: "302", floor: 3, vip: false, clean_type: "FULL", previous_failure: { inspection_id: "i", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean", items: [] } }),
  );
  const availability = buildAvailability(items);
  const shown = (f: QueueFilters) => numbers(sortQueue(items.filter((item) => matchesFilters(item, f, availability, ctx)), "room", ctx));

  it("several priority filters widen (OR)", () => {
    expect(shown(filters({ priority: ["vip", "overdue"] }))).toEqual(["201", "202", "301"]);
    expect(shown(filters({ priority: ["overdue"] }))).toEqual(["202"]);
    expect(shown(filters({ priority: ["arrival"] }))).toEqual(["201", "202"]);
  });

  it("several floors widen (OR)", () => {
    expect(shown(filters({ floors: ["~|2", "~|3"] }))).toEqual(["201", "202", "301", "302"]);
    expect(shown(filters({ floors: ["~|3"] }))).toEqual(["301", "302"]);
  });

  it("different categories narrow (AND)", () => {
    expect(shown(filters({ priority: ["vip"], floors: ["~|3"] }))).toEqual(["301"]);
    expect(shown(filters({ priority: ["vip"], floors: ["~|3"], clean: ["stayover"] }))).toEqual([]);
  });

  it("initial vs reinspection, and departure vs stayover, are separate questions that combine with AND", () => {
    expect(shown(filters({ review: ["reinspection"] }))).toEqual(["302"]);
    expect(shown(filters({ review: ["initial"] }))).toEqual(["201", "202", "301"]);
    expect(shown(filters({ review: ["initial", "reinspection"] }))).toEqual(["201", "202", "301", "302"]);
    expect(shown(filters({ clean: ["departure"] }))).toEqual(["201", "301"]);
    expect(shown(filters({ clean: ["stayover"] }))).toEqual(["202", "302"]);
    expect(shown(filters({ review: ["initial"], clean: ["stayover"] }))).toEqual(["202"]);
  });

  it("a room with an unknown clean type matches neither departure nor stayover", () => {
    const odd = queue(readyRoom("x", { clean_type: null }), readyRoom("y", { clean_type: "DEP" }));
    const av = buildAvailability(odd);
    expect(odd.filter((i) => matchesFilters(i, filters({ clean: ["departure"] }), av, ctx)).map((i) => i.roomId)).toEqual(["y"]);
  });
});

describe("search, the shown list, and counts", () => {
  const items = queue(
    readyRoom("a", { room_number: "112", floor: 1, cleaned_at: ago(10), cleaned_by: "Maria" }),
    readyRoom("b", { room_number: "211", floor: 2, cleaned_at: ago(30) }),
    readyRoom("c", { room_number: "11", floor: 1, cleaned_at: ago(20) }),
    readyRoom("d", { room_number: "2A", floor: 2, cleaned_at: ago(5) }),
  );
  const availability = buildAvailability(items);
  const select = (search: string, f: QueueFilters = EMPTY_QUEUE_FILTERS, sort: QueueSort = "priority") =>
    selectQueue({ items, availability, filters: f, sort, search, ctx });

  it("ranks exact, then prefix, then contains, case- and space-insensitively", () => {
    expect(numbers(select("11").shown)).toEqual(["11", "112", "211"]);
    expect(numbers(select("  2a ").shown)).toEqual(["2A"]);
    expect(numbers(select("2 A").shown)).toEqual(["2A"]);
  });

  it("searches room numbers only: a housekeeper's name never matches", () => {
    expect(select("maria").shown).toEqual([]);
  });

  it("an empty or whitespace query keeps everything in the chosen order", () => {
    expect(select("   ").shown).toHaveLength(4);
    expect(numbers(select("", EMPTY_QUEUE_FILTERS, "waiting").shown)).toEqual(["211", "11", "112", "2A"]);
  });

  it("each search rank keeps the chosen sort", () => {
    const two = queue(readyRoom("p", { room_number: "112", cleaned_at: ago(10) }), readyRoom("q", { room_number: "113", cleaned_at: ago(40) }), readyRoom("r", { room_number: "311", cleaned_at: ago(90) }));
    const av = buildAvailability(two);
    const byWaiting = selectQueue({ items: two, availability: av, filters: EMPTY_QUEUE_FILTERS, sort: "waiting", search: "11", ctx });
    expect(numbers(byWaiting.shown)).toEqual(["113", "112", "311"]); // the two prefix matches by wait, then the contains match
    const byRoom = selectQueue({ items: two, availability: av, filters: EMPTY_QUEUE_FILTERS, sort: "room", search: "11", ctx });
    expect(numbers(byRoom.shown)).toEqual(["112", "113", "311"]);
  });

  it("counts come from one snapshot: filtered count is before search, shown is after both", () => {
    const result = select("11", filters({ floors: ["~|1"] }));
    expect(result.totalCount).toBe(4);
    expect(result.filteredCount).toBe(2);
    expect(numbers(result.shown)).toEqual(["11", "112"]);
  });

  it("a filter that matches nothing is a verified zero, distinct from an unavailable queue", () => {
    const result = select("", filters({ floors: ["~|9"] }));
    expect(result.shown).toEqual([]);
    expect(result.totalCount).toBe(4);
  });

  it("the drawer's 'Show N rooms' is exactly what applying the draft would list, search included", () => {
    const draft = { filters: filters({ floors: ["~|1"] }), sort: "room" as const };
    const count = previewCount({ items, availability, search: "11", ctx, draft });
    expect(count).toBe(select("11", draft.filters, "room").shown.length);
    expect(count).toBe(2);
  });
});

describe("chips and the active count", () => {
  it("one chip per applied filter, removable one at a time", () => {
    const applied = filters({ priority: ["vip", "overdue"], floors: ["A|2"], review: ["reinspection"], clean: ["stayover"] });
    const chips = buildChips(applied);
    expect(chips.map((chip) => chip.id)).toEqual(["priority:vip", "priority:overdue", "floor:A|2", "review:reinspection", "clean:stayover"]);
    let rest = applied;
    for (const chip of chips) rest = removeChip(rest, chip);
    expect(rest).toEqual(EMPTY_QUEUE_FILTERS);
    expect(removeChip(applied, chips[0]).priority).toEqual(["overdue"]);
  });

  it("the filter badge counts filters plus a non-default sort", () => {
    expect(activeCount(DEFAULT_QUEUE_DRAFT)).toBe(0);
    expect(activeCount({ filters: filters({ floors: ["~|2"], priority: ["vip"] }), sort: "priority" })).toBe(2);
    expect(activeCount({ filters: EMPTY_QUEUE_FILTERS, sort: "room" })).toBe(1);
  });
});

describe("performance with a large hotel", () => {
  it("filters, sorts and searches several hundred rooms well inside a frame budget", () => {
    const rooms = Array.from({ length: 600 }, (_, n) =>
      readyRoom(`r${n}`, { room_number: String(100 + n), floor: 1 + (n % 12), vip: n % 7 === 0, arrival_at: n % 5 === 0 ? "2026-10-20T20:00:00Z" : null, cleaned_at: ago(n % 240), clean_type: n % 2 ? "DEP" : "FULL" }),
    );
    const items = buildQueue(rooms);
    const availability = buildAvailability(items);
    const start = Date.now();
    for (let n = 0; n < 20; n += 1) selectQueue({ items, availability, filters: filters({ priority: ["vip", "arrival"], floors: ["~|3", "~|4"] }), sort: "priority", search: "1", ctx });
    expect((Date.now() - start) / 20).toBeLessThan(25);
  });
});
