import type { Room } from "@/stores/appStore";
import type { ChecklistItem, LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import {
  findNextRoom,
  getStickyActions,
  needsKnockProtocol,
  resolveRoomDetailView,
  type ActionContext,
  type ResolveInput,
} from "@/lib/housekeeping/roomDetailState";

const NOW = new Date("2026-10-09T17:00:00.000Z");
const CHECKED_OUT = "2026-10-09T16:00:00.000Z";

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "224",
    floor: 2,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: CHECKED_OUT,
    fo_status: "VAC",
    clean_type: "DEP",
    ...overrides,
  };
}

function item(id: string, required: boolean, checked = false, section = "General"): ChecklistItem {
  return { item_id: id, section, label: `item ${id}`, is_required: required, checked, checked_at: checked ? NOW.toISOString() : null };
}

function session(overrides: Partial<LocalCleanSession> = {}): LocalCleanSession {
  return {
    roomId: "room-1",
    sessionId: "sess-1",
    cleanType: "DEP",
    startedAt: "2026-10-09T16:30:00.000Z",
    entryAcknowledged: true,
    checklist: [item("a", true), item("b", true), item("c", false)],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function resolve(overrides: Partial<ResolveInput> & { room?: Room } = {}) {
  return resolveRoomDetailView({ room: room(), isOnline: true, otherRoomInProgress: false, now: NOW, ...overrides });
}

const ctx: ActionContext = { hasNextRoom: true, hasWorkOrder: true, busy: false };

describe("resolveRoomDetailView — states", () => {
  it("A: an assigned, serviceable vacant room is ready to start with a plain Start", () => {
    const view = resolve();
    expect(view.kind).toBe("ready");
    expect(view.entry).toBe("start");
    expect(view.working).toBe(false);
    const actions = getStickyActions(view, ctx);
    expect(actions.primary).toMatchObject({ id: "start", enabled: true });
    expect(actions.more).not.toBeNull();
  });

  it("A: a stayover (PICKUP) room can only be entered through the knock protocol", () => {
    const view = resolve({ room: room({ status: "PICKUP", clean_type: "FULL", actual_checkout_at: null, fo_status: "OCC" }) });
    expect(view.kind).toBe("ready");
    expect(view.entry).toBe("protocol");
    expect(getStickyActions(view, ctx).primary?.id).toBe("begin_entry");
  });

  it("B: IN_PROGRESS with a live session is in progress and completion tracks required items", () => {
    const view = resolve({ room: room({ status: "IN_PROGRESS" }), session: session() });
    expect(view.kind).toBe("in_progress");
    expect(view.working).toBe(true);
    expect(view.completion).toMatchObject({ requiredTotal: 2, requiredRemaining: 2, canSubmit: false });
    const primary = getStickyActions(view, ctx).primary!;
    expect(primary).toMatchObject({ id: "complete", enabled: false, disabledReasonKey: "rooms.work.disabled.stepsRemaining" });
    expect(primary.labelParams).toEqual({ done: 0, total: 2 });
  });

  it("B: finishing is enabled only once every required item is ticked (optional ones don't count)", () => {
    const done = session({ checklist: [item("a", true, true), item("b", true, true), item("c", false, false)] });
    const view = resolve({ room: room({ status: "IN_PROGRESS" }), session: done });
    expect(view.completion?.canSubmit).toBe(true);
    expect(getStickyActions(view, ctx).primary).toMatchObject({ id: "complete", enabled: true });
  });

  it("B: IN_PROGRESS without a local checklist is 'awaiting checklist', never completable", () => {
    const view = resolve({ room: room({ status: "IN_PROGRESS" }) });
    expect(view.kind).toBe("in_progress");
    expect(view.awaitingChecklist).toBe(true);
    expect(getStickyActions(view, ctx).primary).toMatchObject({ enabled: false, disabledReasonKey: "rooms.work.disabled.loadingChecklist" });
  });

  it("C: an active DND is needs-attention with no way to start, and it beats a Rush priority", () => {
    const view = resolve({ room: room({ dnd_flag: true, priority: 1, priority_needed_by: "2026-10-09T18:00:00.000Z" }) });
    expect(view.kind).toBe("needs_attention");
    expect(view.attention).toBe("dnd");
    expect(view.entry).toBe("none");
    expect(view.startBlock).toBe("restricted");
    expect(view.classification.rush).not.toBeNull(); // retained, but it cannot lift the restriction
    const actions = getStickyActions(view, ctx);
    expect(actions.primary?.id).toBe("record_attempt");
    expect(actions.secondary?.id).toBe("back_to_route");
    expect([actions.primary?.id, actions.secondary?.id]).not.toContain("start");
    expect([actions.primary?.id, actions.secondary?.id]).not.toContain("begin_entry");
  });

  it.each([
    ["service declined", { do_not_service: true, service_declined_at: "2026-10-09T15:00:00.000Z", status: "PICKUP", actual_checkout_at: null, fo_status: "OCC", clean_type: "FULL" }],
    ["do not service", { do_not_service: true, status: "PICKUP", actual_checkout_at: null, fo_status: "OCC", clean_type: "FULL" }],
    ["come back later", { dnd_retry_at: "2026-10-09T19:00:00.000Z" }],
  ] as Array<[string, Partial<Room>]>)("C: %s blocks starting entirely", (_label, overrides) => {
    const view = resolve({ room: room(overrides) });
    expect(view.kind).toBe("needs_attention");
    expect(view.entry).toBe("none");
    const ids = [getStickyActions(view, ctx).primary?.id, getStickyActions(view, ctx).secondary?.id];
    expect(ids).not.toContain("start");
    expect(ids).not.toContain("begin_entry");
  });

  it("C: an unverified departure checkout never offers a bare Start — only the entry protocol", () => {
    const view = resolve({ room: room({ status: "OCCUPIED", actual_checkout_at: null, fo_status: "OCC" }) });
    expect(view.kind).toBe("needs_attention");
    expect(view.attention).toBe("checkout_unverified");
    expect(view.entry).toBe("protocol");
    const actions = getStickyActions(view, ctx);
    expect(actions.primary?.id).toBe("begin_entry");
    expect(actions.more?.labelKey).toBe("rooms.work.actions.reportAccess");
  });

  it("C: starting is blocked (with a reason) while another room is already in progress", () => {
    const view = resolve({ otherRoomInProgress: true });
    expect(view.startBlock).toBe("other_room");
    expect(getStickyActions(view, ctx).primary).toMatchObject({ enabled: false, disabledReasonKey: "rooms.work.disabled.otherRoom" });
  });

  it("D: a failed-inspection room is a reclean; starting is a correction start", () => {
    const view = resolve({ room: room({ reclean_requested_at: "2026-10-09T15:00:00.000Z", reclean_corrections: ["Mirror"] }) });
    expect(view.kind).toBe("reclean");
    expect(getStickyActions(view, ctx).primary).toMatchObject({ id: "start", labelKey: "rooms.work.actions.startCorrections" });
  });

  it("D: an active reclean resubmits for inspection, enabled only when the corrections are done", () => {
    const open = session({ checklist: [item("c1", true, false, "Corrections"), item("c2", true, true, "Corrections")] });
    const r = room({ status: "IN_PROGRESS", reclean_requested_at: "2026-10-09T15:00:00.000Z" });
    const incomplete = resolve({ room: r, session: open });
    expect(incomplete.kind).toBe("reclean");
    expect(getStickyActions(incomplete, ctx).primary).toMatchObject({ id: "resubmit", enabled: false });
    const done = resolve({ room: r, session: session({ checklist: [item("c1", true, true, "Corrections")] }) });
    expect(getStickyActions(done, ctx).primary).toMatchObject({ id: "resubmit", enabled: true });
  });

  it("D: a correction session is a reclean even before the room list reports the reclean fields", () => {
    const view = resolve({ room: room({ status: "IN_PROGRESS" }), session: session({ checklist: [item("c1", true, false, "Corrections")] }) });
    expect(view.kind).toBe("reclean");
  });

  it("E: server CLEAN is submitted — no Start, next room offered", () => {
    const view = resolve({ room: room({ status: "CLEAN" }) });
    expect(view.kind).toBe("submitted");
    const actions = getStickyActions(view, ctx);
    expect(actions.primary?.id).toBe("next_room");
    expect(actions.secondary?.id).toBe("view_record");
    expect(getStickyActions(view, { ...ctx, hasNextRoom: false }).primary?.id).toBe("back_to_route");
  });

  it("E: a server-confirmed completion shows submitted even if the room list still says IN_PROGRESS", () => {
    const view = resolve({ room: room({ status: "IN_PROGRESS" }), session: session({ completionConfirmed: true, durationSeconds: 1680 }) });
    expect(view.kind).toBe("submitted");
  });

  it("E: server CLEAN wins over a local completion that was still queued", () => {
    const view = resolve({ room: room({ status: "CLEAN" }), session: session({ completeRequestedAt: NOW.toISOString() }) });
    expect(view.kind).toBe("submitted");
  });

  it("E: a stale completed record does not hide a room that came back for reclean", () => {
    const view = resolve({
      room: room({ status: "DIRTY", reclean_requested_at: "2026-10-09T16:30:00.000Z" }),
      session: session({ completionConfirmed: true }),
    });
    expect(view.kind).toBe("reclean");
    expect(view.working).toBe(false);
  });

  it("F: INSPECTED is read-only — only navigation and the record", () => {
    const view = resolve({ room: room({ status: "INSPECTED" }) });
    expect(view.kind).toBe("inspected");
    const actions = getStickyActions(view, ctx);
    expect([actions.primary?.id, actions.secondary?.id]).toEqual(["back_to_route", "view_record"]);
    expect(actions.more).toBeNull();
  });

  it.each(["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"] as const)("G: %s is unavailable with no housekeeper override", (status) => {
    const view = resolve({ room: room({ status, dnd_flag: true, priority: 1 }) });
    expect(view.kind).toBe("unavailable");
    expect(view.entry).toBe("none");
    const actions = getStickyActions(view, ctx);
    expect(actions.primary?.id).toBe("back_to_route");
    expect(actions.secondary?.id).toBe("view_work_order");
    expect(getStickyActions(view, { ...ctx, hasWorkOrder: false }).secondary).toBeNull();
  });
});

describe("resolveRoomDetailView — offline, pending and conflict", () => {
  const working = room({ status: "IN_PROGRESS" });

  it("H: working with no connection is 'offline'", () => {
    expect(resolve({ room: working, session: session(), isOnline: false }).sync).toBe("offline");
  });

  it("H: unsaved checklist edits are 'changes_pending' with an exact count", () => {
    const pending = { "id:a": item("a", true, true), "id:b": item("b", true, true) };
    const view = resolve({ room: working, session: session({ pendingItems: pending }) });
    expect(view.sync).toBe("changes_pending");
    expect(view.pendingChanges).toBe(2);
  });

  it("H: unsaved linen counts also count as pending", () => {
    const view = resolve({ room: working, session: session({ linen: { dirtyOut: 2, cleanIn: 2, pending: true, failed: false } }) });
    expect(view.sync).toBe("changes_pending");
    expect(view.pendingChanges).toBe(1);
  });

  it("H: a queued start is 'starting'", () => {
    expect(resolve({ room: room(), session: session({ startConfirmed: false }) }).sync).toBe("starting");
  });

  it("H: a queued completion is NEVER submitted — it stays in progress, pending, and cannot be pressed again", () => {
    const all = [item("a", true, true), item("b", true, true)];
    const view = resolve({ room: working, session: session({ checklist: all, completeRequestedAt: NOW.toISOString() }), isOnline: false });
    expect(view.kind).toBe("in_progress");
    expect(view.sync).toBe("completion_pending");
    expect(view.completion?.pending).toBe(true);
    expect(getStickyActions(view, ctx).primary).toMatchObject({ enabled: false, disabledReasonKey: "rooms.work.disabled.completionPending" });
  });

  it("H: a server conflict keeps the work visible and blocks finishing with a reason", () => {
    const view = resolve({
      room: working,
      session: session({ conflict: { code: "ROOM_STATE_CHANGED", message: "x", at: NOW.toISOString() } }),
    });
    expect(view.kind).toBe("in_progress");
    expect(view.sync).toBe("conflict");
    expect(getStickyActions(view, ctx).primary).toMatchObject({ enabled: false, disabledReasonKey: "rooms.work.disabled.conflict" });
  });

  it("an in-flight action disables the primary button (double-tap guard)", () => {
    const done = session({ checklist: [item("a", true, true)] });
    const view = resolve({ room: working, session: done });
    expect(getStickyActions(view, { ...ctx, busy: true }).primary).toMatchObject({ enabled: false, disabledReasonKey: "rooms.work.disabled.busy" });
    expect(getStickyActions(resolve(), { ...ctx, busy: true }).primary).toMatchObject({ enabled: false });
  });
});

describe("resolveRoomDetailView — precedence", () => {
  it("unavailable beats everything, including DND, Rush and a live session", () => {
    expect(resolve({ room: room({ status: "OOO", dnd_flag: true }), session: session() }).kind).toBe("unavailable");
  });

  it("inspected beats a restriction", () => {
    expect(resolve({ room: room({ status: "INSPECTED", dnd_flag: true }) }).kind).toBe("inspected");
  });

  it("a room being worked stays in progress even if DND is set underneath it (never strands the attendant)", () => {
    expect(resolve({ room: room({ status: "IN_PROGRESS", dnd_flag: true }), session: session() }).kind).toBe("in_progress");
  });

  it("a hard restriction beats a reclean", () => {
    const view = resolve({ room: room({ dnd_flag: true, reclean_requested_at: "2026-10-09T15:00:00.000Z" }) });
    expect(view.kind).toBe("needs_attention");
  });

  it("informational reasons stay advisories on a startable room", () => {
    const view = resolve({ room: room({ open_work_order_id: "wo-1", open_work_order_title: "Leaky tap", actual_checkout_at: null, fo_status: "VAC", clean_type: "LIGHT", status: "DIRTY" }) });
    expect(view.kind).toBe("ready");
    expect(view.advisories).toContain("work_order");
    expect(view.entry).toBe("start");
  });
});

describe("needsKnockProtocol", () => {
  it("covers occupied, pickup and unverified-occupancy dirty rooms only", () => {
    expect(needsKnockProtocol(room({ status: "OCCUPIED" }))).toBe(true);
    expect(needsKnockProtocol(room({ status: "PICKUP" }))).toBe(true);
    expect(needsKnockProtocol(room({ status: "DIRTY", fo_status: "OCC", actual_checkout_at: null }))).toBe(true);
    expect(needsKnockProtocol(room({ status: "DIRTY" }))).toBe(false);
  });
});

describe("findNextRoom", () => {
  it("returns the next workable room by the dashboard ordering and never a restricted or finished one", () => {
    const rooms = [
      room({ id: "r1", room_number: "224" }),
      room({ id: "r2", room_number: "225", dnd_flag: true }),
      room({ id: "r3", room_number: "226", status: "CLEAN" }),
      room({ id: "r4", room_number: "227" }),
    ];
    expect(findNextRoom(rooms, {}, "r1", NOW)?.id).toBe("r4");
  });

  it("is null when nothing workable is left", () => {
    const rooms = [room({ id: "r1" }), room({ id: "r2", room_number: "225", dnd_flag: true })];
    expect(findNextRoom(rooms, {}, "r1", NOW)).toBeNull();
  });
});

describe("buildEntryChecks", () => {
  const { buildEntryChecks } = jest.requireActual("@/lib/housekeeping/roomDetailState") as typeof import("@/lib/housekeeping/roomDetailState");

  it("confirms only what the record proves: verified checkout + no DND", () => {
    const checks = buildEntryChecks(room({ latest_note: "Extra towels" }));
    expect(checks.map((c) => [c.key, c.tone])).toEqual([["checkout", "ok"], ["dnd", "ok"], ["instructions", "info"]]);
    expect(checks[0].time).toBe(CHECKED_OUT);
  });

  it("an unconfirmed departure checkout is a warning, not a tick", () => {
    expect(buildEntryChecks(room({ actual_checkout_at: null }))[0]).toMatchObject({ tone: "warn", textKey: "rooms.work.checks.checkoutNotConfirmed" });
  });

  it("flags DND and a declined service", () => {
    const checks = buildEntryChecks(room({ dnd_flag: true, do_not_service: true, status: "PICKUP", clean_type: "FULL", actual_checkout_at: null }));
    expect(checks.find((c) => c.key === "dnd")?.tone).toBe("warn");
    expect(checks.find((c) => c.key === "service")?.tone).toBe("warn");
    expect(checks.find((c) => c.key === "checkout")?.textKey).toBe("rooms.work.checks.guestMayBeInside");
  });

  it("adds no instructions row when there is nothing to review", () => {
    expect(buildEntryChecks(room()).some((c) => c.key === "instructions")).toBe(false);
  });
});

describe("resolved status", () => {
  it("reports the list status normally", () => {
    expect(resolve({ room: room({ status: "DIRTY" }) }).status).toBe("DIRTY");
    expect(resolve({ room: room({ status: "IN_PROGRESS" }), session: session() }).status).toBe("IN_PROGRESS");
  });

  it("reports CLEAN once the server confirmed the completion, even if the list still says IN_PROGRESS", () => {
    const view = resolve({ room: room({ status: "IN_PROGRESS" }), session: session({ completionConfirmed: true }) });
    expect(view.kind).toBe("submitted");
    expect(view.status).toBe("CLEAN");
  });

  it("does not report CLEAN for a queued, unconfirmed completion", () => {
    const view = resolve({ room: room({ status: "IN_PROGRESS" }), session: session({ completeRequestedAt: NOW.toISOString() }) });
    expect(view.status).toBe("IN_PROGRESS");
  });
});
