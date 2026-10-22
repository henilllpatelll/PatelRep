import {
  acksSatisfied,
  attendanceAckFor,
  buildAssignPicker,
  buildAssignReview,
  buildRemovalReview,
  loadView,
  softAcksOf,
  type AssignPicker,
} from "@/lib/housekeeping/assignmentPicker";
import { availableSource, failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { SETTINGS, assignmentsOf, rosterOf, rosterRow, shift } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, NOW, rawRoom } from "../helpers/roomBoardFixtures";
import type { RosterEntry } from "@/lib/housekeeping/supervisorTeam";

const owned = (number: string, status: string, user: string, extra: Partial<BoardRoomRaw> = {}) =>
  rawRoom(number, status, { assigned_to: user, assignment_id: `as-${number}`, assignment_date: HOTEL_DATE, ...extra });
const noEstimate = (number: string) => ({ rooms: { id: `room-${number}`, room_number: number, floor: 1, building: "A", room_types: { code: "Q" } } });

const everyoneOnShift = () => rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);

function picker(options: Parameters<typeof assignmentsOf>[0], roomId = "room-101", extra: { query?: string; filter?: "on_shift" | "all" } = {}): AssignPicker {
  const result = buildAssignPicker(assignmentsOf(options), { roomId, query: extra.query ?? "", filter: extra.filter ?? "all" });
  if (!result) throw new Error("no picker");
  return result;
}
const ids = (p: AssignPicker) => p.candidates.map((c) => c.userId);
const candidate = (p: AssignPicker, id: string) => {
  const found = p.candidates.find((c) => c.userId === id);
  if (!found) throw new Error(`no candidate ${id}`);
  return found;
};

describe("who is offered", () => {
  it("lists every listed housekeeper, including people with no rooms at all", () => {
    const p = picker({ roster: everyoneOnShift() });
    expect(ids(p).sort()).toEqual(["hk-1", "hk-2", "hk-3"]);
    expect(candidate(p, "hk-3").current).toMatchObject({ assignedRooms: 0, minutes: { minutes: 0, rooms: 0 } });
  });

  it("never offers an owner the staff list does not contain", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY"), owned("102", "DIRTY", "ghost")], roster: everyoneOnShift() });
    expect(ids(p)).not.toContain("ghost");
  });

  it("is null for a room that is not on the verified board, and while the board is unknown", () => {
    expect(buildAssignPicker(assignmentsOf(), { roomId: "room-999", query: "", filter: "all" })).toBeNull();
  });

  it("keeps the current owner visible but marks them as such", () => {
    const p = picker({ roster: everyoneOnShift() }, "room-102");
    expect(p.intent).toBe("reassign");
    expect(candidate(p, "hk-1")).toMatchObject({ isCurrentOwner: true, after: null });
  });
});

describe("availability is verified, never assumed", () => {
  it("On shift filtering lists only people the verified roster says are on shift", () => {
    const p = picker({ roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "ended")]) }, "room-101", { filter: "on_shift" });
    expect(ids(p)).toEqual(["hk-1"]);
    expect(p.counts).toEqual({ onShift: 1, all: 3 });
    expect(p.rosterVerified).toBe(true);
  });

  it("a failed roster is not 'nobody is working' and not 'everyone is working': everyone is listed, unverified", () => {
    const failed = failedSource<RosterEntry[]>(Object.assign(new Error("forbidden"), { status: 403 }), loadingSource());
    const p = picker({ roster: failed }, "room-101", { filter: "on_shift" });
    expect(p.rosterVerified).toBe(false);
    expect(p.filter).toBe("all");
    expect(ids(p).sort()).toEqual(["hk-1", "hk-2", "hk-3"]);
    expect(p.candidates.every((c) => c.attendance === "unknown")).toBe(true);
    expect(p.candidates.every((c) => c.acks.includes("attendance_unverified"))).toBe(true);
    expect(p.counts.onShift).toBe(0);
  });

  it("a person on break, scheduled-not-clocked-in and shift-ended each carry their own acknowledgement", () => {
    const p = picker(
      {
        roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break")]),
        schedule: availableSource([shift("hk-3")], NOW),
      },
    );
    expect(candidate(p, "hk-1").acks).toEqual([]);
    expect(candidate(p, "hk-2")).toMatchObject({ attendance: "on_break", acks: ["on_break"] });
    expect(candidate(p, "hk-3")).toMatchObject({ attendance: "scheduled_not_clocked_in", acks: ["not_clocked_in"] });
    const ended = picker({ roster: rosterOf([rosterRow("hk-1", "ended")]) });
    expect(candidate(ended, "hk-1").acks).toEqual(["shift_ended"]);
  });

  it("maps every attendance to its acknowledgement", () => {
    expect(attendanceAckFor("on_shift")).toBeNull();
    expect(attendanceAckFor("on_break")).toBe("on_break");
    expect(attendanceAckFor("shift_ended")).toBe("shift_ended");
    expect(attendanceAckFor("not_clocked_in")).toBe("not_clocked_in");
    expect(attendanceAckFor("scheduled_not_clocked_in")).toBe("not_clocked_in");
    expect(attendanceAckFor("unknown")).toBe("attendance_unverified");
  });
});

