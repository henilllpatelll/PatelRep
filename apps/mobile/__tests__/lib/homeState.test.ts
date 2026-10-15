import type { Room } from "@/stores/appStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { buildHomeModel, type HomeBoardInput, type HomeModelInput } from "@/lib/housekeeping/homeModel";
import {
  buildAttentionPreview,
  canQuickMarkClean,
  progressCounts,
  resolveHomeState,
  selectUpNext,
  submissionFor,
} from "@/lib/housekeeping/homeState";
import { resolveShiftLifecycle, type ShiftLifecycleInput } from "@/lib/housekeeping/shiftLifecycle";
import type { ShiftSession } from "@/lib/api/shifts";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";

const NOW = new Date("2026-10-14T15:00:00.000Z");
const TODAY = "2026-10-14";
const ZONE = "America/Chicago";

function room(id: string, overrides: Partial<Room> = {}): Room {
  return {
    id,
    room_number: id.replace(/\D/g, "") || id,
    floor: 2,
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
    checklist: [
      { item_id: "a", section: "Bed", label: "Make bed", is_required: true, checked: true, checked_at: null },
      { item_id: "b", section: "Bath", label: "Bathroom", is_required: true, checked: false, checked_at: null },
    ],
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

function shiftRow(overrides: Partial<ShiftSession> = {}): ShiftSession {
  return {
    id: "shift-1",
    status: "active",
    started_at: "2026-10-14T13:00:00.000Z",
    ended_at: null,
    on_break_since: null,
    break_seconds: 0,
    ...overrides,
  } as ShiftSession;
}

function lifecycleFor(kind: "not_started" | "active" | "on_break" | "ended" | "unknown", extra: Partial<ShiftLifecycleInput> = {}) {
  const base: ShiftLifecycleInput = {
    current: null,
    lastEnded: null,
    serverConfirmed: kind !== "unknown",
    lastFetchFailed: false,
    pendingOp: null,
    shiftDate: TODAY,
    timeZone: ZONE,
    isOnline: true,
  };
  if (kind === "active") base.current = shiftRow();
  if (kind === "on_break") base.current = shiftRow({ status: "on_break", on_break_since: "2026-10-14T14:30:00.000Z" });
  if (kind === "ended") {
    base.lastEnded = shiftRow({ status: "ended", ended_at: "2026-10-14T14:55:00.000Z" });
  }
  return resolveShiftLifecycle({ ...base, ...extra });
}

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

function build(
  rooms: Room[],
  opts: {
    shift?: Parameters<typeof lifecycleFor>[0];
    sessions?: Record<string, LocalCleanSession>;
    board?: Partial<HomeBoardInput>;
    online?: boolean;
    syncRows?: SyncRow[];
    note?: HomeModelInput["supervisorNote"];
  } = {},
) {
  const online = opts.online ?? true;
  return buildHomeModel({
    rooms,
    sessions: opts.sessions ?? {},
    rankedAt: NOW,
    now: NOW,
    expectedShiftDate: TODAY,
    timeZone: ZONE,
    isOnline: online,
    board: { ...readyBoard, ...opts.board },
    lifecycle: lifecycleFor(opts.shift ?? "active", { isOnline: online }),
    syncRows: opts.syncRows ?? [],
    syncRowsComplete: true,
    supervisorNote: opts.note ?? null,
  });
}

describe("resolveHomeState: the nine states", () => {
  it("State 1 — before the shift: no active room, shift not started", () => {
    const view = resolveHomeState(build([room("101"), room("102")], { shift: "not_started" }));
    expect(view.kind).toBe("before_shift");
    expect(view.startNudge).toBe(false);
  });

  it("State 2 — started, no active room: the recommended room leads", () => {
    const model = build([room("101"), room("102")]);
    const view = resolveHomeState(model);
    expect(view.kind).toBe("idle");
    expect(view.lead?.kind).toBe("start");
    expect(view.lead?.room.id).toBe("101");
  });

  it("State 3 — cleaning in progress: the open session leads, above any other room", () => {
    const model = build([room("101"), room("102", { status: "IN_PROGRESS" })], { sessions: { "102": session("102") } });
    const view = resolveHomeState(model);
    expect(view.kind).toBe("cleaning");
    expect(view.lead?.kind).toBe("continue");
    expect(view.lead?.room.id).toBe("102");
  });

  it("State 4 — submitted: a room finished moments ago, with the next room suggested", () => {
    const model = build([room("101", { status: "CLEAN" }), room("102")], {
      sessions: {
        "101": session("101", { completionConfirmed: true, endedAt: "2026-10-14T14:57:00.000Z", completeRequestedAt: "2026-10-14T14:57:00.000Z" }),
      },
    });
    const view = resolveHomeState(model);
    expect(view.kind).toBe("submitted");
    expect(view.lead?.room.id).toBe("102");
    expect(submissionFor(model)).toMatchObject({ roomNumber: "101", confirmed: true, inspected: false });
  });

  it("State 5 — needs attention: nothing to start, so the issues lead", () => {
    const model = build([room("101", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null })]);
    const view = resolveHomeState(model);
    expect(view.kind).toBe("attention");
    expect(view.lead).toBeNull();
    expect(model.attention.length).toBeGreaterThan(0);
  });

  it("State 6 — no assignments: only when the server confirmed zero rooms", () => {
    const view = resolveHomeState(build([], { board: { confirmedEmpty: true } }));
    expect(view.kind).toBe("no_assignments");
  });

  it("State 7 — a failed or offline load with nothing cached is 'unavailable', never 'no assignments'", () => {
    const failed = resolveHomeState(build([], { board: { confirmedEmpty: false, fetchError: "boom", freshness: "never" } }));
    expect(failed.kind).toBe("unavailable");
    const offline = resolveHomeState(build([], { online: false, board: { confirmedEmpty: false, freshness: "never" } }));
    expect(offline.kind).toBe("unavailable");
  });

  it("State 7 — with cached rooms the work stays visible and the reason is a notice", () => {
    const offline = resolveHomeState(build([room("101")], { online: false, board: { freshness: "cached", usingCache: true, lastRefreshAt: null } }));
    expect(offline.kind).toBe("idle");
    expect(offline.notice).toEqual({ kind: "offline", lastRefreshAt: null });

    const failed = resolveHomeState(build([room("101")], { board: { fetchError: "500", freshness: "stale" } }));
    expect(failed.notice?.kind).toBe("refresh_failed");

    const stale = resolveHomeState(build([room("101")], { board: { freshness: "stale" } }));
    expect(stale.notice?.kind).toBe("stale");

    expect(resolveHomeState(build([room("101")])).notice).toBeNull();
  });

  it("State 8 — on break wins over everything, including an open room", () => {
    const model = build([room("101", { status: "IN_PROGRESS" })], { shift: "on_break", sessions: { "101": session("101") } });
    expect(resolveHomeState(model).kind).toBe("on_break");
  });

  it("State 9 — clocked out is stable: it never reverts to before_shift", () => {
    expect(resolveHomeState(build([room("101")], { shift: "ended" })).kind).toBe("clocked_out");
    expect(resolveHomeState(build([], { shift: "ended", board: { confirmedEmpty: true } })).kind).toBe("clocked_out");
  });

  it("is loading during the first load and when the hotel day rolled over", () => {
    expect(resolveHomeState(build([], { board: { loading: true } })).kind).toBe("loading");
    const stale = build([room("101", { assignment_date: "2026-10-13" })], { board: { serverShiftDate: null, answeredForDate: null } });
    expect(resolveHomeState(stale).kind).toBe("loading");
  });

  it("an unreadable shift does not hide the work: the board decides", () => {
    const view = resolveHomeState(build([room("101")], { shift: "unknown" }));
    expect(view.kind).toBe("idle");
  });

  it("offers a quiet Start Shift when work is already open but the shift never started", () => {
    const model = build([room("101", { status: "IN_PROGRESS" })], { shift: "not_started", sessions: { "101": session("101") } });
    const view = resolveHomeState(model);
    expect(view.kind).toBe("cleaning");
    expect(view.startNudge).toBe(true);
  });

  it("flags all-done so clock-out can lead", () => {
    const view = resolveHomeState(build([room("101", { status: "CLEAN" }), room("102", { status: "INSPECTED" })]));
    expect(view.allDone).toBe(true);
    expect(view.kind).toBe("idle");
  });
});

describe("a completion still waiting to send", () => {
  const pending = () =>
    build([room("101", { status: "IN_PROGRESS" }), room("102")], {
      sessions: { "101": session("101", { completeRequestedAt: "2026-10-14T14:58:00.000Z", completionConfirmed: false }) },
    });

  it("is a submitted state that is NOT confirmed, with the next room suggested", () => {
    const model = pending();
    const view = resolveHomeState(model);
    expect(view.kind).toBe("submitted");
    expect(view.lead?.room.id).toBe("102");
    expect(submissionFor(model)).toMatchObject({ roomNumber: "101", confirmed: false });
  });

  it("is not counted as completed until the server confirms", () => {
    const model = pending();
    expect(model.progress.completed).toBe(0);
    expect(model.progress.awaitingConfirmation).toBe(1);
  });
});

describe("recent submission", () => {
  const sessions = (endedAt: string) => ({
    "101": session("101", { completionConfirmed: true, endedAt, completeRequestedAt: endedAt }),
  });

  it("expires after ten minutes", () => {
    const old = build([room("101", { status: "CLEAN" }), room("102")], { sessions: sessions("2026-10-14T14:40:00.000Z") });
    expect(old.recentSubmission).toBeNull();
    expect(resolveHomeState(old).kind).toBe("idle");
  });

  it("distinguishes Clean from Inspected", () => {
    const clean = build([room("101", { status: "CLEAN" }), room("102")], { sessions: sessions("2026-10-14T14:57:00.000Z") });
    expect(clean.recentSubmission?.inspected).toBe(false);
    const inspected = build([room("101", { status: "INSPECTED" }), room("102")], { sessions: sessions("2026-10-14T14:57:00.000Z") });
    expect(inspected.recentSubmission?.inspected).toBe(true);
  });

  it("ignores a room with no local session (it was not necessarily this person's work)", () => {
    expect(build([room("101", { status: "CLEAN" })]).recentSubmission).toBeNull();
  });
});

describe("Right Now / recommendation", () => {
  it("never recommends a DND room", () => {
    const model = build([room("101", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null }), room("102")]);
    expect(resolveHomeState(model).lead?.room.id).toBe("102");
  });

  it("puts a rush room first and reports why", () => {
    const rush = room("103", { priority: 1, priority_reason: "vip", priority_needed_by: "2026-10-14T17:00:00.000Z" } as Partial<Room>);
    const model = build([room("101"), room("102"), rush]);
    const lead = resolveHomeState(model).lead;
    expect(lead?.room.id).toBe("103");
    expect(lead?.reason).toBe("rush");
  });

  it("honours the supervisor's route sequence", () => {
    const model = build([
      room("101", { sequence_order: 2 } as Partial<Room>),
      room("102", { sequence_order: 1 } as Partial<Room>),
    ]);
    expect(resolveHomeState(model).lead?.room.id).toBe("102");
    expect(resolveHomeState(model).lead?.reason).toBe("assigned_sequence");
  });

  it("recovers, rather than invents a timer, when an in-progress room has no session", () => {
    const model = build([room("101", { status: "IN_PROGRESS" })]);
    expect(model.activeRoom?.sessionState).toBe("missing");
    expect(model.activeRoom?.startedAt).toBeNull();
    expect(model.activeRoom?.elapsedSeconds).toBeNull();
  });

  it("only offers quick Mark Clean on an open, non-departure session", () => {
    const light = room("101", { status: "IN_PROGRESS", clean_type: "LIGHT" });
    expect(canQuickMarkClean(build([light], { sessions: { "101": session("101", { cleanType: "LIGHT" }) } }))).toBe(true);
    const dep = room("102", { status: "IN_PROGRESS" });
    expect(canQuickMarkClean(build([dep], { sessions: { "102": session("102") } }))).toBe(false);
    expect(canQuickMarkClean(build([room("103")]))).toBe(false);
    // no session on this device: recovery, not a shortcut
    expect(canQuickMarkClean(build([light]))).toBe(false);
  });
});

