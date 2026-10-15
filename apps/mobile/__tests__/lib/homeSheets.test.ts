import { buildProgressDetails, issueKindOf, resolveIssueDetails, resolveRoomActions, resolveWhyRoom } from "@/lib/housekeeping/homeSheets";
import { build, room, session } from "../helpers/homeModelFixture";

const dnd = (id: string, extra = {}) => room(id, { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, ...extra });
const actionIds = (view: ReturnType<typeof resolveRoomActions>) => (view.state === "ready" ? view.actions.map((action) => action.id) : []);

describe("room actions drawer", () => {
  const input = { role: "housekeeper", isOnline: true, pendingCount: 0 };

  it("resolves the room it was opened for, with only the actions that room and role allow", () => {
    const model = build([room("208", { status: "IN_PROGRESS" }), room("112")], { sessions: { "208": session("208") } });
    const view = resolveRoomActions({ model, roomId: "208", ...input });
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.room.id).toBe("208");
    expect(view.continuing).toBe(true);
    expect(actionIds(view)).toEqual(["open", "note", "issue", "supplies", "exception", "info"]);
    // already inside: a pre-entry access exception can no longer be recorded, and the drawer says why
    if (view.state === "ready") expect(view.actions.find((a) => a.id === "exception")?.disabledReason).toBe("cleaningStarted");
  });

  it("separates navigation from the forms it hands off to", () => {
    const view = resolveRoomActions({ model: build([room("112")]), roomId: "112", ...input });
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.actions.filter((a) => a.kind === "navigate").map((a) => a.id)).toEqual(["open", "info"]);
    expect(view.actions.filter((a) => a.kind === "form").map((a) => a.id)).toEqual(["note", "issue", "supplies", "exception"]);
  });

  it("never says 'continue' for a restricted room", () => {
    const view = resolveRoomActions({ model: build([dnd("214")]), roomId: "214", ...input });
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.restricted).toBe(true);
    expect(view.continuing).toBe(false);
  });

  it("reports a room that left the list (reassigned, or the day changed) instead of acting on it", () => {
    const view = resolveRoomActions({ model: build([room("112")]), roomId: "999", ...input });
    expect(view.state).toBe("missing");
    expect(resolveRoomActions({ model: build([room("112")]), roomId: null, ...input }).state).toBe("missing");
  });

  it("re-resolves against the latest model: a reassignment while open turns it into 'missing'", () => {
    const rooms = [room("112"), room("113")];
    expect(resolveRoomActions({ model: build(rooms), roomId: "113", ...input }).state).toBe("ready");
    expect(resolveRoomActions({ model: build([rooms[0]]), roomId: "113", ...input }).state).toBe("missing");
  });

  it("explains in words why a form is unavailable offline, and still allows maintenance (it queues)", () => {
    const view = resolveRoomActions({ model: build([room("112")], { online: false }), roomId: "112", ...input, isOnline: false });
    if (view.state !== "ready") throw new Error("expected ready");
    const byId = Object.fromEntries(view.actions.map((a) => [a.id, a.disabledReason]));
    expect(byId.note).toBe("needsConnection");
    expect(byId.supplies).toBe("needsConnection");
    expect(byId.exception).toBe("needsConnection");
    expect(byId.issue).toBeNull();
    expect(byId.open).toBeNull();
  });

  it("hides what the role cannot do on the server", () => {
    const model = build([room("112")]);
    const engineer = resolveRoomActions({ model, roomId: "112", ...input, role: "inspector" });
    expect(actionIds(engineer)).not.toContain("supplies");
    expect(actionIds(engineer)).not.toContain("exception");
  });

  it("offers no access-problem form once the room is already clean or out of service", () => {
    const view = resolveRoomActions({ model: build([room("112", { status: "CLEAN" })]), roomId: "112", ...input });
    expect(actionIds(view)).not.toContain("exception");
  });
});

describe("why this room", () => {
  it("describes the current lead room", () => {
    const view = resolveWhyRoom(build([room("101"), room("102")]), "101");
    expect(view).toMatchObject({ state: "ready", changed: false });
    if (view.state === "ready") expect(view.recommendation.room.id).toBe("101");
  });

  it("flags — and follows — a ranking that moved while the drawer was open", () => {
    const view = resolveWhyRoom(build([room("102")]), "101");
    expect(view).toMatchObject({ state: "ready", changed: true });
    if (view.state === "ready") expect(view.recommendation.room.id).toBe("102");
  });

  it("never recommends a restricted room, and says there is nothing when only restricted rooms remain", () => {
    expect(resolveWhyRoom(build([dnd("214")]), "214")).toEqual({ state: "none" });
  });

  it("uses only verified facts: no checkout claim without actual checkout data", () => {
    const light = resolveWhyRoom(build([room("101", { actual_checkout_at: null, status: "DIRTY", clean_type: "LIGHT", clean_type_label: "Light" })]), "101");
    if (light.state !== "ready") throw new Error("expected ready");
    const reasons = [light.recommendation.reason, ...light.recommendation.alsoApplies];
    expect(reasons).not.toContain("checkout_verified");
    expect(reasons).not.toContain("arrival_soon");

    const departure = resolveWhyRoom(build([room("102")]), "102");
    if (departure.state !== "ready") throw new Error("expected ready");
    expect([departure.recommendation.reason, ...departure.recommendation.alsoApplies]).toContain("checkout_verified");
  });
});

