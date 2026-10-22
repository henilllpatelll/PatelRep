import {
  buildCapacity,
  buildPropertyLoad,
  capacityState,
  computePersonLoad,
  parseWorkloadSettings,
  projectPersonLoad,
  roomCredits,
  sumCredits,
  targetFor,
  type WorkloadSettings,
} from "@/lib/housekeeping/assignmentWorkload";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource, failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import { SETTINGS, assignmentsOf } from "../helpers/assignmentFixtures";
import { NOW, rawRoom } from "../helpers/roomBoardFixtures";

const rooms = (raws: BoardRoomRaw[]) => normalizeBoardRecords(raws).rooms;
const mine = (number: string, status: string, extra: Partial<BoardRoomRaw> = {}) =>
  rawRoom(number, status, { assigned_to: "hk-1", assignment_id: `as-${number}`, ...extra });
const noEstimate = { rooms: { id: "x", room_number: "x", floor: 1, building: "A", room_types: { code: "Q" } } };

const payload = (data: Record<string, unknown>) => ({
  data: { default_target_credits: 16, credit_weights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacity_overrides: {}, ...data },
});

describe("workload settings", () => {
  it("parses the documented response", () => {
    expect(parseWorkloadSettings(payload({ default_target_credits: 14, capacity_overrides: { "hk-2": 10 } }))).toEqual({
      targetCredits: 14,
      creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 },
      capacityOverrides: { "hk-2": 10 },
    });
  });

  it.each([
    ["no body", null],
    ["no data", {}],
    ["no target", payload({ default_target_credits: null })],
    ["a zero target", payload({ default_target_credits: 0 })],
    ["a string target", payload({ default_target_credits: "16" })],
    ["a missing weight", payload({ credit_weights: { DEP: 3, FULL: 2 } })],
    ["a negative weight", payload({ credit_weights: { DEP: 3, FULL: -1, LIGHT: 1 } })],
    ["a non-numeric weight", payload({ credit_weights: { DEP: 3, FULL: "2", LIGHT: 1 } })],
  ])("%s throws — it is never replaced with invented numbers", (_name, body) => {
    expect(() => parseWorkloadSettings(body)).toThrow(/Malformed/);
  });

  it("a weight of 0 is allowed (a clean type that adds no workload)", () => {
    expect(parseWorkloadSettings(payload({ credit_weights: { DEP: 3, FULL: 0, LIGHT: 1 } })).creditWeights.FULL).toBe(0);
  });

  it("ignores an invalid override without discarding the valid ones", () => {
    const parsed = parseWorkloadSettings(payload({ capacity_overrides: { a: 10, b: 0, c: -3, d: "x", e: 12 } }));
    expect(parsed.capacityOverrides).toEqual({ a: 10, e: 12 });
  });
});

describe("credits are not minutes, and are never invented", () => {
  it("weights a room by its clean type", () => {
    const [dep, full, light] = rooms([
      rawRoom("101", "DIRTY", { clean_type: "DEP" }),
      rawRoom("102", "PICKUP", { clean_type: "FULL" }),
      rawRoom("103", "PICKUP", { clean_type: "LIGHT" }),
    ]);
    expect([dep, full, light].map((room) => roomCredits(room, SETTINGS).credits)).toEqual([3, 2, 1]);
  });

  it("a room with no clean type, or an unrecognised one, has NO credit value (not 0)", () => {
    const [none, odd] = rooms([rawRoom("101", "DIRTY"), rawRoom("102", "DIRTY", { clean_type: "DEEP" })]);
    expect(roomCredits(none, SETTINGS)).toEqual({ credits: null, basis: "unknown_clean_type" });
    expect(roomCredits(odd, SETTINGS)).toEqual({ credits: null, basis: "unknown_clean_type" });
  });

  it("a room the guest declined is known, zero work", () => {
    const [declined] = rooms([rawRoom("101", "DIRTY", { do_not_service: true })]);
    expect(roomCredits(declined, SETTINGS)).toEqual({ credits: 0, basis: "no_work" });
  });

  it("without settings no credit figure exists at all", () => {
    const [room] = rooms([rawRoom("101", "DIRTY", { clean_type: "DEP" })]);
    expect(roomCredits(room, null)).toEqual({ credits: null, basis: "settings_unavailable" });
    expect(sumCredits([room], null)).toMatchObject({ available: false, complete: false });
  });

  it("sums only remaining work and reports what is missing", () => {
    const load = sumCredits(
      rooms([
        mine("101", "DIRTY", { clean_type: "DEP" }),
        mine("102", "IN_PROGRESS", { clean_type: "FULL" }),
        mine("103", "DIRTY"), // unknown clean type
        mine("104", "CLEAN", { clean_type: "DEP" }), // submitted: not remaining work
      ]),
      SETTINGS,
    );
    expect(load).toEqual({ available: true, remaining: 5, roomsWithoutCredit: 1, complete: false });
  });
});

