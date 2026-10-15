import { build, room, session } from "../helpers/homeModelFixture";
import { makeTranslator } from "../helpers/i18n";
import { buildShiftReview, describeReviewItem, formatDuration } from "@/lib/housekeeping/shiftReview";
import { buildShiftSummary } from "@/lib/housekeeping/shiftSummary";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";

const t = makeTranslator("en");
const NOW = new Date("2026-10-14T15:00:00.000Z");

const submitted = (id: string) => room(id, { status: "CLEAN" });
const inspected = (id: string) => room(id, { status: "INSPECTED" });

describe("buildShiftReview — totals", () => {
  it("reports the shared progress model, split into submitted and inspected", () => {
    const review = buildShiftReview(build([submitted("101"), submitted("102"), inspected("103"), room("104", { status: "OUT_OF_ORDER" })]));
    expect(review.totals).toMatchObject({ assigned: 4, completed: 3, submitted: 2, inspected: 1, unavailable: 1 });
    expect(review.boardUsable).toBe(true);
    expect(review.remaining).toBe(0);
    expect(review.items).toEqual([]);
    expect(review.warnings).toEqual([]);
  });

  it("counts a DND room as a documented exception, not as unfinished work", () => {
    const model = build([submitted("101"), room("315", { dnd_flag: true })]);
    const review = buildShiftReview(model);
    expect(review.totals.exceptions).toBe(1);
    expect(review.remaining).toBe(0);
    expect(review.items.map((item) => [item.kind, item.roomNumber])).toEqual([["exception", "315"]]);
  });

  it("does not trap anyone: clock-out stays available with unfinished rooms, and says so", () => {
    const model = build([submitted("101"), room("102"), room("103", { status: "IN_PROGRESS" })], {
      sessions: { "103": session("103") },
    });
    const review = buildShiftReview(model);
    expect(review.canClockOut).toBe(true);
    expect(review.blockedBy).toBeNull();
    expect(review.remaining).toBe(2);
    expect(review.warnings).toEqual(expect.arrayContaining(["active_room", "rooms_remaining"]));
    expect(review.activeRoomNumber).toBe("103");
    expect(review.items.filter((item) => item.kind === "unfinished").map((item) => item.roomNumber).sort()).toEqual(["102", "103"]);
  });

  it("only blocks clock-out for what the server itself requires: an open shift and a connection", () => {
    expect(buildShiftReview(build([submitted("101")], { shift: "ended" })).blockedBy).toBe("not_open");
    expect(buildShiftReview(build([submitted("101")], { shift: "not_started" })).blockedBy).toBe("not_open");
    const offline = buildShiftReview(build([submitted("101")], { online: false }));
    expect(offline.blockedBy).toBe("offline");
    expect(offline.canClockOut).toBe(false);
  });

  it("does not state room totals as fact when today's list could not be confirmed", () => {
    const review = buildShiftReview(build([], { board: { freshness: "never", confirmedEmpty: false, serverShiftDate: null, answeredForDate: null } }));
    expect(review.boardUsable).toBe(false);
    expect(review.warnings).toContain("board_unverified");
    expect(review.items.filter((item) => item.kind !== "sync")).toEqual([]);
  });
});

describe("buildShiftReview — handoffs", () => {
  it("lists a room with an open work order as a maintenance handoff that opens the work order", () => {
    const model = build([submitted("214"), room("214", { status: "CLEAN", open_work_order_id: "wo-9", open_work_order_title: "Leaking faucet" })].slice(1));
    const item = buildShiftReview(model).items.find((entry) => entry.kind === "maintenance");
    expect(item).toMatchObject({ roomNumber: "214", workOrderId: "wo-9", target: { type: "workOrder", workOrderId: "wo-9" } });
    expect(describeReviewItem(item!, t)).toEqual({
      title: "Room 214 — Maintenance",
      detail: "Open work order: Leaking faucet",
    });
  });

  it("does not assume a room with a work order is unsafe or uncleanable", () => {
    const model = build([room("214", { status: "CLEAN", open_work_order_id: "wo-9" })]);
    const review = buildShiftReview(model);
    expect(review.totals.completed).toBe(1);
    expect(review.items.map((item) => item.kind)).toEqual(["maintenance"]);
  });

  it("lists each room and kind once, even when several signals point at the same room", () => {
    const model = build([room("214", { status: "CLEAN", open_work_order_id: "wo-9", open_work_order_title: "Faucet" }), room("315", { dnd_flag: true, open_work_order_id: "wo-3" })]);
    const items = buildShiftReview(model).items;
    const keys = items.map((item) => item.id);
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.filter((item) => item.roomNumber === "315").map((item) => item.kind).sort()).toEqual(["exception", "maintenance"]);
    // an attention row for the same work order never doubles the maintenance handoff
    expect(items.filter((item) => item.kind === "maintenance")).toHaveLength(2);
  });

  it("opens the right place for each kind", () => {
    const model = build([room("214", { status: "CLEAN", open_work_order_id: "wo-9" }), room("315", { dnd_flag: true }), room("120")]);
    const targets = Object.fromEntries(buildShiftReview(model).items.map((item) => [item.kind, item.target]));
    expect(targets.maintenance).toEqual({ type: "workOrder", workOrderId: "wo-9" });
    expect(targets.exception).toMatchObject({ type: "room" });
    expect(targets.unfinished).toMatchObject({ type: "room" });
  });

  it("adds tasks and lost & found only when they are real and counted", () => {
    const model = build([submitted("101")]);
    expect(buildShiftReview(model).items).toEqual([]);
    expect(buildShiftReview(model, { openTasks: 0, foundToday: 0 }).items).toEqual([]);
    const items = buildShiftReview(model, { openTasks: 2, foundToday: 1 }).items;
    expect(items.map((item) => [item.kind, item.count, item.target.type])).toEqual([
      ["tasks", 2, "tasks"],
      ["lost_found", 1, "lostFound"],
    ]);
    expect(describeReviewItem(items[0], t).title).toBe("2 open tasks");
  });
});

