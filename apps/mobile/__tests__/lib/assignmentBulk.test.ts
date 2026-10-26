import {
  MAX_BULK_SELECTION,
  addRooms,
  blockedIn,
  buildingGroups,
  bulkEligibility,
  floorGroups,
  removeRooms,
  roomsInScope,
  scopeState,
  selectableIn,
  selectionSummary,
  toggleRoom,
  toggleScope,
  totalMinutes,
} from "@/lib/housekeeping/assignmentBulk";
import { queueOf } from "@/lib/housekeeping/assignmentQuery";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import { bulkModel, entryOf, idsOf, room } from "../helpers/bulkFixtures";
import { assignmentsOf } from "../helpers/assignmentFixtures";

const model = bulkModel();
const rooms = model.rooms ?? [];
const numbers = (entries: { room: { roomNumber: string } }[]) => entries.map((entry) => entry.room.roomNumber).sort();

describe("which rooms can be selected", () => {
  it("is exactly Phase 1's autoAssignable: unowned, to clean, nothing soft in the way", () => {
    for (const entry of rooms) {
      expect(bulkEligibility(entry).selectable).toBe(entry.eligibility.autoAssignable);
    }
    expect(numbers(selectableIn(rooms))).toEqual(["101", "102", "103", "201", "202", "301", "302"]);
  });

  it.each([
    ["104", { kind: "soft", blocks: ["dnd"] }],
    ["105", { kind: "soft", blocks: ["service_declined"] }],
    ["106", { kind: "hard", block: "in_progress" }],
    ["107", { kind: "assigned", ownerName: "Ana Torres" }],
    ["108", { kind: "hard", block: "awaiting_inspection" }],
  ])("explains why room %s is excluded", (number, exclusion) => {
    expect(bulkEligibility(entryOf(model, number))).toEqual({ selectable: false, exclusion });
  });

  it("excludes out-of-service, return-later and discrepancy rooms", () => {
    const future = new Date(Date.parse("2026-10-16T17:00:00Z") + 3_600_000).toISOString();
    const odd = assignmentsOf({ raw: [room("101", "OOO"), room("102", "DIRTY", { dnd_retry_at: future }), room("103", "DIRTY", { occupancy_discrepancy: true }), room("104", "WEIRD")] });
    expect((odd.rooms ?? []).map((entry) => bulkEligibility(entry).exclusion?.kind)).toEqual(["hard", "soft", "soft", "hard"]);
    expect(selectableIn(odd.rooms ?? [])).toEqual([]);
  });

  it("counts as blocked only unowned rooms a supervisor must look at, not owned work", () => {
    expect(numbers(blockedIn(queueOf(rooms)))).toEqual(["104", "105", "106"]);
  });
});

describe("toggling and limits", () => {
  it("adds and removes one eligible room", () => {
    const first = toggleRoom(new Set(), entryOf(model, "101"));
    expect([...first.selected]).toEqual(["room-101"]);
    expect(first.refused).toBeUndefined();
    expect(toggleRoom(first.selected, entryOf(model, "101")).selected.size).toBe(0);
  });

  it("refuses an ineligible room and changes nothing", () => {
    const empty = new Set<string>();
    for (const number of ["104", "106", "107", "108"]) {
      const result = toggleRoom(empty, entryOf(model, number));
      expect(result.refused).toBe("not_selectable");
      expect(result.selected).toBe(empty);
    }
  });

  it("lets a selected room be removed even after it stopped being eligible", () => {
    const stale = new Set(["room-104"]);
    expect(toggleRoom(stale, entryOf(model, "104")).selected.size).toBe(0);
  });

  it("stops at the documented limit and says why", () => {
    expect(MAX_BULK_SELECTION).toBe(MAX_BATCH_CHANGES);
    const two = new Set(["room-101", "room-102"]);
    const refused = toggleRoom(two, entryOf(model, "103"), 2);
    expect(refused.refused).toBe("limit");
    expect(refused.selected).toBe(two);
    expect(toggleRoom(two, entryOf(model, "101"), 2).selected.size).toBe(1);
  });

  it("selecting many takes only eligible rooms, in priority order, up to the limit", () => {
    const all = addRooms(new Set(), rooms);
    expect(numbers(rooms.filter((entry) => all.selected.has(entry.room.roomId)))).toEqual(["101", "102", "103", "201", "202", "301", "302"]);
    expect(all.truncated).toBeUndefined();
    const capped = addRooms(new Set(), rooms, 3);
    expect(capped.selected.size).toBe(3);
    expect(capped.truncated).toBe(true);
    // The first three the MODEL ranks, not alphabetical or random.
    expect([...capped.selected]).toEqual(selectableIn(rooms).slice(0, 3).map((entry) => entry.room.roomId));
  });

  it("never adds an ineligible room however it is asked", () => {
    const added = addRooms(new Set(), [entryOf(model, "104"), entryOf(model, "106"), entryOf(model, "107")]);
    expect(added.selected.size).toBe(0);
  });

  it("removes rooms by id", () => {
    expect([...removeRooms(new Set(["a", "b", "c"]), ["b", "z"])]).toEqual(["a", "c"]);
  });
});

