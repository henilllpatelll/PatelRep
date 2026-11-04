import type { AttentionItem, Technician, TeamOverview } from "@/lib/api/engineeringTeam";
import {
  PRIORITY_PREVIEW,
  assignTargetFor,
  buildPriorities,
  canAssignFromPriority,
  chiefSummary,
  priorityRoute,
  technicianRoute,
  workloadPreview,
} from "@/lib/engineering/chiefHomeModel";

const wo = (over: Partial<AttentionItem>): AttentionItem => ({
  kind: "on_hold",
  id: "wo-1",
  work_order_number: 1001,
  title: "Job",
  priority: "normal",
  status: "open",
  assigned_to: null,
  due_at: null,
  room_id: null,
  room_number: null,
  ...over,
});

const overview = (over: Partial<TeamOverview> = {}): TeamOverview => ({
  generated_at: "2026-11-03T12:00:00Z",
  counts: { open: 5, overdue: 1, on_hold: 2, emergency: 1, unassigned: 3, needs_owner: 3, in_progress: 4, pm_overdue: 1 },
  rooms_down: { total: 0, past_expected_return: 0 },
  pm_oversight: { overdue: [], overdue_total: 0, repeat_defects: [], repeat_window_days: 90 },
  technicians: [],
  attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 0, on_hold: 0 },
  needs_attention: [],
  truncated: false,
  ...over,
});

const tech = (id: string, active: number, over: Partial<Technician> = {}): Technician => ({ user_id: id, name: id, active, urgent: 0, on_hold: 0, overdue: 0, ...over });

describe("chiefSummary", () => {
  it("returns the server's exact counts, in Needs owner / In progress / On hold order", () => {
    expect(chiefSummary(overview().counts)).toEqual([
      { key: "needsOwner", value: 3 },
      { key: "inProgress", value: 4 },
      { key: "waiting", value: 2 },
    ]);
  });

  it("keeps a real zero as zero", () => {
    const counts = { ...overview().counts, needs_owner: 0, in_progress: 0, on_hold: 0 };
    expect(chiefSummary(counts).map((s) => s.value)).toEqual([0, 0, 0]);
  });

  it("treats a field an older server does not send, or a malformed one, as unknown, never zero", () => {
    const { needs_owner: _a, in_progress: _b, ...older } = overview().counts;
    expect(chiefSummary(older as never).map((s) => s.value)).toEqual([null, null, 2]);
    expect(chiefSummary({ ...older, needs_owner: -1, in_progress: 1.5 } as never).map((s) => s.value)).toEqual([null, null, 2]);
  });

  it("is unknown before the overview exists", () => {
    expect(chiefSummary(null).map((s) => s.value)).toEqual([null, null, null]);
  });
});

