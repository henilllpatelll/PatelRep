import type { Room } from "@/stores/appStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { snapshotFromDashboard } from "@/lib/ai/companion";
import { buildHomeModel, type HomeModelInput, type HomeBoardInput } from "@/lib/housekeeping/homeModel";
import { buildDashboard } from "@/lib/housekeeping/myRoomsDashboard";
import { resolveShiftLifecycle } from "@/lib/housekeeping/shiftLifecycle";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";

const NOW = new Date("2026-10-14T15:00:00.000Z");
const TODAY = "2026-10-14";

function room(id: string, overrides: Partial<Room> = {}): Room {
  return {
    id,
    room_number: id.replace(/\D/g, "") || id,
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    actual_checkout_at: "2026-10-14T12:00:00.000Z",
    clean_type: "DEP",
    clean_type_label: "Departure",
    assignment_date: TODAY,
    ...overrides,
  };
}

function session(roomId: string, overrides: Partial<LocalCleanSession> = {}): LocalCleanSession {
  return {
    roomId,
    sessionId: `s-${roomId}`,
    cleanType: "DEP",
    startedAt: "2026-10-14T14:42:00.000Z",
    entryAcknowledged: true,
    checklist: [{ item_id: "a", section: "Bed", label: "Make bed", is_required: true, checked: true, checked_at: null }],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-14T14:50:00.000Z",
    ...overrides,
  };
}

const lifecycle = resolveShiftLifecycle({
  current: null,
  lastEnded: null,
  serverConfirmed: true,
  lastFetchFailed: false,
  pendingOp: null,
  shiftDate: TODAY,
  timeZone: "America/Chicago",
  isOnline: true,
});

const readyBoard: HomeBoardInput = {
  loading: false,
  refreshing: false,
  confirmedEmpty: false,
  freshness: "fresh",
  fetchError: null,
  usingCache: false,
  lastRefreshAt: NOW.getTime() - 30_000,
  serverShiftDate: TODAY,
  answeredForDate: TODAY,
};

function build(rooms: Room[], extra: Partial<HomeModelInput> = {}, sessions: Record<string, LocalCleanSession> = {}) {
  return buildHomeModel({
    rooms,
    sessions,
    rankedAt: NOW,
    now: NOW,
    expectedShiftDate: TODAY,
    timeZone: "America/Chicago",
    isOnline: true,
    board: readyBoard,
    lifecycle,
    syncRows: [],
    syncRowsComplete: true,
    supervisorNote: null,
    ...extra,
  });
}