describe("Up Next", () => {
  it("is never the room that already leads", () => {
    const model = build([room("101"), room("102"), room("103")]);
    const view = resolveHomeState(model);
    expect(view.lead?.room.id).toBe("101");
    expect(selectUpNext(model, view.lead)?.room.id).toBe("102");
  });

  it("is the next room, not the active one, during a clean", () => {
    const model = build([room("101", { status: "IN_PROGRESS" }), room("102")], { sessions: { "101": session("101") } });
    const view = resolveHomeState(model);
    expect(selectUpNext(model, view.lead)?.room.id).toBe("102");
  });

  it("is absent when only one eligible room remains, and excludes restricted and completed rooms", () => {
    const model = build([room("101"), room("102", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null }), room("103", { status: "CLEAN" })]);
    expect(selectUpNext(model, resolveHomeState(model).lead)).toBeNull();
  });
});

describe("progress counts", () => {
  it("are disjoint and never count unavailable rooms as cleaned", () => {
    const model = build([
      room("101", { status: "CLEAN" }),
      room("102", { status: "INSPECTED" }),
      room("103", { status: "OOO" }),
      room("104", { status: "IN_PROGRESS" }),
      room("105"),
      room("106"),
      room("107", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null }),
    ], { sessions: { "104": session("104") } });
    expect(model.progress.completed).toBe(2);
    expect(model.progress.unavailable).toBe(1);
    expect(model.progress.serviceable).toBe(6);
    const counts = progressCounts(model);
    expect(counts).toEqual({ toClean: 2, inProgress: 1, needAttention: 1 });
    expect(model.progress.completed + counts.toClean + counts.inProgress + counts.needAttention).toBe(model.progress.serviceable);
  });
});

