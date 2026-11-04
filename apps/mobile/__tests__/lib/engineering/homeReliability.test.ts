import { HOME_METRICS, MY_JOBS_STATUSES, UNKNOWN_DISPLAY, formatMetric, metricVisibleTo, readMetric } from "@/lib/engineering/homeContract";
import { buildEngineeringSyncCounts, buildHomeModel, compareForAttention, resolveSyncStatus } from "@/lib/engineering/homeModel";
import { buildPriorities, comparePriorityItems } from "@/lib/engineering/chiefHomeModel";
import { createRefreshGate } from "@/lib/engineering/refreshGate";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import { myJobsRoute, urgentWorkRoute, chiefSummaryRoute } from "@/lib/engineering/homeNavigation";
import { resolveWorkLink } from "@/lib/engineering/workNavigation";
import { belongsToView, viewStatuses, EMPTY_FILTERS, buildListParams } from "@/lib/engineering/workQueue";
import { isHighPriority, type WorkOrder } from "@/lib/engineering/workOrders";
import type { PmScheduleRow } from "@/lib/api/assets";
import type { PendingAction } from "@/lib/engineering/offlineActions";
import type { TeamOverview } from "@/lib/api/engineeringTeam";

const NOW = new Date("2026-10-31T15:00:00Z");
const ME = "me";
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const wo = (over: Partial<WorkOrder> & { id: string }): WorkOrder => ({ title: over.id, status: "open", priority: "normal", assigned_to: null, created_at: ago(60), ...over }) as WorkOrder;

/* ─── Unknown is never zero, a lower bound is never exact ─────────────────── */
describe("readMetric / formatMetric", () => {
  it("shows an unanswered source as unknown, never as 0", () => {
    expect(formatMetric(readMetric({ available: false, observed: 0, complete: true }))).toBe(UNKNOWN_DISPLAY);
    expect(formatMetric(readMetric({ available: true }))).toBe(UNKNOWN_DISPLAY);
  });
  it("shows a cut-off read as a lower bound", () => {
    const r = readMetric({ available: true, observed: 12, complete: false });
    expect(r).toEqual({ count: 12, kind: "lower_bound", stale: false });
    expect(formatMetric(r)).toBe("12+");
  });
  it("shows a complete read as exact, and a real zero as 0", () => {
    expect(formatMetric(readMetric({ available: true, observed: 0, complete: true }))).toBe("0");
    expect(formatMetric(readMetric({ available: true, observed: 4, complete: true }))).toBe("4");
  });
  it("prefers the server's exact count over a partial observation", () => {
    expect(readMetric({ available: true, exact: 9, observed: 5, complete: false })).toEqual({ count: 9, kind: "exact", stale: false });
  });
  it("rejects malformed counts instead of displaying them", () => {
    expect(readMetric({ available: true, exact: -1 })).toMatchObject({ kind: "unknown" });
    expect(readMetric({ available: true, exact: 1.5 })).toMatchObject({ kind: "unknown" });
    expect(readMetric({ available: true, exact: Number.NaN })).toMatchObject({ kind: "unknown" });
  });
  it("flags a figure kept from before a failed refresh as stale", () => {
    expect(readMetric({ available: true, observed: 3, complete: true, stale: true }).stale).toBe(true);
  });
  it("gives every metric a definition, a role, and a role-correct visibility", () => {
    for (const def of Object.values(HOME_METRICS)) {
      expect(def.scope.length).toBeGreaterThan(10);
      expect(def.source.length).toBeGreaterThan(0);
      expect(def.roles.length).toBeGreaterThan(0);
    }
    expect(metricVisibleTo("myJobs", "technician")).toBe(true);
    expect(metricVisibleTo("myJobs", "chief_engineer")).toBe(false);
    expect(metricVisibleTo("needsOwner", "technician")).toBe(false);
    expect(metricVisibleTo("needsOwner", "chief_engineer")).toBe(true);
  });
});

