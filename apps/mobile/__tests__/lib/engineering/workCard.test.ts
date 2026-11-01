import {
  contextBadges,
  dueLabel,
  isEmphasised,
  ownerLine,
  primaryAction,
  showsSecondaryAssign,
  statusTone,
  type CardActionInput,
} from "@/lib/engineering/workCard";
import { WORK_ORDER_PRIORITIES, type WorkOrder, type WorkOrderStatus } from "@/lib/engineering/workOrders";

const ME = "u-me";
const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: "wo-1",
  title: "AC not cooling",
  status: "open",
  priority: "normal",
  assigned_to: null,
  ...over,
});
const input = (over: Partial<CardActionInput> = {}): CardActionInput => ({
  view: "mine",
  viewerId: ME,
  claimable: false,
  assignable: false,
  ...over,
});

describe("primaryAction — one authorized next step per card", () => {
  it("leads an engineer's own work with the step that matches its status", () => {
    expect(primaryAction(wo({ status: "open", assigned_to: ME }), input())).toBe("open");
    expect(primaryAction(wo({ status: "escalated", assigned_to: ME }), input())).toBe("open");
    expect(primaryAction(wo({ status: "in_progress", assigned_to: ME }), input())).toBe("continue");
    expect(primaryAction(wo({ status: "on_hold", assigned_to: ME }), input())).toBe("reviewHold");
  });

  it("offers Claim only when the screen says the viewer may claim", () => {
    expect(primaryAction(wo(), input({ view: "available", claimable: true }))).toBe("claim");
    expect(primaryAction(wo(), input({ view: "available", claimable: false }))).toBe("review");
  });

  it("sends finished work to its record, whoever is looking and whatever they may do", () => {
    for (const status of ["completed", "cancelled"] as WorkOrderStatus[]) {
      expect(primaryAction(wo({ status, assigned_to: ME }), input({ view: "done" }))).toBe("viewRecord");
      expect(primaryAction(wo({ status }), input({ view: "done", claimable: true, assignable: true }))).toBe("viewRecord");
    }
  });

  it("gives a chief engineer Assign on unowned work and Review on a colleague's, never a technician action", () => {
    const chief = input({ view: "team", assignable: true });
    expect(primaryAction(wo({ status: "open" }), chief)).toBe("assign");
    expect(primaryAction(wo({ status: "escalated" }), chief)).toBe("assign");
    expect(primaryAction(wo({ status: "in_progress", assigned_to: "sam" }), chief)).toBe("review");
    expect(primaryAction(wo({ status: "on_hold", assigned_to: "sam" }), chief)).toBe("reviewHold");
    for (const status of ["open", "escalated", "in_progress", "on_hold"] as WorkOrderStatus[]) {
      expect(["claim", "continue", "open"]).not.toContain(primaryAction(wo({ status, assigned_to: "sam" }), chief));
    }
  });

  it("lets a GM who may claim lead with Claim and keep Assign as the small secondary", () => {
    const gm = input({ view: "available", claimable: true, assignable: true });
    const action = primaryAction(wo(), gm);
    expect(action).toBe("claim");
    expect(showsSecondaryAssign(action, gm)).toBe(true);
  });

  it("does not repeat Assign as both the primary and the secondary", () => {
    const chief = input({ view: "available", assignable: true });
    const action = primaryAction(wo(), chief);
    expect(action).toBe("assign");
    expect(showsSecondaryAssign(action, chief)).toBe(false);
  });

  it("shows a small Reassign beside a manager's Review, and nothing to a viewer who cannot assign", () => {
    expect(showsSecondaryAssign("review", { assignable: true })).toBe(true);
    expect(showsSecondaryAssign("review", { assignable: false })).toBe(false);
    expect(showsSecondaryAssign("viewRecord", { assignable: true })).toBe(false);
  });

  it("never treats someone else's order as the viewer's when the viewer is unknown", () => {
    expect(primaryAction(wo({ status: "in_progress", assigned_to: "sam" }), input({ viewerId: null }))).toBe("review");
    expect(primaryAction(wo({ status: "in_progress", assigned_to: null }), input({ viewerId: null }))).toBe("review");
  });
});

