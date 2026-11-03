import { availableOrders, compareFocus, focusRank, pickDraft, rankedAssigned, resolveFocus, type FocusInput } from "@/lib/engineering/homeFocus";
import { buildHomeModel } from "@/lib/engineering/homeModel";
import type { PmDraftSummary } from "@/lib/engineering/pmDraftStore";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const NOW = new Date("2026-10-31T15:00:00Z");
const ME = "me";
const wo = (over: Partial<WorkOrder> & { id: string }): WorkOrder =>
  ({ title: over.id, status: "open", priority: "normal", assigned_to: ME, created_at: "2026-10-31T10:00:00Z", due_at: null, ...over }) as WorkOrder;
const draft = (scheduleId: string, updatedAt = "2026-10-31T12:00:00Z"): PmDraftSummary => ({ scheduleId, label: scheduleId, answered: 1, total: 4, updatedAt });
const sched = (id: string): PmScheduleView => ({ id, name: id, assetName: "Boiler", state: "upcoming", daysUntilDue: 3 }) as unknown as PmScheduleView;

const input = (over: Partial<FocusInput> = {}): FocusInput => ({
  queue: [],
  viewerId: ME,
  canAct: true,
  pm: [],
  drafts: [],
  loaded: { queue: true, pm: true, drafts: true },
  now: NOW,
  ...over,
});
const kindOf = (over: Partial<FocusInput>) => resolveFocus(input(over)).kind;

describe("focusRank", () => {
  it("ranks my work by the documented hierarchy", () => {
    expect(focusRank(wo({ id: "a", status: "in_progress", priority: "emergency" }), ME, NOW)).toBe(0);
    expect(focusRank(wo({ id: "a", status: "in_progress", priority: "low" }), ME, NOW)).toBe(1);
    expect(focusRank(wo({ id: "a", priority: "emergency" }), ME, NOW)).toBe(2);
    expect(focusRank(wo({ id: "a", priority: "urgent", status: "escalated" }), ME, NOW)).toBe(3);
    expect(focusRank(wo({ id: "a", due_at: "2026-10-31T09:00:00Z" }), ME, NOW)).toBe(4);
    expect(focusRank(wo({ id: "a" }), ME, NOW)).toBe(5);
  });

  it("is not a candidate when unassigned, someone else's, on hold, or the viewer is unknown", () => {
    expect(focusRank(wo({ id: "a", assigned_to: null }), ME, NOW)).toBeNull();
    expect(focusRank(wo({ id: "a", assigned_to: "other" }), ME, NOW)).toBeNull();
    expect(focusRank(wo({ id: "a", status: "on_hold" }), ME, NOW)).toBeNull();
    expect(focusRank(wo({ id: "a" }), null, NOW)).toBeNull();
  });
});

describe("tie-breakers", () => {
  it("separates general overdue from emergency: an emergency outranks an overdue normal job", () => {
    const order = rankedAssigned([wo({ id: "late", due_at: "2026-10-30T10:00:00Z" }), wo({ id: "emg", priority: "emergency" })], ME, NOW);
    expect(order.map((o) => o.id)).toEqual(["emg", "late"]);
  });

  it("within a rank: priority, then earliest due, then oldest created, then id", () => {
    const a = wo({ id: "a", status: "in_progress", priority: "normal", due_at: "2026-11-02T00:00:00Z" });
    const b = wo({ id: "b", status: "in_progress", priority: "urgent", due_at: "2026-11-05T00:00:00Z" });
    const c = wo({ id: "c", status: "in_progress", priority: "normal", due_at: "2026-11-01T00:00:00Z" });
    const d = wo({ id: "d", status: "in_progress", priority: "normal", due_at: "2026-11-01T00:00:00Z", created_at: "2026-10-30T10:00:00Z" });
    const e = wo({ id: "e", status: "in_progress", priority: "normal", due_at: "2026-11-01T00:00:00Z", created_at: "2026-10-30T10:00:00Z" });
    expect(rankedAssigned([a, b, c, d, e], ME, NOW).map((o) => o.id)).toEqual(["b", "d", "e", "c", "a"]);
  });

  it("is deterministic regardless of input order", () => {
    const rows = [wo({ id: "x" }), wo({ id: "y" }), wo({ id: "z", priority: "urgent" })];
    const forward = rankedAssigned(rows, ME, NOW).map((o) => o.id);
    const backward = rankedAssigned([...rows].reverse(), ME, NOW).map((o) => o.id);
    expect(forward).toEqual(backward);
  });

  it("compareFocus treats a missing due time as latest", () => {
    expect(compareFocus(wo({ id: "a", due_at: "2026-11-01T00:00:00Z" }), wo({ id: "b" }), ME, NOW)).toBeLessThan(0);
  });
});

