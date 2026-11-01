import type { PmScheduleRow } from "@/lib/api/assets";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import { DEFAULT_PM_FILTERS, activeFilterCount, applyPmFilters, categoriesOf, matchesQuery, todaySections } from "@/lib/engineering/pmFilters";

const NOW = new Date("2026-11-04T16:00:00Z");
const row = (id: string, due: string | null, extra: Partial<PmScheduleRow> = {}): PmScheduleRow => ({
  id,
  asset_id: `asset-${id}`,
  name: `PM ${id}`,
  interval_type: "monthly",
  next_due_at: due,
  is_active: true,
  assets: { name: `Asset ${id}`, room_id: null },
  ...extra,
});

const set = adaptPmSchedules(
  [
    row("filter", "2026-11-01T18:00:00Z", {
      name: "HVAC filter change",
      interval_type: "quarterly",
      assets: { name: "AHU-02", room_id: null, asset_tag: "HV-0002", location_text: "Roof", asset_categories: { name: "HVAC" }, manufacturer: "Trane" },
    }),
    row("boiler", "2026-11-04T18:00:00Z", {
      name: "Boiler pressure check",
      interval_type: "weekly",
      assets: { name: "Boiler 1", room_id: "r1", asset_categories: { name: "Boilers" }, rooms: { room_number: "B12" } },
    }),
    row("pool", "2026-11-20T18:00:00Z", { name: "Pool pump", interval_type: "annual", assets: { name: "Pump A", room_id: null, asset_categories: { name: "Pool" } } }),
    row("old", "2026-10-01T18:00:00Z", { name: "Elevator review", assets: { name: "Elevator 2", room_id: null, asset_categories: { name: "HVAC" } } }),
  ],
  "America/Chicago",
  NOW,
);

describe("search", () => {
  it("matches name, equipment, asset tag, location, room, category and manufacturer", () => {
    const find = (q: string) => set.filter((v) => matchesQuery(v, q)).map((v) => v.id);
    expect(find("hvac filter")).toEqual(["filter"]);
    expect(find("ahu-02")).toEqual(["filter"]);
    expect(find("hv-0002")).toEqual(["filter"]);
    expect(find("roof")).toEqual(["filter"]);
    expect(find("b12")).toEqual(["boiler"]);
    expect(find("trane")).toEqual(["filter"]);
    expect(find("pool")).toEqual(["pool"]);
    expect(find("")).toHaveLength(4);
    expect(find("nothing like this")).toEqual([]);
  });

  it("requires every word to match", () => {
    expect(set.filter((v) => matchesQuery(v, "boiler pool"))).toEqual([]);
  });
});

describe("filters over the whole dataset", () => {
  it("filters by due state", () => {
    const only = (states: string[]) => applyPmFilters(set, { ...DEFAULT_PM_FILTERS, states: states as never }).map((v) => v.id);
    expect(only(["overdue"]).sort()).toEqual(["filter", "old"]);
    expect(only(["due_today"])).toEqual(["boiler"]);
    expect(only(["overdue", "due_today"])).toHaveLength(3);
    expect(only(["upcoming"])).toEqual(["pool"]);
  });

  it("filters by frequency and equipment type", () => {
    expect(applyPmFilters(set, { ...DEFAULT_PM_FILTERS, frequencies: ["quarterly", "annual"] }).map((v) => v.id).sort()).toEqual(["filter", "pool"]);
    expect(applyPmFilters(set, { ...DEFAULT_PM_FILTERS, category: "HVAC" }).map((v) => v.id).sort()).toEqual(["filter", "old"]);
    expect(categoriesOf(set)).toEqual(["Boilers", "HVAC", "Pool"]);
  });

  it("sorts by due date, most overdue, or equipment name", () => {
    const ids = (sort: "due_soonest" | "most_overdue" | "equipment") => applyPmFilters(set, { ...DEFAULT_PM_FILTERS, sort }).map((v) => v.id);
    expect(ids("due_soonest")).toEqual(["old", "filter", "boiler", "pool"]);
    expect(ids("most_overdue")).toEqual(["old", "filter", "boiler", "pool"]);
    expect(ids("equipment")).toEqual(["filter", "boiler", "old", "pool"]);
  });

  it("does not mutate its input and reports how many controls are active", () => {
    const before = set.map((v) => v.id);
    applyPmFilters(set, { ...DEFAULT_PM_FILTERS, sort: "equipment" });
    expect(set.map((v) => v.id)).toEqual(before);
    expect(activeFilterCount(DEFAULT_PM_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_PM_FILTERS, query: "x", states: ["overdue"], sort: "equipment" })).toBe(3);
  });
});

describe("todaySections", () => {
  it("separates overdue (longest first) from due today and the coming week", () => {
    const s = todaySections(set);
    expect(s.overdue.map((v) => v.id)).toEqual(["old", "filter"]);
    expect(s.dueToday.map((v) => v.id)).toEqual(["boiler"]);
    expect(s.next).toEqual([]);
  });
});
