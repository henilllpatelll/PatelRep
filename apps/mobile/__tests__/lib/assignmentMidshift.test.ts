import {
  availableTeamIds,
  buildDestinations,
  buildMidshiftSource,
  defaultSelection,
  diffSeen,
  draftOverlap,
  hasChanges,
  midshiftChangesIn,
  planMidshift,
  recoveryAction,
  selectAllMovable,
  summarizeSelection,
  takeSeen,
  toggleRoom,
} from "@/lib/housekeeping/assignmentMidshift";
import { emptyDraft, stageChange, toSaveRequests, type PlannedChange } from "@/lib/housekeeping/assignmentPlan";
import { toBatchRequest } from "@/lib/housekeeping/assignmentBatch";
import { assignmentsOf, rosterOf, rosterRow } from "../helpers/assignmentFixtures";
import { room } from "../helpers/bulkFixtures";
import { HOTEL_DATE, anaEnded, idsOf, midshiftBoard, midshiftModel, numbersOfIds } from "../helpers/midshiftFixtures";

const SCOPE = "scope-1";
const MOVABLE = ["301", "302", "303", "304", "305", "306"];

function sourceOf(model = midshiftModel(), userId = "hk-1") {
  const source = buildMidshiftSource(model, userId);
  if (!source) throw new Error("no source");
  return source;
}

describe("the source's day", () => {
  it("counts nine owned rooms and protects started, finished and held-back work", () => {
    const { counts } = sourceOf();
    expect(counts).toMatchObject({ assigned: 12, completed: 2, inProgress: 1, eligible: 6, held: 2, notStarted: 8, other: 1, protectedRooms: 3 });
  });

  it("classifies each room by the Phase 1 eligibility", () => {
    const kinds = Object.fromEntries(sourceOf().rooms.map((r) => [r.roomNumber, r.class.kind]));
    expect(kinds).toMatchObject({ "301": "eligible", "307": "in_progress", "308": "completed", "309": "completed", "310": "held", "311": "held", "312": "unavailable" });
  });

  it("only eligible rooms are movable", () => {
    expect(sourceOf().rooms.filter((r) => r.movable).map((r) => r.roomNumber).sort()).toEqual(MOVABLE);
  });

  it("adds up the known estimates of the movable rooms", () => {
    expect(sourceOf().eligibleMinutes).toEqual({ minutes: 170, partial: false, missing: 0 });
  });

  it("keeps an estimate that is missing unknown rather than zero", () => {
    const raw = [room("301", "DIRTY", { owner: "hk-1", minutes: 30 }), room("302", "DIRTY", { owner: "hk-1", minutes: null })];
    const model = assignmentsOf({ raw, roster: anaEnded() });
    expect(buildMidshiftSource(model, "hk-1")?.eligibleMinutes).toEqual({ minutes: 30, partial: true, missing: 1 });
  });

  it("is null when the board is unknown or the person is not on it", () => {
    expect(buildMidshiftSource(midshiftModel(), "nobody")).toBeNull();
    const failed = assignmentsOf({ raw: midshiftBoard(), boardDate: "2020-01-01" });
    expect(buildMidshiftSource(failed, "hk-1")).toBeNull();
  });

  it("names the verified reason for attention", () => {
    expect(sourceOf().attention).toBe("shift_ended");
    const light = assignmentsOf({ raw: [room("301", "DIRTY", { owner: "hk-1" }), room("302", "DIRTY", { owner: "hk-1" })], roster: rosterOf([rosterRow("hk-1", "active")]) });
    expect(buildMidshiftSource(light, "hk-1")?.attention).toBeNull();
    // Twelve rooms against a 16-credit target is a real, evidenced overload even for someone working normally.
    const heavy = assignmentsOf({ raw: midshiftBoard(), roster: rosterOf([rosterRow("hk-1", "active")]) });
    expect(buildMidshiftSource(heavy, "hk-1")?.attention).toBe("overloaded");
  });

  it("an employee on break keeps their assignments and raises no recovery concern", () => {
    const model = assignmentsOf({ raw: midshiftBoard(), roster: rosterOf([rosterRow("hk-1", "on_break"), rosterRow("hk-2", "active")]) });
    const source = buildMidshiftSource(model, "hk-1");
    expect(source?.member.attendance).toBe("on_break");
    expect(source?.attention).not.toBe("shift_ended");
    expect(source?.attention).not.toBe("not_clocked_in");
    expect(source?.counts.eligible).toBe(6);
  });

  it("a scheduled person who is not verified clocked in is only 'not clocked in' when the roster answered", () => {
    const unverified = assignmentsOf({ raw: midshiftBoard(), roster: { status: "failed", error: "x", fetchedAt: null } as never });
    const source = buildMidshiftSource(unverified, "hk-1");
    expect(source?.member.attendance).toBe("unknown");
    expect(source?.attention).not.toBe("not_clocked_in");
    const verified = assignmentsOf({ raw: midshiftBoard(), roster: rosterOf([rosterRow("hk-2", "active")]) });
    expect(buildMidshiftSource(verified, "hk-1")?.attention).toBe("not_clocked_in");
  });

  it("an unlisted owner (no profile) can still be recovered", () => {
    const raw = [room("301", "DIRTY", { owner: "ghost" }), room("302", "DIRTY", { owner: "ghost" })];
    const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-2", "active")]) });
    const source = buildMidshiftSource(model, "ghost");
    expect(source?.member.listed).toBe(false);
    expect(source?.name).toBeNull();
    expect(source?.counts.eligible).toBe(2);
  });
});

