import { normalizeTask, type Task, type TaskActivityEvent } from "@/lib/api/tasks";
import { canAddNote, conflictReason, isClaimable, primaryAction, type Viewer } from "@/lib/tasks/taskActions";
import { dayBucket, formatWhen, groupByDay, placeLabel } from "@/lib/tasks/taskDisplay";

const ME: Viewer = { userId: "me", role: "housekeeper" };
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function task(extra: Record<string, unknown> = {}): Task {
  return normalizeTask({ id: "t1", title: "T", status: "open", task_type: "housekeeping", priority: "normal", assigned_to: "me", ...extra });
}

describe("primaryAction", () => {
  it.each([
    ["assigned + open", { status: "open" }, "start"],
    ["assigned + escalated", { status: "escalated" }, "start"],
    ["assigned + in progress", { status: "in_progress" }, "complete"],
    ["completed", { status: "completed" }, null],
    ["cancelled", { status: "cancelled" }, null],
    ["unassigned housekeeping pool", { assigned_to: null }, "claim"],
    ["unassigned but not housekeeping", { assigned_to: null, task_type: "engineering" }, null],
    ["someone else's", { assigned_to: "other" }, null],
    ["someone else's, in progress", { assigned_to: "other", status: "in_progress" }, null],
  ])("%s -> %s", (_label, extra, expected) => {
    expect(primaryAction(task(extra), ME)).toBe(expected);
  });

  it("never offers a mutation to a non-housekeeper on the pool, or to a signed-out viewer", () => {
    expect(primaryAction(task({ assigned_to: null }), { userId: "m", role: "housekeeping_supervisor" })).toBeNull();
    expect(isClaimable(task({ assigned_to: null }), { userId: null, role: null })).toBe(false);
    expect(primaryAction(task(), { userId: null, role: "housekeeper" })).toBeNull();
  });
});

describe("canAddNote", () => {
  it("allows notes only on live tasks that are mine or claimable", () => {
    expect(canAddNote(task({ status: "in_progress" }), ME)).toBe(true);
    expect(canAddNote(task({ assigned_to: null }), ME)).toBe(true);
    expect(canAddNote(task({ status: "completed" }), ME)).toBe(false);
    expect(canAddNote(task({ status: "cancelled" }), ME)).toBe(false);
    expect(canAddNote(task({ assigned_to: "other" }), ME)).toBe(false);
  });
});

describe("conflictReason", () => {
  it("explains a refusal from the task as the server now reports it", () => {
    expect(conflictReason("complete", task({ status: "completed" }), ME)).toBe("completed");
    expect(conflictReason("start", task({ status: "cancelled" }), ME)).toBe("cancelled");
    expect(conflictReason("claim", task({ assigned_to: "other", status: "in_progress" }), ME)).toBe("claimed");
    expect(conflictReason("start", task({ assigned_to: "other" }), ME)).toBe("reassigned");
    expect(conflictReason("start", null, ME)).toBe("unavailable");
    expect(conflictReason("start", task({ status: "open" }), ME)).toBe("changed");
  });
});

describe("task display", () => {
  it("treats a free-text place as a location and a verified room as a room with its floor", () => {
    expect(placeLabel(task({ location_text: "Pool deck" }), t)).toBe("Pool deck");
    expect(placeLabel(task({ room_id: "r1", rooms: { room_number: "214", floor: 2 } }), t)).toContain("214");
    expect(placeLabel(task({ room_id: "r1", rooms: { room_number: "214", floor: 2 } }), t)).toContain('"floor":2');
    expect(placeLabel(task(), t)).toBeNull();
  });

  const NOW = new Date("2026-10-13T03:30:00Z"); // 10:30 PM on Oct 12 in Chicago, still Oct 13 in UTC
  it("groups the feed by the HOTEL's day, not the device's", () => {
    const event = (id: string, at: string): TaskActivityEvent => ({ id, kind: "comment", at, actor_id: null, actor_name: null, text: id });
    const groups = groupByDay(
      [event("a", "2026-10-10T20:00:00Z"), event("b", "2026-10-12T14:00:00Z"), event("c", "2026-10-13T02:00:00Z")],
      NOW,
      "America/Chicago",
    );
    expect(groups.map((g) => g.bucket)).toEqual(["2026-10-10", "today"]);
    expect(groups[1].events.map((e) => e.id)).toEqual(["b", "c"]);
    expect(dayBucket("2026-10-10T20:00:00Z", NOW, "America/Chicago")).toBe("2026-10-10");
    expect(dayBucket("2026-10-12T00:30:00Z", NOW, "America/Chicago")).toBe("yesterday");
  });

  it("shows only the time for today and adds the date for other days, in hotel time", () => {
    expect(formatWhen("2026-10-13T02:45:00Z", NOW, "America/Chicago", "en")).toBe("9:45 PM");
    expect(formatWhen("2026-10-10T17:30:00Z", NOW, "America/Chicago", "en")).toBe("Oct 10, 12:30 PM");
    expect(formatWhen(null, NOW, "America/Chicago", "en")).toBeNull();
  });
});