describe("Home progress", () => {
  it("does not count out-of-order or out-of-service rooms as rooms cleaned", () => {
    const model = build([
      room("101", { status: "CLEAN" }),
      room("102", { status: "OOO" }),
      room("103", { status: "OUT_OF_SERVICE" }),
      room("104"),
    ]);
    const p = model.progress;
    expect(p.assigned).toBe(4);
    expect(p.unavailable).toBe(2);
    expect(p.serviceable).toBe(2);
    expect(p.completed).toBe(1);
    expect(p.percent).toBe(50);
    expect(snapshotFromDashboard(model.dashboard, "en-US", NOW).done).toBe(1);
  });

  it("keeps submitted and inspected rooms separate and never double counts them", () => {
    const model = build([room("101", { status: "CLEAN" }), room("102", { status: "INSPECTED" }), room("103")]);
    expect(model.progress.submitted).toBe(1);
    expect(model.progress.inspected).toBe(1);
    expect(model.progress.completed).toBe(2);
    expect(model.progress.serviceable).toBe(3);
  });

  it("does not claim an inspected room was cleaned by this person without a confirmed session", () => {
    const rooms = [room("101", { status: "INSPECTED" }), room("102", { status: "CLEAN" })];
    const none = build(rooms);
    expect(none.progress.confirmedByYou).toBe(0);
    const withEvidence = build(rooms, {}, { "102": session("102", { completionConfirmed: true }) });
    expect(withEvidence.progress.confirmedByYou).toBe(1);
    expect(withEvidence.progress.completed).toBe(2);
  });

  it("puts every assigned room in exactly one bucket; overlapping signals live in alerts", () => {
    const rooms = [
      room("101", { status: "CLEAN" }),
      room("102", { status: "INSPECTED" }),
      room("103", { status: "OOO" }),
      room("104", { status: "IN_PROGRESS" }),
      room("105"), // ready to start
      room("106", { priority: 1, priority_needed_by: "2026-10-14T14:00:00.000Z", vip_flag: true }), // rush, overdue, VIP
      room("107", { dnd_flag: true, dnd_attempt_count: 1 }), // exception
      room("108", { do_not_service: true, service_declined_reason: "guest declined", clean_type: "FULL", actual_checkout_at: null, status: "PICKUP" }), // exception
      room("109", { risk_level: "HIGH" }), // open attention
      room("110", { latest_note: "BLOCKER: guest inside" }), // open attention
    ];
    const p = build(rooms, {}, { "104": session("104") }).progress;
    expect(p.completed + p.handledExceptions + p.actionRequired.total + p.unavailable).toBe(p.assigned);
    expect(p.handledExceptions).toBe(2);
    expect(p.actionRequired).toEqual({ total: 5, active: 1, ready: 2, attention: 2 });
    expect(p.workable).toBe(3);

    const alerts = build(rooms, {}, { "104": session("104") }).alerts;
    expect(alerts.rush).toBe(1);
    expect(alerts.rushOverdue).toBe(1);
    expect(alerts.vip).toBe(1);
    expect(alerts.dnd).toBe(1);
    expect(alerts.serviceDeclined).toBe(1);
  });

  it("derives the same numbers Home and My Rooms show", () => {
    const rooms = [room("101", { status: "CLEAN" }), room("102", { status: "OUT_OF_ORDER" }), room("103"), room("104", { dnd_flag: true })];
    const sessions = {};
    const model = build(rooms);
    const dashboard = buildDashboard(rooms, sessions, NOW);
    expect(model.dashboard.progress).toEqual(dashboard.progress);
    const snapshot = snapshotFromDashboard(model.dashboard, "en-US", NOW);
    expect(snapshot.total).toBe(dashboard.progress.serviceable);
    expect(snapshot.done).toBe(dashboard.progress.completed);
    expect(snapshot.pct).toBe(dashboard.progress.percent);
    expect(model.progress.percent).toBe(dashboard.progress.percent);
  });

  it("does not count a completion the server has not confirmed", () => {
    const rooms = [room("101", { status: "IN_PROGRESS" }), room("102", { status: "CLEAN" })];
    const model = build(rooms, {}, { "101": session("101", { completeRequestedAt: "2026-10-14T14:58:00.000Z" }) });
    expect(model.progress.completed).toBe(1);
    expect(model.progress.awaitingConfirmation).toBe(1);
    expect(model.activeRoom?.completing).toBe(true);
    expect(model.activeRoom?.sessionState).toBe("completing");
  });

  it("counts a completion once the server confirmed it, even if the list still says in progress", () => {
    const rooms = [room("101", { status: "IN_PROGRESS" })];
    const model = build(rooms, {}, { "101": session("101", { completionConfirmed: true, completeRequestedAt: "2026-10-14T14:58:00.000Z" }) });
    expect(model.progress.completed).toBe(1);
    expect(model.progress.awaitingConfirmation).toBe(0);
  });
});