describe("issue details drawer", () => {
  const ctx = { role: "housekeeper", isOnline: true };

  it("treats DND as a wait, not something to override", () => {
    const model = build([dnd("214")]);
    const view = resolveIssueDetails({ model, itemId: "room:214:dnd", ...ctx });
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.kind).toBe("dnd");
    expect(view.restricted).toBe(true);
    expect(view.canViewRoom).toBe(true);
    expect(view.noteAction).toEqual({ disabledReason: null });
  });

  it("treats declined service the same way", () => {
    const model = build([room("215", { do_not_service: true, status: "OCCUPIED", actual_checkout_at: null } as never)]);
    const item = model.attention.find((i) => i.roomId === "215");
    const view = resolveIssueDetails({ model, itemId: item?.id ?? null, ...ctx });
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.kind).toBe("declined");
    expect(view.restricted).toBe(true);
  });

  it("keeps scheduled checkout and verified checkout apart", () => {
    const model = build([room("305", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" })]);
    const item = model.attention.find((i) => i.code === "checkout_unverified");
    expect(item).toBeTruthy();
    const view = resolveIssueDetails({ model, itemId: item!.id, ...ctx });
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.kind).toBe("checkout");
    expect(view.entry?.room.actual_checkout_at).toBeNull();
    expect(view.entry?.room.checkout_time).toBeTruthy();
  });

  it("presents maintenance as information, not something the housekeeper resolves", () => {
    const model = build([room("401", { clean_type: "FULL", clean_type_label: "Full", open_work_order_id: "wo-1", open_work_order_title: "Leaking faucet", actual_checkout_at: null })]);
    const item = model.attention.find((i) => i.code === "work_order");
    expect(item).toBeTruthy();
    const view = resolveIssueDetails({ model, itemId: item!.id, ...ctx });
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.kind).toBe("maintenance");
  });

  it("is 'resolved' once the condition clears, instead of showing stale detail", () => {
    const itemId = "room:214:dnd";
    expect(resolveIssueDetails({ model: build([dnd("214")]), itemId, ...ctx }).state).toBe("ready");
    expect(resolveIssueDetails({ model: build([room("214")]), itemId, ...ctx }).state).toBe("resolved");
    expect(resolveIssueDetails({ model: build([room("214")]), itemId: null, ...ctx }).state).toBe("resolved");
  });

  it("offers no note form when the person cannot add one, and says when it is offline", () => {
    const model = build([dnd("214")]);
    const offline = resolveIssueDetails({ model, itemId: "room:214:dnd", role: "housekeeper", isOnline: false });
    if (offline.state !== "ready") throw new Error("expected ready");
    expect(offline.noteAction).toEqual({ disabledReason: "needsConnection" });
  });

  it("maps every attention code to a presentation", () => {
    const codes = ["dnd", "do_not_service", "service_declined", "come_back_later", "guest_inside", "access_problem", "checkout_unverified", "work_order", "reclean", "rush_overdue", "session_missing", "session_unassigned", "sync_conflict", "sync_failed", "high_risk", "note"] as const;
    for (const code of codes) expect(issueKindOf(code)).toBeTruthy();
    expect(issueKindOf("reclean")).toBe("reclean");
    expect(issueKindOf("rush_overdue")).toBe("rush");
  });
});

describe("shift progress details", () => {
  it("rooms reconcile: completed + to clean + in progress + attention + unavailable = assigned", () => {
    const model = build(
      [
        room("101", { status: "CLEAN" }),
        room("102", { status: "INSPECTED" }),
        room("103", { status: "IN_PROGRESS" }),
        room("104"),
        room("105"),
        dnd("106"),
        room("107", { status: "OOO" }),
      ],
      { sessions: { "103": session("103") } },
    );
    const details = buildProgressDetails(model);
    expect(details.assigned).toBe(7);
    expect(details.reconciles).toBe(true);
    expect(details.completed + details.toClean + details.inProgress + details.needsAttention + details.unavailable).toBe(details.assigned);
    expect(details.submitted).toBe(1);
    expect(details.inspected).toBe(1);
  });

  it("never counts an unavailable room as completed", () => {
    const details = buildProgressDetails(build([room("101"), room("107", { status: "OOO" }), room("108", { status: "OUT_OF_SERVICE" })]));
    expect(details.unavailable).toBe(2);
    expect(details.completed).toBe(0);
    expect(details.serviceable).toBe(1);
  });

  it("does not count a completion waiting to send as server-confirmed", () => {
    const model = build([room("101", { status: "IN_PROGRESS" }), room("102")], {
      sessions: { "101": session("101", { completeRequestedAt: "2026-10-14T14:59:00.000Z", completionConfirmed: false }) },
    });
    const details = buildProgressDetails(model);
    expect(details.completed).toBe(0);
    expect(details.awaitingConfirmation).toBe(1);
    expect(details.inProgress).toBeGreaterThanOrEqual(1);
    expect(details.reconciles).toBe(true);
  });

  it("keeps overlapping flags apart from the totals", () => {
    const model = build([room("101", { priority: 1, priority_reason: "vip" }), room("102", { reclean_requested_at: "2026-10-14T14:00:00.000Z" }), room("103")]);
    const details = buildProgressDetails(model);
    expect(details.flags.rush).toBe(1);
    expect(details.flags.reclean).toBe(1);
    expect(details.reconciles).toBe(true);
  });
});