describe("the drawer action", () => {
  it("is available when something can move", () => {
    const action = recoveryAction(midshiftModel(), "hk-1");
    expect(action.kind).toBe("available");
  });

  it("explains a person with nothing assigned", () => {
    expect(recoveryAction(midshiftModel(), "hk-3")).toMatchObject({ kind: "available" });
    const model = assignmentsOf({ raw: [room("101", "DIRTY")], roster: anaEnded() });
    expect(recoveryAction(model, "hk-1")).toMatchObject({ kind: "unavailable", reason: "nothing_assigned" });
  });

  it("explains a person whose remaining work is all started or finished", () => {
    const raw = [room("101", "IN_PROGRESS", { owner: "hk-1" }), room("102", "INSPECTED", { owner: "hk-1" })];
    expect(recoveryAction(assignmentsOf({ raw, roster: anaEnded() }), "hk-1")).toMatchObject({ kind: "unavailable", reason: "nothing_unstarted" });
  });

  it("explains a person whose unstarted rooms are all held back", () => {
    const raw = [room("101", "DIRTY", { owner: "hk-1", dnd_flag: true })];
    expect(recoveryAction(assignmentsOf({ raw, roster: anaEnded() }), "hk-1")).toMatchObject({ kind: "unavailable", reason: "all_held" });
  });

  it("is unavailable, with a reason, while the board is unknown", () => {
    const failed = assignmentsOf({ raw: midshiftBoard(), boardDate: "2020-01-01" });
    expect(recoveryAction(failed, "hk-1")).toMatchObject({ kind: "unavailable", reason: "board_unavailable" });
  });
});

