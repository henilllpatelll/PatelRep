import type { InspectionRecordRow, OpenCorrectionRow } from "@/lib/api/inspections";
import { buildCorrections, buildDone, searchByRoomNumber } from "@/lib/inspections/lists";

const task = (over: Partial<NonNullable<OpenCorrectionRow["task"]>> = {}): NonNullable<OpenCorrectionRow["task"]> => ({
  id: "t",
  status: "open",
  assigned_to: "hk-1",
  assigned_name: "Hana",
  due_at: null,
  started_at: null,
  completed_at: null,
  ...over,
});

const correction = (id: string, over: Partial<OpenCorrectionRow> = {}): OpenCorrectionRow => ({
  inspection_id: `insp-${id}`,
  room_id: `room-${id}`,
  room_number: id,
  floor: 2,
  building: null,
  inspected_at: "2026-10-20T14:00:00Z",
  overall_result: "failed",
  kind: "reclean",
  status: "assigned",
  notes: null,
  inspector_name: "Sam",
  failed_count: 2,
  failed_items: [{ id: "i1", label: "Mirror", note: null }],
  task: task(),
  ...over,
});

describe("corrections", () => {
  it("classifies by the server status: needs action, with the housekeeper, ready for reinspection", () => {
    const { items } = buildCorrections([
      correction("201", { status: "unassigned", task: task({ assigned_to: null, assigned_name: null }) }),
      correction("202", { status: "in_progress" }),
      correction("203", { status: "resubmitted" }),
      correction("204", { status: "escalated" }),
      correction("205", { status: "correction_missing", task: null }),
      correction("206", { status: "cancelled" }),
    ]);
    const stage = Object.fromEntries(items.map((i) => [i.roomNumber, i.stage]));
    expect(stage).toEqual({
      "201": "needs_action",
      "202": "with_housekeeper",
      "203": "awaiting_reinspection",
      "204": "needs_action",
      "205": "needs_action",
      "206": "needs_action",
    });
  });

  it("verified and superseded corrections are not outstanding, even if the server sent them", () => {
    const { items } = buildCorrections([correction("201", { status: "verified" }), correction("202", { status: "superseded" }), correction("203")]);
    expect(items.map((i) => i.roomNumber)).toEqual(["203"]);
  });

  it("an unknown status is counted as unreadable, never shown as needing action", () => {
    const list = buildCorrections([correction("201", { status: "teleported" }), correction("202", { room_id: null }), correction("203")]);
    expect(list.items.map((i) => i.roomNumber)).toEqual(["203"]);
    expect(list.unreadable).toBe(2);
  });

  it("counts a room correction once even if the server repeats it, keeping the newer", () => {
    const { items } = buildCorrections([
      correction("201", { inspection_id: "old", inspected_at: "2026-10-19T10:00:00Z" }),
      correction("201", { inspection_id: "new", inspected_at: "2026-10-20T10:00:00Z" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].inspectionId).toBe("new");
  });

  it("owner is the real assignee, unnamed when there is an id but no name, and none when unassigned", () => {
    const { items } = buildCorrections([
      correction("201"),
      correction("202", { task: task({ assigned_to: "hk-2", assigned_name: null }) }),
      correction("203", { status: "unassigned", task: task({ assigned_to: null, assigned_name: null }) }),
      correction("204", { status: "correction_missing", task: null }),
    ]);
    const owner = Object.fromEntries(items.map((i) => [i.roomNumber, i.owner]));
    expect(owner["201"]).toEqual({ kind: "named", name: "Hana" });
    expect(owner["202"]).toEqual({ kind: "unnamed" });
    expect(owner["203"]).toEqual({ kind: "none" });
    expect(owner["204"]).toEqual({ kind: "none" });
  });

  it("orders needs-action first, then ready for reinspection, then with the housekeeper; longest-outstanding first", () => {
    const { items } = buildCorrections([
      correction("301", { status: "in_progress" }),
      correction("302", { status: "resubmitted" }),
      correction("303", { status: "unassigned", inspected_at: "2026-10-20T15:00:00Z", task: null }),
      correction("304", { status: "unassigned", inspected_at: "2026-10-20T09:00:00Z", task: null }),
    ]);
    expect(items.map((i) => i.roomNumber)).toEqual(["304", "303", "302", "301"]);
  });

  it("the latest relevant time is the most recent of the inspection and the task start or completion", () => {
    const { items } = buildCorrections([
      correction("201", { inspected_at: "2026-10-20T10:00:00Z", task: task({ status: "completed", started_at: "2026-10-20T11:00:00Z", completed_at: "2026-10-20T12:30:00Z" }) }),
    ]);
    expect(items[0].latestAtMs).toBe(Date.parse("2026-10-20T12:30:00Z"));
  });

  it("carries truncation through so a lower bound is never presented as a total", () => {
    expect(buildCorrections([correction("201")], true).truncated).toBe(true);
    expect(buildCorrections([], false)).toEqual({ items: [], unreadable: 0, truncated: false });
  });
});

const record = (id: string, over: Partial<InspectionRecordRow> = {}): InspectionRecordRow => ({
  id,
  room_id: `room-${id}`,
  room_number: id,
  floor: 2,
  building: null,
  inspector_name: "a1b2c3d4",
  inspector_display_name: "Sam Supervisor",
  overall_result: "passed",
  notes: null,
  completed_at: "2026-10-20T15:00:00Z",
  reinspection_of: null,
  ...over,
});

describe("done", () => {
  it("shows only the hotel business date, newest first", () => {
    const { items } = buildDone(
      [
        record("101", { completed_at: "2026-10-20T14:00:00Z" }),
        record("102", { completed_at: "2026-10-20T17:00:00Z" }),
        record("103", { completed_at: "2026-10-20T03:00:00Z" }), // 10 PM on the 19th in Chicago
      ],
      "2026-10-20",
      "America/Chicago",
    );
    expect(items.map((i) => i.roomNumber)).toEqual(["102", "101"]);
  });

  it("never shows an id as a person: no real name means not recorded", () => {
    const { items } = buildDone([record("101", { inspector_display_name: null }), record("102", { inspector_display_name: "  " }), record("103")], "2026-10-20", "America/Chicago");
    expect(items.find((i) => i.roomNumber === "101")!.inspectorName).toBeNull();
    expect(items.find((i) => i.roomNumber === "102")!.inspectorName).toBeNull();
    expect(items.find((i) => i.roomNumber === "103")!.inspectorName).toBe("Sam Supervisor");
    expect(JSON.stringify(items)).not.toContain("a1b2c3d4");
  });

  it("an older server that sends only the legacy name never leaks its id prefix", () => {
    const legacy = record("101");
    delete legacy.inspector_display_name;
    expect(buildDone([legacy], "2026-10-20", "America/Chicago").items[0].inspectorName).toBeNull();
  });

  it("maps results, treats unknown ones as unknown, and marks a reinspection only when it is linked", () => {
    const { items } = buildDone(
      [
        record("101", { overall_result: "failed" }),
        record("102", { overall_result: "conditional" }),
        record("103", { overall_result: "weird" }),
        record("104", { reinspection_of: "insp-1" }),
      ],
      "2026-10-20",
      "America/Chicago",
    );
    const by = Object.fromEntries(items.map((i) => [i.roomNumber, i]));
    expect(by["101"].result).toBe("failed");
    expect(by["102"].result).toBe("conditional");
    expect(by["103"].result).toBe("unknown");
    expect(by["104"].isReinspection).toBe(true);
    expect(by["101"].isReinspection).toBe(false);
  });

  it("drops repeats of the same inspection and counts rows it cannot read", () => {
    const list = buildDone([record("101"), record("101"), record("102", { completed_at: "garbage" }), record("103", { room_number: "" })], "2026-10-20", "America/Chicago");
    expect(list.items).toHaveLength(1);
    expect(list.unreadable).toBe(2);
  });
});

describe("search across lists", () => {
  it("ranks exact, prefix, contains and ignores case and spaces", () => {
    const rooms = [{ roomNumber: "212" }, { roomNumber: "12" }, { roomNumber: "123" }, { roomNumber: "9" }];
    expect(searchByRoomNumber(rooms, " 12 ").map((r) => r.roomNumber)).toEqual(["12", "123", "212"]);
    expect(searchByRoomNumber(rooms, "")).toHaveLength(4);
    expect(searchByRoomNumber([{ roomNumber: "2A" }], "2a")).toHaveLength(1);
  });
});
