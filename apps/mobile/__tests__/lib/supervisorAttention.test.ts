import type { BlockedTaskItem, TaskBlocker } from "@/lib/api/tasks";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { buildSupervisorAttention, selectAttentionPreview } from "@/lib/housekeeping/supervisorAttention";
import { availableSource, failedSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import type { RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import { initialTodaySources, normalizeBoard, type TodaySources } from "@/lib/housekeeping/supervisorToday";
import { SUPERVISOR_ROUTES, isSupervisorSafePath, supervisorHref } from "@/lib/navigation/supervisorRoutes";

// 12:00 in Chicago (CDT) on 2026-10-16.
const NOW = Date.parse("2026-10-16T17:00:00Z");
const ZONE = "America/Chicago";
const minutesFromNow = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

function raw(roomId: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: roomId, status, rooms: { id: roomId, room_number: roomId.replace("r-", ""), floor: 1 }, ...extra };
}

function blocker(id: string, overrides: Partial<TaskBlocker> = {}): TaskBlocker {
  return {
    id,
    reason: "missing_supplies",
    details: null,
    reported_by: "hk-1",
    reported_by_name: "Ana",
    reported_at: "2026-10-16T15:00:00Z",
    status: "active",
    notification_status: "queued",
    ...overrides,
  };
}

function blockedTask(blockerId: string, taskId = "t-1", priority: "urgent" | "normal" | "low" = "normal"): BlockedTaskItem {
  return {
    blocker: blocker(blockerId),
    task: {
      id: taskId,
      title: "Restock 204",
      task_type: "housekeeping",
      priority,
      assigned_to_name: "Ana",
      room_number: "204",
      location_text: null,
    },
  };
}

function sourcesWith(rooms: BoardRoomRaw[], extra: Partial<TodaySources> = {}): TodaySources {
  return {
    ...initialTodaySources(),
    board: availableSource(normalizeBoard(rooms), NOW, (b) => b.rooms.length === 0),
    staff: availableSource([{ userId: "hk-1", name: "Ana", role: "housekeeper" }], NOW),
    roster: availableSource<RosterEntry[]>([], NOW),
    inspections: availableSource([], NOW),
    blockedTasks: availableSource<BlockedTaskItem[]>([], NOW),
    ...extra,
  };
}

const build = (sources: TodaySources) => buildSupervisorAttention(sources, { now: NOW, timeZone: ZONE });
const ids = (sources: TodaySources) => build(sources).items.map((item) => item.id);

describe("arrival-at-risk items", () => {
  const arriving = (minutes: number, extra: Partial<BoardRoomRaw> = {}) =>
    raw("r-101", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(minutes), assigned_to: "hk-1", ...extra });

  it("is critical within an hour of the recorded arrival and high within two hours", () => {
    expect(build(sourcesWith([arriving(40)])).items[0]).toMatchObject({ kind: "arrival_at_risk", severity: "critical" });
    expect(build(sourcesWith([arriving(100)])).items[0]).toMatchObject({ kind: "arrival_at_risk", severity: "high" });
  });

  it("stays critical once the recorded arrival time has passed", () => {
    expect(build(sourcesWith([arriving(-30)])).items[0]).toMatchObject({ kind: "arrival_at_risk", severity: "critical" });
  });

  it("raises nothing without a recorded arrival, outside the window, on another day, or for an occupied room", () => {
    expect(ids(sourcesWith([raw("r-101", "DIRTY", { fo_status: "VAC", assigned_to: "hk-1" })]))).toEqual([]);
    expect(ids(sourcesWith([arriving(180)]))).toEqual([]);
    expect(ids(sourcesWith([arriving(60 * 24)]))).toEqual([]);
    expect(ids(sourcesWith([arriving(30, { fo_status: "OCC" })]))).toEqual([]);
    expect(ids(sourcesWith([arriving(30, { fo_status: null })]))).toEqual([]);
  });

  it("raises nothing for a room that is already ready or out of order", () => {
    expect(ids(sourcesWith([arriving(30, { status: "INSPECTED" })]))).toEqual([]);
    expect(ids(sourcesWith([arriving(30, { status: "OOO" })]))).toEqual([]);
  });

  it("points at inspection for a submitted room and at the Rooms workflow otherwise", () => {
    expect(build(sourcesWith([arriving(30, { status: "CLEAN" })])).items.find((i) => i.kind === "arrival_at_risk")?.action).toBe("inspect_rooms");
    expect(build(sourcesWith([arriving(30)])).items[0].action).toBe("review_rooms");
  });

  it("carries the real arrival timestamp and room reference", () => {
    const item = build(sourcesWith([arriving(30)])).items[0];
    expect(item.occurredAt).toBe(minutesFromNow(30));
    expect(item.records).toEqual([{ type: "room", id: "r-101", label: "101" }]);
  });
});

