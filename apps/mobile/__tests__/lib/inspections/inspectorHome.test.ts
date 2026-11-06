import type { InspectionRecordRow, OpenCorrectionRow } from "@/lib/api/inspections";
import { buildInspectorHome, PRIORITY_LIMIT, queueAccess, RECENT_LIMIT } from "@/lib/inspections/inspectorHome";
import { buildCorrections, buildDone } from "@/lib/inspections/lists";
import { buildQueue } from "@/lib/inspections/queue";
import type { QueueContext } from "@/lib/inspections/queueView";
import { readyRoom } from "../../helpers/inspectionFixtures";

const NOW = Date.parse("2026-10-20T18:00:00Z"); // 1:00 PM in Chicago
const ctx: QueueContext = { now: NOW, timeZone: "America/Chicago" };

const record = (id: string, result: string, minutesAgo: number): InspectionRecordRow =>
  ({
    id,
    room_id: `room-${id}`,
    room_number: id,
    floor: 2,
    building: null,
    inspector_display_name: "Sam",
    completed_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
    overall_result: result,
    reinspection_of: null,
    notes: null,
  }) as unknown as InspectionRecordRow;

const correction = (id: string): OpenCorrectionRow =>
  ({
    inspection_id: `insp-${id}`,
    room_id: `room-${id}`,
    room_number: id,
    floor: 2,
    building: null,
    inspected_at: "2026-10-20T14:00:00Z",
    overall_result: "failed",
    kind: "reclean",
    status: "unassigned",
    notes: null,
    inspector_name: "Sam",
    failed_count: 1,
    failed_items: [{ id: "i1", label: "Mirror", note: null }],
    task: null,
  }) as unknown as OpenCorrectionRow;

const doneList = (...rows: InspectionRecordRow[]) => buildDone(rows, "2026-10-20", "America/Chicago");

describe("Inspector Home model", () => {
  it("chooses the next room with the same priority order the queue uses", () => {
    const items = buildQueue([
      readyRoom("a", { room_number: "101", floor: 1 }),
      readyRoom("b", { room_number: "102", floor: 1, arrival_at: "2026-10-20T16:00:00Z" }), // arrival already passed: overdue
      readyRoom("c", { room_number: "103", floor: 1, vip: true }),
    ]);
    const model = buildInspectorHome({ items, corrections: null, done: null, ctx });
    expect(model.focus?.roomNumber).toBe("102");
  });

  it("lists only other rooms that carry a recorded reason to go first, capped", () => {
    const rooms = [
      readyRoom("focus", { room_number: "100", floor: 1, arrival_at: "2026-10-20T15:00:00Z" }),
      readyRoom("p1", { room_number: "101", floor: 1, vip: true }),
      readyRoom("p2", { room_number: "102", floor: 1, vip: true }),
      readyRoom("p3", { room_number: "103", floor: 1, vip: true }),
      readyRoom("p4", { room_number: "104", floor: 1, vip: true }),
      readyRoom("plain", { room_number: "105", floor: 1 }),
    ];
    const model = buildInspectorHome({ items: buildQueue(rooms), corrections: null, done: null, ctx });
    expect(model.focus?.roomNumber).toBe("100");
    expect(model.priority).toHaveLength(PRIORITY_LIMIT);
    expect(model.priority.every((entry) => entry.item.roomNumber !== "100" && entry.item.roomNumber !== "105")).toBe(true);
    expect(model.priority.every((entry) => entry.badge === "vip")).toBe(true);
  });

  it("an unplanned room with nothing recorded about it is never labelled a priority", () => {
    const model = buildInspectorHome({ items: buildQueue([readyRoom("a"), readyRoom("b", { room_number: "202" })]), corrections: null, done: null, ctx });
    expect(model.focus).not.toBeNull();
    expect(model.priority).toEqual([]);
  });

  it("unverified sources are unknown (null), never zero", () => {
    const model = buildInspectorHome({ items: null, corrections: null, done: null, ctx });
    expect(model.metrics.awaiting.value).toBeNull();
    expect(model.metrics.completed.value).toBeNull();
    expect(model.metrics.failed.value).toBeNull();
    expect(model.metrics.reinspection.value).toBeNull();
    expect(model.focus).toBeNull();
    expect(model.allComplete).toBe(false);
    expect(model.nothingWaiting).toBe(false);
  });

  it("counts completed and failed from today's inspections, newest first and capped", () => {
    const done = doneList(record("1", "passed", 50), record("2", "failed", 40), record("3", "passed", 30), record("4", "failed", 20), record("5", "conditional", 10));
    const model = buildInspectorHome({ items: buildQueue([]), corrections: buildCorrections([]), done, ctx });
    expect(model.metrics.completed.value).toBe(5);
    expect(model.metrics.failed.value).toBe(2);
    expect(model.recent).toHaveLength(RECENT_LIMIT);
    expect(model.recent.map((entry) => entry.roomNumber)).toEqual(["5", "4", "3"]);
  });

  it("reinspection work is the open corrections, and a truncated list is a lower bound", () => {
    const list = buildCorrections([correction("201"), correction("202")], true);
    const model = buildInspectorHome({ items: buildQueue([]), corrections: list, done: doneList(), ctx });
    expect(model.metrics.reinspection).toEqual({ value: 2, atLeast: true });
  });

  it("separates 'all inspections complete' from 'nothing has been waiting yet'", () => {
    const empty = buildQueue([]);
    const finished = buildInspectorHome({ items: empty, corrections: null, done: doneList(record("1", "passed", 5)), ctx });
    expect(finished.allComplete).toBe(true);
    expect(finished.nothingWaiting).toBe(false);
    const idle = buildInspectorHome({ items: empty, corrections: null, done: doneList(), ctx });
    expect(idle.allComplete).toBe(false);
    expect(idle.nothingWaiting).toBe(true);
  });

  it("an empty queue with unverified history says neither", () => {
    const model = buildInspectorHome({ items: buildQueue([]), corrections: null, done: null, ctx });
    expect(model.allComplete).toBe(false);
    expect(model.nothingWaiting).toBe(false);
  });

  it("does not mutate or reorder the caller's queue", () => {
    const items = buildQueue([readyRoom("a", { room_number: "101", floor: 1 }), readyRoom("b", { room_number: "102", floor: 1, vip: true })]);
    const before = items.map((item) => item.roomNumber);
    buildInspectorHome({ items, corrections: null, done: null, ctx });
    expect(items.map((item) => item.roomNumber)).toEqual(before);
  });
});

describe("queue access", () => {
  it("tells a refusal apart from a failure and from loading", () => {
    expect(queueAccess({ status: "loading" })).toBe("loading");
    expect(queueAccess({ status: "failed", failure: { kind: "forbidden", status: 403 } })).toBe("restricted");
    expect(queueAccess({ status: "failed", failure: { kind: "error", status: 500 } })).toBe("unavailable");
    expect(queueAccess({ status: "failed", failure: { kind: "offline", status: null } })).toBe("unavailable");
  });

  it("keeps showing the last answer when a refresh failed or the device went offline", () => {
    expect(queueAccess({ status: "stale", data: [], fetchedAt: 1, reason: "offline", failure: null })).toBe("ok");
    expect(queueAccess({ status: "available", data: [], fetchedAt: 1 })).toBe("ok");
    expect(queueAccess({ status: "empty", fetchedAt: 1 })).toBe("ok");
  });
});