describe("selection", () => {
  it("starts with every movable room selected when the shift ended", () => {
    expect([...defaultSelection(sourceOf())].sort()).toEqual(idsOf(MOVABLE));
  });

  it("starts empty for someone who is working: the supervisor chooses", () => {
    const model = assignmentsOf({ raw: midshiftBoard(), roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active")]) });
    expect(defaultSelection(sourceOf(model)).size).toBe(0);
  });

  it("'select all' never includes protected, held-back or out-of-service rooms", () => {
    const all = selectAllMovable(sourceOf());
    for (const protectedRoom of ["307", "308", "309", "310", "311", "312"]) expect(all.has(`room-${protectedRoom}`)).toBe(false);
    expect(all.size).toBe(6);
  });

  it("refuses a protected room and says why", () => {
    const source = sourceOf();
    expect(toggleRoom(new Set(), source, "room-307")).toEqual({ selected: new Set(), refused: "not_movable" });
    expect(toggleRoom(new Set(), source, "room-310").refused).toBe("not_movable");
  });

  it("refuses a room the person does not own (another property's id included)", () => {
    expect(toggleRoom(new Set(), sourceOf(), "room-401").refused).toBe("not_owned");
    expect(toggleRoom(new Set(), sourceOf(), "other-hotel-room").refused).toBe("not_owned");
  });

  it("adds and removes a movable room", () => {
    const source = sourceOf();
    const added = toggleRoom(new Set(), source, "room-301");
    expect([...added.selected]).toEqual(["room-301"]);
    expect(toggleRoom(added.selected, source, "room-301").selected.size).toBe(0);
  });

  it("totals the selection from the live model", () => {
    const summary = summarizeSelection(midshiftModel(), "hk-1", new Set(idsOf(["301", "303"])));
    expect(summary.valid.map((r) => r.roomNumber)).toEqual(["301", "303"]);
    expect(summary.minutes).toEqual({ minutes: 45, partial: false, missing: 0 });
    expect(summary.invalid).toEqual([]);
  });

  it("a selected room that started, moved or left is invalid and never sent", () => {
    const board = midshiftBoard().map((raw) => {
      if (raw.rooms?.room_number === "301") return { ...raw, status: "IN_PROGRESS" };
      if (raw.rooms?.room_number === "302") return { ...raw, assigned_to: "hk-2" };
      return raw;
    });
    const live = assignmentsOf({ raw: board.filter((raw) => raw.rooms?.room_number !== "303"), roster: anaEnded() });
    const summary = summarizeSelection(live, "hk-1", new Set(idsOf(["301", "302", "303", "304"])));
    expect(summary.valid.map((r) => r.roomNumber)).toEqual(["304"]);
    expect(Object.fromEntries(summary.invalid.map((entry) => [entry.roomId, entry.problem]))).toEqual({
      "room-301": "started",
      "room-302": "reassigned",
      "room-303": "gone",
    });
  });
});

describe("who can receive", () => {
  it("never includes the person the work leaves", () => {
    const model = midshiftModel();
    const rooms = sourceOf(model).rooms.filter((r) => r.movable).map((r) => r.entry);
    const ids = buildDestinations(model, "hk-1", rooms).map((d) => d.userId);
    expect(ids).toEqual(["hk-2", "hk-3"]);
  });

  it("the available team is verified on-shift people only", () => {
    const roster = rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "active"), rosterRow("hk-3", "on_break")]);
    const model = midshiftModel({ roster });
    expect(availableTeamIds(model, "hk-1")).toEqual(["hk-2"]);
    const destinations = buildDestinations(model, "hk-1", []);
    expect(destinations.find((d) => d.userId === "hk-3")?.availableNow).toBe(false);
  });

  it("an unverified roster makes nobody available", () => {
    const model = midshiftModel({ roster: { status: "failed", error: "x", fetchedAt: null } as never });
    expect(availableTeamIds(model, "hk-1")).toEqual([]);
    expect(buildDestinations(model, "hk-1", []).every((d) => d.attendance === "unknown" && !d.availableNow)).toBe(true);
  });
});

function planFor(model = midshiftModel(), numbers = MOVABLE, extra: Partial<Parameters<typeof planMidshift>[0]> = {}) {
  const source = sourceOf(model);
  const rooms = source.rooms.filter((r) => numbers.includes(r.roomNumber));
  return planMidshift({ model, sourceUserId: "hk-1", rooms, mode: "team", destinationId: null, scopeKey: SCOPE, ...extra });
}