describe("readiness risk and de-duplication", () => {
  it("reports a stored HIGH prediction on a room that is not ready", () => {
    const items = build(sourcesWith([raw("r-101", "DIRTY", { assigned_to: "hk-1", prediction: { risk_level: "HIGH" } })])).items;
    expect(items.map((item) => item.kind)).toEqual(["readiness_risk"]);
  });

  it("does not report a ready room's old prediction", () => {
    expect(ids(sourcesWith([raw("r-101", "INSPECTED", { prediction: { risk_level: "HIGH" } })]))).toEqual([]);
  });

  it("reports one issue — not two — for a room that is both an arrival risk and predicted high risk", () => {
    const items = build(
      sourcesWith([
        raw("r-101", "DIRTY", { assigned_to: "hk-1", fo_status: "VAC", checkin_time: minutesFromNow(30), prediction: { risk_level: "HIGH" } }),
      ]),
    ).items;
    expect(items.map((item) => item.kind)).toEqual(["arrival_at_risk"]);
  });
});

describe("bulk queues", () => {
  const rooms = [
    raw("r-101", "DIRTY"),
    raw("r-102", "IN_PROGRESS"),
    raw("r-103", "DIRTY", { assigned_to: "hk-1" }),
    raw("r-104", "CLEAN"),
    raw("r-105", "INSPECTED"),
    raw("r-106", "DIRTY", { assigned_to: "hk-1", dnd_flag: true }),
    raw("r-107", "OOO", { dnd_flag: true }),
  ];
  const items = build(sourcesWith(rooms)).items;
  const byKind = (kind: string) => items.find((item) => item.kind === kind);

  it("lists every unassigned actionable room in one item", () => {
    expect(byKind("unassigned_rooms")?.records.map((r) => r.id)).toEqual(["r-101", "r-102"]);
    expect(byKind("unassigned_rooms")).toMatchObject({ id: "queue:unassigned_rooms", target: { screen: "team" }, action: "assign_rooms" });
  });

  it("lists rooms awaiting inspection and sends them to Inspect", () => {
    expect(byKind("awaiting_inspection")?.records.map((r) => r.id)).toEqual(["r-104"]);
    expect(byKind("awaiting_inspection")).toMatchObject({ target: { screen: "inspect" }, action: "inspect_rooms" });
  });

  it("lists do-not-disturb rooms that still need work, not out-of-order ones", () => {
    expect(byKind("access_restricted")?.records.map((r) => r.id)).toEqual(["r-106"]);
  });

  it("raises no queue item for an empty queue", () => {
    expect(ids(sourcesWith([raw("r-1", "INSPECTED")]))).toEqual([]);
  });
});