describe("attention preview", () => {
  const dnd = (id: string) => room(id, { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null });

  it("ranks work the person can resolve above rooms they can only wait on", () => {
    const reclean = room("310", { status: "DIRTY", priority: 3 } as Partial<Room>);
    const model = build([dnd("214"), dnd("215"), reclean, room("101")], {
      note: { id: "n1", title: "Heads up", body: "Skip 105" },
    });
    const preview = buildAttentionPreview(model, 3);
    const groups = preview.shown.map((row) => row.group);
    // restricted rooms (DND) never outrank the supervisor message
    expect(groups.indexOf("message")).toBeLessThan(groups.indexOf("restricted"));
  });

  it("caps the preview but counts what is left", () => {
    const model = build([dnd("211"), dnd("212"), dnd("213"), dnd("214")]);
    const preview = buildAttentionPreview(model, 2);
    expect(preview.shown).toHaveLength(2);
    expect(preview.total).toBe(4);
    expect(preview.remaining).toBe(2);
  });

  it("never lists the same condition twice", () => {
    const model = build([dnd("211"), dnd("212")]);
    const ids = buildAttentionPreview(model, 10).shown.map((row) => row.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts a critical sync problem first and keeps the room link", () => {
    const row = { key: "r1", kind: "completion", state: "conflict", roomId: "101", count: 1 } as unknown as SyncRow;
    const model = build([dnd("211"), room("101")], { syncRows: [row] });
    const first = buildAttentionPreview(model).shown[0];
    expect(first.group).toBe("critical");
    expect(first.item.destination).toEqual({ route: "room", roomId: "101" });
  });
});