/* ─── Count / destination parity ──────────────────────────────────────────── */
describe("count and destination agree", () => {
  const orders: WorkOrder[] = [
    wo({ id: "a", assigned_to: ME, status: "open" }),
    wo({ id: "b", assigned_to: ME, status: "in_progress", priority: "urgent" }),
    wo({ id: "c", assigned_to: ME, status: "escalated" }),
    wo({ id: "d", assigned_to: ME, status: "on_hold", priority: "emergency" }),
    wo({ id: "e", assigned_to: "other", status: "in_progress" }),
    wo({ id: "f", assigned_to: null, status: "open", priority: "emergency" }),
    wo({ id: "g", assigned_to: ME, status: "completed" }),
    wo({ id: "h", assigned_to: null, status: "on_hold" }),
  ];
  const viewer = { userId: ME, role: "engineer" };

  it("My Jobs opens exactly the orders it counted (on-hold work is not in the number, so not in the list)", () => {
    const model = buildHomeModel(orders, [], ME, NOW);
    const route = myJobsRoute("engineer");
    const link = resolveWorkLink(route.params.view, route.params.filter, "engineer");
    expect(link?.view).toBe("mine");
    const filters = link?.filters ?? EMPTY_FILTERS;
    const allowed = viewStatuses("mine", filters);
    const listed = orders.filter((o) => belongsToView(o, "mine", viewer) && allowed.includes(o.status));
    expect(listed.map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
    expect(listed.length).toBe(model.myJobs);
    expect(allowed).toEqual([...MY_JOBS_STATUSES]);
  });

  it("the server's own-work summary (total - waiting) matches the same scope", () => {
    const mineActive = orders.filter((o) => o.assigned_to === ME && ["open", "escalated", "in_progress", "on_hold"].includes(o.status));
    const total = mineActive.length;
    const waiting = mineActive.filter((o) => o.status === "on_hold").length;
    expect(total - waiting).toBe(buildHomeModel(orders, [], ME, NOW).myJobs);
  });

  it("Urgent opens the All view narrowed to emergency + urgent, which holds every counted order", () => {
    const model = buildHomeModel(orders, [], ME, NOW);
    const route = urgentWorkRoute();
    const link = resolveWorkLink(route.params.view, route.params.filter, "engineer");
    expect(link?.view).toBe("all");
    expect(link?.filters?.urgentOnly).toBe(true);
    const params = buildListParams("all", link?.filters ?? EMPTY_FILTERS, "", { role: "engineer", timeZone: "America/Chicago" });
    expect(params.priorities).toEqual(["emergency", "urgent"]);
    const listed = orders.filter((o) => belongsToView(o, "all", viewer) && (params.priorities ?? []).includes(o.priority as never));
    expect(listed.length).toBe(model.urgent);
    expect(orders.filter((o) => ["open", "escalated", "in_progress", "on_hold"].includes(o.status) && isHighPriority(o.priority)).length).toBe(model.urgent);
  });

  it("Chief counts match the queue each one opens", () => {
    const manager = { userId: "chief", role: "chief_engineer" };
    const active = orders.filter((o) => ["open", "escalated", "in_progress", "on_hold"].includes(o.status));
    // The server's definitions (apps/api/routers/engineering_team.py).
    const needsOwner = active.filter((o) => !o.assigned_to && ["open", "escalated"].includes(o.status)).length;
    const inProgress = active.filter((o) => o.assigned_to && o.status === "in_progress").length;
    const onHold = active.filter((o) => o.status === "on_hold").length;

    expect(chiefSummaryRoute("needsOwner").params.view).toBe("available");
    expect(active.filter((o) => belongsToView(o, "available", manager)).length).toBe(needsOwner);

    const progress = chiefSummaryRoute("inProgress").params;
    const progressLink = resolveWorkLink(progress.view, progress.filter, "chief_engineer");
    expect(progressLink?.view).toBe("team");
    const progressStatuses = viewStatuses("team", progressLink?.filters ?? EMPTY_FILTERS);
    expect(active.filter((o) => belongsToView(o, "team", manager) && progressStatuses.includes(o.status)).length).toBe(inProgress);

    expect(chiefSummaryRoute("waiting").params.view).toBe("waiting");
    expect(active.filter((o) => belongsToView(o, "waiting", manager)).length).toBe(onHold);
  });
});

/* ─── Deterministic, deduplicated, explainable ordering ───────────────────── */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("technician attention order", () => {
  const orders = [
    wo({ id: "em2", priority: "emergency", created_at: ago(30) }),
    wo({ id: "em1", priority: "emergency", created_at: ago(30) }), // same time as em2: id breaks the tie
    wo({ id: "em0", priority: "emergency", created_at: ago(90) }),
    wo({ id: "ug", priority: "urgent", assigned_to: null, due_at: ago(5) }),
    wo({ id: "late1", priority: "normal", assigned_to: ME, due_at: ago(500) }),
    wo({ id: "late2", priority: "normal", assigned_to: ME, due_at: ago(100) }),
    wo({ id: "hold", priority: "normal", assigned_to: ME, status: "on_hold" }),
  ];
  const keys = (list: WorkOrder[]) =>
    buildHomeModel(list, [], ME, NOW, { canAct: false })
      .attention.map((a) => a.key)
      .join(",");

  it("is identical for every input order (equal records never swap between refreshes)", () => {
    const expected = keys(orders);
    for (let seed = 1; seed <= 25; seed += 1) expect(keys(shuffle(orders, seed))).toBe(expected);
  });
  it("puts oldest-waiting first among equal emergencies, then the id", () => {
    expect(keys(orders).split(",").slice(0, 3)).toEqual(["wo:em0", "wo:em1", "wo:em2"]);
  });
  it("puts the longest-overdue work first inside Past due", () => {
    const order = keys(orders).split(",");
    expect(order.indexOf("wo:late1")).toBeLessThan(order.indexOf("wo:late2"));
  });
  it("lists a work order once even when it has several reasons", () => {
    const dup = wo({ id: "x", priority: "emergency", due_at: ago(10), status: "on_hold", assigned_to: ME });
    const list = buildHomeModel([dup, { ...dup }], [], ME, NOW, { canAct: false }).attention.filter((a) => a.kind === "wo");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: "emergency" });
  });
  it("compareForAttention treats a malformed due time as no due time", () => {
    const bad = wo({ id: "bad", due_at: "not-a-date" });
    const good = wo({ id: "good", due_at: ago(5) });
    expect(compareForAttention(good, bad)).toBeLessThan(0);
  });
});