describe("task blockers", () => {
  it("creates one item per unresolved blocker, keyed by the blocker record", () => {
    const items = build(sourcesWith([], { blockedTasks: availableSource([blockedTask("b-1"), blockedTask("b-2", "t-1")], NOW) })).items;
    expect(items.map((item) => item.id).sort()).toEqual(["blocker:b-1", "blocker:b-2"]);
    expect(items[0].records.map((r) => r.type).sort()).toEqual(["blocker", "task"]);
  });

  it("is critical for an urgent task and high otherwise, with the real reported time", () => {
    const urgent = build(sourcesWith([], { blockedTasks: availableSource([blockedTask("b-1", "t-1", "urgent")], NOW) })).items[0];
    const normal = build(sourcesWith([], { blockedTasks: availableSource([blockedTask("b-1", "t-1", "normal")], NOW) })).items[0];
    expect(urgent.severity).toBe("critical");
    expect(normal.severity).toBe("high");
    expect(normal.occurredAt).toBe("2026-10-16T15:00:00Z");
  });

  it("ignores a resolved blocker and collapses a repeated one", () => {
    const resolved = { ...blockedTask("b-9"), blocker: blocker("b-9", { status: "resolved" }) };
    const items = build(sourcesWith([], { blockedTasks: availableSource([resolved, blockedTask("b-1"), blockedTask("b-1")], NOW) })).items;
    expect(items.map((item) => item.id)).toEqual(["blocker:b-1"]);
  });
});

describe("stable identity", () => {
  const rooms = [
    raw("r-101", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(30) }),
    raw("r-102", "CLEAN"),
    raw("r-103", "DIRTY", { prediction: { risk_level: "HIGH" } }),
  ];
  const sources = sourcesWith(rooms, { blockedTasks: availableSource([blockedTask("b-1")], NOW) });

  it("produces the same ids, in the same order, on every build", () => {
    expect(ids(sources)).toEqual(ids({ ...sources }));
    expect(ids(sources)).toEqual(ids(sourcesWith([...rooms].reverse(), { blockedTasks: sources.blockedTasks })));
  });

  it("never repeats an id", () => {
    const all = ids(sources);
    expect(new Set(all).size).toBe(all.length);
  });

  it("orders critical before high before normal", () => {
    const severities = build(sources).items.map((item) => item.severity);
    const rank = { critical: 0, high: 1, normal: 2 } as const;
    expect([...severities].sort((a, b) => rank[a] - rank[b])).toEqual(severities);
  });
});