describe("search", () => {
  it("matches names case-insensitively inside the chosen pool", () => {
    const p = picker({ roster: everyoneOnShift() }, "room-101", { query: "  BEN " });
    expect(ids(p)).toEqual(["hk-2"]);
  });

  it("an unmatched search says so, rather than 'no staff'", () => {
    expect(picker({ roster: everyoneOnShift() }, "room-101", { query: "zzz" }).empty).toBe("no_match");
  });

  it("an unnamed person is listed, never matched by the search, and never crashes", () => {
    const p = picker({ staff: availableSource([{ userId: "hk-1", name: "—", role: "housekeeper" }, { userId: "hk-2", name: "Ben Ortiz", role: "housekeeper" }], NOW), roster: everyoneOnShift() });
    expect(candidate(p, "hk-1").name).toBeNull();
    expect(ids(picker({ staff: availableSource([{ userId: "hk-1", name: "—", role: "housekeeper" }], NOW), roster: everyoneOnShift() }, "room-101", { query: "a" }))).toEqual([]);
  });

  it("nobody on shift is its own empty state", () => {
    expect(picker({ roster: rosterOf([]) }, "room-101", { filter: "on_shift" }).empty).toBe("no_on_shift");
  });
});

describe("current and projected workload", () => {
  it("adds the room's estimate to what is left, and shows both", () => {
    // hk-1 owns 102 (OCCUPIED, 30 min) and 103 (PICKUP, 30 min): 60 min left. Room 101 is 30 min.
    const p = picker({ roster: everyoneOnShift() });
    const ana = candidate(p, "hk-1");
    expect(ana.current.minutes).toEqual({ minutes: 60, partial: false, missing: 0, rooms: 2 });
    expect(ana.after?.minutes).toEqual({ minutes: 90, partial: false, missing: 0, rooms: 3 });
    expect(p.estimate?.minutes).toBe(30);
  });

  it("does not count finished work as remaining", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY"), owned("102", "CLEAN", "hk-2"), owned("103", "DIRTY", "hk-2")], roster: everyoneOnShift() });
    expect(candidate(p, "hk-2").current).toMatchObject({ assignedRooms: 2, completedRooms: 1, minutes: { minutes: 30, rooms: 1 } });
  });

  it("an unknown estimate is never zero: the figure is 'at least', with the number missing", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY"), owned("102", "DIRTY", "hk-1"), owned("103", "DIRTY", "hk-1", noEstimate("103"))], roster: everyoneOnShift() });
    const ana = candidate(p, "hk-1");
    expect(ana.current.minutes).toEqual({ minutes: 30, partial: true, missing: 1, rooms: 2 });
    expect(ana.after?.minutes).toEqual({ minutes: 60, partial: true, missing: 1, rooms: 3 });
  });

  it("a person whose only remaining rooms have no estimate has NO minutes figure", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY"), owned("102", "DIRTY", "hk-1", noEstimate("102"))], roster: everyoneOnShift() });
    expect(candidate(p, "hk-1").current.minutes).toMatchObject({ minutes: null, missing: 1 });
  });

  it("a room with no estimate adds no time, and says the projection is incomplete", () => {
    const p = picker({ raw: [{ ...rawRoom("101", "DIRTY"), ...noEstimate("101") }, owned("102", "DIRTY", "hk-1")], roster: everyoneOnShift() });
    expect(p.estimate).toBeNull();
    const ana = candidate(p, "hk-1");
    expect(ana.roomEstimateMissing).toBe(true);
    expect(ana.after?.minutes).toEqual({ minutes: 30, partial: true, missing: 1, rooms: 2 });
  });

  it("is not capped at a working day", () => {
    const many = Array.from({ length: 20 }, (_, i) => owned(String(300 + i), "DIRTY", "hk-1"));
    const ana = candidate(picker({ raw: [rawRoom("101", "DIRTY"), ...many], roster: everyoneOnShift() }), "hk-1");
    expect(ana.current.minutes.minutes).toBe(600);
    expect(ana.after?.minutes.minutes).toBe(630);
  });
});