describe("dueLabel — the hotel's clock, never an invented time", () => {
  // 2026-10-15 17:30 UTC = 12:30 PM in Chicago (CDT).
  const now = new Date("2026-10-15T17:30:00Z");
  const opts = { now, timeZone: "America/Chicago", language: "en" };

  it("is silent without a due date, with an unreadable one, or once the work is finished", () => {
    expect(dueLabel(wo({ due_at: null }), opts)).toBeNull();
    expect(dueLabel(wo({ due_at: undefined }), opts)).toBeNull();
    expect(dueLabel(wo({ due_at: "not-a-date" }), opts)).toBeNull();
    expect(dueLabel(wo({ status: "completed", due_at: "2026-10-01T10:00:00Z" }), opts)).toBeNull();
    expect(dueLabel(wo({ status: "cancelled", due_at: "2026-10-30T10:00:00Z" }), opts)).toBeNull();
  });

  it("reads overdue by the minute, using the same rule as the queue's Overdue filter", () => {
    expect(dueLabel(wo({ due_at: "2026-10-15T16:45:00Z" }), opts)).toEqual({ kind: "overdue", minutes: 45 });
    expect(dueLabel(wo({ status: "in_progress", due_at: "2026-10-14T17:30:00Z" }), opts)).toEqual({ kind: "overdue", minutes: 1440 });
  });

  it("says today, tomorrow and a date by the hotel's calendar day, not the phone's or UTC's", () => {
    expect(dueLabel(wo({ due_at: "2026-10-15T20:00:00Z" }), opts)).toEqual({ kind: "today", clock: "3:00 PM" });
    expect(dueLabel(wo({ due_at: "2026-10-16T14:00:00Z" }), opts)).toEqual({ kind: "tomorrow", clock: "9:00 AM" });
    expect(dueLabel(wo({ due_at: "2026-11-02T15:00:00Z" }), opts)).toEqual({ kind: "later", date: "Nov 2" });
  });

  it("does not move a late-evening hotel time onto the next UTC day", () => {
    // 11:30 PM Chicago on the 15th is 04:30 UTC on the 16th: still "today" at the hotel.
    expect(dueLabel(wo({ due_at: "2026-10-16T04:30:00Z" }), opts)).toEqual({ kind: "today", clock: "11:30 PM" });
    // 12:30 AM Chicago on the 16th is "tomorrow" even though UTC says 05:30 on the same 16th.
    expect(dueLabel(wo({ due_at: "2026-10-16T05:30:00Z" }), opts)).toEqual({ kind: "tomorrow", clock: "12:30 AM" });
  });

  it("follows the hotel's zone, not a fixed one", () => {
    const tokyo = { now, timeZone: "Asia/Tokyo", language: "en" };
    // 17:30 UTC is 2:30 AM on the 16th in Tokyo, so a 10:00 UTC due time on the 16th is "today" there.
    expect(dueLabel(wo({ due_at: "2026-10-16T10:00:00Z" }), tokyo)).toEqual({ kind: "today", clock: "7:00 PM" });
  });

  it("formats in the person's language", () => {
    const label = dueLabel(wo({ due_at: "2026-11-02T15:00:00Z" }), { ...opts, language: "es" });
    expect(label?.kind).toBe("later");
    expect((label as { date: string }).date).toMatch(/2/);
    expect((label as { date: string }).date).not.toBe("Nov 2");
  });
});

