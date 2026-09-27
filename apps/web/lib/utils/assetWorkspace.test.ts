import assert from "node:assert/strict";
import test from "node:test";
import type { Asset, PMSchedule, WorkOrder } from "@/lib/api/engineering";
import {
  assetAgeYears,
  assetMetrics,
  sortAssetsForOperations,
} from "./assetWorkspace";

const now = new Date("2026-09-27T12:00:00.000Z");
const asset = (id: string, risk = 0): Asset => ({
  id,
  name: id,
  category_id: "category",
  is_active: true,
  failure_risk_score: risk,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
});
const workOrder = (overrides: Partial<WorkOrder>): WorkOrder => ({
  id: crypto.randomUUID(),
  work_order_number: 1,
  title: "Repair",
  category: "hvac",
  priority: "normal",
  status: "completed",
  created_by: "user",
  is_ai_created: false,
  is_pm_generated: false,
  guest_reported: false,
  sla_minutes: 60,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  ...overrides,
});
const schedule = (asset_id: string, next_due_at: string): PMSchedule => ({
  id: `pm-${asset_id}`,
  asset_id,
  name: "Quarterly PM",
  interval_type: "quarterly",
  estimated_minutes: 20,
  next_due_at,
  is_active: true,
});

test("calculates asset costs only from completed current-year work with recorded total cost", () => {
  const data = assetMetrics(
    asset("a"),
    [
      workOrder({
        asset_id: "a",
        completed_at: "2026-02-03T00:00:00Z",
        total_cost: 145,
      }),
      workOrder({ asset_id: "a", completed_at: "2026-03-03T00:00:00Z" }),
      workOrder({ asset_id: "a", status: "open" }),
      workOrder({
        asset_id: "a",
        completed_at: "2025-12-31T00:00:00Z",
        total_cost: 99,
      }),
    ],
    [],
    now,
  );
  assert.equal(data.openWorkOrders, 1);
  assert.equal(data.repairsThisYear, 2);
  assert.equal(data.repairCostThisYear, 145);
  assert.equal(data.completedCostRows, 1);
});

test("prioritizes risky assets with active work before remaining assets and derives age without persistence", () => {
  const urgent = asset("urgent", 82);
  const healthy = asset("healthy", 12);
  const metrics = new Map([
    [
      urgent.id,
      assetMetrics(
        urgent,
        [workOrder({ asset_id: urgent.id, status: "open" })],
        [schedule(urgent.id, "2026-10-01T00:00:00Z")],
        now,
      ),
    ],
    [healthy.id, assetMetrics(healthy, [], [], now)],
  ]);
  assert.deepEqual(
    sortAssetsForOperations([healthy, urgent], metrics).map((item) => item.id),
    ["urgent", "healthy"],
  );
  assert.equal(
    assetAgeYears({ ...urgent, installation_date: "2018-03-27" }, now)?.toFixed(
      1,
    ),
    "8.5",
  );
});

test("puts assets with an active complete downtime ahead of high-risk operating assets", () => {
  const down = {
    ...asset("down", 10),
    active_downtime: {
      id: "down-1",
      asset_id: "down",
      started_at: now.toISOString(),
      downtime_type: "unplanned" as const,
      impact_level: "out_of_service" as const,
    },
  };
  const highRisk = asset("high-risk", 91);
  const metrics = new Map([
    [down.id, assetMetrics(down, [], [], now)],
    [highRisk.id, assetMetrics(highRisk, [], [], now)],
  ]);
  assert.deepEqual(
    sortAssetsForOperations([highRisk, down], metrics).map((item) => item.id),
    ["down", "high-risk"],
  );
});