describe("chief priorities order", () => {
  const item = (id: string, kind: "emergency_unassigned" | "urgent_overdue" | "escalated" | "on_hold", over: Record<string, unknown> = {}) => ({
    kind,
    id,
    work_order_number: id,
    title: id,
    priority: "urgent",
    status: "open",
    assigned_to: null,
    due_at: ago(10),
    room_id: null,
    room_number: null,
    ...over,
  });
  const overview = (needs: ReturnType<typeof item>[], pm: TeamOverview["pm_oversight"] = { overdue: [], overdue_total: 0, repeat_defects: [], repeat_window_days: 30 }) =>
    ({
      generated_at: NOW.toISOString(),
      counts: { open: 0, overdue: 0, on_hold: 0, emergency: 0, unassigned: 0, needs_owner: 0, in_progress: 0, pm_overdue: 0 },
      attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 0, on_hold: 0 },
      needs_attention: needs,
      technicians: [],
      rooms_down: { total: 2, past_expected_return: 1 },
      pm_oversight: pm,
      truncated: false,
    }) as unknown as TeamOverview;

  it("ranks emergency, urgent overdue, escalated, rooms, on hold, PM and repeat defects in that order", () => {
    const pm = { overdue: [{ id: "pm1", name: "Boiler", asset_name: "B1", next_due_at: ago(1000) }], repeat_defects: [{ asset_id: "a1", asset_name: "Chiller", count: 3 }], repeat_window_days: 30 } as TeamOverview["pm_oversight"];
    const list = buildPriorities(overview([item("h", "on_hold"), item("e", "escalated"), item("u", "urgent_overdue"), item("m", "emergency_unassigned", { priority: "emergency" })], pm));
    expect(list.items.map((i) => i.key)).toEqual(["wo:m", "wo:u", "wo:e", "rooms-down", "wo:h", "pm:pm1", "repeat:a1"]);
  });
  it("is identical for every server order and never repeats a work order", () => {
    const rows = [item("a", "escalated", { due_at: ago(5) }), item("b", "escalated", { due_at: ago(5) }), item("c", "escalated", { due_at: ago(50) }), item("c", "escalated", { due_at: ago(50) }), item("d", "escalated", { due_at: null })];
    const expected = buildPriorities(overview(rows)).items.map((i) => i.key);
    expect(expected).toEqual(["wo:c", "wo:a", "wo:b", "wo:d", "rooms-down"]);
    for (let seed = 1; seed <= 20; seed += 1) expect(buildPriorities(overview(shuffle(rows, seed))).items.map((i) => i.key)).toEqual(expected);
  });
  it("breaks PM and repeat-defect ties without relying on the server order", () => {
    const a = { kind: "pm", key: "pm:a", rank: 5, id: "a", name: null, assetName: null, nextDueAt: ago(10) } as const;
    const b = { kind: "pm", key: "pm:b", rank: 5, id: "b", name: null, assetName: null, nextDueAt: ago(10) } as const;
    expect(comparePriorityItems(a, b)).toBeLessThan(0);
    expect(comparePriorityItems(b, a)).toBeGreaterThan(0);
  });
});

