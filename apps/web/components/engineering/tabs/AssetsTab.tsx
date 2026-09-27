"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ChevronRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  engineeringApi,
  type Asset,
  type PMSchedule,
  type WorkOrder,
} from "@/lib/api/engineering";
import {
  assetMetrics,
  sortAssetsForOperations,
} from "@/lib/utils/assetWorkspace";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StateBlock } from "@/components/ui/StateBlock";
import { Skeleton } from "@/components/ui/Skeleton";
import { AssetDetailPanel } from "@/components/engineering/AssetDetailPanel";
import { CreateAssetModal } from "@/components/engineering/CreateAssetModal";

type Filter = "all" | "risk" | "open" | "pm" | "warranty";
interface Props {
  canEdit: boolean;
  showCreateModal: boolean;
  onCloseCreateModal: () => void;
  onRequestCreate: () => void;
  initialAssetId?: string | null;
}

function formatCurrency(value: number | null) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
}

export function AssetsTab({
  canEdit,
  showCreateModal,
  onCloseCreateModal,
  onRequestCreate,
  initialAssetId,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    initialAssetId ?? null,
  );
  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: () => engineeringApi.listAssets(),
    select: (response) => response.data as Asset[],
  });
  const workOrdersQuery = useQuery({
    queryKey: ["asset-workspace-work-orders"],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 100 }),
    select: (response) => response.data as WorkOrder[],
  });
  const schedulesQuery = useQuery({
    queryKey: ["pm-schedules"],
    queryFn: engineeringApi.listPMSchedules,
    select: (response) => response.data as PMSchedule[],
  });
  const assets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data]);
  const workOrders = useMemo(
    () => workOrdersQuery.data ?? [],
    [workOrdersQuery.data],
  );
  const schedules = useMemo(
    () => schedulesQuery.data ?? [],
    [schedulesQuery.data],
  );
  const metrics = useMemo(
    () =>
      new Map(
        assets.map((asset) => [
          asset.id,
          assetMetrics(asset, workOrders, schedules),
        ]),
      ),
    [assets, schedules, workOrders],
  );

  useEffect(() => {
    if (initialAssetId && assets.some((asset) => asset.id === initialAssetId))
      setSelectedAssetId(initialAssetId);
  }, [assets, initialAssetId]);

  const filtered = useMemo(
    () =>
      sortAssetsForOperations(assets, metrics).filter((asset) => {
        const data = metrics.get(asset.id);
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query ||
          [
            asset.name,
            asset.asset_tag,
            asset.location_text,
            asset.model,
            asset.serial_number,
            asset.rooms?.room_number,
          ].some((value) => value?.toLowerCase().includes(query));
        const matchesFilter =
          filter === "all" ||
          (filter === "risk" && asset.failure_risk_score >= 70) ||
          (filter === "open" && Boolean(data?.openWorkOrders)) ||
          (filter === "pm" && Boolean(data?.pmOverdue)) ||
          (filter === "warranty" &&
            Boolean(
              asset.warranty_expires &&
              new Date(asset.warranty_expires) > new Date(),
            ));
        return matchesSearch && matchesFilter;
      }),
    [assets, filter, metrics, search],
  );

  const highRisk = assets.filter(
    (asset) => asset.failure_risk_score >= 70,
  ).length;
  const openRepairs = [...metrics.values()].reduce(
    (sum, metric) => sum + metric.openWorkOrders,
    0,
  );
  const pmOverdue = [...metrics.values()].filter(
    (metric) => metric.pmOverdue,
  ).length;
  const ytdCostRows = workOrders.filter(
    (workOrder) =>
      workOrder.status === "completed" &&
      workOrder.completed_at &&
      new Date(workOrder.completed_at).getFullYear() ===
        new Date().getFullYear() &&
      workOrder.asset_id &&
      workOrder.total_cost != null,
  );
  const ytdCost = ytdCostRows.length
    ? ytdCostRows.reduce(
        (sum, workOrder) => sum + (workOrder.total_cost ?? 0),
        0,
      )
    : null;
  const filterItems: Array<{ key: Filter; label: string }> = [
    { key: "all", label: t("engineering.assetsPage.filterAll") },
    { key: "risk", label: t("engineering.assetsPage.filterHighRisk") },
    { key: "open", label: t("engineering.assetsPage.filterOpenWo") },
    { key: "pm", label: t("engineering.assetsPage.filterPmDue") },
    { key: "warranty", label: t("engineering.assetsPage.filterWarranty") },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line py-3 sm:grid-cols-4">
        <div>
          <p className="text-lg font-semibold tabular-nums text-alert">
            {highRisk}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-ink3">
            {t("engineering.assetsPage.statHighRisk")}
          </p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums text-caution">
            {openRepairs}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-ink3">
            {t("engineering.assetsPage.openRepairs")}
          </p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums text-alert">
            {pmOverdue}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-ink3">
            {t("engineering.assetsPage.pmOverdue")}
          </p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums text-ink">
            {formatCurrency(ytdCost)}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-ink3">
            {t("engineering.assetsPage.maintenanceCostYtd")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t("engineering.assetsPage.searchAriaLabel")}
            placeholder={t(
              "engineering.assetsPage.searchOperationalPlaceholder",
            )}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {filterItems.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-[var(--r-sm)] border px-2.5 py-1.5 text-xs font-medium ${filter === item.key ? "border-accent bg-accent-soft text-accent" : "border-line text-ink2 hover:bg-surface-2"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {assetsQuery.isError ? (
        <StateBlock
          status="error"
          error={{
            message: t("engineering.assetsPage.loadError"),
            onRetry: () =>
              queryClient.invalidateQueries({ queryKey: ["assets"] }),
          }}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--r-md)] border border-line bg-surface md:grid md:grid-cols-[minmax(18rem,38%)_1fr]">
          <aside className={selectedAssetId ? "hidden md:block" : ""}>
            <div className="border-b border-line px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                {t("engineering.assetsPage.assetsList")}
              </p>
              <p className="mt-1 text-xs text-ink3">
                {t("engineering.assetsPage.footerCount", {
                  filtered: filtered.length,
                  total: assets.length,
                })}
              </p>
            </div>
            {assetsQuery.isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton
                    key={index}
                    variant="text"
                    className="h-16 w-full"
                  />
                ))}
              </div>
            ) : filtered.length ? (
              <div className="max-h-[42rem] overflow-y-auto">
                {filtered.map((asset) => {
                  const item = metrics.get(asset.id)!;
                  const location = asset.rooms?.room_number
                    ? `${t("engineering.workOrderCard.room")} ${asset.rooms.room_number}`
                    : asset.location_text;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => setSelectedAssetId(asset.id)}
                      className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${selectedAssetId === asset.id ? "bg-accent-soft" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {asset.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink3">
                          {[asset.asset_categories?.name, location]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-2 text-xs text-ink2">
                          {t("engineering.assetsPage.assetListRiskSummary", {
                            score: asset.failure_risk_score,
                            repairs: item.openWorkOrders
                              ? t("engineering.assetsPage.openRepairCount", {
                                  count: item.openWorkOrders,
                                })
                              : t("engineering.assetsPage.noOpenWork"),
                          })}
                        </p>
                        {asset.active_downtime && (
                          <p className={`mt-1 text-xs font-semibold ${asset.active_downtime.impact_level === "out_of_service" ? "text-alert" : "text-caution"}`}>
                            {asset.active_downtime.impact_level === "out_of_service"
                              ? t("engineering.assetsPage.outOfService")
                              : t("engineering.assetsPage.degraded")}
                          </p>
                        )}
                        {asset.condition_status === "critical" && (
                          <p className="mt-1 text-xs font-semibold text-alert">
                            ⚠ {t("condition.criticalReading")}
                          </p>
                        )}
                        <p
                          className={`mt-1 text-xs ${item.pmOverdue ? "font-medium text-alert" : "text-ink3"}`}
                        >
                          {item.pmSchedule
                            ? `${t("engineering.assetsPage.nextPm")} ${new Date(item.pmSchedule.next_due_at).toLocaleDateString()}`
                            : "—"}
                        </p>
                      </div>
                      <ChevronRight
                        size={16}
                        className="mt-3 shrink-0 text-ink3"
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold text-ink">
                  {assets.length
                    ? t("engineering.assetsPage.noMatchFilters")
                    : t("engineering.assetsPage.emptyHeading")}
                </p>
                <p className="mt-1 text-sm text-ink3">
                  {assets.length ? "" : t("engineering.assetsPage.emptyHelp")}
                </p>
                {!assets.length && canEdit && (
                  <Button
                    variant="primary"
                    onClick={onRequestCreate}
                    className="mt-4"
                  >
                    <Plus size={15} />
                    {t("engineering.assetsPage.addAsset")}
                  </Button>
                )}
              </div>
            )}
          </aside>
          <AssetDetailPanel
            assetId={selectedAssetId}
            canEdit={canEdit}
            onClose={() => setSelectedAssetId(null)}
          />
        </div>
      )}
      <CreateAssetModal
        isOpen={showCreateModal}
        onClose={onCloseCreateModal}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: ["assets"] })
        }
      />
    </div>
  );
}