describe("Home recommendation", () => {
  it("keeps an active cleaning session as the principal focus over rush work", () => {
    const rooms = [room("101", { status: "IN_PROGRESS" }), room("102", { priority: 1 })];
    const model = build(rooms, {}, { "101": session("101") });
    expect(model.recommendation?.kind).toBe("continue");
    expect(model.recommendation?.room.id).toBe("101");
    expect(model.recommendation?.reason).toBe("active_session");
    expect(model.recommendation?.priority).toBe("active");
  });

  it("follows the supervisor's sequence, and says so", () => {
    const rooms = [room("101", { sequence_order: 2 }), room("102", { sequence_order: 1 }), room("103")];
    const rec = build(rooms).recommendation;
    expect(rec?.room.id).toBe("102");
    expect(rec?.reason).toBe("assigned_sequence");
    expect(rec?.timing.sequenceOrder).toBe(1);
  });

  it("notes that a sequenced room is also rush", () => {
    const rooms = [room("101", { sequence_order: 1, priority: 1, priority_needed_by: "2026-10-14T19:00:00.000Z" }), room("102")];
    const rec = build(rooms).recommendation;
    expect(rec?.room.id).toBe("101");
    expect(rec?.reason).toBe("assigned_sequence");
    expect(rec?.alsoApplies).toContain("rush");
    expect(rec?.timing.neededBy).toBe("2026-10-14T19:00:00.000Z");
    expect(rec?.timing.neededByOverdue).toBe(false);
  });

  it("puts rush work (by priority, then deadline) ahead of unsequenced standard rooms", () => {
    const rooms = [
      room("101"),
      room("102", { priority: 2, priority_needed_by: "2026-10-14T18:00:00.000Z" }),
      room("103", { priority: 1, priority_needed_by: "2026-10-14T20:00:00.000Z" }),
    ];
    const rec = build(rooms).recommendation;
    expect(rec?.room.id).toBe("103");
    expect(rec?.reason).toBe("rush");
    expect(rec?.priority).toBe("rush");
  });

  it("reports an overdue rush deadline as timing and as a critical attention item", () => {
    const rooms = [room("101", { priority: 1, priority_needed_by: "2026-10-14T14:00:00.000Z" })];
    const model = build(rooms);
    expect(model.recommendation?.timing.neededByOverdue).toBe(true);
    const item = model.attention.find((a) => a.code === "rush_overdue");
    expect(item?.severity).toBe("critical");
    expect(item?.destination).toEqual({ route: "room", roomId: "101" });
  });

  it("prioritizes an inspector's reclean over the standard queue", () => {
    const rooms = [room("101"), room("102", { reclean_requested_at: "2026-10-14T13:00:00.000Z", reclean_corrections: ["Dust"] })];
    const rec = build(rooms).recommendation;
    expect(rec?.room.id).toBe("102");
    expect(rec?.reason).toBe("reclean");
  });

  it("reports a verified checkout, and not a scheduled one", () => {
    const verified = build([room("101")]).recommendation;
    expect(verified?.reason).toBe("checkout_verified");
    expect(verified?.timing.checkoutVerifiedAt).toBe("2026-10-14T12:00:00.000Z");

    const scheduledOnly = build([room("102", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" })]);
    expect(scheduledOnly.recommendation).toBeNull();
    expect(scheduledOnly.attention.some((a) => a.code === "checkout_unverified")).toBe(true);
  });

  it("never recommends a room with DND, declined service, or blocked access", () => {
    const rooms = [
      room("101", { dnd_flag: true, dnd_attempt_count: 1 }),
      room("102", { do_not_service: true, service_declined_reason: "guest declined", clean_type: "FULL", actual_checkout_at: null, status: "PICKUP" }),
      room("103", { status: "OUT_OF_ORDER" }),
      room("104", { latest_note: "BLOCKER: can't enter" }),
    ];
    const model = build(rooms);
    expect(model.recommendation).toBeNull();
    expect(model.noRecommendation).toBe("only_attention");
    expect(model.progress.actionRequired.ready).toBe(0);
  });

  it("is deterministic: the same inputs always give the same room, whatever order the API delivered", () => {
    const rooms = [room("105"), room("102"), room("109", { priority: 1 }), room("101")];
    const a = build(rooms).recommendation?.room.id;
    const b = build([...rooms].reverse()).recommendation?.room.id;
    expect(a).toBe("109");
    expect(b).toBe("109");
  });

  it("explains why there is nothing to recommend", () => {
    expect(build([room("101", { status: "CLEAN" })]).noRecommendation).toBe("all_done");
    expect(build([], { board: { ...readyBoard, confirmedEmpty: true } }).noRecommendation).toBe("no_rooms");
    expect(build([], { board: { ...readyBoard, confirmedEmpty: false } }).noRecommendation).toBe("board_unavailable");
  });
});

describe("Home active room timing", () => {
  it("uses the clean session's start, not the room's last update", () => {
    const rooms = [room("101", { status: "IN_PROGRESS", updated_at: "2026-10-14T14:59:30.000Z" })];
    const active = build(rooms, {}, { "101": session("101", { startedAt: "2026-10-14T14:42:00.000Z" }) }).activeRoom;
    expect(active?.startedAt).toBe("2026-10-14T14:42:00.000Z");
    expect(active?.elapsedSeconds).toBe(18 * 60);
    expect(active?.startedAtVerified).toBe(true);
  });

  it("does not invent a timer when the session start is unknown", () => {
    const rooms = [room("101", { status: "IN_PROGRESS", updated_at: "2026-10-14T14:59:30.000Z" })];
    const active = build(rooms).activeRoom;
    expect(active?.sessionState).toBe("missing");
    expect(active?.startedAt).toBeNull();
    expect(active?.elapsedSeconds).toBeNull();
    expect(active?.startedAtVerified).toBe(false);
  });

  it("marks an offline-started session as not yet verified by the server", () => {
    const rooms = [room("101", { status: "IN_PROGRESS" })];
    const active = build(rooms, {}, { "101": session("101", { startConfirmed: false }) }).activeRoom;
    expect(active?.sessionState).toBe("starting");
    expect(active?.startedAt).toBe("2026-10-14T14:42:00.000Z");
    expect(active?.startedAtVerified).toBe(false);
    expect(active?.pendingSync).toBe(true);
  });

  it("does not reset the timer when the room receives a note or other update", () => {
    const before = build([room("101", { status: "IN_PROGRESS" })], {}, { "101": session("101") }).activeRoom;
    const after = build(
      [room("101", { status: "IN_PROGRESS", latest_note: "Extra towels", updated_at: "2026-10-14T14:59:59.000Z" })],
      {},
      { "101": session("101") },
    ).activeRoom;
    expect(after?.elapsedSeconds).toBe(before?.elapsedSeconds);
  });
});

describe("Home attention items", () => {
  it("are structured with stable ids and a destination", () => {
    const rooms = [room("101", { dnd_flag: true, dnd_retry_at: "2026-10-14T18:00:00.000Z", dnd_attempt_count: 1 }), room("102", { risk_level: "HIGH" })];
    const first = build(rooms).attention;
    const second = build([...rooms].reverse()).attention;
    expect(first.map((i) => i.id).sort()).toEqual(second.map((i) => i.id).sort());
    const dnd = first.find((i) => i.code === "dnd");
    expect(dnd).toMatchObject({
      id: "room:101:dnd",
      kind: "room",
      roomId: "101",
      roomNumber: "101",
      severity: "info",
      at: "2026-10-14T18:00:00.000Z",
      destination: { route: "room", roomId: "101" },
    });
    expect(first.find((i) => i.code === "high_risk")?.severity).toBe("warning");
  });

  it("orders by severity, so a sync conflict comes before a DND note", () => {
    const rows: SyncRow[] = [{ key: "session-101-conflict", roomId: "101", kind: "completion", state: "conflict" }];
    const model = build([room("101", { status: "IN_PROGRESS" }), room("102", { dnd_flag: true })], { syncRows: rows }, { "101": session("101") });
    expect(model.attention[0]).toMatchObject({ code: "sync_conflict", severity: "critical", recordId: "session-101-conflict" });
    expect(model.attention[model.attention.length - 1].severity).toBe("info");
  });

  it("carries the supervisor's instruction with its record id and destination", () => {
    const model = build([room("101")], { supervisorNote: { id: "n1", title: "Heads up", body: "Take 115 after 108", createdAt: "2026-10-14T14:00:00.000Z" } });
    expect(model.supervisorInstruction).toMatchObject({
      id: "n1",
      title: "Heads up",
      destination: { route: "notification", notificationId: "n1" },
    });
    expect(model.attention.find((i) => i.kind === "supervisor_message")).toMatchObject({ id: "message:n1", recordId: "n1" });
  });

  it("flags a session this device holds for a room that left the board (reassigned)", () => {
    const withRoom = build([room("101", { status: "IN_PROGRESS" })], {}, { "101": session("101") });
    expect(withRoom.attention.some((i) => i.kind === "session_unassigned")).toBe(false);

    const reassigned = build([room("102")], {}, { "101": session("101") });
    expect(reassigned.attention[0]).toMatchObject({ kind: "session_unassigned", severity: "critical", roomId: "101", recordId: "s-101" });
    expect(reassigned.progress.assigned).toBe(1);
  });

  it("flags an in-progress room this device has no session for", () => {
    const model = build([room("101", { status: "IN_PROGRESS" })]);
    expect(model.attention.find((i) => i.code === "session_missing")).toMatchObject({ roomId: "101", severity: "warning" });
  });
});

describe("Home board state", () => {
  it("treats a failed request as unavailable, never as an empty board", () => {
    const failed = build([], { board: { ...readyBoard, confirmedEmpty: false, fetchError: "network", freshness: "never", lastRefreshAt: null, serverShiftDate: null, answeredForDate: null } });
    expect(failed.board.state).toBe("unavailable");
    expect(failed.endOfShift.ready).toBe(false);
    expect(failed.endOfShift.blockers).toContainEqual({ code: "board_unavailable", count: 1 });
  });

  it("says empty only when the server answered with no assignments", () => {
    const empty = build([], { board: { ...readyBoard, confirmedEmpty: true } });
    expect(empty.board.state).toBe("empty");
    expect(empty.endOfShift.ready).toBe(true);
  });

  it("keeps showing cached rooms when a refresh fails, labelled stale", () => {
    const model = build([room("101"), room("102", { status: "CLEAN" })], {
      isOnline: true,
      board: { ...readyBoard, fetchError: "timeout", usingCache: true, freshness: "stale" },
    });
    expect(model.board.state).toBe("ready");
    expect(model.board.freshness).toBe("stale");
    expect(model.progress.assigned).toBe(2);
    expect(model.sync.status).toBe("stale");
    expect(model.sync.refreshFailed).toBe(true);
  });

  it("serves the device cache when offline and says so", () => {
    const model = build([room("101")], {
      isOnline: false,
      board: { ...readyBoard, freshness: "cached", usingCache: true, lastRefreshAt: null, serverShiftDate: null, answeredForDate: null },
    });
    expect(model.board.state).toBe("ready");
    expect(model.board.freshness).toBe("cached");
    expect(model.sync.online).toBe(false);
    expect(model.sync.status).toBe("offline");
    expect(model.sync.lastRefreshAt).toBeNull();
    expect(model.recommendation?.room.id).toBe("101");
  });

  it("shows loading only while there is nothing yet to show", () => {
    expect(build([], { board: { ...readyBoard, loading: true, lastRefreshAt: null } }).board.state).toBe("loading");
  });

  it("hides yesterday's rooms once the hotel's day rolls over, until today's list arrives", () => {
    const yesterday = room("101", { assignment_date: "2026-10-13" });
    const rolled = build([yesterday], { expectedShiftDate: "2026-10-14", board: { ...readyBoard, serverShiftDate: "2026-10-13", answeredForDate: "2026-10-13" } });
    expect(rolled.board.state).toBe("stale_date");
    expect(rolled.progress.assigned).toBe(0);
    expect(rolled.recommendation).toBeNull();
    expect(rolled.endOfShift.ready).toBe(false);
  });

  it("drops individual rooms dated for another day when the list is mixed", () => {
    const model = build([room("101"), room("102", { assignment_date: "2026-10-13" })]);
    expect(model.progress.assigned).toBe(1);
  });

  it("trusts the server's date when it answered for today with its own hotel date", () => {
    const serverDay = room("101", { assignment_date: "2026-10-13" });
    const model = build([serverDay], {
      expectedShiftDate: "2026-10-14",
      board: { ...readyBoard, serverShiftDate: "2026-10-13", answeredForDate: "2026-10-14" },
    });
    expect(model.board.state).toBe("ready");
    expect(model.shiftDate).toBe("2026-10-13");
  });
});

describe("Home sync summary", () => {
  it("never represents a locally queued completion as server-confirmed", () => {
    const rows: SyncRow[] = [{ key: "session-101-complete", roomId: "101", kind: "completion", state: "pending" }];
    const model = build([room("101", { status: "IN_PROGRESS" })], { syncRows: rows }, { "101": session("101", { completeRequestedAt: "2026-10-14T14:58:00.000Z" }) });
    expect(model.sync.pending).toBe(1);
    expect(model.sync.completionsAwaitingConfirmation).toBe(1);
    expect(model.sync.status).toBe("pending");
    expect(model.progress.completed).toBe(0);
    expect(model.endOfShift.ready).toBe(false);
  });

  it("counts failed and conflicting changes separately and asks for attention", () => {
    const rows: SyncRow[] = [
      { key: "a", roomId: "101", kind: "checklist", state: "pending", count: 3 },
      { key: "b", roomId: "102", kind: "linen", state: "failed" },
      { key: "c", roomId: "103", kind: "completion", state: "conflict" },
    ];
    const sync = build([room("101")], { syncRows: rows }).sync;
    expect(sync).toMatchObject({ pending: 3, failed: 1, conflicts: 1, status: "attention" });
  });

  it("does not say everything is saved when a queue could not be read", () => {
    const sync = build([room("101")], { syncRowsComplete: false }).sync;
    expect(sync.complete).toBe(false);
    expect(sync.status).toBe("pending");
  });
});

describe("Home end of shift", () => {
  it("is ready only when nothing is left to do or to send", () => {
    const done = build([room("101", { status: "CLEAN" }), room("102", { status: "INSPECTED" })]);
    expect(done.endOfShift.ready).toBe(true);
    expect(done.endOfShift.completed).toBe(2);

    const remaining = build([room("101", { status: "CLEAN" }), room("102")]);
    expect(remaining.endOfShift.ready).toBe(false);
    expect(remaining.endOfShift.blockers).toContainEqual({ code: "rooms_remaining", count: 1 });
  });

  it("lists documented exceptions without blocking, and hands over open work orders", () => {
    const model = build([
      room("101", { status: "CLEAN", open_work_order_id: "wo-1", open_work_order_title: "Leaky faucet" }),
      room("102", { dnd_flag: true, dnd_attempt_count: 2 }),
    ]);
    expect(model.endOfShift.ready).toBe(true);
    expect(model.endOfShift.exceptions).toEqual([{ roomId: "102", roomNumber: "102", code: "dnd" }]);
    expect(model.endOfShift.handoffs).toEqual([{ roomId: "101", roomNumber: "101", workOrderId: "wo-1", title: "Leaky faucet" }]);
  });

  it("blocks on an open attention room and an active room", () => {
    const model = build([room("101", { status: "IN_PROGRESS" }), room("102", { risk_level: "HIGH" })], {}, { "101": session("101") });
    const codes = model.endOfShift.blockers.map((b) => b.code);
    expect(codes).toContain("active_room");
    expect(codes).toContain("attention_open");
  });
});