describe("redistributing across the team", () => {
  it("spreads the rooms over the available team and reports the source releasing them", () => {
    const plan = planFor();
    expect(Object.keys(plan.assignments)).toHaveLength(6);
    expect(new Set(Object.values(plan.assignments))).toEqual(new Set(["hk-2", "hk-3"]));
    expect(plan.leftOut).toEqual([]);
    const source = plan.review?.employees.find((employee) => employee.userId === "hk-1");
    expect(source?.released).toHaveLength(6);
    expect(source?.added).toHaveLength(0);
  });

  it("keeps the in-progress room with the source, so the source is not reported as free", () => {
    const source = planFor().review?.employees.find((employee) => employee.userId === "hk-1");
    expect(source?.proposed.minutes.rooms).toBeGreaterThan(0);
  });

  it("weighs current workload: the person with less already gets more", () => {
    const plan = planFor();
    const mine = (id: string) => Object.values(plan.assignments).filter((owner) => owner === id).length;
    // hk-3 owns one room, hk-2 owns two.
    expect(mine("hk-3")).toBeGreaterThanOrEqual(mine("hk-2"));
  });

  it("projects each receiver from their own rooms, not from the source's", () => {
    const plan = planFor();
    const hk2 = plan.review?.employees.find((employee) => employee.userId === "hk-2");
    expect(hk2?.current.minutes.minutes).toBe(60);
    expect((hk2?.proposed.minutes.minutes ?? 0) - 60).toBe(
      plan.review?.employees.find((employee) => employee.userId === "hk-2")?.added.reduce((sum, item) => sum + (item.estimateMinutes ?? 0), 0),
    );
  });

  it("changes nothing live: the model is untouched and the scratch draft is local", () => {
    const model = midshiftModel();
    const before = JSON.stringify(model.rooms?.map((entry) => entry.room.assignment));
    planFor(model);
    expect(JSON.stringify(model.rooms?.map((entry) => entry.room.assignment))).toBe(before);
  });

  it("stages every change with the 'midshift' source and the owner the supervisor saw", () => {
    const plan = planFor();
    const changes = Object.values(plan.scratch.changes);
    expect(changes).toHaveLength(6);
    for (const change of changes) {
      expect(change).toMatchObject({ kind: "reassign", fromUserId: "hk-1", source: "midshift", expected: { expected_assigned_to: "hk-1" }, acknowledged: [] });
    }
  });

  it("is honest when nobody is verified available", () => {
    const model = midshiftModel({ roster: rosterOf([rosterRow("hk-1", "ended")]) });
    const plan = planFor(model);
    expect(plan.empty).toBe(true);
    expect(plan.leftOut).toHaveLength(6);
    expect(plan.leftOut.every((room) => room.reason === "no_eligible_staff")).toBe(true);
    expect(plan.review).toBeNull();
  });

  it("leaves a room out rather than forcing it past a real capacity limit", () => {
    const raw = [
      room("301", "DIRTY", { owner: "hk-1", cleanType: "DEP" }),
      room("302", "DIRTY", { owner: "hk-1", cleanType: "DEP" }),
      ...["401", "402", "403", "404", "405"].map((number) => room(number, "DIRTY", { owner: "hk-2", cleanType: "DEP" })),
    ];
    // hk-2 is at 15 of 16 credits: another DEP (3) is past the +2 band.
    const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "active")]) });
    const plan = planMidshift({ model, sourceUserId: "hk-1", rooms: sourceOf(model).rooms.filter((r) => r.movable), mode: "team", destinationId: null, scopeKey: SCOPE });
    expect(plan.leftOut.some((entry) => entry.reason === "insufficient_capacity")).toBe(true);
    expect(Object.keys(plan.assignments).length + plan.leftOut.length).toBe(2);
  });

  it("a partial plan names exactly the rooms nobody took", () => {
    const raw = [
      room("301", "DIRTY", { owner: "hk-1", cleanType: "DEP" }),
      room("302", "DIRTY", { owner: "hk-1", cleanType: "DEP" }),
      ...["401", "402", "403", "404", "405"].map((number) => room(number, "DIRTY", { owner: "hk-2", cleanType: "DEP" })),
    ];
    const model = assignmentsOf({ raw, roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "active")]) });
    const plan = planMidshift({ model, sourceUserId: "hk-1", rooms: sourceOf(model).rooms.filter((r) => r.movable), mode: "team", destinationId: null, scopeKey: SCOPE });
    const placed = new Set(Object.keys(plan.assignments));
    expect(plan.leftOut.map((entry) => entry.roomId).sort()).toEqual(["room-301", "room-302"].filter((id) => !placed.has(id)));
  });

  it("respects an individual capacity override", () => {
    const raw = [room("301", "DIRTY", { owner: "hk-1", cleanType: "DEP" }), room("401", "DIRTY", { owner: "hk-2", cleanType: "DEP" })];
    const model = assignmentsOf({
      raw,
      roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "active")]),
      settings: { status: "available", data: { targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: { "hk-2": 3 } }, fetchedAt: 1_000 } as never,
    });
    const plan = planMidshift({ model, sourceUserId: "hk-1", rooms: sourceOf(model).rooms.filter((r) => r.movable), mode: "team", destinationId: null, scopeKey: SCOPE });
    // hk-2 may carry at most 3+2 credits; they already hold 3, so one more DEP (6) is over.
    expect(plan.leftOut.map((entry) => entry.reason)).toEqual(["insufficient_capacity"]);
  });
});

