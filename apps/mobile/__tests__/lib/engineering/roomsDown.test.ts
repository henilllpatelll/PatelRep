import type { ActiveRoomPeriod } from "@/lib/api/engineeringRooms";
import { buildRoomsDown, toImpactRow } from "@/lib/engineering/roomsDown";

const period = (over: Partial<ActiveRoomPeriod> = {}): ActiveRoomPeriod => ({
  id: "p1",
  room_id: "r1",
  type: "OUT_OF_ORDER",
  reason_label: "Water leak",
  expected_return_at: "2026-11-05T12:00:00Z",
  is_past_eta: false,
  rooms: { room_number: "415", floor: 4 },
  work_orders: { id: "wo1", work_order_number: "1045", title: "Leak", status: "in_progress", priority: "urgent", assigned_to: "t1" },
  ...over,
});

describe("toImpactRow", () => {
  it("carries the room, reason, return time and linked repair", () => {
    expect(toImpactRow(period())).toMatchObject({
      periodId: "p1",
      roomId: "r1",
      roomNumber: "415",
      floor: 4,
      type: "OUT_OF_ORDER",
      reason: "Water leak",
      pastEta: false,
      repair: { id: "wo1", code: "WO-1045", status: "in_progress" },
      repairClosed: false,
    });
  });

  it("does not double the WO prefix", () => {
    expect(toImpactRow(period({ work_orders: { id: "w", work_order_number: "WO-7" } }))?.repair?.code).toBe("WO-7");
  });

  it("marks a finished or cancelled repair on a room that is still down", () => {
    expect(toImpactRow(period({ work_orders: { id: "w", status: "completed" } }))?.repairClosed).toBe(true);
    expect(toImpactRow(period({ work_orders: { id: "w", status: "cancelled" } }))?.repairClosed).toBe(true);
    expect(toImpactRow(period({ work_orders: { id: "w", status: "on_hold" } }))?.repairClosed).toBe(false);
  });

  it("has no repair when none is linked", () => {
    const row = toImpactRow(period({ work_orders: null }));
    expect(row?.repair).toBeNull();
    expect(row?.repairClosed).toBe(false);
  });

  it("rejects a period with no id or room number instead of inventing one", () => {
    expect(toImpactRow(period({ rooms: null }))).toBeNull();
    expect(toImpactRow(period({ id: "" }))).toBeNull();
  });
});

describe("buildRoomsDown", () => {
  it("orders past-due rooms first, then the soonest return, then no return time, then room number", () => {
    const { rows } = buildRoomsDown([
      period({ id: "none", expected_return_at: null, rooms: { room_number: "100", floor: 1 } }),
      period({ id: "soon", expected_return_at: "2026-11-04T00:00:00Z", rooms: { room_number: "300", floor: 3 } }),
      period({ id: "late", is_past_eta: true, expected_return_at: "2026-11-09T00:00:00Z", rooms: { room_number: "900", floor: 9 } }),
      period({ id: "later", expected_return_at: "2026-11-08T00:00:00Z", rooms: { room_number: "200", floor: 2 } }),
    ]);
    expect(rows.map((r) => r.periodId)).toEqual(["late", "soon", "later", "none"]);
  });

  it("sorts room numbers as numbers when nothing else separates them", () => {
    const { rows } = buildRoomsDown([
      period({ id: "a", expected_return_at: null, rooms: { room_number: "1000", floor: 10 } }),
      period({ id: "b", expected_return_at: null, rooms: { room_number: "200", floor: 2 } }),
    ]);
    expect(rows.map((r) => r.roomNumber)).toEqual(["200", "1000"]);
  });

  it("counts rooms with no repair or a finished repair as needing a decision", () => {
    const result = buildRoomsDown([
      period({ id: "a", work_orders: null }),
      period({ id: "b", work_orders: { id: "w", status: "completed" } }),
      period({ id: "c" }),
    ]);
    expect(result.needsDecision).toBe(2);
  });

  it("counts unreadable periods rather than dropping them silently", () => {
    const result = buildRoomsDown([period(), period({ id: "bad", rooms: null })]);
    expect(result.rows).toHaveLength(1);
    expect(result.unreadable).toBe(1);
  });

  it("is empty for no periods", () => {
    expect(buildRoomsDown([])).toEqual({ rows: [], unreadable: 0, needsDecision: 0 });
  });
});
