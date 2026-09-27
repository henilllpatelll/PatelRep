import type { Asset, PMSchedule, WorkOrder } from "@/lib/api/engineering";

export type AssetWorkspaceMetrics = {
  openWorkOrders: number;
  repairsThisYear: number;
  repairCostThisYear: number | null;
  completedCostRows: number;
  pmSchedule?: PMSchedule;
  pmOverdue: boolean;
};

const OPEN_STATUSES = new Set<WorkOrder["status"]>([
  "open",
  "escalated",
  "in_progress",
  "on_hold",
]);

export function assetMetrics(
  asset: Asset,
  workOrders: WorkOrder[],
  schedules: PMSchedule[],
  now = new Date(),
): AssetWorkspaceMetrics {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const linked = workOrders.filter(
    (workOrder) => workOrder.asset_id === asset.id,
  );
  const completedThisYear = linked.filter(
    (workOrder) =>
      workOrder.status === "completed" &&
      workOrder.completed_at &&
      new Date(workOrder.completed_at) >= yearStart,
  );
  const costRows = completedThisYear.filter(
    (workOrder) => workOrder.total_cost != null,
  );
  const pmSchedule = schedules
    .filter((schedule) => schedule.asset_id === asset.id && schedule.is_active)
    .sort(
      (a, b) =>
        new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime(),
    )[0];

  return {
    openWorkOrders: linked.filter((workOrder) =>
      OPEN_STATUSES.has(workOrder.status),
    ).length,
    repairsThisYear: completedThisYear.length,
    repairCostThisYear: costRows.length
      ? costRows.reduce(
          (sum, workOrder) => sum + (workOrder.total_cost ?? 0),
          0,
        )
      : null,
    completedCostRows: costRows.length,
    pmSchedule,
    pmOverdue: Boolean(pmSchedule && new Date(pmSchedule.next_due_at) < now),
  };
}

export function assetAgeYears(asset: Asset, now = new Date()): number | null {
  const start = asset.installation_date ?? asset.purchase_date;
  if (!start) return null;
  const years =
    (now.getTime() - new Date(start).getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);
  return years >= 0 ? years : null;
}

export function sortAssetsForOperations(
  assets: Asset[],
  metrics: Map<string, AssetWorkspaceMetrics>,
): Asset[] {
  return [...assets].sort((a, b) => {
    const leftMetric = metrics.get(a.id);
    const rightMetric = metrics.get(b.id);
    const score = (asset: Asset, value?: AssetWorkspaceMetrics) =>
      (asset.active_downtime?.impact_level === "out_of_service" ? 1_000 : 0) +
      (asset.active_downtime?.impact_level === "degraded" ? 250 : 0) +
      (asset.failure_risk_score >= 70 ? 100 : 0) +
      ((value?.openWorkOrders ?? 0) > 0 ? 40 : 0) +
      (value?.pmOverdue ? 30 : 0) +
      Math.min(value?.repairsThisYear ?? 0, 10);
    const difference = score(b, rightMetric) - score(a, leftMetric);
    return (
      difference || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
  });
}