describe("buildPriorities ordering", () => {
  it("orders emergency, urgent overdue, escalated, rooms, on hold, PM, then repeated defects", () => {
    const o = overview({
      needs_attention: [
        wo({ id: "hold", kind: "on_hold", status: "on_hold" }),
        wo({ id: "esc", kind: "escalated", status: "escalated" }),
        wo({ id: "urg", kind: "urgent_overdue", priority: "urgent" }),
        wo({ id: "emg", kind: "emergency_unassigned", priority: "emergency" }),
      ],
      attention_counts: { emergency_unassigned: 1, urgent_overdue: 1, escalated: 1, on_hold: 1 },
      rooms_down: { total: 2, past_expected_return: 1 },
      pm_oversight: {
        overdue: [{ id: "pm1", name: "Boiler", asset_name: "Boiler", next_due_at: null }],
        overdue_total: 1,
        repeat_defects: [{ asset_id: "a1", asset_name: "AHU", count: 3 }],
        repeat_window_days: 90,
      },
    });
    expect(buildPriorities(o).items.map((i) => i.key)).toEqual(["wo:emg", "wo:urg", "wo:esc", "rooms-down", "wo:hold", "pm:pm1", "repeat:a1"]);
  });

  it("keeps the server's own order inside one kind and drops a duplicate id", () => {
    const o = overview({
      needs_attention: [wo({ id: "a", kind: "escalated" }), wo({ id: "b", kind: "escalated" }), wo({ id: "a", kind: "escalated" })],
      attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 2, on_hold: 0 },
    });
    expect(buildPriorities(o).items.map((i) => i.key)).toEqual(["wo:a", "wo:b"]);
  });

  it("shows rooms only as the aggregate the server confirmed, never as fabricated rooms, and not at all at zero", () => {
    const some = buildPriorities(overview({ rooms_down: { total: 3, past_expected_return: 2 } })).items;
    expect(some).toEqual([expect.objectContaining({ kind: "rooms", total: 3, pastExpected: 2 })]);
    expect(buildPriorities(overview()).items.some((i) => i.kind === "rooms")).toBe(false);
  });

  it("does not turn a work order or PM schedule into a room-down item", () => {
    const o = overview({
      needs_attention: [wo({ id: "leak", kind: "emergency_unassigned", room_number: "415" })],
      attention_counts: { emergency_unassigned: 1, urgent_overdue: 0, escalated: 0, on_hold: 0 },
    });
    expect(buildPriorities(o).items.filter((i) => i.kind === "rooms")).toHaveLength(0);
  });
});

describe("buildPriorities trust", () => {
  it("is an all-clear only when every source was read, nothing is cut off and nothing is flagged", () => {
    expect(buildPriorities(overview()).allClear).toBe(true);
  });

  it.each([
    ["PM could not be read", { pm_oversight: null }, { pmUnavailable: true }],
    ["rooms could not be read", { rooms_down: null }, { roomsUnavailable: true }],
  ])("is not an all-clear when %s, and says which part is unknown", (_n, patch, flag) => {
    const p = buildPriorities(overview(patch as never));
    expect(p.allClear).toBe(false);
    expect(p).toMatchObject(flag);
  });

  it("is not an all-clear when the server read only part of the active work", () => {
    expect(buildPriorities(overview({ truncated: true })).allClear).toBe(false);
  });

  it("counts flagged work orders the server did not send, so Home can point to Team Overview", () => {
    const o = overview({
      needs_attention: [wo({ id: "a", kind: "escalated" })],
      attention_counts: { emergency_unassigned: 2, urgent_overdue: 0, escalated: 3, on_hold: 0 },
    });
    const p = buildPriorities(o);
    expect(p.hiddenWorkOrders).toBe(4);
    expect(p.allClear).toBe(false);
  });

  it("is neutral (not all-clear, nothing unavailable) before there is an overview", () => {
    expect(buildPriorities(null)).toEqual({ items: [], hiddenWorkOrders: 0, roomsUnavailable: false, pmUnavailable: false, allClear: false });
  });

  it("previews a small, fixed number of rows", () => {
    expect(PRIORITY_PREVIEW).toBe(4);
  });
});