describe("minutes: estimates stay unknown and totals are real sums", () => {
  it("a room with no estimate adds nothing and is counted, never defaulted to 30", () => {
    const load = computePersonLoad("hk-1", rooms([mine("101", "DIRTY"), mine("102", "DIRTY", noEstimate)]), { settings: SETTINGS });
    expect(load.minutes).toMatchObject({ remainingRooms: 2, remainingMinutes: 30, roomsWithoutEstimate: 1, minutesComplete: false });
    expect(load.warnings).toContain("estimates_missing");
  });

  it("is NOT capped at a working day", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => mine(`${101 + i}`, "DIRTY", { clean_type: "DEP" }));
    const load = computePersonLoad("hk-1", rooms(twenty), { settings: SETTINGS });
    expect(load.minutes.remainingMinutes).toBe(600); // 20 × 30, well past 480
    expect(load.minutes.overloaded).toBe(true);
    expect(load.warnings).toContain("exceeds_full_day");
  });

  it("only the person's own rooms count", () => {
    const load = computePersonLoad("hk-1", rooms([mine("101", "DIRTY"), rawRoom("102", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-2" })]), { settings: SETTINGS });
    expect(load.minutes.total).toBe(1);
  });
});

describe("capacity", () => {
  it("uses the individual override before the hotel target", () => {
    const withOverride: WorkloadSettings = { ...SETTINGS, capacityOverrides: { "hk-2": 8 } };
    expect(targetFor("hk-2", withOverride)).toEqual({ target: 8, source: "override" });
    expect(targetFor("hk-1", withOverride)).toEqual({ target: 16, source: "default" });
    expect(targetFor("hk-1", null)).toEqual({ target: null, source: "unknown" });
  });

  it("uses the web's bands (±2 credits is on target)", () => {
    expect([capacityState(8, 16), capacityState(14, 16), capacityState(16, 16), capacityState(18, 16), capacityState(19, 16)]).toEqual(["under", "on", "at", "at", "over"]);
  });

  it("a percentage exists only when credits are complete AND the target is known — and is not capped", () => {
    const heavy = Array.from({ length: 8 }, (_, i) => mine(`${101 + i}`, "DIRTY", { clean_type: "DEP" })); // 24 credits
    const load = computePersonLoad("hk-1", rooms(heavy), { settings: SETTINGS });
    expect(load.capacity).toMatchObject({ target: 16, targetSource: "default", state: "over", creditsLeft: -8 });
    expect(load.capacity.utilization).toBeCloseTo(1.5);
    expect(load.warnings).toContain("over_credit_target");
  });

  it("an override changes the verdict for that person only", () => {
    const six = rooms(Array.from({ length: 4 }, (_, i) => mine(`${101 + i}`, "DIRTY", { clean_type: "DEP" }))); // 12 credits
    expect(computePersonLoad("hk-1", six, { settings: SETTINGS }).capacity.state).toBe("under");
    expect(computePersonLoad("hk-1", six, { settings: { ...SETTINGS, capacityOverrides: { "hk-1": 8 } } }).capacity.state).toBe("over");
  });

  it("incomplete credits: no percentage and no 'fine' — but a lower bound that is already too much is still over", () => {
    const some = rooms([mine("101", "DIRTY", { clean_type: "DEP" }), mine("102", "DIRTY")]); // 3 known + 1 unknown
    const fine = computePersonLoad("hk-1", some, { settings: SETTINGS });
    expect(fine.credits).toMatchObject({ remaining: 3, complete: false });
    expect(fine.capacity).toMatchObject({ state: null, utilization: null, creditsLeft: null });

    const many = rooms([...Array.from({ length: 7 }, (_, i) => mine(`${101 + i}`, "DIRTY", { clean_type: "DEP" })), mine("301", "DIRTY")]); // 21 known + 1 unknown
    const over = computePersonLoad("hk-1", many, { settings: SETTINGS });
    expect(over.capacity).toMatchObject({ state: "over", utilization: null });
  });

  it("without settings there is no target, no state and no percentage — never the legacy 16", () => {
    const load = computePersonLoad("hk-1", rooms([mine("101", "DIRTY", { clean_type: "DEP" })]), { settings: null });
    expect(load.credits.available).toBe(false);
    expect(load.capacity).toEqual({ target: null, targetSource: "unknown", state: null, utilization: null, creditsLeft: null });
    expect(buildCapacity("hk-1", { available: false, remaining: 0, roomsWithoutCredit: 0, complete: false }, SETTINGS).utilization).toBeNull();
  });
});

describe("shift time", () => {
  const shiftTime = (minutesLeft: number) => ({ phase: "during" as const, minutesLeft, startsAt: 0, endsAt: 0 });
  const five = rooms(Array.from({ length: 5 }, (_, i) => mine(`${101 + i}`, "DIRTY"))); // 150 min

  it("flags work that cannot fit in the shift time left", () => {
    const load = computePersonLoad("hk-1", five, { settings: SETTINGS, shiftTime: shiftTime(120) });
    expect(load.shift).toEqual({ minutesLeft: 120, exceeds: true });
    expect(load.warnings).toContain("exceeds_shift_time");
  });

  it("work that fits is only 'fits' when the estimate is complete", () => {
    expect(computePersonLoad("hk-1", five, { settings: SETTINGS, shiftTime: shiftTime(240) }).shift.exceeds).toBe(false);
    const partial = rooms([mine("101", "DIRTY"), mine("102", "DIRTY", noEstimate)]);
    expect(computePersonLoad("hk-1", partial, { settings: SETTINGS, shiftTime: shiftTime(240) }).shift.exceeds).toBeNull();
  });

  it("no schedule means unknown, not 'no time left'", () => {
    expect(computePersonLoad("hk-1", five, { settings: SETTINGS, shiftTime: null }).shift).toEqual({ minutesLeft: null, exceeds: null });
  });
});

describe("projected load after a change", () => {
  const board = rooms([mine("101", "DIRTY", { clean_type: "DEP" }), mine("102", "DIRTY", { clean_type: "FULL" }), rawRoom("103", "DIRTY", { clean_type: "LIGHT" })]);
  const unowned = board[2];

  it("adds a room to the receiver", () => {
    const after = projectPersonLoad("hk-1", board, { add: [unowned] }, { settings: SETTINGS });
    expect(after.minutes.remainingRooms).toBe(3);
    expect(after.credits.remaining).toBe(6);
  });

  it("releases a room from the giver", () => {
    const after = projectPersonLoad("hk-1", board, { release: ["room-101"] }, { settings: SETTINGS });
    expect(after.minutes.remainingRooms).toBe(1);
    expect(after.credits.remaining).toBe(2);
  });

  it("never counts a room twice or releases someone else's room", () => {
    const own = board[0];
    expect(projectPersonLoad("hk-1", board, { add: [own] }, { settings: SETTINGS }).minutes.remainingRooms).toBe(2);
    expect(projectPersonLoad("hk-2", board, { release: ["room-101"] }, { settings: SETTINGS }).minutes.remainingRooms).toBe(0);
  });

  it("does not mutate the board", () => {
    const before = JSON.stringify(board);
    projectPersonLoad("hk-1", board, { add: [unowned], release: ["room-101"] }, { settings: SETTINGS });
    expect(JSON.stringify(board)).toBe(before);
  });
});

describe("property load", () => {
  it("separates the whole day's remaining work from what nobody owns", () => {
    const load = buildPropertyLoad(
      rooms([mine("101", "DIRTY", { clean_type: "DEP" }), rawRoom("102", "DIRTY", { clean_type: "FULL" }), rawRoom("103", "DIRTY", noEstimate), rawRoom("104", "INSPECTED")]),
      SETTINGS,
    );
    expect(load).toMatchObject({ remainingRooms: 3, remainingMinutes: 60, roomsWithoutEstimate: 1, unassignedRooms: 2, unassignedMinutes: 30 });
    expect(load.credits).toMatchObject({ remaining: 5, roomsWithoutCredit: 1, complete: false });
    expect(load.unassignedCredits).toMatchObject({ remaining: 2, roomsWithoutCredit: 1 });
  });
});

describe("composed model: workload sources fail independently", () => {
  const raw = [mine("101", "DIRTY", { clean_type: "DEP" })];

  it("failed settings withhold credits and capacity but leave rooms, owners and minutes intact", () => {
    const failed = failedSource<WorkloadSettings>(Object.assign(new Error("403"), { status: 403 }), loadingSource());
    const model = assignmentsOf({ raw, settings: failed });
    expect(model.settings).toMatchObject({ trust: "unknown", value: null });
    expect(model.rooms).toHaveLength(1);
    const ana = model.team?.find((member) => member.userId === "hk-1");
    expect(ana?.rooms).toHaveLength(1);
    expect(ana?.load.minutes.remainingMinutes).toBe(30);
    expect(ana?.load.credits.available).toBe(false);
    expect(ana?.load.capacity.target).toBeNull();
  });

  it("loading settings read as unknown, not default", () => {
    const model = assignmentsOf({ raw, settings: loadingSource() });
    expect(model.settings.trust).toBe("unknown");
    expect(model.property?.credits.available).toBe(false);
  });

  it("stale settings are still used but labelled", () => {
    const old = availableSource(SETTINGS, NOW - 60 * 60_000, () => false);
    const model = assignmentsOf({ raw, settings: old });
    expect(model.settings.trust).toBe("stale");
    expect(model.team?.find((member) => member.userId === "hk-1")?.load.credits.remaining).toBe(3);
  });
});