describe("floors and buildings", () => {
  const queue = queueOf(rooms);

  it("offers only floors that have a selectable room, read from the rooms themselves", () => {
    expect(floorGroups(queue).map((group) => [group.building, group.floor, group.eligible, group.total])).toEqual([
      ["A", 1, 3, 7], // 101 102 103 free; 104 105 106 107 held back or owned
      ["A", 2, 2, 2],
      ["B", 3, 2, 2],
    ]);
  });

  it("offers buildings only when the hotel has more than one", () => {
    expect(buildingGroups(queue).map((group) => [group.building, group.eligible])).toEqual([["A", 5], ["B", 2]]);
    const single = assignmentsOf({ raw: [room("101", "DIRTY"), room("201", "DIRTY")] });
    expect(buildingGroups(queueOf(single.rooms ?? []))).toEqual([]);
  });

  it("does not hard-code a floor or building: a hotel with different ones gets its own", () => {
    const odd = assignmentsOf({ raw: [room("1201", "DIRTY", { floor: 12, building: "Tower" }), room("1202", "DIRTY", { floor: 12, building: "Tower" }), room("501", "DIRTY", { floor: 5, building: "Annex" })] });
    expect(floorGroups(queueOf(odd.rooms ?? [])).map((group) => [group.building, group.floor, group.eligible])).toEqual([["Annex", 5, 1], ["Tower", 12, 2]]);
  });

  it("selecting a scope takes its eligible rooms only; pressing again clears them", () => {
    const floor2 = { kind: "floor", key: "A|2" } as const;
    const selected = toggleRoom(new Set(), entryOf(model, "101")).selected;
    expect(scopeState(queue, floor2, selected)).toBe("none");
    const one = toggleScope(selected, queue, floor2);
    expect([...one.selected].sort()).toEqual(["room-101", "room-201", "room-202"]);
    expect(scopeState(queue, floor2, one.selected)).toBe("all");
    const cleared = toggleScope(one.selected, queue, floor2);
    expect([...cleared.selected]).toEqual(["room-101"]); // the unrelated selection survives
  });

  it("a building scope never reaches rooms outside it, nor ineligible rooms inside", () => {
    const building = { kind: "building", building: "A" } as const;
    const all = toggleScope(new Set(), queue, building).selected;
    expect(numbers(roomsInScope(queue, building).filter((entry) => all.has(entry.room.roomId)))).toEqual(["101", "102", "103", "201", "202"]);
    expect(all.has("room-301")).toBe(false);
    expect(all.has("room-104")).toBe(false);
  });

  it("reports a partially selected scope as 'some'", () => {
    expect(scopeState(queue, { kind: "floor", key: "A|2" }, new Set(["room-201"]))).toBe("some");
  });

  it("a scope with the limit reached says it was truncated", () => {
    const result = toggleScope(new Set(), queue, { kind: "building", building: "A" }, 2);
    expect(result.selected.size).toBe(2);
    expect(result.truncated).toBe(true);
  });
});

describe("what a selection adds up to", () => {
  it("sums KNOWN estimates and never counts a missing one as zero", () => {
    const entries = ["101", "102", "103"].map((number) => entryOf(model, number));
    expect(totalMinutes(entries)).toEqual({ minutes: 60, partial: true, missing: 1 });
    expect(totalMinutes(entries.slice(0, 2))).toEqual({ minutes: 60, partial: false, missing: 0 });
    expect(totalMinutes([entries[2]])).toEqual({ minutes: null, partial: false, missing: 1 });
    expect(totalMinutes([])).toEqual({ minutes: null, partial: false, missing: 0 });
  });

  it("re-derives validity from the live model: a selected room that became ineligible is invalid, not silently dropped", () => {
    const selected = new Set(idsOf(["101", "102", "104", "999"]));
    const summary = selectionSummary(rooms, selected);
    expect(numbers(summary.valid)).toEqual(["101", "102"]);
    expect(summary.selectedCount).toBe(4);
    expect(summary.invalid).toEqual([
      { roomId: "room-104", roomNumber: "104", exclusion: { kind: "soft", blocks: ["dnd"] } },
      { roomId: "room-999", roomNumber: "", exclusion: null },
    ]);
    expect(summary.minutes).toEqual({ minutes: 60, partial: false, missing: 0 });
  });

  it("is unaffected by what the list is currently filtered to", () => {
    // A selection is ids: a room scrolled or filtered out of view is still counted and still validated.
    const summary = selectionSummary(rooms, new Set(idsOf(["301", "202"])));
    expect(numbers(summary.valid)).toEqual(["202", "301"]);
  });

  it("is empty-safe while the board is unknown", () => {
    expect(selectionSummary(null, new Set(["room-101"]))).toEqual({ selectedCount: 1, valid: [], invalid: [{ roomId: "room-101", roomNumber: "", exclusion: null }], minutes: { minutes: null, partial: false, missing: 0 } });
  });
});
