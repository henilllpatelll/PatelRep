import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import { loadingSource } from "@/lib/housekeeping/supervisorSources";
import { buildQueue, queueFreshness, queueRooms, searchQueue, waitingMinutes } from "@/lib/inspections/queue";
import { readyRoom } from "../../helpers/inspectionFixtures";

const NOW = Date.parse("2026-10-20T16:00:00Z");

describe("building the queue", () => {
  it("keeps what the server said and uses the room id, not the number, as identity", () => {
    const [item] = buildQueue([readyRoom("r204", { room_number: "204", room_type_id: "type-suite", clean_cycle_id: "cyc-9" })]);
    expect(item).toMatchObject({ roomId: "r204", roomNumber: "204", roomTypeId: "type-suite", cleanCycleId: "cyc-9", floor: 2 });
    expect(item.reinspection.isReinspection).toBe(false);
  });

  it("missing room type or cycle stays null — it is never filled in", () => {
    const [item] = buildQueue([readyRoom("r204", { room_type_id: undefined, clean_cycle_id: undefined })]);
    expect(item.roomTypeId).toBeNull();
    expect(item.cleanCycleId).toBeNull();
  });

  it("lists each room once even if the server repeats it", () => {
    const rooms = buildQueue([readyRoom("r204"), readyRoom("r204"), readyRoom("r305")]);
    expect(rooms.map((r) => r.roomId)).toEqual(["r204", "r305"]);
  });

  it("two rooms with the same number on different rows stay distinct", () => {
    const rooms = buildQueue([readyRoom("a", { room_number: "101" }), readyRoom("b", { room_number: "101" })]);
    expect(rooms.map((r) => r.roomId).sort()).toEqual(["a", "b"]);
  });

  it("orders by floor then room number numerically", () => {
    const rooms = buildQueue([
      readyRoom("a", { floor: 2, room_number: "210" }),
      readyRoom("b", { floor: 1, room_number: "105" }),
      readyRoom("c", { floor: 2, room_number: "99" }),
      readyRoom("d", { floor: null, room_number: "1" }),
    ]);
    expect(rooms.map((r) => r.roomNumber)).toEqual(["1", "105", "99", "210"]);
  });

  it("carries a reinspection's failed items from the queue row", () => {
    const [item] = buildQueue([
      readyRoom("r204", { previous_failure: { inspection_id: "i", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean", items: [{ id: "x", label: "Bed", note: null }] } }),
    ]);
    expect(item.reinspection).toMatchObject({ isReinspection: true, kind: "reclean" });
  });
});

describe("waiting time and search", () => {
  it("counts whole minutes since the clean, never negative, null when unknown", () => {
    const [item] = buildQueue([readyRoom("r1", { cleaned_at: "2026-10-20T15:30:30Z" })]);
    expect(waitingMinutes(item, NOW)).toBe(29);
    expect(waitingMinutes(item, Date.parse("2026-10-20T15:00:00Z"))).toBe(0);
    const [unknown] = buildQueue([readyRoom("r2", { cleaned_at: null }), ]);
    expect(waitingMinutes(unknown, NOW)).toBeNull();
    const [garbage] = buildQueue([readyRoom("r3", { cleaned_at: "not a date" })]);
    expect(waitingMinutes(garbage, NOW)).toBeNull();
  });

  it("ranks rooms that start with the query before ones that merely contain it", () => {
    const rooms = buildQueue([readyRoom("a", { room_number: "112" }), readyRoom("b", { room_number: "211" }), readyRoom("c", { room_number: "311", cleaned_by: "Maria" })]);
    expect(searchQueue(rooms, "11").map((r) => r.roomNumber)).toEqual(["112", "211", "311"]);
    // room numbers only: a housekeeper's name is not a room
    expect(searchQueue(rooms, "maria")).toEqual([]);
    expect(searchQueue(rooms, "  ").length).toBe(3);
    expect(searchQueue(rooms, "zzz")).toEqual([]);
  });
});

describe("freshness", () => {
  const fetchedAt = NOW - 60_000;

  it("a recent verified answer is live; an old one is stale", () => {
    expect(queueFreshness({ status: "available", data: [], fetchedAt }, NOW)).toBe("live");
    expect(queueFreshness({ status: "empty", fetchedAt }, NOW)).toBe("live");
    expect(queueFreshness({ status: "available", data: [], fetchedAt: NOW - STALE_AFTER_MS - 1 }, NOW)).toBe("stale");
  });

  it("a kept-but-unverified answer is stale; nothing verified is unverified, never 'all clear'", () => {
    expect(queueFreshness({ status: "stale", data: [], fetchedAt, reason: "offline", failure: null }, NOW)).toBe("stale");
    expect(queueFreshness(loadingSource(), NOW)).toBe("unverified");
    expect(queueFreshness({ status: "failed", failure: { kind: "error", status: 500 } }, NOW)).toBe("unverified");
  });

  it("only a verified-empty answer is an empty queue; loading or failed is unknown", () => {
    expect(queueRooms({ status: "empty", fetchedAt })).toEqual([]);
    expect(queueRooms({ status: "available", data: [readyRoom("r1")], fetchedAt })).toHaveLength(1);
    expect(queueRooms({ status: "stale", data: null, fetchedAt, reason: "age", failure: null })).toEqual([]);
    expect(queueRooms(loadingSource())).toBeNull();
    expect(queueRooms({ status: "failed", failure: { kind: "offline", status: null } })).toBeNull();
  });
});
