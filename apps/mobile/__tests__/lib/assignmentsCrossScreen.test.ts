import fs from "fs";
import path from "path";
import { assignmentBlock } from "@/lib/housekeeping/roomAssignment";
import { queueOf, runAssignmentQuery } from "@/lib/housekeeping/assignmentQuery";
import { selectSummary, selectUrgent } from "@/lib/housekeeping/assignmentSelectors";
import { buildBoardMetrics } from "@/lib/housekeeping/roomBoardSelectors";
import { assignmentsOf } from "../helpers/assignmentFixtures";
import { HOTEL_DATE, rawRoom } from "../helpers/roomBoardFixtures";

/* Assignments, the Room Board and Today are three readers of ONE verified snapshot. These tests pin the places
   where a second opinion would creep in: who owns a room, what may be done with it, what "unassigned" and
   "urgent" mean, and how rooms in the inspection loop are treated. */

describe("Assignments and the Room Board agree about every room", () => {
  const model = assignmentsOf();
  const rooms = model.rooms ?? [];

  it("same owner on both screens", () => {
    for (const entry of rooms) expect(entry.ownership.userId).toBe(entry.room.assignedTo);
  });

  it("a room the Room Board refuses to assign is a hard block in Assignments, and the reverse", () => {
    for (const entry of rooms) {
      expect(entry.eligibility.hardBlock === null).toBe(assignmentBlock(entry.room) === null);
    }
  });

  it("a room being cleaned is protected in both: not assignable, reassignable or removable", () => {
    const started = rooms.find((entry) => entry.room.status === "IN_PROGRESS");
    expect(started).toBeTruthy();
    expect(started?.eligibility).toMatchObject({ canAssign: false, canReassign: false, canRemove: false });
    expect(assignmentBlock(started!.room)).toBe("in_progress");
  });

  it("out-of-service rooms are blocked identically", () => {
    for (const entry of rooms.filter((candidate) => ["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"].includes(candidate.room.status))) {
      expect(entry.eligibility.hardBlock).toBe("out_of_service");
      expect(assignmentBlock(entry.room)).toBe("unavailable");
    }
  });

  it("Today's unassigned count is Assignments' unassigned work, not a second definition", () => {
    const summary = selectSummary(model)!;
    expect(summary.unassignedWork).toBe(buildBoardMetrics(rooms.map((entry) => entry.room)).unassigned);
  });

  it("the Home 'Unassigned' link lands on the assignable subset, never on more rooms than Today counted", () => {
    const summary = selectSummary(model)!;
    const queue = queueOf(rooms);
    const unassignedView = runAssignmentQuery({ rooms: queue, search: "", filters: { ...runFilters() }, scope: "unassigned", sort: "priority" });
    expect(unassignedView.visible.length).toBe(summary.autoAssignable);
    expect(unassignedView.visible.length).toBeLessThanOrEqual(summary.unassignedWork);
  });
});

function runFilters() {
  return require("@/lib/housekeeping/assignmentQuery").EMPTY_ASSIGNMENT_FILTERS;
}

describe("the inspection loop is respected, not duplicated", () => {
  const raw = [
    rawRoom("101", "CLEAN", { inspection_required: true }),
    rawRoom("102", "INSPECTED"),
    // A failed inspection returned this room to the cleaning queue with a recorded reclean request.
    rawRoom("103", "DIRTY", { reclean_requested_at: "2026-10-16T15:00:00Z" } as never),
    rawRoom("104", "DIRTY"),
  ];
  const model = assignmentsOf({ raw });
  const rooms = model.rooms ?? [];

  it("rooms waiting for or past inspection are not assignable", () => {
    for (const number of ["101", "102"]) {
      const entry = rooms.find((candidate) => candidate.room.roomNumber === number)!;
      expect(entry.eligibility.canAssign).toBe(false);
      expect(entry.eligibility.autoAssignable).toBe(false);
    }
    expect(rooms.find((candidate) => candidate.room.roomNumber === "101")!.eligibility.hardBlock).toBe("awaiting_inspection");
    expect(rooms.find((candidate) => candidate.room.roomNumber === "102")!.eligibility.hardBlock).toBe("guest_ready");
  });

  it("a recorded reclean is read from the authoritative data: one row, urgent, assignable once", () => {
    const reclean = rooms.filter((candidate) => candidate.room.roomNumber === "103");
    expect(reclean).toHaveLength(1);
    expect(reclean[0].eligibility.canAssign).toBe(true);
    expect(selectUrgent(rooms).map((entry) => entry.room.roomNumber)).toContain("103");
    // An ordinary dirty room is not urgent merely because it is dirty.
    expect(selectUrgent(rooms).map((entry) => entry.room.roomNumber)).not.toContain("104");
  });

  it("a failed inspection does not by itself create an unowned job: only the recorded reclean does", () => {
    const owned = assignmentsOf({ raw: [rawRoom("105", "DIRTY", { assigned_to: "hk-1", assignment_id: "a-1", assignment_date: HOTEL_DATE, reclean_requested_at: "2026-10-16T15:00:00Z" } as never)] });
    const entry = (owned.rooms ?? [])[0];
    expect(entry.eligibility.canAssign).toBe(false);
    expect(entry.eligibility.canReassign).toBe(true);
    expect(entry.ownership.userId).toBe("hk-1");
  });
});

describe("module boundaries", () => {
  const root = path.resolve(__dirname, "../..");
  const dirs = ["lib/housekeeping", "components/supervisor/assignments", "app/(app)/assignments"];
  const files = dirs.flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir))
      .filter((name) => /\.(ts|tsx)$/.test(name) && (dir !== "lib/housekeeping" || /^(use)?[Aa]ssignment|^useMidshift|^useSmartBalance|^useBulk|^smartBalance|^useBatch/.test(name)))
      .map((name) => path.join(root, dir, name)),
  );

  it("the Assignments code imports nothing from the Inspections screens or libraries (PR #165 stays independent)", () => {
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const imports = fs.readFileSync(file, "utf8").match(/from "@\/[^"]+"/g) ?? [];
      const offending = imports.filter((entry) => /@\/(components|lib|app)\/(\(app\)\/)?inspect/i.test(entry));
      expect({ file: path.relative(root, file), offending }).toEqual({ file: path.relative(root, file), offending: [] });
    }
  });

  it("no Assignments file opens its own realtime channel", () => {
    for (const file of files) expect(fs.readFileSync(file, "utf8")).not.toMatch(/supabase\s*\.\s*channel\(|\.channel\(/);
  });
});