describe("handing everything to one person", () => {
  it("gives every room to the chosen person, who may be over capacity and is asked to acknowledge", () => {
    const plan = planFor(midshiftModel(), MOVABLE, { mode: "person", destinationId: "hk-2" });
    expect(new Set(Object.values(plan.assignments))).toEqual(new Set(["hk-2"]));
    expect(plan.leftOut).toEqual([]);
  });

  it("refuses the source as a destination and an unknown person", () => {
    expect(planFor(midshiftModel(), MOVABLE, { mode: "person", destinationId: "hk-1" }).empty).toBe(true);
    const ghost = planFor(midshiftModel(), MOVABLE, { mode: "person", destinationId: "ghost" });
    expect(ghost.empty).toBe(true);
    expect(ghost.leftOut.length).toBe(6);
  });

  it("does not choose a destination by itself", () => {
    expect(planFor(midshiftModel(), MOVABLE, { mode: "person", destinationId: null }).empty).toBe(true);
  });

  it("a person who is not clocked in needs an acknowledgement, never treated as verified", () => {
    const model = midshiftModel({ roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "active")]) });
    const plan = planFor(model, MOVABLE, { mode: "person", destinationId: "hk-3" });
    expect(plan.review?.employees.find((employee) => employee.userId === "hk-3")?.acks).toContain("not_clocked_in");
  });
});

describe("editing the plan", () => {
  it("a manual override moves a room to someone else and both sides recalculate", () => {
    const base = planFor();
    const roomId = "room-301";
    const original = base.assignments[roomId];
    const other = original === "hk-2" ? "hk-3" : "hk-2";
    const edited = planFor(midshiftModel(), MOVABLE, { overrides: { [roomId]: other } });
    expect(edited.assignments[roomId]).toBe(other);
    const minutesFor = (plan: typeof base, id: string) => plan.review?.employees.find((employee) => employee.userId === id)?.proposed.minutes.minutes;
    expect(minutesFor(edited, other)).not.toBe(minutesFor(base, other));
    expect(minutesFor(edited, original)).not.toBe(minutesFor(base, original));
  });

  it("removing a room from the selection takes it out of the plan", () => {
    const plan = planFor(midshiftModel(), MOVABLE.filter((number) => number !== "304"));
    expect(Object.keys(plan.assignments)).not.toContain("room-304");
    expect(Object.keys(plan.assignments)).toHaveLength(5);
  });

  it("an override naming the source or an unknown person leaves the room out", () => {
    const plan = planFor(midshiftModel(), MOVABLE, { overrides: { "room-301": "hk-1", "room-302": "ghost" } });
    expect(plan.leftOut.map((entry) => entry.roomId).sort()).toEqual(["room-301", "room-302"]);
  });
});

describe("protected rooms cannot enter any plan", () => {
  it.each(["307", "308", "309", "310", "311", "312"])("room %s is rejected by staging even if it is passed in", (number) => {
    const model = midshiftModel();
    const source = sourceOf(model);
    const forced = source.rooms.filter((r) => r.roomNumber === number);
    const plan = planMidshift({ model, sourceUserId: "hk-1", rooms: forced, mode: "person", destinationId: "hk-2", scopeKey: SCOPE });
    expect(plan.empty).toBe(true);
    expect(plan.leftOut).toHaveLength(1);
    expect(plan.review).toBeNull();
  });

  it("a cross-property room id is never staged", () => {
    const model = midshiftModel();
    const real = sourceOf(model).rooms[0];
    const foreign = { ...real, roomId: "other-hotel-room", roomNumber: "999", entry: { ...real.entry, room: { ...real.entry.room, roomId: "other-hotel-room", roomNumber: "999" } } };
    const plan = planMidshift({
      model,
      sourceUserId: "hk-1",
      rooms: [foreign],
      mode: "person",
      destinationId: "hk-2",
      scopeKey: SCOPE,
    });
    expect(plan.empty).toBe(true);
    expect(plan.leftOut[0]).toMatchObject({ roomId: "other-hotel-room", reason: "room_missing" });
  });
});