describe("capacity", () => {
  const fullRooms = (user: string, count: number) =>
    Array.from({ length: count }, (_, i) => owned(String(400 + i), "DIRTY", user, { clean_type: "FULL" }));

  it("shows a percentage only when credits are complete and a target is known", () => {
    // Four FULL rooms (2 credits each) = 8 credits of a 16 target.
    const p = picker({ raw: [rawRoom("101", "DIRTY", { clean_type: "FULL" }), ...fullRooms("hk-1", 4)], roster: everyoneOnShift() });
    expect(candidate(p, "hk-1").current).toMatchObject({ percent: 50, capacityState: "under" });
    expect(candidate(p, "hk-1").after).toMatchObject({ percent: 63 });
    // Without a clean type on the new room the credits are incomplete: no percentage after.
    const unknown = picker({ raw: [rawRoom("101", "DIRTY"), ...fullRooms("hk-1", 4)], roster: everyoneOnShift() });
    expect(candidate(unknown, "hk-1").after?.percent).toBeNull();
  });

  it("with no settings there is no percentage, no target and no over-capacity claim", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY", { clean_type: "FULL" }), ...fullRooms("hk-1", 9)], roster: everyoneOnShift(), settings: failedSource(new Error("x"), loadingSource()) });
    const ana = candidate(p, "hk-1");
    expect(ana.after?.percent).toBeNull();
    expect(ana.acks).not.toContain("over_capacity");
  });

  it("an individual capacity override replaces the hotel target", () => {
    const settings = availableSource({ ...SETTINGS, capacityOverrides: { "hk-1": 8 } }, NOW, () => false);
    const p = picker({ raw: [rawRoom("101", "DIRTY", { clean_type: "FULL" }), ...fullRooms("hk-1", 4)], roster: everyoneOnShift(), settings });
    expect(candidate(p, "hk-1").current).toMatchObject({ percent: 100 });
    // 10 credits against a target of 8 is 125%: "at" capacity (within two credits), not yet "over".
    expect(candidate(p, "hk-1").after).toMatchObject({ percent: 125, capacityState: "at" });
    const more = picker({ raw: [rawRoom("101", "DIRTY", { clean_type: "FULL" }), ...fullRooms("hk-1", 5)], roster: everyoneOnShift(), settings });
    expect(candidate(more, "hk-1").after).toMatchObject({ percent: 150, capacityState: "over" });
    expect(candidate(more, "hk-1").acks).toEqual(["over_capacity"]);
  });

  it("a projected over-capacity needs its own acknowledgement; a person who stays within capacity does not", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY", { clean_type: "DEP" }), ...fullRooms("hk-1", 8)], roster: everyoneOnShift() });
    expect(candidate(p, "hk-1").newWarnings).toContain("over_credit_target");
    expect(candidate(p, "hk-1").acks).toEqual(["over_capacity"]);
    expect(candidate(p, "hk-2").acks).toEqual([]);
  });

  it("running past the scheduled shift time left needs an acknowledgement", () => {
    // NOW is 12:00 in Chicago: a shift ending 13:00 has 60 minutes left; hk-1 already has 60, plus 30.
    const p = picker({ roster: everyoneOnShift(), schedule: availableSource([shift("hk-1", "07:00:00", "13:00:00")], NOW) });
    expect(candidate(p, "hk-1").newWarnings).toContain("exceeds_shift_time");
    expect(candidate(p, "hk-1").acks).toContain("over_capacity");
  });

  it("the plain 'full day' warning informs but never asks for an acknowledgement", () => {
    const many = Array.from({ length: 20 }, (_, i) => owned(String(300 + i), "DIRTY", "hk-1"));
    const ana = candidate(picker({ raw: [rawRoom("101", "DIRTY"), ...many], roster: everyoneOnShift() }), "hk-1");
    expect(ana.current.warnings).toContain("exceeds_full_day");
    expect(ana.acks).toEqual([]);
  });
});