/* ─── Hotel-timezone correctness ──────────────────────────────────────────── */
describe("PM due state follows the hotel calendar, not the device", () => {
  const row = (due: string | null): PmScheduleRow => ({ id: "p", asset_id: "a", name: "Boiler", interval_type: "monthly", is_active: true, next_due_at: due }) as PmScheduleRow;
  const stateAt = (due: string | null, now: string, tz = "America/Chicago") => adaptPmSchedules([row(due)], tz, new Date(now))[0]?.state;

  it("flips from due today to overdue at hotel midnight (CDT)", () => {
    // 2026-03-09T04:30Z is 23:30 on Mar 8 in Chicago (CDT).
    expect(stateAt("2026-03-09T04:30:00Z", "2026-03-09T04:59:00Z")).toBe("due_today");
    expect(stateAt("2026-03-09T04:30:00Z", "2026-03-09T05:00:00Z")).toBe("overdue");
  });
  it("is correct across the spring-forward gap", () => {
    // Mar 8 2026: 02:00 CST jumps to 03:00 CDT (08:00Z). 07:00Z is 01:00 CST on Mar 8.
    expect(stateAt("2026-03-08T07:00:00Z", "2026-03-08T08:30:00Z")).toBe("due_today");
    expect(stateAt("2026-03-08T07:00:00Z", "2026-03-09T04:59:00Z")).toBe("due_today");
    expect(stateAt("2026-03-08T07:00:00Z", "2026-03-09T05:00:00Z")).toBe("overdue");
  });
  it("is correct across the fall-back repeat hour", () => {
    // Nov 1 2026: 02:00 CDT falls back to 01:00 CST. 05:30Z Nov 2 is 23:30 CST on Nov 1.
    expect(stateAt("2026-11-02T05:30:00Z", "2026-11-02T05:59:00Z")).toBe("due_today");
    expect(stateAt("2026-11-02T05:30:00Z", "2026-11-02T06:00:00Z")).toBe("overdue");
    expect(stateAt("2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z")).toBe("due_today"); // inside the repeated hour
  });
  it("gives a different answer in a different hotel zone for the same instant", () => {
    expect(stateAt("2026-03-09T04:30:00Z", "2026-03-09T05:00:00Z", "America/Chicago")).toBe("overdue");
    expect(stateAt("2026-03-09T04:30:00Z", "2026-03-09T05:00:00Z", "Pacific/Honolulu")).toBe("due_today");
  });
  it("never counts a missing or malformed due time as due", () => {
    expect(stateAt(null, "2026-03-09T05:00:00Z")).toBe("unscheduled");
    expect(stateAt("garbage", "2026-03-09T05:00:00Z")).toBe("unscheduled");
    const views = adaptPmSchedules([row(null), row("garbage")], "America/Chicago", NOW);
    expect(buildHomeModel([], views, ME, NOW).pmDue).toBe(0);
  });
  it("Home PM Due counts overdue and due-today only", () => {
    const rows = [row("2026-10-30T15:00:00Z"), { ...row("2026-10-31T20:00:00Z"), id: "q" }, { ...row("2026-11-20T15:00:00Z"), id: "r" }] as PmScheduleRow[];
    expect(buildHomeModel([], adaptPmSchedules(rows, "America/Chicago", NOW), ME, NOW).pmDue).toBe(2);
  });
  it("work-order due times are instants, so an overdue order is the same in every device zone", () => {
    const late = wo({ id: "late", due_at: "2026-10-31T14:59:59Z", assigned_to: ME });
    const onTime = wo({ id: "ok", due_at: "2026-10-31T15:00:01Z", assigned_to: ME });
    const reasons = buildHomeModel([late, onTime], [], ME, NOW, { canAct: false }).attention.map((a) => a.key);
    expect(reasons).toEqual(["wo:late"]);
  });
  it("elapsed time in the sync line is never negative", () => {
    const status = resolveSyncStatus({ online: true, pending: 0, failed: false, refreshing: false, syncedAt: new Date(NOW.getTime() + 5 * 60_000), now: NOW });
    expect(status.minutes).toBe(0);
    expect(resolveSyncStatus({ online: true, pending: 0, failed: false, refreshing: false, syncedAt: new Date("nope"), now: NOW }).kind).toBe("unsynced");
  });
});

/* ─── Engineering sync summary ────────────────────────────────────────────── */
const action = (over: Partial<PendingAction>): PendingAction => ({ key: "k", queueId: 1, kind: "claim", state: "waiting", woId: "w", label: null, savedAt: null, reason: null, canRetry: false, canDiscard: true, ...over });
const noPm = { drafts: 0, waiting: 0, syncing: 0, needsReview: 0, failed: 0, photosPending: 0 };
const base = { online: true, failed: false, refreshing: false, syncedAt: new Date(NOW.getTime() - 120_000), now: NOW };