describe("resolveFocus state machine", () => {
  it("continues the highest in-progress job and counts the rest", () => {
    const f = resolveFocus(
      input({ queue: [wo({ id: "p1", status: "in_progress" }), wo({ id: "p2", status: "in_progress", priority: "emergency" }), wo({ id: "o", priority: "emergency" })] }),
    );
    expect(f).toMatchObject({ kind: "continue_repair", moreActive: 1 });
    expect((f as { wo: WorkOrder }).wo.id).toBe("p2");
  });

  it("an in-progress job outranks a more urgent job that has not started", () => {
    const f = resolveFocus(input({ queue: [wo({ id: "emg", priority: "emergency" }), wo({ id: "going", status: "in_progress" })] }));
    expect(f).toMatchObject({ kind: "continue_repair" });
    expect((f as { wo: WorkOrder }).wo.id).toBe("going");
  });

  it("offers the best assigned job when nothing is in progress", () => {
    const f = resolveFocus(input({ queue: [wo({ id: "n" }), wo({ id: "u", priority: "urgent" })] }));
    expect(f).toMatchObject({ kind: "start_next", queued: 2 });
    expect((f as { wo: WorkOrder }).wo.id).toBe("u");
  });

  it("ignores on-hold work and other people's work when choosing", () => {
    expect(kindOf({ queue: [wo({ id: "h", status: "on_hold" }), wo({ id: "t", assigned_to: "other", status: "in_progress" })] })).toBe("caught_up");
  });

  it("resumes a saved draft only when there is no assigned repair", () => {
    expect(kindOf({ queue: [wo({ id: "n" })], drafts: [draft("pm1")], pm: [sched("pm1")] })).toBe("start_next");
    expect(kindOf({ drafts: [draft("pm1")], pm: [sched("pm1")] })).toBe("resume_pm");
  });

  it("then offers available work, then caught up", () => {
    expect(kindOf({ queue: [wo({ id: "free", assigned_to: null })] })).toBe("available_work");
    expect(kindOf({})).toBe("caught_up");
  });

  it("never reports caught up before everything that could object has loaded", () => {
    expect(kindOf({ loaded: { queue: false, pm: true, drafts: true } })).toBe("none");
    expect(kindOf({ loaded: { queue: true, pm: true, drafts: false } })).toBe("none");
    expect(kindOf({ loaded: { queue: true, pm: false, drafts: true } })).toBe("caught_up_pm_unknown");
  });

  it("a role that cannot act on work orders never gets a personal card", () => {
    expect(kindOf({ canAct: false, queue: [wo({ id: "w", status: "in_progress" })] })).toBe("none");
    expect(kindOf({ canAct: false })).toBe("none");
  });

  it("does not treat an unknown viewer's queue as theirs", () => {
    expect(kindOf({ viewerId: null, queue: [wo({ id: "w", status: "in_progress" })] })).toBe("caught_up");
  });
});

describe("pickDraft", () => {
  it("prefers the newest draft", () => {
    const pick = pickDraft([draft("old", "2026-10-30T00:00:00Z"), draft("new", "2026-10-31T00:00:00Z")], [sched("old"), sched("new")], true);
    expect(pick?.draft.scheduleId).toBe("new");
  });

  it("skips a draft whose schedule is gone once schedules are loaded, but keeps it while they are not", () => {
    expect(pickDraft([draft("gone")], [], true)).toBeNull();
    expect(pickDraft([draft("gone")], [], false)?.draft.scheduleId).toBe("gone");
  });
});

describe("availableOrders", () => {
  it("is unassigned open or escalated work only", () => {
    const rows = [wo({ id: "a", assigned_to: null }), wo({ id: "b", assigned_to: null, status: "on_hold" }), wo({ id: "c" }), wo({ id: "d", assigned_to: null, status: "escalated" })];
    expect(availableOrders(rows).map((o) => o.id)).toEqual(["a", "d"]);
  });
});

describe("buildHomeModel integration", () => {
  it("de-duplicates repeated rows and keeps the primary order out of Needs Attention", () => {
    const next = wo({ id: "n", priority: "emergency" });
    const model = buildHomeModel([next, next, wo({ id: "x", priority: "emergency", assigned_to: null })], [], ME, NOW, { canAct: true });
    expect(model.focus).toMatchObject({ kind: "start_next" });
    expect(model.attention.map((a) => a.key)).toEqual(["wo:x"]);
    expect(model.urgent).toBe(2);
    expect(model.available).toBe(1);
  });

  it("never counts completed or cancelled work", () => {
    const model = buildHomeModel([wo({ id: "c", status: "completed", priority: "emergency" }), wo({ id: "k", status: "cancelled" })], [], ME, NOW, { canAct: true });
    expect(model.myJobs).toBe(0);
    expect(model.urgent).toBe(0);
  });

  it("a chief engineer's model has no personal focus even with an in-progress order of the same id", () => {
    const model = buildHomeModel([wo({ id: "w", status: "in_progress" })], [], ME, NOW, { canAct: false });
    expect(model.focus.kind).toBe("none");
    expect(model.activeJob).toBeNull();
  });
});
