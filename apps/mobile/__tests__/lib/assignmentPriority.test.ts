import { comparePriority, describePriority, type PriorityContext } from "@/lib/housekeeping/assignmentPriority";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { assignmentsOf } from "../helpers/assignmentFixtures";
import { NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

// NOW is 12:00 in Chicago on 2026-10-16 (17:00Z).
const PASSED = "2026-10-16T15:00:00Z"; // 10:00 local
const SOON = "2026-10-16T21:00:00Z"; // 16:00 local
const LATER = "2026-10-16T23:30:00Z"; // 18:30 local
const YESTERDAY = "2026-10-15T20:00:00Z";

const room = (number: string, status: string, extra: Partial<BoardRoomRaw> = {}) => normalizeBoardRecords([rawRoom(number, status, extra)]).rooms[0];
const context = (guestWaiting: ReadonlySet<string> | null = null): PriorityContext => ({ now: NOW, timeZone: ZONE, guestWaiting });
const describeRoom = (number: string, status: string, extra: Partial<BoardRoomRaw> = {}, guest: ReadonlySet<string> | null = null) =>
  describePriority(room(number, status, extra), context(guest));

describe("tiers and reasons are recorded facts", () => {
  it("an ordinary room is routine with no reasons", () => {
    expect(describeRoom("101", "DIRTY")).toEqual({ tier: "routine", reasons: [], arrivalAt: null });
  });

  it("a guest waiting is critical — but only when that signal is supplied", () => {
    const waiting = new Set(["room-101"]);
    expect(describeRoom("101", "DIRTY", {}, waiting)).toMatchObject({ tier: "critical", reasons: ["guest_waiting"] });
    // Unknown is not the same as "nobody waiting" and raises nothing.
    expect(describeRoom("101", "DIRTY", {}, null).reasons).not.toContain("guest_waiting");
    expect(describeRoom("102", "DIRTY", {}, waiting).reasons).not.toContain("guest_waiting");
  });

  it("a reclean request, an explicit rush priority and a passed arrival are high", () => {
    expect(describeRoom("101", "DIRTY", { reclean_requested_at: "2026-10-16T14:00:00Z" })).toMatchObject({ tier: "high", reasons: ["reclean_requested"] });
    expect(describeRoom("102", "DIRTY", { priority: 2 })).toMatchObject({ tier: "high", reasons: ["rush"] });
    expect(describeRoom("103", "DIRTY", { checkin_time: PASSED })).toMatchObject({ tier: "high", reasons: ["arrival_passed"] });
  });

  it("a default priority (5) or lower urgency number is not a rush", () => {
    expect(describeRoom("101", "DIRTY", { priority: 5 }).reasons).toEqual([]);
    expect(describeRoom("102", "DIRTY", { priority: 8 }).reasons).toEqual([]);
  });

  it("a confirmed arrival later today, a VIP and a HIGH-risk forecast are elevated", () => {
    expect(describeRoom("101", "DIRTY", { checkin_time: SOON })).toMatchObject({ tier: "elevated", reasons: ["arrival_today"], arrivalAt: Date.parse(SOON) });
    expect(describeRoom("102", "DIRTY", { vip_flag: true })).toMatchObject({ tier: "elevated", reasons: ["vip"] });
    expect(describeRoom("103", "DIRTY", { prediction: { risk_level: "HIGH" } })).toMatchObject({ tier: "elevated", reasons: ["high_risk"] });
  });

  it("an arrival from another day creates no deadline", () => {
    expect(describeRoom("101", "DIRTY", { checkin_time: YESTERDAY })).toEqual({ tier: "routine", reasons: [], arrivalAt: null });
  });

  it("the tier is the highest of the reasons, and reasons keep a fixed order", () => {
    const priority = describeRoom("101", "DIRTY", { vip_flag: true, priority: 1, checkin_time: PASSED, prediction: { risk_level: "HIGH" } }, new Set(["room-101"]));
    expect(priority.tier).toBe("critical");
    expect(priority.reasons).toEqual(["guest_waiting", "rush", "arrival_passed", "vip", "high_risk"]);
  });

  it.each(["INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"])("%s is always routine — nobody can act on it", (status) => {
    expect(describeRoom("101", status, { vip_flag: true, priority: 1, checkin_time: PASSED }, new Set(["room-101"]))).toEqual({ tier: "routine", reasons: [], arrivalAt: null });
  });
});

describe("ordering is deterministic", () => {
  const raws = [
    rawRoom("110", "DIRTY"),
    rawRoom("109", "DIRTY"),
    rawRoom("108", "DIRTY", { vip_flag: true }),
    rawRoom("107", "DIRTY", { checkin_time: LATER }),
    rawRoom("106", "DIRTY", { checkin_time: SOON }),
    rawRoom("105", "DIRTY", { priority: 1 }),
    rawRoom("104", "DIRTY", { checkin_time: PASSED }),
    rawRoom("103", "DIRTY", { reclean_requested_at: "2026-10-16T14:00:00Z" }),
    rawRoom("102", "DIRTY", { priority: 1, vip_flag: true }),
    rawRoom("101", "DIRTY"),
  ];
  const orderOf = (input: BoardRoomRaw[]) => assignmentsOf({ raw: input, guestWaiting: new Set(["room-110"]) }).rooms?.map((entry) => entry.room.roomNumber);

  it("critical first, then high, elevated, routine — earliest arrival first, then more reasons, then room number", () => {
    // 110 critical · high: 104 (arrival 10:00) → 102/105/103 by reasons then number · elevated: 106 (16:00) → 107 (18:30) → 108 · routine
    expect(orderOf(raws)).toEqual(["110", "104", "102", "103", "105", "106", "107", "108", "101", "109"]);
  });

  it("does not depend on the order rows arrive in", () => {
    const expected = orderOf(raws);
    expect(orderOf([...raws].reverse())).toEqual(expected);
    expect(orderOf([...raws.slice(5), ...raws.slice(0, 5)])).toEqual(expected);
    expect(orderOf([...raws].sort((a, b) => a.room_id.localeCompare(b.room_id)))).toEqual(expected);
  });

  it("comparePriority is a strict total order over distinct rooms (antisymmetric, never 0)", () => {
    const entries = assignmentsOf({ raw: raws }).rooms ?? [];
    for (const a of entries) {
      for (const b of entries) {
        if (a === b) continue;
        expect(Math.sign(comparePriority(a, b))).toBe(-Math.sign(comparePriority(b, a)));
        expect(comparePriority(a, b)).not.toBe(0);
      }
    }
  });
});