describe("engineering sync summary", () => {
  it("counts waiting and needs-review work from every queue, and keeps drafts out of both", () => {
    const counts = buildEngineeringSyncCounts({
      actions: [action({ state: "waiting" }), action({ state: "retrying" }), action({ state: "refused" }), action({ state: "stuck" })],
      pm: { ...noPm, drafts: 3, waiting: 2, syncing: 1, needsReview: 1, failed: 1 },
      refusedReports: 1,
      claimConflicts: 2,
    });
    expect(counts).toEqual({ waiting: 2 + 2 + 1, attention: 2 + 2 + 1 + 1 + 1, verified: true });
  });
  it("is not verified when any queue could not be read", () => {
    expect(buildEngineeringSyncCounts({ actions: null, pm: noPm, refusedReports: 0, claimConflicts: 0 }).verified).toBe(false);
    expect(buildEngineeringSyncCounts({ actions: [], pm: null, refusedReports: 0, claimConflicts: 0 }).verified).toBe(false);
    expect(buildEngineeringSyncCounts({ actions: [], pm: noPm, refusedReports: null, claimConflicts: 0 }).verified).toBe(false);
  });
  it("says Up to date only when read, empty and confirmed", () => {
    expect(resolveSyncStatus({ ...base, pending: 0 }).kind).toBe("synced");
  });
  it("never says Up to date while submitted changes are unconfirmed", () => {
    expect(resolveSyncStatus({ ...base, pending: 2 }).kind).toBe("pending");
  });
  it("shows Needs review above Pending and above a read failure", () => {
    expect(resolveSyncStatus({ ...base, pending: 2, attention: 1 }).kind).toBe("review");
    expect(resolveSyncStatus({ ...base, pending: 0, attention: 1, failed: true }).kind).toBe("review");
  });
  it("shows a read failure when nothing needs the person", () => {
    expect(resolveSyncStatus({ ...base, pending: 0, failed: true }).kind).toBe("failed");
  });
  it("shows Syncing while a read or a send is running, and Offline above everything", () => {
    expect(resolveSyncStatus({ ...base, pending: 1, refreshing: true }).kind).toBe("syncing");
    expect(resolveSyncStatus({ ...base, pending: 1, sending: true }).kind).toBe("syncing");
    expect(resolveSyncStatus({ ...base, pending: 1, attention: 1, online: false }).kind).toBe("offline");
  });
  it("refuses to say Up to date when a queue could not be read", () => {
    expect(resolveSyncStatus({ ...base, pending: 0, verified: false }).kind).toBe("unverified");
  });
});

/* ─── Refresh gate ────────────────────────────────────────────────────────── */
describe("refresh gate", () => {
  function setup(opts: { focusFreshMs?: number } = {}) {
    let clock = 1_000_000;
    const releases: Array<() => void> = [];
    const run = jest.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const gate = createRefreshGate(run, { now: () => clock, ...opts });
    return { gate, run, releases, advance: (ms: number) => (clock += ms) };
  }
  const settle = () => new Promise((r) => setImmediate(r));

  it("joins a read already in flight instead of starting another", async () => {
    const { gate, run, releases } = setup();
    const a = gate.request("manual");
    const b = gate.request("manual");
    const c = gate.request("focus");
    expect(run).toHaveBeenCalledTimes(1);
    releases[0]();
    await Promise.all([a, b, c]);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("runs exactly one trailing read for any number of realtime events during a read", async () => {
    const { gate, run, releases } = setup();
    const first = gate.request("manual");
    gate.request("realtime");
    gate.request("realtime");
    gate.request("realtime");
    releases[0]();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    releases[1]();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("skips a focus hint right after a read, and allows one once the data is old", async () => {
    const { gate, run, releases, advance } = setup({ focusFreshMs: 10_000 });
    const p = gate.request("manual");
    releases[0]();
    await p;
    await gate.request("focus");
    expect(run).toHaveBeenCalledTimes(1);
    advance(10_001);
    const q = gate.request("focus");
    releases[1]();
    await q;
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("always lets a manual refresh read, even right after another read", async () => {
    const { gate, run, releases } = setup();
    const p = gate.request("manual");
    releases[0]();
    await p;
    const q = gate.request("manual");
    releases[1]();
    await q;
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("keeps working after a failed read", async () => {
    let n = 0;
    const gate = createRefreshGate(async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
    });
    await expect(gate.request("manual")).resolves.toBeUndefined();
    await gate.request("manual");
    expect(n).toBe(2);
  });
});