describe("order and the suggestion", () => {
  it("verified on-shift people come first, then less work left, then name", () => {
    const p = picker({ roster: rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "active")]) });
    // hk-3 (no rooms) beats hk-1 (60 min); hk-2 is on break so it comes after both.
    expect(ids(p)).toEqual(["hk-3", "hk-1", "hk-2"]);
  });

  it("is deterministic: the same inputs give the same order", () => {
    const a = ids(picker({ roster: everyoneOnShift() }));
    const b = ids(picker({ roster: everyoneOnShift() }));
    expect(a).toEqual(b);
  });

  it("suggests the person with the least work left and says why", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY"), owned("102", "DIRTY", "hk-1"), owned("103", "DIRTY", "hk-1"), owned("104", "DIRTY", "hk-2")], roster: everyoneOnShift() });
    expect(p.suggestedId).toBe("hk-3");
    expect(candidate(p, "hk-3").suggested).toBe("least_remaining_time");
  });

  it("names capacity as the reason when the credits on both sides are known", () => {
    const p = picker({
      raw: [rawRoom("101", "DIRTY"), owned("102", "DIRTY", "hk-1", { clean_type: "FULL" }), owned("103", "DIRTY", "hk-2", { clean_type: "LIGHT" })],
      roster: everyoneOnShift(),
    });
    expect(p.suggestedId).toBe("hk-3");
    expect(candidate(p, "hk-3").suggested).toBe("most_capacity");
  });

  it("makes no suggestion when nothing in the evidence separates the top two", () => {
    const tie = picker({ raw: [rawRoom("101", "DIRTY")], roster: everyoneOnShift() });
    expect(tie.suggestedId).toBeNull();
  });

  it("makes no suggestion when only one person can be compared", () => {
    const p = picker({ roster: rosterOf([rosterRow("hk-1", "active")]) });
    expect(p.suggestedId).toBeNull();
    expect(p.candidates.some((c) => c.suggested !== null)).toBe(false);
  });

  it("makes no suggestion without a verified roster", () => {
    const p = picker({ roster: failedSource<RosterEntry[]>(new Error("x"), loadingSource()) });
    expect(p.suggestedId).toBeNull();
  });

  it("does not suggest anyone whose workload has an unknown estimate or who would end up over capacity", () => {
    const p = picker({ raw: [rawRoom("101", "DIRTY"), owned("102", "DIRTY", "hk-3", noEstimate("102"))], roster: everyoneOnShift() });
    expect(candidate(p, "hk-3").suggested).toBeNull();
  });
});

