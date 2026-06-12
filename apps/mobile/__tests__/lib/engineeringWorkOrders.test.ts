import {
  countQueueSignals,
  dueState,
  formatDuration,
  minutesSince,
  sortQueue,
  splitWorkbench,
  workOrderLocation,
  type WorkOrder,
} from "@/lib/engineering/workOrders";

const base: WorkOrder = {
  id: "wo-1",
  title: "Fix AC",
  status: "open",
  priority: "normal",
};

describe("formatDuration", () => {
  it("formats minutes under an hour", () => {
    expect(formatDuration(45)).toBe("45m");
  });
  it("formats hours with zero-padded minutes", () => {
    expect(formatDuration(125)).toBe("2h 05m");
  });
});

describe("minutesSince", () => {
  it("returns whole minutes since the timestamp", () => {
    const now = new Date("2026-06-12T12:30:00Z");
    expect(minutesSince("2026-06-12T12:00:00Z", now)).toBe(30);
  });
  it("returns null for missing or invalid input", () => {
    expect(minutesSince(null)).toBeNull();
    expect(minutesSince("not-a-date")).toBeNull();
  });
});

describe("dueState", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("reports overdue minutes when due_at is in the past", () => {
    const state = dueState({ ...base, due_at: "2026-06-12T11:00:00Z" }, "en", now);
    expect(state).toEqual({ kind: "overdue", minutes: 60 });
  });

  it("reports a due clock when due_at is in the future", () => {
    const state = dueState({ ...base, due_at: "2026-06-12T14:00:00Z" }, "en", now);
    expect(state?.kind).toBe("due");
  });

  it("is silent for completed orders", () => {
    const state = dueState(
      { ...base, status: "completed", due_at: "2026-06-12T11:00:00Z" },
      "en",
      now
    );
    expect(state).toBeNull();
  });
});

describe("sortQueue", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("puts urgent first, then SLA-overdue, then newest", () => {
    const newish: WorkOrder = { ...base, id: "a", created_at: "2026-06-12T11:50:00Z", due_at: "2026-06-12T15:00:00Z" };
    const overdue: WorkOrder = { ...base, id: "b", created_at: "2026-06-12T08:00:00Z", due_at: "2026-06-12T10:00:00Z" };
    const urgent: WorkOrder = { ...base, id: "c", priority: "urgent", created_at: "2026-06-12T09:00:00Z" };

    const sorted = sortQueue([newish, overdue, urgent], now);
    expect(sorted.map((wo) => wo.id)).toEqual(["c", "b", "a"]);
  });
});

describe("countQueueSignals", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("counts urgent, past-SLA, guest-reported, and on-hold orders", () => {
    const orders: WorkOrder[] = [
      { ...base, id: "a", priority: "urgent", guest_reported: true },
      { ...base, id: "b", status: "on_hold", due_at: "2026-06-12T10:00:00Z" },
      { ...base, id: "c", due_at: "2026-06-12T15:00:00Z" },
    ];
    expect(countQueueSignals(orders, now)).toEqual({ urgent: 1, pastSla: 1, guest: 1, onHold: 1 });
  });

  it("ignores completed and cancelled orders", () => {
    const orders: WorkOrder[] = [
      { ...base, id: "a", status: "completed", priority: "urgent", due_at: "2026-06-12T10:00:00Z" },
      { ...base, id: "b", status: "cancelled", guest_reported: true },
    ];
    expect(countQueueSignals(orders, now)).toEqual({ urgent: 0, pastSla: 0, guest: 0, onHold: 0 });
  });
});

describe("splitWorkbench", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("splits active orders into my bench vs the team, keeping open as the queue", () => {
    const open: WorkOrder[] = [{ ...base, id: "q1" }];
    const active: WorkOrder[] = [
      { ...base, id: "mine", status: "in_progress", assigned_to: "u1" },
      { ...base, id: "theirs", status: "in_progress", assigned_to: "u2" },
    ];
    const bench = splitWorkbench(open, active, "u1", now);
    expect(bench.bench.map((wo) => wo.id)).toEqual(["mine"]);
    expect(bench.team.map((wo) => wo.id)).toEqual(["theirs"]);
    expect(bench.queue.map((wo) => wo.id)).toEqual(["q1"]);
  });

  it("treats everything as team work when the viewer is unknown", () => {
    const active: WorkOrder[] = [{ ...base, id: "a", status: "in_progress", assigned_to: "u2" }];
    const bench = splitWorkbench([], active, undefined, now);
    expect(bench.bench).toHaveLength(0);
    expect(bench.team).toHaveLength(1);
  });
});

describe("workOrderLocation", () => {
  it("prefers the linked room number", () => {
    const loc = workOrderLocation({ ...base, rooms: { room_number: "204" }, location_text: "2nd floor hallway" });
    expect(loc.room).toBe("204");
  });
  it("falls back to free-text location", () => {
    const loc = workOrderLocation({ ...base, location_text: "Boiler room" });
    expect(loc).toEqual({ room: null, text: "Boiler room" });
  });
});
