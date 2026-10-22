import { proposeAllocation } from "@/lib/housekeeping/assignmentAllocator";
import { selectableIn } from "@/lib/housekeeping/assignmentBulk";
import type { AssignmentRoom } from "@/lib/housekeeping/assignmentModel";
import { assignmentsOf } from "../helpers/assignmentFixtures";
import { bulkModel, everyoneOnShift, room } from "../helpers/bulkFixtures";

const pick = (model: ReturnType<typeof bulkModel>, numbers: string[]): AssignmentRoom[] =>
  numbers.map((number) => {
    const found = (model.rooms ?? []).find((entry) => entry.room.roomNumber === number);
    if (!found) throw new Error(number);
    return found;
  });
const numbersOf = (model: ReturnType<typeof bulkModel>, ids: string[]) => ids.map((id) => (model.rooms ?? []).find((entry) => entry.room.roomId === id)?.room.roomNumber).sort();

describe("one housekeeper", () => {
  it("gives every room to the chosen person", () => {
    const model = bulkModel();
    const rooms = pick(model, ["101", "102", "201"]);
    const proposal = proposeAllocation({ model, rooms, employeeIds: ["hk-3"], mode: "single" });
    expect(proposal.assignments).toEqual({ "room-101": "hk-3", "room-102": "hk-3", "room-201": "hk-3" });
    expect(proposal.shares).toEqual([{ userId: "hk-3", roomIds: ["room-101", "room-102", "room-201"] }]);
    expect(proposal.unallocated).toEqual([]);
  });

  it("uses only the first person when several are passed", () => {
    const model = bulkModel();
    const proposal = proposeAllocation({ model, rooms: pick(model, ["101"]), employeeIds: ["hk-2", "hk-3"], mode: "single" });
    expect(proposal.assignments).toEqual({ "room-101": "hk-2" });
  });

  it("never assigns to someone the verified staff list does not name, and says so", () => {
    const model = bulkModel();
    const proposal = proposeAllocation({ model, rooms: pick(model, ["101", "102"]), employeeIds: ["ghost"], mode: "single" });
    expect(proposal.assignments).toEqual({});
    expect(proposal.unresolved).toEqual(["ghost"]);
    expect(proposal.unallocated).toEqual(["room-101", "room-102"]);
  });

  it("is the staff list that decides: no staff list, no assignment", () => {
    const model = assignmentsOf({ raw: [room("101", "DIRTY")], staff: { status: "failed", error: "x", fetchedAt: null } as never });
    expect(proposeAllocation({ model, rooms: model.rooms ?? [], employeeIds: ["hk-1"], mode: "single" }).assignments).toEqual({});
  });
});

