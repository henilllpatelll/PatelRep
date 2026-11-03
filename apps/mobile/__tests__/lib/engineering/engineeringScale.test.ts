import type { PmScheduleRow } from "@/lib/api/assets";
import { adaptPmSchedules, countPmSchedules } from "@/lib/engineering/pmSchedules";
import { applyPmFilters, DEFAULT_PM_FILTERS, todayPlan } from "@/lib/engineering/pmFilters";
import { countThisWeek, dayMarkers } from "@/lib/engineering/pmCalendar";
import { mergeAssetPages, type AssetRow } from "@/lib/engineering/assetModel";

const NOW = new Date("2026-11-04T16:00:00Z");
const TODAY = "2026-11-04";

function rows(n: number): PmScheduleRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    asset_id: `a${i}`,
    name: i % 7 === 0 ? `Very long inspection name that keeps going to test wrapping and truncation number ${i}` : `PM ${i}`,
    interval_type: (["daily", "weekly", "monthly", "quarterly", "annual"] as const)[i % 5],
    next_due_at: i % 11 === 0 ? null : new Date(NOW.getTime() + ((i % 60) - 20) * 86_400_000).toISOString(),
    is_active: true,
    assets: { name: `Asset ${i}`, room_id: null, asset_categories: { name: `Cat ${i % 9}` } },
  }));
}

describe("PM at property scale (400 schedules)", () => {
  const views = adaptPmSchedules(rows(400), "America/Chicago", NOW);

  it("keeps every active schedule and never counts one twice across the summary buckets", () => {
    expect(views).toHaveLength(400);
    const c = countPmSchedules(views);
    expect(c.overdue + c.dueToday + c.dueSoon + c.upcoming + c.unscheduled).toBe(400);
    expect(countThisWeek(views, TODAY)).toBeLessThanOrEqual(c.dueToday + c.dueSoon);
  });

  it("builds the Today plan with each schedule in at most one section", () => {
    const drafts = new Set(["s3", "s14", "s250"]);
    const plan = todayPlan(views, drafts);
    const ids = [...plan.continueWork, ...plan.needsAttention, ...plan.dueToday, ...plan.comingUp].map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.continueWork.map((v) => v.id).sort()).toEqual(["s14", "s250", "s3"]);
  });

  it("filters, sorts and marks the calendar over all 400 quickly", () => {
    const start = Date.now();
    const filtered = applyPmFilters(views, { ...DEFAULT_PM_FILTERS, query: "inspection name", sort: "most_overdue" });
    dayMarkers(views);
    expect(filtered.length).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe("Assets at property scale (1,000 assets)", () => {
  const asset = (i: number): AssetRow => ({
    id: `a${i}`,
    name: `Asset ${i}`,
    service_status: "operational",
    active_work_order_count: i % 4,
    pm_overdue: false,
    pm_due_soon: false,
    repeat_repairs_90d: 0,
    has_active_prediction: false,
    had_downtime_365d: false,
  });

  it("merges 40 pages of 25 without losing or duplicating a row", () => {
    let merged: AssetRow[] = [];
    for (let page = 0; page < 40; page++) {
      const incoming = Array.from({ length: 25 }, (_, i) => asset(page * 25 + i));
      merged = mergeAssetPages(merged, incoming);
      // A re-delivered page (a retried request) must be a no-op.
      merged = mergeAssetPages(merged, incoming);
    }
    expect(merged).toHaveLength(1000);
    expect(new Set(merged.map((r) => r.id)).size).toBe(1000);
  });
});
