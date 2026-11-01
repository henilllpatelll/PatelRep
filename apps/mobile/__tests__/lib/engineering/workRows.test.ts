import { buildWorkRows, type WorkRow } from "@/lib/engineering/workRows";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const ME = "eng-me";
let n = 0;
const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: `wo-${++n}`,
  title: "Fix it",
  status: "open",
  priority: "normal",
  assigned_to: null,
  created_at: "2026-10-15T10:00:00Z",
  ...over,
});
const shape = (rows: WorkRow[]) => rows.map((r) => (r.type === "section" ? `#${r.section}:${r.count}${r.partial ? "+" : ""}` : r.wo.id));

describe("My Work sections", () => {
  it("orders needs-attention, in progress, ready, on hold and skips empty ones", () => {
    const rows = buildWorkRows(
      [
        wo({ id: "h", status: "on_hold", assigned_to: ME }),
        wo({ id: "r", assigned_to: ME }),
        wo({ id: "p", status: "in_progress", assigned_to: ME }),
        wo({ id: "u", priority: "urgent", assigned_to: ME }),
      ],
      { view: "mine", role: "engineer", sort: "priority", hasMore: false }
    );
    expect(shape(rows)).toEqual(["#escalated:1", "u", "#in_progress:1", "p", "#ready:1", "r", "#on_hold:1", "h"]);
  });

  it("shows no section header at all for an empty list", () => {
    expect(buildWorkRows([], { view: "mine", role: "engineer", sort: "priority", hasMore: false })).toEqual([]);
  });

  it("marks counts as partial while more pages remain, so a floor is never passed off as a total", () => {
    const rows = buildWorkRows([wo({ status: "in_progress", assigned_to: ME })], { view: "mine", role: "engineer", sort: "priority", hasMore: true });
    expect(rows[0]).toMatchObject({ type: "section", section: "in_progress", count: 1, partial: true });
  });

  it("never lists one order twice", () => {
    const dup = wo({ id: "same", status: "in_progress", assigned_to: ME });
    const rows = buildWorkRows([dup, dup], { view: "mine", role: "engineer", sort: "priority", hasMore: false });
    expect(rows.filter((r) => r.type === "wo")).toHaveLength(1);
  });
});

describe("Available sections", () => {
  it("is a plain list when everything can be claimed", () => {
    const rows = buildWorkRows([wo({ id: "a" }), wo({ id: "b" })], { view: "available", role: "engineer", sort: "priority", hasMore: false });
    expect(shape(rows).every((r) => !r.startsWith("#"))).toBe(true);
  });

  it("splits out escalated work that needs an owner, and omits an empty 'ready to claim' header", () => {
    const rows = buildWorkRows([wo({ id: "e", status: "escalated" })], { view: "available", role: "engineer", sort: "priority", hasMore: false });
    expect(shape(rows)).toEqual(["#needsOwner:1", "e"]);
  });

  it("a chief engineer cannot claim, so everything is work that needs an owner", () => {
    const rows = buildWorkRows([wo({ id: "o" })], { view: "available", role: "chief_engineer", sort: "priority", hasMore: false });
    expect(shape(rows)).toEqual(["#needsOwner:1", "o"]);
  });
});

describe("other views", () => {
  it("lists Team, Waiting and Done flat and sorted", () => {
    for (const view of ["team", "waiting", "done"] as const) {
      const rows = buildWorkRows([wo({ id: "low", priority: "low" }), wo({ id: "hi", priority: "emergency" })], { view, role: "gm", sort: "priority", hasMore: false });
      expect(shape(rows)).toEqual(["hi", "low"]);
    }
  });
});
