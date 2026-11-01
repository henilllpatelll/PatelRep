import { buildHomeModel, resolveSyncStatus, activeQueue } from "@/lib/engineering/homeModel";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import type { PmScheduleRow } from "@/lib/api/assets";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const NOW = new Date("2026-10-31T15:00:00Z");
const ME = "me";
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function wo(over: Partial<WorkOrder> & { id: string }): WorkOrder {
  return { title: over.id, status: "open", priority: "normal", assigned_to: null, created_at: minutesAgo(60), ...over } as WorkOrder;
}

function pmRow(over: Partial<PmScheduleRow> & { id: string; next_due_at: string | null }): PmScheduleRow {
  return { asset_id: "a", name: over.id, interval_type: "monthly", is_active: true, ...over } as PmScheduleRow;
}

const views = (rows: PmScheduleRow[]) => adaptPmSchedules(rows, "America/Chicago", NOW);
const model = (orders: WorkOrder[], rows: PmScheduleRow[] = []) => buildHomeModel(orders, views(rows), ME, NOW);

describe("buildHomeModel counts", () => {
  it("counts My Jobs as my actionable work only (not on hold, not someone else's, not unassigned)", () => {
    const m = model([
      wo({ id: "a", assigned_to: ME, status: "open" }),
      wo({ id: "b", assigned_to: ME, status: "in_progress" }),
      wo({ id: "c", assigned_to: ME, status: "escalated" }),
      wo({ id: "d", assigned_to: ME, status: "on_hold" }),
      wo({ id: "e", assigned_to: "other", status: "in_progress" }),
      wo({ id: "f", assigned_to: null, status: "open" }),
      wo({ id: "g", assigned_to: ME, status: "completed" }),
    ]);
    expect(m.myJobs).toBe(3);
  });

  it("counts emergency AND urgent in Urgent, including escalated and on-hold ones", () => {
    const m = model([
      wo({ id: "e1", priority: "emergency" }),
      wo({ id: "u1", priority: "urgent", status: "escalated" }),
      wo({ id: "u2", priority: "urgent", status: "on_hold", assigned_to: ME }),
      wo({ id: "n1", priority: "normal" }),
      wo({ id: "done", priority: "emergency", status: "completed" }),
    ]);
    expect(m.urgent).toBe(3);
  });

  it("never double-counts a work order that arrives twice", () => {
    const dup = wo({ id: "dup", assigned_to: ME, priority: "urgent" });
    const m = model([dup, { ...dup }]);
    expect(m.myJobs).toBe(1);
    expect(m.urgent).toBe(1);
    expect(activeQueue([dup, { ...dup }])).toHaveLength(1);
  });

  it("counts PM due from normalized rows: overdue + due today, ignoring inactive and undated", () => {
    const m = model([], [
      pmRow({ id: "p1", next_due_at: "2026-10-28T15:00:00Z" }),
      pmRow({ id: "p2", next_due_at: "2026-10-31T20:00:00Z" }),
      pmRow({ id: "p3", next_due_at: "2026-12-01T20:00:00Z" }),
      pmRow({ id: "p4", next_due_at: "2026-10-01T20:00:00Z", is_active: false }),
      pmRow({ id: "p5", next_due_at: null }),
    ]);
    expect(m.pmDue).toBe(2);
    expect(m.attention.map((i) => i.key)).toEqual(["pm:p1"]);
  });
});

describe("buildHomeModel active job", () => {
  it("picks my most severe in-progress job and counts the rest", () => {
    const m = model([
      wo({ id: "low", assigned_to: ME, status: "in_progress" }),
      wo({ id: "hot", assigned_to: ME, status: "in_progress", priority: "urgent" }),
    ]);
    expect(m.activeJob?.id).toBe("hot");
    expect(m.moreActive).toBe(1);
  });

  it("never offers another engineer's job, an unassigned one, or one that is only on hold", () => {
    const m = model([
      wo({ id: "x", assigned_to: "other", status: "in_progress" }),
      wo({ id: "y", status: "open" }),
      wo({ id: "z", assigned_to: ME, status: "on_hold" }),
    ]);
    expect(m.activeJob).toBeNull();
    expect(m.moreActive).toBe(0);
  });

  it("does not repeat the Continue job in Needs Attention, but still counts it as urgent", () => {
    const m = model([wo({ id: "mine", assigned_to: ME, status: "in_progress", priority: "emergency" })]);
    expect(m.activeJob?.id).toBe("mine");
    expect(m.attention).toHaveLength(0);
    expect(m.urgent).toBe(1);
  });
});

describe("buildHomeModel attention list", () => {
  it("orders emergency, urgent unassigned, past due, overdue PM, then my on-hold work", () => {
    const m = model(
      [
        wo({ id: "hold", status: "on_hold", assigned_to: ME }),
        wo({ id: "late", due_at: minutesAgo(30) }),
        wo({ id: "urg", priority: "urgent" }),
        wo({ id: "emg", priority: "emergency", status: "escalated" }),
      ],
      [pmRow({ id: "p1", next_due_at: "2026-10-20T15:00:00Z" })],
    );
    expect(m.attention.map((i) => [i.key, i.reason])).toEqual([
      ["wo:emg", "emergency"],
      ["wo:urg", "urgent_unassigned"],
      ["wo:late", "past_due"],
      ["pm:p1", "pm_overdue"],
      ["wo:hold", "on_hold"],
    ]);
  });

  it("lists a work order once, under its most severe reason", () => {
    const m = model([wo({ id: "both", priority: "emergency", due_at: minutesAgo(10) })]);
    expect(m.attention).toHaveLength(1);
    expect(m.attention[0]).toMatchObject({ reason: "emergency" });
  });

  it("does not flag urgent work that already has an owner", () => {
    const m = model([wo({ id: "u", priority: "urgent", assigned_to: "other" })]);
    expect(m.attention).toHaveLength(0);
    expect(m.urgent).toBe(1);
  });

  it("has no input for failure predictions, so a prediction can never read as an emergency", () => {
    expect(model([]).attention).toEqual([]);
  });
});

describe("resolveSyncStatus", () => {
  const base = { online: true, pending: 0, failed: false, refreshing: false, syncedAt: new Date(NOW.getTime() - 4 * 60_000), now: NOW };

  it("says synced only after a successful load", () => {
    expect(resolveSyncStatus(base)).toMatchObject({ kind: "synced", minutes: 4 });
    expect(resolveSyncStatus({ ...base, syncedAt: null }).kind).toBe("unsynced");
  });

  it("reports offline, failed, syncing and waiting-to-sync truthfully", () => {
    expect(resolveSyncStatus({ ...base, online: false }).kind).toBe("offline");
    expect(resolveSyncStatus({ ...base, failed: true }).kind).toBe("failed");
    expect(resolveSyncStatus({ ...base, refreshing: true }).kind).toBe("syncing");
    expect(resolveSyncStatus({ ...base, pending: 2 })).toMatchObject({ kind: "pending", pending: 2 });
  });

  it("offline wins over a stale synced reading", () => {
    expect(resolveSyncStatus({ ...base, online: false, pending: 3 }).kind).toBe("offline");
  });
});
