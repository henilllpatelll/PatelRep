import { parseSmartBalanceResponse } from "@/lib/housekeeping/smartBalanceWire";
import {
  addProposal,
  addableRooms,
  buildSmartPlan,
  changesOf,
  editedCount,
  moveProposal,
  planFreshness,
  removeProposal,
  stagePayloads,
} from "@/lib/housekeeping/smartBalancePlan";
import { availableSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import { assignmentsOf, rosterOf, rosterRow, SETTINGS } from "../helpers/assignmentFixtures";
import { bulkModel, entryOf, everyoneOnShift, room } from "../helpers/bulkFixtures";
import { SCOPE_KEY, answerFor, inputOf, planOf, NOW } from "../helpers/smartBalanceFixtures";

const FLOOR_PLAN = [room("101", "DIRTY"), room("102", "DIRTY"), room("103", "DIRTY", { minutes: null }), room("104", "DIRTY", { dnd_flag: true }), room("105", "IN_PROGRESS", { owner: "hk-2" }), room("106", "DIRTY", { owner: "hk-1" })];
const modelOf = (raw = FLOOR_PLAN, options = {}) => assignmentsOf({ raw, roster: everyoneOnShift(), ...options });

describe("the planning request", () => {
  it("carries each room exactly as the verified model has it, with unknowns left unknown", () => {
    const model = bulkModel();
    const { body } = inputOf(model);
    const byNumber = Object.fromEntries(body.rooms.map((item) => [item.room_number, item]));
    expect(Object.keys(byNumber).sort()).toEqual(["101", "102", "103", "201", "202", "301", "302"]);
    expect(byNumber["101"]).toMatchObject({ room_id: "room-101", expected_owner_id: null, minutes: 30, minutes_basis: "room_type", credits: 3, floor: 1, building: "A", arrival_at: null });
    expect(byNumber["103"]).toMatchObject({ minutes: null, minutes_basis: null }); // no estimate: never defaulted
    expect(byNumber["201"].reasons).toContain("vip");
    expect(byNumber["302"]).toMatchObject({ minutes: 15, credits: 1, building: "B", floor: 3 });
  });

  it("states the date, scope and the time the board was verified, and nothing that names a tenant", () => {
    const input = inputOf(bulkModel());
    expect(input.body.date).toBe("2026-10-16");
    expect(input.body.scope).toBe("unassigned");
    expect(input.body.snapshot_verified_at).toBe(NOW);
    expect(JSON.stringify(input.body)).not.toMatch(/tenant|hotel_id/);
  });

  it("counts everyone's existing work so fairness is about minutes already owed, not room counts", () => {
    const { body } = inputOf(bulkModel());
    const staff = Object.fromEntries(body.staff.map((person) => [person.user_id, person]));
    expect(staff["hk-1"]).toMatchObject({ base_minutes: 30, base_rooms: 1, base_unknown_rooms: 0, floors: [{ building: "A", floor: 1 }], buildings: ["A"] });
    expect(staff["hk-2"]).toMatchObject({ base_minutes: 0, base_rooms: 0, floors: [], buildings: [] });
  });

  it("full rebalance takes the pool rooms an owner holds OUT of their baseline (the plan decides them) and sends the expected owner", () => {
    const { body } = inputOf(bulkModel(), "all_unstarted");
    const staff = Object.fromEntries(body.staff.map((person) => [person.user_id, person]));
    expect(staff["hk-1"].base_minutes).toBe(0);
    expect(body.rooms.find((item) => item.room_number === "107")).toMatchObject({ expected_owner_id: "hk-1" });
  });

  it("protected work still counts: a started room stays in its owner's baseline in every scope", () => {
    const model = modelOf();
    for (const scope of ["unassigned", "all_unstarted"] as const) {
      const { body } = inputOf(model, scope);
      expect(body.staff.find((person) => person.user_id === "hk-2")).toMatchObject({ base_minutes: 30, base_rooms: 1 });
    }
  });

  it("an owner's room without an estimate or a clean type keeps the figures incomplete", () => {
    const model = modelOf([room("101", "DIRTY"), room("102", "DIRTY", { owner: "hk-1", minutes: null }), room("103", "DIRTY", { owner: "hk-1", clean_type: null } as never)]);
    const person = inputOf(model).body.staff.find((item) => item.user_id === "hk-1");
    expect(person).toMatchObject({ base_unknown_rooms: 1 });
    expect(person?.credits_complete).toBe(false);
  });

  it("capacity is unknown, not invented, when the workload settings are unavailable", () => {
    const person = inputOf(modelOf(FLOOR_PLAN, { settings: loadingSource() })).body.staff[0];
    expect(person.credit_target).toBeNull();
    expect(person.credits_complete).toBe(false);
  });

  it("uses the person's own capacity override and scheduled time left", () => {
    const model = modelOf(FLOOR_PLAN, { settings: availableSource({ ...SETTINGS, capacityOverrides: { "hk-3": 9 } }, NOW, () => false) });
    const staff = Object.fromEntries(inputOf(model).body.staff.map((person) => [person.user_id, person]));
    expect(staff["hk-3"].credit_target).toBe(9);
    expect(staff["hk-1"].credit_target).toBe(16);
  });

  it("is deterministic and never changes the model", () => {
    const model = bulkModel();
    const before = JSON.stringify(model.rooms?.map((entry) => entry.ownership));
    const a = inputOf(model);
    const b = inputOf(model);
    expect(a.body).toEqual(b.body);
    expect(JSON.stringify(model.rooms?.map((entry) => entry.ownership))).toBe(before);
  });
});

describe("reading the planner's answer strictly", () => {
  const good = {
    data: {
      read_only: true,
      plan_id: "abc",
      date: "2026-10-16",
      scope: "unassigned",
      generated_at: "2026-10-16T17:00:00Z",
      snapshot_verified_at: 5,
      status: "optimal",
      assignments: [{ room_id: "room-101", room_number: "101", kind: "new", from_user_id: null, to_user_id: "hk-1", tier: "routine", reasons: [{ code: "same_floor", floor: 1 }, { code: "invented", x: 1 }] }],
      unallocated: [{ room_id: "room-102", room_number: "102", reason: "insufficient_capacity", tier: "routine" }],
      staff: [{ user_id: "hk-1", rooms_added: 1, rooms_released: 0, minutes_added_known: 30, unknown_added: 0, no_capacity: false }],
      rejected_rooms: [{ room_id: "room-103", room_number: "103", reason: "owner_changed", current_owner_id: "hk-2" }],
      rejected_staff: [{ user_id: "hk-9", reason: "not_eligible" }],
      assumptions: [{ code: "unknown_estimate_surrogate", rooms: 1, minutes: 30 }, { code: "mystery" }],
      warnings: [],
    },
  };
  const clone = () => JSON.parse(JSON.stringify(good));

  it("reads a well-formed answer and drops only the explanations it does not understand", () => {
    const parsed = parseSmartBalanceResponse(good);
    expect(parsed?.assignments[0].reasons).toEqual([{ code: "same_floor", floor: 1 }]);
    expect(parsed?.assumptions).toEqual([{ code: "unknown_estimate_surrogate", rooms: 1, minutes: 30 }]);
    expect(parsed?.rejectedRooms[0]).toMatchObject({ reason: "owner_changed", current_owner_id: "hk-2" });
    expect(parsed?.rejectedStaff).toEqual(["hk-9"]);
  });

  it.each([
    ["not read-only", (d: any) => { d.data.read_only = false; }],
    ["no plan id", (d: any) => { delete d.data.plan_id; }],
    ["unknown status", (d: any) => { d.data.status = "applied"; }],
    ["unknown scope", (d: any) => { d.data.scope = "everything"; }],
    ["a new room that had an owner", (d: any) => { d.data.assignments[0].from_user_id = "hk-2"; }],
    ["a moved room with no previous owner", (d: any) => { d.data.assignments[0].kind = "moved"; }],
    ["a retained room that changed hands", (d: any) => { d.data.assignments[0].kind = "retained"; d.data.assignments[0].from_user_id = "hk-2"; }],
    ["a room in two places", (d: any) => { d.data.unallocated[0].room_id = "room-101"; }],
    ["an unknown unallocated reason", (d: any) => { d.data.unallocated[0].reason = "whim"; }],
    ["a fractional count", (d: any) => { d.data.staff[0].rooms_added = 1.5; }],
    ["a missing list", (d: any) => { delete d.data.rejected_rooms; }],
  ])("refuses an answer with %s", (_name, mutate) => {
    const data = clone();
    mutate(data);
    expect(parseSmartBalanceResponse(data)).toBeNull();
  });

  it("refuses non-objects", () => {
    for (const value of [null, undefined, "plan", 3, []]) expect(parseSmartBalanceResponse(value)).toBeNull();
  });
});

describe("turning an answer into a plan", () => {
  it("builds the plan, with every room accounted for exactly once", () => {
    const model = modelOf();
    const input = inputOf(model);
    const plan = planOf(model, input, { assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated: [["103", "insufficient_capacity"]] });
    expect(changesOf(plan).map((p) => [p.roomNumber, p.toUserId, p.kind, p.origin])).toEqual([["101", "hk-2", "new", "optimizer"], ["102", "hk-3", "new", "optimizer"]]);
    expect(plan.leftOut["room-103"]).toMatchObject({ reason: "insufficient_capacity" });
    expect(plan.excludedRooms.map((room) => room.roomNumber)).toEqual(["104"]);
    expect(plan.protectedInProgress).toBe(1);
    expect(plan.preservedAssignments).toBe(1);
  });

  it("refuses an answer about another day or scope", () => {
    const model = modelOf();
    const input = inputOf(model);
    const wrongDay = { ...answerFor(input, { assign: [["101", "hk-1"]] }), date: "2026-10-15" };
    expect(buildSmartPlan(input, wrongDay, { scopeKey: SCOPE_KEY, now: NOW, model })).toEqual({ ok: false, refusal: "wrong_day" });
    const wrongScope = { ...answerFor(input, { assign: [["101", "hk-1"]] }), scope: "selected" as const };
    expect(buildSmartPlan(input, wrongScope, { scopeKey: SCOPE_KEY, now: NOW, model })).toEqual({ ok: false, refusal: "wrong_scope" });
  });

  it("refuses an answer that names a room that was never sent, or leaves one out, or repeats one", () => {
    const model = modelOf();
    const input = inputOf(model);
    const answer = answerFor(input, { assign: [["101", "hk-1"], ["102", "hk-1"]], unallocated: [["103", "insufficient_capacity"]] });
    const refuse = (response: typeof answer) => buildSmartPlan(input, response, { scopeKey: SCOPE_KEY, now: NOW, model });
    expect(refuse(answer).ok).toBe(true);
    expect(refuse({ ...answer, assignments: [...answer.assignments, { ...answer.assignments[0], room_id: "room-999" }] })).toEqual({ ok: false, refusal: "unverified" });
    expect(refuse({ ...answer, assignments: answer.assignments.slice(1) })).toEqual({ ok: false, refusal: "unverified" });
    expect(refuse({ ...answer, assignments: [...answer.assignments, answer.assignments[0]] })).toEqual({ ok: false, refusal: "unverified" });
  });

  it("refuses an answer that hands a room to someone who was never offered rooms", () => {
    const model = modelOf(FLOOR_PLAN, { roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break")]) });
    const input = inputOf(model);
    expect(input.receivers.map((r) => r.member.userId)).toEqual(["hk-1"]);
    const answer = answerFor(input, { assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    expect(buildSmartPlan(input, answer, { scopeKey: SCOPE_KEY, now: NOW, model })).toEqual({ ok: false, refusal: "unverified" });
  });

  it("refuses an answer that disagrees with the owner the supervisor saw", () => {
    const model = modelOf();
    const input = inputOf(model, "all_unstarted");
    const answer = answerFor(input, { assign: [["101", "hk-2"]], retain: ["106"], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    const tampered = { ...answer, assignments: answer.assignments.map((a) => (a.room_id === "room-106" ? { ...a, from_user_id: "hk-3", to_user_id: "hk-3" } : a)) };
    expect(buildSmartPlan(input, tampered, { scopeKey: SCOPE_KEY, now: NOW, model })).toEqual({ ok: false, refusal: "unverified" });
  });

  it("records what the server rejected as exclusions with the server's reason, and people it rejected", () => {
    const model = modelOf();
    const input = inputOf(model);
    const plan = planOf(model, input, { assign: [["101", "hk-1"]], rejected: [["102", "owner_changed"]], rejectedStaff: ["hk-3"], noCapacity: ["hk-2"], unallocated: [["103", "insufficient_capacity"]] });
    expect(plan.excludedRooms.find((r) => r.roomNumber === "102")?.exclusion).toEqual({ kind: "server", reason: "owner_changed" });
    expect(plan.excludedStaff.map((s) => [s.userId, s.reason])).toEqual([["hk-2", "no_capacity"], ["hk-3", "not_eligible"]]);
    expect(plan.receiverIds).toEqual(["hk-1"]); // neither can be chosen for a manual move either
  });

  it("an honest 'no safe plan' keeps every unowned room unplanned, with the solver as the reason", () => {
    const model = modelOf();
    const input = inputOf(model, "all_unstarted");
    const response = { ...answerFor(input), status: "no_safe_plan" as const };
    const built = buildSmartPlan(input, response, { scopeKey: SCOPE_KEY, now: NOW, model });
    expect(built.ok && built.plan.status).toBe("no_safe_plan");
    expect(built.ok && Object.values(built.plan.leftOut).map((l) => l.reason)).toEqual(["solver_no_solution", "solver_no_solution", "solver_no_solution"]);
    expect(built.ok && changesOf(built.plan)).toEqual([]);
  });
});

describe("editing the proposal", () => {
  const setup = () => {
    const model = modelOf();
    const input = inputOf(model, "all_unstarted");
    const plan = planOf(model, input, { assign: [["101", "hk-2"], ["102", "hk-3"], ["106", "hk-3"]], retain: [], unallocated: [["103", "insufficient_capacity"]] });
    return { model, plan };
  };

  it("an untouched recommendation is the optimizer's; an edit is the supervisor's", () => {
    const { plan } = setup();
    expect(changesOf(plan).every((p) => p.origin === "optimizer")).toBe(true);
    const moved = moveProposal(plan, "room-101", "hk-3");
    expect(moved.ok && moved.plan.proposals["room-101"]).toMatchObject({ toUserId: "hk-3", origin: "edited", reasons: [] });
    expect(moved.ok && editedCount(moved.plan)).toBe(1);
    const payload = moved.ok ? stagePayloads(moved.plan) : null;
    expect(payload?.edited).toEqual({ "room-101": "hk-3" });
    expect(Object.keys(payload?.optimizer ?? {}).sort()).toEqual(["room-102", "room-106"]);
  });

  it("moving a room back to the optimizer's own answer makes it the optimizer's again", () => {
    const { plan } = setup();
    const away = moveProposal(plan, "room-101", "hk-3");
    const back = away.ok ? moveProposal(away.plan, "room-101", "hk-2") : null;
    expect(back?.ok && back.plan.proposals["room-101"]).toMatchObject({ origin: "optimizer", toUserId: "hk-2" });
  });

  it("only a receiver the planner could offer rooms to can be chosen", () => {
    const { plan } = setup();
    expect(moveProposal(plan, "room-101", "hk-9")).toEqual({ ok: false, refusal: "not_a_receiver" });
    expect(moveProposal(plan, "room-101", "hk-2")).toEqual({ ok: false, refusal: "same_person" });
    expect(moveProposal(plan, "room-999", "hk-3")).toEqual({ ok: false, refusal: "unknown_room" });
  });

  it("taking out a new room leaves it unassigned; taking out a moved room restores its owner", () => {
    const { plan } = setup();
    const removedNew = removeProposal(plan, "room-101");
    expect(removedNew.ok && removedNew.plan.proposals["room-101"]).toBeUndefined();
    expect(removedNew.ok && removedNew.plan.leftOut["room-101"]).toMatchObject({ reason: "taken_out" });
    const restored = removeProposal(plan, "room-106");
    expect(restored.ok && restored.plan.proposals["room-106"]).toMatchObject({ kind: "retained", toUserId: "hk-1", origin: "edited" });
    expect(restored.ok && changesOf(restored.plan).map((p) => p.roomNumber)).not.toContain("106");
  });

  it("a room that stays with its owner is shown but cannot be edited", () => {
    const model = modelOf();
    const input = inputOf(model, "all_unstarted");
    const plan = planOf(model, input, { retain: ["106"], assign: [["101", "hk-2"]], unallocated: [["102", "insufficient_capacity"], ["103", "insufficient_capacity"]] });
    expect(moveProposal(plan, "room-106", "hk-3")).toEqual({ ok: false, refusal: "protected" });
    expect(removeProposal(plan, "room-106")).toEqual({ ok: false, refusal: "protected" });
  });

  it("a left-out room can be added to a receiver; a blocked or owned room cannot", () => {
    const { model, plan } = setup();
    const added = addProposal(plan, entryOf(model, "103"), "hk-2");
    expect(added.ok && added.plan.proposals["room-103"]).toMatchObject({ kind: "new", origin: "edited", toUserId: "hk-2" });
    expect(added.ok && added.plan.leftOut["room-103"]).toBeUndefined();
    expect(addProposal(plan, entryOf(model, "104"), "hk-2")).toEqual({ ok: false, refusal: "not_addable" }); // DND
    expect(addProposal(plan, entryOf(model, "105"), "hk-2")).toEqual({ ok: false, refusal: "not_addable" }); // being cleaned
    expect(addProposal(plan, entryOf(model, "101"), "hk-2")).toEqual({ ok: false, refusal: "already_planned" });
    expect(addProposal(plan, entryOf(model, "103"), "hk-9")).toEqual({ ok: false, refusal: "not_a_receiver" });
  });

  it("offers only unowned, plannable rooms that are not already in the plan", () => {
    const { model, plan } = setup();
    expect(addableRooms(model, plan).map((entry) => entry.room.roomNumber)).toEqual(["103"]);
  });

  it("edits never change the model or the original plan", () => {
    const { plan } = setup();
    const snapshot = JSON.stringify(plan);
    moveProposal(plan, "room-101", "hk-3");
    removeProposal(plan, "room-102");
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe("is the plan still true", () => {
  const base = () => {
    const model = modelOf();
    const plan = planOf(model, inputOf(model), { assign: [["101", "hk-2"], ["102", "hk-3"]], unallocated: [["103", "insufficient_capacity"]] });
    return { model, plan };
  };

  it("is fresh against the board it was built from", () => {
    const { model, plan } = base();
    expect(planFreshness(model, plan, SCOPE_KEY)).toEqual([]);
  });

  it("goes stale when a planned room gets an owner, is started, or becomes blocked", () => {
    const { plan } = base();
    for (const change of [
      room("101", "DIRTY", { owner: "hk-1" }),
      room("101", "IN_PROGRESS"),
      room("101", "DIRTY", { dnd_flag: true }),
    ]) {
      const raw = FLOOR_PLAN.map((r) => (r.room_id === "room-101" ? change : r));
      expect(planFreshness(modelOf(raw), plan, SCOPE_KEY)).toEqual([{ kind: "rooms_changed", roomNumbers: ["101"] }]);
    }
  });

  it("goes stale when a receiver clocks out or goes on break", () => {
    const { plan } = base();
    const model = modelOf(FLOOR_PLAN, { roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "active")]) });
    expect(planFreshness(model, plan, SCOPE_KEY)).toEqual([{ kind: "staff_changed", userIds: ["hk-2"] }]);
  });

  it("goes stale when the roster stops being verified", () => {
    const { plan } = base();
    const model = modelOf(FLOOR_PLAN, { roster: { status: "failed", error: "x", fetchedAt: null } as never });
    expect(planFreshness(model, plan, SCOPE_KEY).map((reason) => reason.kind)).toContain("attendance_unverified");
  });

  it("goes stale when capacity settings change", () => {
    const { plan } = base();
    const model = modelOf(FLOOR_PLAN, { settings: availableSource({ ...SETTINGS, targetCredits: 12 }, NOW, () => false) });
    expect(planFreshness(model, plan, SCOPE_KEY)).toEqual([{ kind: "settings_changed" }]);
  });

  it("goes stale for another hotel/person, a new day, or an unknown board", () => {
    const { model, plan } = base();
    expect(planFreshness(model, plan, "tenant-2:sup-1")).toEqual([{ kind: "scope" }]);
    expect(planFreshness(model, plan, null)).toEqual([{ kind: "scope" }]);
    expect(planFreshness({ ...model, hotelDate: "2026-10-17" }, plan, SCOPE_KEY)).toContainEqual({ kind: "day" });
    expect(planFreshness({ ...model, rooms: null }, plan, SCOPE_KEY)).toContainEqual({ kind: "board_unavailable" });
  });

  it("rechecks rooms the supervisor added from outside the pool", () => {
    const { model, plan } = base();
    const added = addProposal(plan, entryOf(model, "103"), "hk-2");
    if (!added.ok) throw new Error("add failed");
    const raw = FLOOR_PLAN.map((r) => (r.room_id === "room-103" ? room("103", "DIRTY", { minutes: null, owner: "hk-1" }) : r));
    expect(planFreshness(modelOf(raw), added.plan, SCOPE_KEY)).toContainEqual({ kind: "rooms_changed", roomNumbers: ["103"] });
  });
});