describe("contextBadges — only what the data proves", () => {
  const ctx = (occupancy: "occupied" | "vacant" | "unknown", availability: NonNullable<WorkOrder["room_context"]>["availability"] = null) => ({ occupancy, availability });

  it("shows occupied or vacant only from the server's room context", () => {
    expect(contextBadges(wo({ room_context: ctx("occupied") })).map((b) => b.kind)).toEqual(["occupied"]);
    expect(contextBadges(wo({ room_context: ctx("vacant") })).map((b) => b.kind)).toEqual(["vacant"]);
  });

  it("shows nothing about occupancy when it is unknown or was never sent", () => {
    expect(contextBadges(wo({ room_context: ctx("unknown") }))).toEqual([]);
    expect(contextBadges(wo({ room_context: null }))).toEqual([]);
    expect(contextBadges(wo({ rooms: { room_number: "312" } }))).toEqual([]);
  });

  it("shows a recorded out-of-order or out-of-service room, separately from occupancy", () => {
    expect(contextBadges(wo({ room_context: ctx("vacant", "out_of_order") })).map((b) => b.kind)).toEqual(["vacant", "out_of_order"]);
    expect(contextBadges(wo({ room_context: ctx("unknown", "out_of_service") })).map((b) => b.kind)).toEqual(["out_of_service"]);
    expect(contextBadges(wo({ room_context: ctx("unknown", "unrecorded_down") })).map((b) => b.kind)).toEqual(["unrecorded_down"]);
  });

  it("treats a guest report as a fact about the report, not about who is in the room", () => {
    expect(contextBadges(wo({ guest_reported: true })).map((b) => b.kind)).toEqual(["guest"]);
    expect(contextBadges(wo({ guest_reported: true, room_context: ctx("vacant") })).map((b) => b.kind)).toEqual(["vacant", "guest"]);
    expect(contextBadges(wo({ guest_reported: true, room_context: ctx("unknown") })).map((b) => b.kind)).toEqual(["guest"]);
    expect(contextBadges(wo({ guest_reported: false, room_context: ctx("occupied") })).map((b) => b.kind)).not.toContain("guest");
  });

  it("never infers a room is down from the repair, its priority or its category", () => {
    expect(contextBadges(wo({ priority: "emergency", category: "plumbing", status: "escalated" }))).toEqual([]);
  });

  it("names equipment only when the order is linked to a named asset", () => {
    expect(contextBadges(wo({ assets: { name: " Chiller 2 " } }))).toEqual([{ kind: "equipment", label: "Chiller 2" }]);
    expect(contextBadges(wo({ assets: { name: "  " } }))).toEqual([]);
    expect(contextBadges(wo({ assets: null }))).toEqual([]);
  });

  it("drops room state from finished work, where today's state says nothing about then", () => {
    for (const status of ["completed", "cancelled"] as WorkOrderStatus[]) {
      expect(contextBadges(wo({ status, room_context: ctx("occupied", "out_of_order"), guest_reported: true })).map((b) => b.kind)).toEqual(["guest"]);
    }
  });
});

describe("ownerLine", () => {
  it("stays quiet where the queue already implies the owner", () => {
    expect(ownerLine(wo({ assigned_to: ME }), "mine", ME)).toBeNull();
    expect(ownerLine(wo(), "available", ME)).toBeNull();
  });

  it("names a colleague, says 'you', and admits when the name is unknown or nobody has it", () => {
    expect(ownerLine(wo({ assigned_to: "sam", assigned_to_name: "Sam Ortiz" }), "team", ME)).toEqual({ kind: "name", name: "Sam Ortiz" });
    expect(ownerLine(wo({ assigned_to: "sam" }), "team", ME)).toEqual({ kind: "assigned" });
    expect(ownerLine(wo({ assigned_to: ME, status: "on_hold" }), "waiting", ME)).toEqual({ kind: "you" });
    expect(ownerLine(wo({ status: "on_hold" }), "waiting", ME)).toEqual({ kind: "unassigned" });
  });

  it("does not call finished work 'unassigned'", () => {
    expect(ownerLine(wo({ status: "cancelled" }), "done", ME)).toBeNull();
  });
});

describe("priority and status vocabulary", () => {
  it("emphasises exactly emergency and urgent, across every supported priority", () => {
    expect(WORK_ORDER_PRIORITIES.map((p) => [p, isEmphasised(p)])).toEqual([
      ["emergency", true],
      ["urgent", true],
      ["normal", false],
      ["low", false],
    ]);
  });

  it("gives every real status its own tone without inventing statuses", () => {
    const tones = (["open", "escalated", "in_progress", "on_hold", "completed", "cancelled"] as WorkOrderStatus[]).map(statusTone);
    expect(tones).toEqual(["neutral", "attention", "active", "waiting", "done", "cancelled"]);
  });
});
