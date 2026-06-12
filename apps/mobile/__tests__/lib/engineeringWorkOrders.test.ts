import {
  dueState,
  formatDuration,
  minutesSince,
  sortQueue,
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