describe("what changed under the supervisor", () => {
  it("is quiet while nothing moved", () => {
    const model = midshiftModel();
    expect(hasChanges(diffSeen(model, "hk-1", takeSeen(model, "hk-1")))).toBe(false);
  });

  it("notices a room that started cleaning, one that was reassigned and one that disappeared", () => {
    const seen = takeSeen(midshiftModel(), "hk-1");
    const board = midshiftBoard()
      .filter((raw) => raw.rooms?.room_number !== "305")
      .map((raw) => (raw.rooms?.room_number === "301" ? { ...raw, status: "IN_PROGRESS" } : raw.rooms?.room_number === "302" ? { ...raw, assigned_to: "hk-3" } : raw));
    const changes = diffSeen(assignmentsOf({ raw: board, roster: anaEnded() }), "hk-1", seen);
    expect(Object.fromEntries(changes.rooms.map((entry) => [entry.roomId, entry.change]))).toEqual({ "room-301": "started", "room-302": "reassigned", "room-305": "gone" });
  });

  it("notices a receiver whose attendance changed", () => {
    const seen = takeSeen(midshiftModel(), "hk-1");
    const model = midshiftModel({ roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "active")]) });
    expect(diffSeen(model, "hk-1", seen).destinations).toEqual([{ userId: "hk-2", from: "on_shift", to: "on_break" }]);
  });

  it("a roster that stops answering reads as 'unknown', not as still available", () => {
    const seen = takeSeen(midshiftModel(), "hk-1");
    const model = midshiftModel({ roster: { status: "failed", error: "x", fetchedAt: null } as never });
    expect(diffSeen(model, "hk-1", seen).destinations.every((entry) => entry.to === "unknown")).toBe(true);
  });

  it("notices the source's attendance is not part of the receivers", () => {
    const seen = takeSeen(midshiftModel(), "hk-1");
    expect(Object.keys(seen.destinations)).not.toContain("hk-1");
  });
});

describe("the unpublished draft", () => {
  const change = (roomId: string, source: PlannedChange["source"] = "bulk"): PlannedChange => ({
    roomId,
    roomNumber: roomId.replace("room-", ""),
    kind: "reassign",
    fromUserId: "hk-1",
    toUserId: "hk-3",
    expected: { expected_assigned_to: "hk-1" },
    acknowledged: [],
    removal: { kind: "none" },
    source,
  });

  it("reports which proposed rooms the draft already has a change for", () => {
    const draft = stageChange(emptyDraft(SCOPE, HOTEL_DATE, 0), change("room-301"));
    expect(draftOverlap(draft, idsOf(MOVABLE))).toEqual(["room-301"]);
    expect(draftOverlap(null, idsOf(MOVABLE))).toEqual([]);
  });

  it("counts the midshift changes in a draft and whose rooms they were", () => {
    let draft = stageChange(emptyDraft(SCOPE, HOTEL_DATE, 0), change("room-301", "midshift"));
    draft = stageChange(draft, change("room-302", "bulk"));
    expect(midshiftChangesIn(draft)).toEqual({ count: 1, sourceUserIds: ["hk-1"] });
  });

  it("publishes as a human decision: no AI flag, expected owners carried, no acknowledgements", () => {
    const plan = planFor();
    const request = toBatchRequest("00000000-0000-4000-8000-000000000001", HOTEL_DATE, Object.values(plan.scratch.changes));
    expect(request.ok).toBe(true);
    if (request.ok) {
      expect(request.request.changes).toHaveLength(6);
      for (const wire of request.request.changes) {
        expect(wire).toMatchObject({ kind: "reassign", expected_assigned_to: "hk-1" });
        expect(wire).not.toHaveProperty("is_ai_suggested");
      }
    }
    expect(toSaveRequests(Object.values(plan.scratch.changes)).assignmentBatches.every((batch) => batch.isAiSuggested === false)).toBe(true);
  });

  it("names its rooms by number in the test helpers", () => {
    expect(numbersOfIds(midshiftModel(), idsOf(MOVABLE))).toEqual(MOVABLE);
  });
});