describe("priorityRoute", () => {
  const item = (o: Partial<AttentionItem>) => buildPriorities(overview({ needs_attention: [wo(o)], attention_counts: { emergency_unassigned: 0, urgent_overdue: 0, escalated: 1, on_hold: 0 } })).items[0];

  it("opens the exact work order, PM schedule and asset through the safe builders", () => {
    expect(priorityRoute(item({ id: "wo-9" }))).toEqual({ pathname: "/(app)/work-orders/[woId]", params: { woId: "wo-9" } });
    const o = overview({
      pm_oversight: { overdue: [{ id: "pm-3", name: "x", asset_name: null, next_due_at: null }], overdue_total: 1, repeat_defects: [{ asset_id: "a-7", asset_name: null, count: 2 }], repeat_window_days: 90 },
    });
    const [pm, repeat] = buildPriorities(o).items;
    expect(priorityRoute(pm)).toBe("/(app)/pm-schedules/pm-3");
    expect(priorityRoute(repeat)).toEqual({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a-7" } });
  });

  it("opens the existing room screen for the room aggregate", () => {
    const rooms = buildPriorities(overview({ rooms_down: { total: 1, past_expected_return: 0 } })).items[0];
    expect(priorityRoute(rooms)).toBe("/(app)/room-status");
  });

  it("falls back to the relevant list, never a malformed link, when an id is unsafe", () => {
    expect(priorityRoute(item({ id: "../admin" }))).toBe("/(app)/work-orders");
    const o = overview({
      pm_oversight: { overdue: [{ id: "a/b", name: null, asset_name: null, next_due_at: null }], overdue_total: 1, repeat_defects: [{ asset_id: "x?y", asset_name: null, count: 2 }], repeat_window_days: 90 },
    });
    const [pm, repeat] = buildPriorities(o).items;
    expect(priorityRoute(pm)).toBe("/(app)/pm-schedules");
    expect(priorityRoute(repeat)).toBe("/(app)/assets");
  });

  it("builds technician links safely", () => {
    expect(technicianRoute("t-1")).toBe("/(app)/team/t-1");
    expect(technicianRoute("t/../x")).toBe("/(app)/team");
    expect(technicianRoute(null)).toBe("/(app)/team");
  });
});

describe("assignment targets", () => {
  it("offers Assign on work orders, but not on held work that has no owner (same rule as Team Overview) or on non-work rows", () => {
    const items = buildPriorities(
      overview({
        needs_attention: [wo({ id: "open", kind: "emergency_unassigned" }), wo({ id: "held", kind: "on_hold", status: "on_hold" }), wo({ id: "held-owned", kind: "on_hold", status: "on_hold", assigned_to: "t1" })],
        attention_counts: { emergency_unassigned: 1, urgent_overdue: 0, escalated: 0, on_hold: 2 },
        rooms_down: { total: 1, past_expected_return: 0 },
      }),
    ).items;
    const can = Object.fromEntries(items.map((i) => [i.key, canAssignFromPriority(i)]));
    expect(can).toEqual({ "wo:open": true, "rooms-down": false, "wo:held": false, "wo:held-owned": true });
  });

  it("carries the work order, room and current assignee so the server can detect a stale view", () => {
    const target = assignTargetFor(wo({ id: "w1", work_order_number: 1045, title: "Leak", priority: "emergency", room_number: "415", assigned_to: "t2", assigned_to_name: "Sam R." }));
    expect(target).toEqual({ id: "w1", code: "WO-1045", title: "Leak", priority: "emergency", location: "415", assignedTo: "t2", assignedToName: "Sam R." });
    expect(assignTargetFor(wo({ assigned_to: null })).assignedTo).toBeNull();
  });
});

describe("workloadPreview", () => {
  it("scales each bar to the busiest technician shown, never to an invented capacity", () => {
    const { rows } = workloadPreview([tech("a", 2), tech("b", 4), tech("c", 1)], "Technician");
    expect(rows.map((r) => [r.tech.user_id, r.ratio])).toEqual([["b", 1], ["a", 0.5], ["c", 0.25]]);
  });

  it("shows no bar when nobody has active work (not a full or an empty capacity)", () => {
    const { rows } = workloadPreview([tech("a", 0), tech("b", 0)], "Technician");
    expect(rows.every((r) => r.ratio === 0)).toBe(true);
  });

  it("limits the preview, reports the full headcount and sorts busiest first", () => {
    const all = ["a", "b", "c", "d", "e", "f"].map((id, i) => tech(id, i));
    const { rows, total } = workloadPreview(all, "Technician");
    expect(total).toBe(6);
    expect(rows.map((r) => r.tech.user_id)).toEqual(["f", "e", "d", "c"]);
  });

  it("names an unnamed technician with the fallback and invents nobody", () => {
    expect(workloadPreview([tech("a", 1, { name: null })], "Technician").rows[0].name).toBe("Technician");
    expect(workloadPreview([], "Technician")).toEqual({ rows: [], total: 0 });
    expect(workloadPreview(null, "Technician")).toEqual({ rows: [], total: 0 });
  });
});