describe("buildShiftReview — sync", () => {
  const row = (overrides: Partial<SyncRow>): SyncRow => ({ key: "r", roomId: null, kind: "checklist", state: "pending", ...overrides });

  it("counts what is still on the phone and warns without blocking", () => {
    const model = build([submitted("101")], { syncRows: [row({ key: "a", count: 3 }), row({ key: "b", kind: "completion" })] });
    const review = buildShiftReview(model);
    expect(review.sync).toMatchObject({ pending: 4, failed: 0, conflicts: 0, verified: true });
    expect(review.warnings).toContain("pending_sync");
    expect(review.canClockOut).toBe(true);
  });

  it("surfaces a refused change as a sync handoff that opens Sync Status", () => {
    const model = build([submitted("208")], { syncRows: [row({ key: "c", state: "conflict", roomId: "208" })] });
    const review = buildShiftReview(model);
    expect(review.warnings).toContain("sync_problem");
    const item = review.items.find((entry) => entry.kind === "sync");
    expect(item).toMatchObject({ roomNumber: "208", target: { type: "sync" } });
  });

  it("never turns a room waiting to send into 'unfinished'", () => {
    const model = build([room("108", { status: "IN_PROGRESS" })], {
      sessions: { "108": session("108", { checklist: [], completeRequestedAt: "2026-10-14T14:58:00.000Z" }) },
    });
    const review = buildShiftReview(model);
    expect(review.items.filter((item) => item.kind === "unfinished")).toEqual([]);
    expect(review.activeRoomNumber).toBeNull();
  });
});

describe("buildShiftSummary", () => {
  it("states recorded times and outcomes, with no scores", () => {
    const model = build([submitted("101"), inspected("102"), room("315", { dnd_flag: true }), room("214", { status: "CLEAN", open_work_order_id: "wo-1" })], { shift: "ended", now: NOW });
    const summary = buildShiftSummary(model, NOW);
    expect(summary.clockedInAt).toBe("2026-10-14T13:00:00.000Z");
    expect(summary.clockedOutAt).toBe("2026-10-14T14:55:00.000Z");
    expect(summary.workedSeconds).toBe(115 * 60);
    expect(summary.rooms).toMatchObject({ submitted: 2, inspected: 1, unavailable: 0, confirmedByYou: 0 });
    expect(summary.exceptions.map((item) => item.roomNumber)).toEqual(["315"]);
    expect(summary.handoffs.map((item) => item.roomNumber)).toEqual(["214"]);
    expect(Object.keys(summary).join(" ")).not.toMatch(/score|rank|pace|percent/i);
  });

  it("does not credit an inspected room to the person without server-confirmed evidence", () => {
    const summary = buildShiftSummary(build([inspected("101")], { shift: "ended" }), NOW);
    expect(summary.rooms.inspected).toBe(1);
    expect(summary.rooms.confirmedByYou).toBe(0);
  });

  it("keeps unfinished and unsent work visible instead of claiming everything is final", () => {
    const row: SyncRow = { key: "x", roomId: null, kind: "checklist", state: "pending" };
    const summary = buildShiftSummary(build([submitted("101"), room("102")], { shift: "ended", syncRows: [row] }), NOW);
    expect(summary.leftOpen.map((item) => item.roomNumber)).toEqual(["102"]);
    expect(summary.sync.pending).toBe(1);
  });

  it("has no clock-out time before the server confirmed one", () => {
    expect(buildShiftSummary(build([submitted("101")], { shift: "active" }), NOW).clockedOutAt).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(25 * 60)).toBe("25m");
    expect(formatDuration(7 * 3600 + 25 * 60)).toBe("7h 25m");
  });
});