describe("preview selection", () => {
  it("shows at most three items, one per subject, and counts what did not fit", () => {
    const sources = sourcesWith(
      [
        raw("r-101", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(30) }),
        raw("r-102", "CLEAN"),
        raw("r-103", "DIRTY", { prediction: { risk_level: "HIGH" } }),
      ],
      { blockedTasks: availableSource([blockedTask("b-1"), blockedTask("b-2", "t-2")], NOW) },
    );
    const attention = build(sources);
    const preview = selectAttentionPreview(attention, 3);
    expect(preview.items).toHaveLength(3);
    expect(preview.hiddenCount).toBe(attention.items.length - 3);
    const subjects = preview.items.map((item) => `${item.subject.type}:${item.subject.id}`);
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it("never removes anything from the full list", () => {
    const attention = build(sourcesWith([raw("r-1", "CLEAN"), raw("r-2", "DIRTY")]));
    const before = attention.items.length;
    selectAttentionPreview(attention, 1);
    expect(attention.items).toHaveLength(before);
  });
});

describe("partial data", () => {
  it("keeps blocker items when the board failed, and reports the board as unverified", () => {
    const sources = sourcesWith([], {
      board: failedSource(new Error("down"), loadingSource()),
      blockedTasks: availableSource([blockedTask("b-1")], NOW),
    });
    const attention = build(sources);
    expect(attention.items.map((item) => item.kind)).toEqual(["task_blocker"]);
    expect(attention.unverified).toContain("board");
  });

  it("keeps room items when blocked-task reads failed, and reports blockers as unverified", () => {
    const sources = sourcesWith([raw("r-1", "CLEAN")], { blockedTasks: failedSource({ status: 403 }, loadingSource()) });
    const attention = build(sources);
    expect(attention.items.map((item) => item.kind)).toEqual(["awaiting_inspection"]);
    expect(attention.unverified).toContain("blockedTasks");
  });

  it("labels items built from the last known board as stale", () => {
    const stale = {
      status: "stale" as const,
      data: normalizeBoard([raw("r-1", "CLEAN")]),
      fetchedAt: NOW - 600_000,
      reason: "age" as const,
      failure: null,
    };
    const item = build(sourcesWith([], { board: stale })).items[0];
    expect(item.source).toEqual({ names: ["board"], status: "stale", fetchedAt: NOW - 600_000 });
  });

  it("marks items from a verified answer as available with its fetch time", () => {
    expect(build(sourcesWith([raw("r-1", "CLEAN")])).items[0].source).toEqual({ names: ["board"], status: "available", fetchedAt: NOW });
  });
});

describe("staff concerns", () => {
  const manyRooms = Array.from({ length: 10 }, (_, i) =>
    raw(`r-${200 + i}`, "DIRTY", { assigned_to: "hk-1", rooms: { id: `r-${200 + i}`, room_number: `${200 + i}`, floor: 2, room_types: { base_clean_minutes: 60 } } }),
  );

  it("flags an over-assigned housekeeper from board workloads alone", () => {
    const item = build(sourcesWith(manyRooms)).items.find((i) => i.kind === "workload_over_assigned");
    expect(item).toMatchObject({ id: "staff:hk-1:over_assigned", severity: "high", action: "assign_rooms", source: { names: ["board"] } });
  });

  it("flags a recorded clock-out with rooms still open, resting on the roster", () => {
    const roster = availableSource<RosterEntry[]>(
      [{ userId: "hk-1", availability: "ended", startedAt: "2026-10-16T12:00:00Z", onBreakSince: null }],
      NOW,
    );
    const item = build(sourcesWith([raw("r-101", "DIRTY", { assigned_to: "hk-1" })], { roster })).items.find(
      (i) => i.kind === "shift_ended_with_open_rooms",
    );
    expect(item).toMatchObject({ severity: "high", action: "open_team", source: { names: ["board", "roster"] } });
  });

  it("does not flag a clock-out whose rooms are all done", () => {
    const roster = availableSource<RosterEntry[]>(
      [{ userId: "hk-1", availability: "ended", startedAt: "2026-10-16T12:00:00Z", onBreakSince: null }],
      NOW,
    );
    expect(ids(sourcesWith([raw("r-101", "INSPECTED", { assigned_to: "hk-1" })], { roster }))).toEqual([]);
  });

  it("cannot judge clock-outs without a roster, and says so", () => {
    const sources = sourcesWith([raw("r-101", "DIRTY", { assigned_to: "hk-1" })], { roster: failedSource({ status: 403 }, loadingSource()) });
    const attention = build(sources);
    expect(attention.items.find((i) => i.kind === "shift_ended_with_open_rooms")).toBeUndefined();
    expect(attention.unverified).toContain("roster");
  });
});

describe("supervisor-safe targets", () => {
  it("only ever targets registered supervisor screens, never housekeeper-only ones", () => {
    const sources = sourcesWith(
      [
        raw("r-101", "DIRTY", { fo_status: "VAC", checkin_time: minutesFromNow(30) }),
        raw("r-102", "CLEAN"),
        raw("r-103", "DIRTY", { dnd_flag: true, prediction: { risk_level: "HIGH" } }),
      ],
      { blockedTasks: availableSource([blockedTask("b-1")], NOW) },
    );
    const items = build(sources).items;
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) {
      expect(Object.keys(SUPERVISOR_ROUTES)).toContain(item.target.screen);
      const { pathname } = supervisorHref(item.target);
      expect(isSupervisorSafePath(pathname)).toBe(true);
      expect(pathname).not.toMatch(/my-rooms|attention/);
    }
  });
});