describe("the review", () => {
  const review = (options: Parameters<typeof assignmentsOf>[0], roomId: string, to: string) => {
    const result = buildAssignReview(assignmentsOf(options), { roomId, toUserId: to });
    if (!result.ok) throw new Error(result.rejection);
    return result.review;
  };

  it("an assignment shows the person's workload before and after", () => {
    const r = review({ roster: everyoneOnShift() }, "room-101", "hk-1");
    expect(r).toMatchObject({ intent: "assign", roomNumber: "101", from: null, fromImpact: null, requiredAcks: [], alreadyOwner: false });
    expect(r.toImpact.before.minutes.minutes).toBe(60);
    expect(r.toImpact.after.minutes.minutes).toBe(90);
    expect(r.estimate?.minutes).toBe(30);
  });

  it("a reassignment shows the impact on BOTH people", () => {
    const r = review({ roster: everyoneOnShift() }, "room-102", "hk-3");
    expect(r.intent).toBe("reassign");
    expect(r.from).toMatchObject({ userId: "hk-1" });
    expect(r.fromImpact?.before.minutes.minutes).toBe(60);
    expect(r.fromImpact?.after.minutes.minutes).toBe(30);
    expect(r.toImpact.before.minutes.minutes).toBe(0);
    expect(r.toImpact.after.minutes.minutes).toBe(30);
  });

  it("choosing the room's current owner is not a reassignment", () => {
    const r = review({ roster: everyoneOnShift() }, "room-102", "hk-1");
    expect(r.alreadyOwner).toBe(true);
    expect(r.fromImpact).toBeNull();
  });

  it("collects the room's soft blocks and the person's attendance into one acknowledgement list", () => {
    const r = review({ raw: [rawRoom("101", "DIRTY", { dnd_flag: true, do_not_service: true })], roster: rosterOf([rosterRow("hk-1", "on_break")]) }, "room-101", "hk-1");
    expect(r.requiredAcks).toEqual(["service_declined", "dnd", "on_break"]);
    expect(r.softBlocks).toEqual(["service_declined", "dnd"]);
    expect(acksSatisfied(r.requiredAcks, ["dnd", "service_declined"])).toBe(false);
    expect(acksSatisfied(r.requiredAcks, ["dnd", "service_declined", "on_break"])).toBe(true);
    expect(softAcksOf(["on_break", "dnd", "over_capacity"])).toEqual(["dnd"]);
  });

  it("reports a hard block so confirming is impossible", () => {
    const r = review({ raw: [owned("102", "IN_PROGRESS", "hk-1"), rawRoom("101", "DIRTY")], roster: everyoneOnShift() }, "room-102", "hk-2");
    expect(r.hardBlock).toBe("in_progress");
  });

  it("is refused for an unknown room or an unlisted person", () => {
    const model = assignmentsOf({ roster: everyoneOnShift() });
    expect(buildAssignReview(model, { roomId: "room-999", toUserId: "hk-1" })).toEqual({ ok: false, rejection: "room_missing" });
    expect(buildAssignReview(model, { roomId: "room-101", toUserId: "nobody" })).toEqual({ ok: false, rejection: "employee_unknown" });
  });
});

describe("the removal review", () => {
  it("reads a dated assignment and shows the owner's load before and after", () => {
    const r = buildRemovalReview(assignmentsOf({ roster: everyoneOnShift() }), "room-102");
    expect(r).toMatchObject({ roomNumber: "102", source: "dated", blocked: null, owner: { userId: "hk-1" } });
    expect(r?.impact?.before.minutes.minutes).toBe(60);
    expect(r?.impact?.after.minutes.minutes).toBe(30);
  });

  it("reads a mirror-only assignment", () => {
    const r = buildRemovalReview(assignmentsOf({ raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-2" })] }), "room-101");
    expect(r).toMatchObject({ source: "status_mirror", owner: { userId: "hk-2" } });
  });

  it("is blocked for a room being cleaned, and absent for an unassigned room", () => {
    expect(buildRemovalReview(assignmentsOf(), "room-104")?.blocked).toBe("in_progress");
    expect(buildRemovalReview(assignmentsOf(), "room-101")).toBeNull();
  });
});

describe("load views", () => {
  it("reports a finished-only person as zero remaining, not unknown", () => {
    const model = assignmentsOf({ raw: [owned("102", "CLEAN", "hk-1")] });
    const view = loadView((model.team ?? []).find((m) => m.userId === "hk-1")!.load);
    expect(view.minutes).toEqual({ minutes: 0, partial: false, missing: 0, rooms: 0 });
    expect(view.completedRooms).toBe(1);
  });
});