describe("across the team", () => {
  it("spreads equal rooms evenly", () => {
    const model = assignmentsOf({
      raw: ["101", "102", "103", "104", "105", "106"].map((number) => room(number, "DIRTY")),
      roster: everyoneOnShift(),
    });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2", "hk-3"], mode: "distribute" });
    expect(proposal.shares.map((share) => share.roomIds.length)).toEqual([2, 2, 2]);
  });

  it("starts from existing workload: someone already busy gets fewer new rooms", () => {
    const raw = [room("101", "DIRTY", { owner: "hk-1" }), room("102", "DIRTY", { owner: "hk-1" }), room("103", "DIRTY", { owner: "hk-1" }), ...["201", "202", "203", "204"].map((number) => room(number, "DIRTY"))];
    const model = assignmentsOf({ raw, roster: everyoneOnShift() });
    const rooms = selectableIn(model.rooms ?? []);
    const proposal = proposeAllocation({ model, rooms, employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    const shares = Object.fromEntries(proposal.shares.map((share) => [share.userId, share.roomIds.length]));
    expect(shares).toEqual({ "hk-1": 0, "hk-2": 4 }); // hk-1 already has 90 minutes; hk-2 has none
  });

  it("is deterministic: input order of rooms and people does not matter", () => {
    const model = bulkModel();
    const rooms = selectableIn(model.rooms ?? []);
    const a = proposeAllocation({ model, rooms, employeeIds: ["hk-1", "hk-2", "hk-3"], mode: "distribute" });
    const b = proposeAllocation({ model, rooms: [...rooms].reverse(), employeeIds: ["hk-3", "hk-1", "hk-2"], mode: "distribute" });
    const c = proposeAllocation({ model, rooms, employeeIds: ["hk-1", "hk-2", "hk-3"], mode: "distribute" });
    expect(c).toEqual(a);
    expect(b.assignments).toEqual(a.assignments);
  });

  it("does not hand everything to the first person", () => {
    const model = bulkModel();
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2", "hk-3"], mode: "distribute" });
    const counts = proposal.shares.map((share) => share.roomIds.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(7);
  });

  it("balances KNOWN minutes: one long room offsets several short ones", () => {
    const raw = [room("101", "DIRTY", { minutes: 60 }), room("102", "DIRTY", { minutes: 20 }), room("103", "DIRTY", { minutes: 20 }), room("104", "DIRTY", { minutes: 20 })];
    const model = assignmentsOf({ raw, roster: everyoneOnShift() });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    const minutes = proposal.shares.map((share) => numbersOf(model, share.roomIds).reduce((sum, number) => sum + (number === "101" ? 60 : 20), 0));
    expect(minutes.sort()).toEqual([60, 60]);
  });

  it("keeps people on the floor they are already working when loads are near-equal", () => {
    const raw = [
      room("101", "DIRTY", { owner: "hk-1" }), // hk-1 works floor 1 of building A
      room("301", "DIRTY", { owner: "hk-2", building: "B", floor: 3 }), // hk-2 works floor 3 of building B
      room("102", "DIRTY"),
      room("302", "DIRTY", { building: "B", floor: 3 }),
    ];
    const model = assignmentsOf({ raw, roster: everyoneOnShift() });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    expect(proposal.assignments).toEqual({ "room-102": "hk-1", "room-302": "hk-2" });
  });

  it("never counts a missing estimate as zero minutes, and reports how many are missing", () => {
    const raw = [room("101", "DIRTY", { minutes: 30 }), room("102", "DIRTY", { minutes: null }), room("103", "DIRTY", { minutes: null }), room("104", "DIRTY", { minutes: null })];
    const model = assignmentsOf({ raw, roster: everyoneOnShift() });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    expect(proposal.missingEstimates).toBe(3);
    // The 30-minute room goes to one person; the unknown-length rooms then go to the OTHER until counts even out.
    const byPerson = Object.fromEntries(proposal.shares.map((share) => [share.userId, numbersOf(model, share.roomIds)]));
    expect(byPerson["hk-1"].length).toBe(2);
    expect(byPerson["hk-2"].length).toBe(2);
  });

  it("places critical rooms first, so they go to the least-loaded person", () => {
    const raw = [room("101", "DIRTY", { owner: "hk-1" }), room("102", "DIRTY", { vip_flag: true }), room("103", "DIRTY")];
    const model = assignmentsOf({ raw, roster: everyoneOnShift() });
    const rooms = selectableIn(model.rooms ?? []);
    const proposal = proposeAllocation({ model, rooms, employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    expect(proposal.assignments["room-102"]).toBe("hk-2");
  });

  it("passes over a person a room would push past a REAL capacity limit while someone else can take it", () => {
    // Target 16 credits ("over" = more than 2 past it), DEP = 3 credits. hk-1 holds six short DEP rooms (18 credits,
    // only 60 minutes); a seventh would be 21. By minutes alone hk-1 is the lighter person - capacity must override.
    const owned = ["101", "102", "103", "104", "105", "106"].map((number) => room(number, "DIRTY", { owner: "hk-1", minutes: 10 }));
    const heavy = ["301", "302", "303"].map((number) => room(number, "DIRTY", { owner: "hk-2", minutes: 60, building: "B", floor: 3 }));
    const model = assignmentsOf({ raw: [...owned, ...heavy, room("201", "DIRTY")], roster: everyoneOnShift() });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    expect(proposal.assignments).toEqual({ "room-201": "hk-2" });
    // Control: the same hotel without the capacity problem (hk-1 owns five rooms) gives the room to the lighter hk-1.
    const lighter = assignmentsOf({ raw: [...owned.slice(0, 5), ...heavy, room("201", "DIRTY")], roster: everyoneOnShift() });
    expect(proposeAllocation({ model: lighter, rooms: selectableIn(lighter.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" }).assignments).toEqual({ "room-201": "hk-1" });
  });

  it("still allocates when everyone would exceed it: the review shows the warning, nothing is dropped", () => {
    const first = ["101", "102", "103", "104", "105", "106"].map((number) => room(number, "DIRTY", { owner: "hk-1" }));
    const second = ["301", "302", "303", "304", "305", "306"].map((number) => room(number, "DIRTY", { owner: "hk-2", building: "B", floor: 3 }));
    const model = assignmentsOf({ raw: [...first, ...second, room("201", "DIRTY")], roster: everyoneOnShift() });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    expect(Object.keys(proposal.assignments)).toEqual(["room-201"]);
    expect(proposal.unallocated).toEqual([]);
  });

  it("allocates with one person chosen too, and reports ids it cannot place", () => {
    const model = bulkModel();
    const proposal = proposeAllocation({ model, rooms: pick(model, ["101", "102"]), employeeIds: ["hk-2", "ghost", "hk-2"], mode: "distribute" });
    expect(proposal.assignments).toEqual({ "room-101": "hk-2", "room-102": "hk-2" });
    expect(proposal.unresolved).toEqual(["ghost"]);
    expect(proposal.shares).toEqual([{ userId: "hk-2", roomIds: ["room-101", "room-102"] }]);
  });

  it("with nobody chosen, allocates nothing and returns every room as unallocated", () => {
    const model = bulkModel();
    const proposal = proposeAllocation({ model, rooms: pick(model, ["101"]), employeeIds: [], mode: "distribute" });
    expect(proposal).toMatchObject({ assignments: {}, shares: [], unallocated: ["room-101"] });
  });

  it("does not use attendance to skip or favour anyone: the supervisor chose these people", () => {
    const model = assignmentsOf({
      raw: ["101", "102", "103", "104"].map((number) => room(number, "DIRTY")),
      roster: undefined, // no roster at all: attendance unknown for everybody
    });
    const proposal = proposeAllocation({ model, rooms: selectableIn(model.rooms ?? []), employeeIds: ["hk-1", "hk-2"], mode: "distribute" });
    expect(proposal.shares.map((share) => share.roomIds.length)).toEqual([2, 2]);
  });
});
