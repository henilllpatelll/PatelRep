"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ClipboardPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  engineeringApi,
  type Asset,
  type AssetReliabilitySummary,
  type PMSchedule,
  type WorkOrder,
} from "@/lib/api/engineering";
import { programsApi, type PMCompletionRecord } from "@/lib/api/programs";
import { assetAgeYears, assetMetrics } from "@/lib/utils/assetWorkspace";
import {
  assetOperationalStatus,
  formatReliabilityDuration,
} from "@/lib/utils/assetReliability";
import { getRiskBadge, getWarrantyLabel } from "@/lib/utils/engineering";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/Skeleton";
import { CreateWorkOrderDrawer } from "@/components/engineering/CreateWorkOrderDrawer";
import { CreatePMScheduleModal } from "@/components/engineering/CreatePMScheduleModal";
import { CreateAssetModal } from "@/components/engineering/CreateAssetModal";
import { AssetReadingsPanel } from "@/components/engineering/AssetReadingsPanel";

type DetailTab = "overview" | "history" | "pm" | "readings" | "reliability";

function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
}

function date(value?: string) {
  return value ? format(new Date(value), "MMM d, yyyy") : "—";
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-[var(--r-sm)] bg-surface-2 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-ink3">
        {label}
      </p>
      <p
        className={`mt-1 text-sm font-semibold tabular-nums ${tone ?? "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

interface Props {
  assetId: string | null;
  canEdit: boolean;
  onClose: () => void;
}

export function AssetDetailPanel({ assetId, canEdit, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCreateWO, setShowCreateWO] = useState(false);
  const [showCreatePM, setShowCreatePM] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);

  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => engineeringApi.getAsset(assetId!),
    select: (response) =>
      response.data as Asset & { pm_schedules?: PMSchedule[] },
    enabled: Boolean(assetId),
  });
  const workOrdersQuery = useQuery({
    queryKey: ["asset-work-orders", assetId],
    queryFn: () =>
      engineeringApi.listWorkOrders({ asset_id: assetId!, per_page: 100 }),
    select: (response) => response.data,
    enabled: Boolean(assetId),
  });
  const predictionQuery = useQuery({
    queryKey: ["failure-predictions"],
    queryFn: engineeringApi.getFailurePredictions,
    select: (response) => response.data,
    enabled: Boolean(assetId),
  });
  const recurringQuery = useQuery({
    queryKey: ["recurring-issues"],
    queryFn: engineeringApi.getRecurringIssues,
    select: (response) => response.data,
    enabled: Boolean(assetId),
  });
  const downtimeQuery = useQuery({
    queryKey: ["asset-downtime", assetId],
    queryFn: () => engineeringApi.listAssetDowntime(assetId!),
    select: (response) => response.data,
    enabled: Boolean(assetId && (tab === "history" || tab === "reliability")),
  });
  const reliabilityQuery = useQuery({
    queryKey: ["asset-reliability", assetId],
    queryFn: () => engineeringApi.getAssetReliability(assetId!),
    select: (response) => response.data as AssetReliabilitySummary,
    enabled: Boolean(
      assetId && (tab === "reliability" || assetQuery.data?.active_downtime),
    ),
  });
  const conditionQuery = useQuery({
    queryKey: ["asset-condition", assetId],
    queryFn: () => engineeringApi.getAssetConditionSummary(assetId!),
    select: (response) => response.data,
    enabled: Boolean(assetId),
  });

  const asset = assetQuery.data;
  const isSpanish = i18n.language.startsWith("es");
  const schedules = asset?.pm_schedules ?? [];
  const historyPmQuery = useQuery({
    queryKey: [
      "asset-pm-history",
      assetId,
      schedules.map((schedule) => schedule.id).join(","),
    ],
    queryFn: async () =>
      (
        await Promise.all(
          schedules.map((schedule) =>
            programsApi.listPMCompletions(schedule.id),
          ),
        )
      ).flatMap((response, index) =>
        response.data.map((completion) => ({
          completion,
          schedule: schedules[index],
        })),
      ),
    enabled: Boolean(assetId && schedules.length && tab === "history"),
  });
  const details = asset
    ? assetMetrics(asset, workOrdersQuery.data ?? [], schedules)
    : null;
  const prediction = predictionQuery.data?.find(
    (item) => item.asset_id === assetId,
  );
  const recurring = recurringQuery.data?.find(
    (item) => item.asset_id === assetId,
  );
  const history = useMemo(() => {
    const work = (workOrdersQuery.data ?? []).map((item) => ({
      kind: "work" as const,
      at: item.completed_at ?? item.created_at,
      item,
    }));
    const pm = (historyPmQuery.data ?? []).map(({ completion, schedule }) => ({
      kind: "pm" as const,
      at: completion.completed_at ?? "",
      item: completion,
      schedule,
    }));
    return [...work, ...pm].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  }, [historyPmQuery.data, workOrdersQuery.data]);

  async function deactivate() {
    if (!assetId) return;
    await engineeringApi.updateAsset(assetId, { is_active: false });
    await queryClient.invalidateQueries({ queryKey: ["assets"] });
    onClose();
  }

  function invalidateDowntime() {
    queryClient.invalidateQueries({ queryKey: ["assets"] });
    queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
    queryClient.invalidateQueries({ queryKey: ["asset-downtime", assetId] });
    queryClient.invalidateQueries({ queryKey: ["asset-reliability", assetId] });
    queryClient.invalidateQueries({ queryKey: ["asset-work-orders", assetId] });
    queryClient.invalidateQueries({ queryKey: ["work-orders"] });
  }

  const startDowntimeMutation = useMutation({
    mutationFn: () =>
      engineeringApi.startAssetDowntime(assetId!, {
        downtime_type: "unplanned",
        impact_level: "out_of_service",
      }),
    onSuccess: invalidateDowntime,
  });
  const restoreDowntimeMutation = useMutation({
    mutationFn: () =>
      engineeringApi.restoreAssetDowntime(
        assetId!,
        asset?.active_downtime?.id ?? "",
      ),
    onSuccess: invalidateDowntime,
  });

  if (!assetId)
    return (
      <div className="hidden min-h-[32rem] items-center justify-center p-8 text-center md:flex">
        <div>
          <Wrench className="mx-auto h-8 w-8 text-ink4" />
          <p className="mt-3 text-sm font-semibold text-ink">
            {t("engineering.assetsPage.selectAsset")}
          </p>
          <p className="mt-1 max-w-xs text-sm text-ink3">
            {t("engineering.assetsPage.selectAssetHelp")}
          </p>
        </div>
      </div>
    );
  if (assetQuery.isLoading)
    return (
      <div className="p-6">
        <Skeleton variant="text" className="h-7 w-44" />
        <Skeleton variant="text" className="mt-5 h-32 w-full" />
      </div>
    );
  if (!asset)
    return (
      <div className="p-8 text-sm text-ink3">
        {t("engineering.assetsPage.loadDetailError")}
      </div>
    );

  const risk = getRiskBadge(asset.failure_risk_score, t);
  const warranty = getWarrantyLabel(asset.warranty_expires, t);
  const age = assetAgeYears(asset);
  const location = asset.rooms?.room_number
    ? `${t("engineering.workOrderCard.room")} ${asset.rooms.room_number}`
    : asset.location_text;
  const operationalStatus = assetOperationalStatus(asset.active_downtime);
  const activeDowntimeDuration = formatReliabilityDuration(
    reliabilityQuery.data?.active_downtime?.elapsed_minutes ??
      reliabilityQuery.data?.active_downtime?.downtime_minutes,
  );

  return (
    <section className="min-h-[32rem] bg-surface md:border-l md:border-line">
      <div className="border-b border-line px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink3 hover:text-ink md:hidden"
            >
              <ArrowLeft size={14} />
              {t("engineering.assetsPage.back")}
            </button>
            <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
              {asset.asset_categories?.name ??
                t("engineering.assetsPage.category")}
            </p>
            <h2 className="mt-1 truncate font-display text-2xl text-ink">
              {asset.name}
            </h2>
            <p className="mt-1 text-sm text-ink2">
              {[asset.manufacturer, asset.model].filter(Boolean).join(" ") ||
                location ||
                "—"}
            </p>
            {asset.asset_tag && (
              <p className="mt-1 font-mono text-xs text-ink3">
                {t("engineering.assetsPage.assetTag")} {asset.asset_tag}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="primary" onClick={() => setShowCreateWO(true)}>
              <ClipboardPlus size={15} />
              {t("engineering.assetsPage.createWorkOrder")}
            </Button>
            {asset.active_downtime && canEdit && (
              <Button
                variant="outline"
                onClick={() => restoreDowntimeMutation.mutate()}
                disabled={restoreDowntimeMutation.isPending}
              >
                {t("engineering.assetsPage.restoreAsset")}
              </Button>
            )}
            {canEdit && (
              <div className="relative">
                <button
                  type="button"
                  aria-label={t("engineering.assetsPage.moreActions")}
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  className="rounded-[var(--r-sm)] border border-line p-2 text-ink2 hover:bg-surface-2"
                >
                  <MoreHorizontal size={17} />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-44 rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-lg"
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowEdit(true);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <Pencil size={14} />
                      {t("engineering.assetsPage.edit")}
                    </button>
                    {!asset.active_downtime && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          startDowntimeMutation.mutate();
                        }}
                        disabled={startDowntimeMutation.isPending}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-alert hover:bg-alert-soft disabled:opacity-50"
                      >
                        <AlertTriangle size={14} />
                        {t("engineering.assetsPage.markOutOfService")}
                      </button>
                    )}
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowCreatePM(true);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <Plus size={14} />
                      {t("engineering.assetsPage.addPm")}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowDeactivate(true);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-alert hover:bg-alert-soft"
                    >
                      <AlertTriangle size={14} />
                      {t("engineering.assetsPage.deactivate")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill tone={risk.tone} size="sm">
            {risk.label} · {asset.failure_risk_score}%
          </Pill>
          <Pill
            tone={
              operationalStatus === "out_of_service"
                ? "alert"
                : operationalStatus === "degraded"
                  ? "caution"
                  : "ready"
            }
            size="sm"
          >
            {t(`engineering.assetsPage.${operationalStatus === "out_of_service" ? "outOfService" : operationalStatus}`)}
            {activeDowntimeDuration
              ? ` · ${t("engineering.assetsPage.downFor", { duration: activeDowntimeDuration })}`
              : ""}
          </Pill>
          {asset.is_active && (
            <Pill tone="ready" size="sm">
              {t("engineering.assetsPage.active")}
            </Pill>
          )}
          {warranty && (
            <span className={`text-xs font-medium ${warranty.cls}`}>
              {warranty.text}
            </span>
          )}
        </div>
      </div>
      <nav
        aria-label={t("engineering.assetsPage.detailTabs")}
        className="flex overflow-x-auto border-b border-line px-4 sm:px-6"
      >
        {(["overview", "history", "pm", "readings", "reliability"] as DetailTab[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
            className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium ${tab === value ? "border-accent text-ink" : "border-transparent text-ink3 hover:text-ink"}`}
          >
            {t(
              `engineering.assetsPage.tab${value[0].toUpperCase()}${value.slice(1)}`,
            )}
          </button>
        ))}
      </nav>
      <div className="space-y-6 p-4 sm:p-6">
        {tab === "overview" && (
          <>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                {t("engineering.assetsPage.health")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Metric
                  label={t("engineering.assetsPage.riskScore")}
                  value={`${asset.failure_risk_score}% · ${risk.label}`}
                  tone={
                    asset.failure_risk_score >= 70 ? "text-alert" : undefined
                  }
                />
                <Metric
                  label={t("engineering.assetsPage.openRepairs")}
                  value={details?.openWorkOrders ?? 0}
                  tone={details?.openWorkOrders ? "text-caution" : undefined}
                />
              </div>
              {recurring && (
                <div className="mt-3 rounded-[var(--r-sm)] border border-caution-line bg-caution-soft px-3 py-3">
                  <p className="text-sm font-semibold text-caution">
                    {t("engineering.assetsPage.repeatIssue")}
                  </p>
                  <p className="mt-1 text-sm text-ink2">
                    {t("engineering.assetsPage.repeatIssueCount", {
                      count: recurring.wo_count,
                      days: recurring.window_days,
                    })}
                  </p>
                </div>
              )}
              {prediction && (
                <div className="mt-3 rounded-[var(--r-sm)] border border-alert-line bg-alert-soft px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-alert">
                    {t("engineering.assetsPage.predictedRisk")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {isSpanish
                      ? t("engineering.assetsPage.predictionSpanishSummary")
                      : prediction.recommendation}
                  </p>
                  {prediction.ai_reasoning && !isSpanish && (
                    <p className="mt-1 text-sm text-ink2">
                      {prediction.ai_reasoning}
                    </p>
                  )}
                </div>
              )}
              {conditionQuery.data && conditionQuery.data.critical_count > 0 && (
                <button type="button" onClick={() => setTab("readings")} className="mt-3 block w-full rounded-[var(--r-sm)] border border-alert-line bg-alert-soft px-3 py-3 text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-alert">{t('condition.condition')}</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{t('condition.criticalCount', { count: conditionQuery.data.critical_count })}</p>
                  <p className="mt-1 text-xs text-ink2">{t('condition.viewReadings')}</p>
                </button>
              )}
            </section>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                {t("engineering.assetsPage.maintenance")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Metric
                  label={t("engineering.assetsPage.repairsYtd")}
                  value={details?.repairsThisYear ?? 0}
                />
                <Metric
                  label={t("engineering.assetsPage.maintenanceCostYtd")}
                  value={money(details?.repairCostThisYear)}
                />
                <Metric
                  label={t("engineering.assetsPage.nextPm")}
                  value={
                    details?.pmSchedule
                      ? date(details.pmSchedule.next_due_at)
                      : "—"
                  }
                  tone={details?.pmOverdue ? "text-alert" : undefined}
                />
                <Metric
                  label={t("engineering.assetsPage.lastPm")}
                  value={
                    details?.pmSchedule?.last_completed_at
                      ? date(details.pmSchedule.last_completed_at)
                      : "—"
                  }
                />
              </div>
            </section>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                {t("engineering.assetsPage.lifecycle")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                <Metric
                  label={t("engineering.assetsPage.location")}
                  value={location ?? "—"}
                />
                <Metric
                  label={t("engineering.assetsPage.age")}
                  value={
                    age == null
                      ? "—"
                      : t("engineering.assetsPage.ageValue", {
                          years: age.toFixed(1),
                        })
                  }
                />
                <Metric
                  label={t("engineering.assetsPage.installationDate")}
                  value={date(asset.installation_date)}
                />
                <Metric
                  label={t("engineering.assetsPage.warranty")}
                  value={warranty?.text ?? "—"}
                  tone={warranty?.cls}
                />
                <Metric
                  label={t("engineering.assetsPage.detailReplacementCost")}
                  value={money(asset.replacement_cost)}
                />
                <Metric
                  label={t("engineering.assetsPage.detailLifespan")}
                  value={
                    asset.expected_lifespan_years
                      ? t("engineering.assetsPage.detailLifespanValue", {
                          years: asset.expected_lifespan_years,
                        })
                      : "—"
                  }
                />
              </div>
            </section>
          </>
        )}
        {tab === "history" && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
              {t("engineering.assetsPage.history")}
            </p>
            {workOrdersQuery.isLoading || historyPmQuery.isLoading ? (
              <Skeleton variant="text" className="mt-3 h-20 w-full" />
            ) : history.length ? (
              <ol className="mt-3 divide-y divide-line">
                {history.map((entry) =>
                  entry.kind === "work" ? (
                    <li key={`wo-${entry.item.id}`} className="py-3">
                      <p className="text-xs text-ink3">{date(entry.at)}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        #{entry.item.work_order_number} · {entry.item.title}
                      </p>
                      {(entry.item.problem_code || entry.item.cause_code || entry.item.resolution_code) && (
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                          {entry.item.problem_code && <><dt className="text-ink3">{t("engineering.repair.problem")}</dt><dd className="text-ink2">{entry.item.problem_code.label}</dd></>}
                          {entry.item.cause_code && <><dt className="text-ink3">{t("engineering.repair.cause")}</dt><dd className="text-ink2">{entry.item.cause_code.label}</dd></>}
                          {entry.item.resolution_code && <><dt className="text-ink3">{t("engineering.repair.resolution")}</dt><dd className="text-ink2">{entry.item.resolution_code.label}</dd></>}
                          {entry.item.verification_result && <><dt className="text-ink3">{t("engineering.repair.verification")}</dt><dd className="text-ink2">{t(`engineering.repair.verification_${entry.item.verification_result}`)}</dd></>}
                        </dl>
                      )}
                      <p className="mt-1 text-xs text-ink2">
                        {t(
                          `engineering.assetsPage.workOrderStatus.${entry.item.status}`,
                        )}{" "}
                        {entry.item.total_cost != null
                          ? `· ${money(entry.item.total_cost)}`
                          : ""}
                      </p>
                    </li>
                  ) : (
                    <li key={`pm-${entry.item.id}`} className="py-3">
                      <p className="text-xs text-ink3">{date(entry.at)}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {entry.schedule.name}
                      </p>
                      <p className="mt-1 text-xs text-ink2">
                        {t("engineering.assetsPage.pmCompleted")}
                      </p>
                    </li>
                  ),
                )}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-ink3">
                {t("engineering.assetsPage.noHistory")}
              </p>
            )}
            <div className="mt-6 border-t border-line pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                {t("engineering.assetsPage.recentDowntime")}
              </p>
              {downtimeQuery.isLoading ? (
                <Skeleton variant="text" className="mt-3 h-16 w-full" />
              ) : downtimeQuery.data?.length ? (
                <ol className="mt-3 divide-y divide-line rounded-[var(--r-sm)] border border-line">
                  {downtimeQuery.data.slice(0, 5).map((period) => (
                    <li key={period.id} className="px-3 py-2.5 text-sm">
                      <p className="font-medium text-ink">
                        {period.downtime_type === "planned"
                          ? t("engineering.assetsPage.plannedDowntime")
                          : t("engineering.assetsPage.unplannedDowntime")}
                        {period.elapsed_minutes != null || period.downtime_minutes != null
                          ? ` · ${formatReliabilityDuration(period.elapsed_minutes ?? period.downtime_minutes)}`
                          : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-ink3">
                        {date(period.started_at)}
                        {period.work_orders
                          ? ` · ${t("engineering.assetsPage.linkedWorkOrder", { number: period.work_orders.work_order_number, title: period.work_orders.title })}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-ink3">
                  {t("engineering.assetsPage.downtimeHistoryEmpty")}
                </p>
              )}
            </div>
          </section>
        )}
        {tab === "pm" && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
              {t("engineering.assetsPage.preventive")}
            </p>
            {schedules.length ? (
              <div className="mt-3 space-y-3">
                {schedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="rounded-[var(--r-sm)] border border-line p-3"
                  >
                    <p className="text-sm font-semibold text-ink">
                      {schedule.name}
                    </p>
                    <p className="mt-1 text-sm text-ink2">
                      {t("engineering.assetsPage.nextPm")}{" "}
                      {date(schedule.next_due_at)}
                    </p>
                    <p className="mt-1 text-xs text-ink3">
                      {schedule.estimated_minutes}{" "}
                      {t("engineering.assetsPage.pmMinutesSuffix", {
                        minutes: "",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink3">
                {t("engineering.assetsPage.noPmSchedules")}
              </p>
            )}
            {canEdit && (
              <Button
                variant="outline"
                onClick={() => setShowCreatePM(true)}
                className="mt-4"
              >
                <Plus size={15} />
                {t("engineering.assetsPage.addPm")}
              </Button>
            )}
          </section>
        )}
        {tab === "readings" && <AssetReadingsPanel assetId={assetId} canEdit={canEdit} />}
        {tab === "reliability" && (
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                {t("engineering.assetsPage.reliability")}
              </p>
              <p className="text-xs text-ink3">
                {t("engineering.assetsPage.reliabilityPeriod")}
              </p>
            </div>
            {reliabilityQuery.isLoading ? (
              <Skeleton variant="text" className="mt-3 h-36 w-full" />
            ) : reliabilityQuery.data ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric
                    label={t("engineering.assetsPage.mttr")}
                    value={
                      formatReliabilityDuration(reliabilityQuery.data.mttr_minutes) ??
                      t("engineering.assetsPage.notEnoughData")
                    }
                  />
                  <Metric
                    label={t("engineering.assetsPage.mtbf")}
                    value={
                      formatReliabilityDuration(reliabilityQuery.data.mtbf_minutes) ??
                      t("engineering.assetsPage.notEnoughData")
                    }
                  />
                  <Metric
                    label={t("engineering.assetsPage.unplannedDowntime12mo")}
                    value={formatReliabilityDuration(reliabilityQuery.data.unplanned_downtime_12mo_minutes) ?? "—"}
                  />
                  <Metric
                    label={t("engineering.assetsPage.plannedDowntime12mo")}
                    value={formatReliabilityDuration(reliabilityQuery.data.planned_downtime_12mo_minutes) ?? "—"}
                  />
                  <Metric
                    label={t("engineering.assetsPage.failures12mo")}
                    value={reliabilityQuery.data.failure_count_12mo}
                  />
                  <Metric
                    label={t("engineering.assetsPage.repeatFailures")}
                    value={reliabilityQuery.data.repeat_failure_count}
                  />
                  <Metric
                    label={t("engineering.assetsPage.reopens")}
                    value={reliabilityQuery.data.reopen_count}
                  />
                  <Metric
                    label={t("engineering.assetsPage.firstTimeFix")}
                    value={
                      reliabilityQuery.data.first_time_fix_rate == null
                        ? t("engineering.assetsPage.notEnoughData")
                        : `${Math.round(reliabilityQuery.data.first_time_fix_rate * 100)}%`
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-ink3">
                  {t("engineering.assetsPage.eligibleRepairs", {
                    successes: reliabilityQuery.data.first_time_fix_successes,
                    eligible: reliabilityQuery.data.first_time_fix_eligible,
                  })}
                </p>
                <p className="mt-4 text-xs text-ink3">
                  {t("engineering.assetsPage.reliabilityTrackingNote")}
                </p>
                <div className="mt-6 border-t border-line pt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">
                    {t("engineering.assetsPage.recentDowntime")}
                  </p>
                  {downtimeQuery.data?.length ? (
                    <ol className="mt-3 space-y-2">
                      {downtimeQuery.data.slice(0, 6).map((period) => (
                        <li key={period.id} className="rounded-[var(--r-sm)] border border-line px-3 py-2.5 text-sm">
                          <p className="font-medium text-ink">
                            {date(period.started_at)} · {period.downtime_type === "planned" ? t("engineering.assetsPage.plannedDowntime") : t("engineering.assetsPage.unplannedDowntime")}
                          </p>
                          <p className="mt-1 text-xs text-ink3">
                            {period.elapsed_minutes == null && period.downtime_minutes == null
                              ? t("engineering.assetsPage.downFor", { duration: formatReliabilityDuration(reliabilityQuery.data.active_downtime?.elapsed_minutes ?? reliabilityQuery.data.active_downtime?.downtime_minutes) ?? "—" })
                              : formatReliabilityDuration(period.elapsed_minutes ?? period.downtime_minutes)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-sm text-ink3">
                      {t("engineering.assetsPage.downtimeHistoryEmpty")}
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </section>
        )}
      </div>
      <CreateWorkOrderDrawer
        isOpen={showCreateWO}
        onClose={() => setShowCreateWO(false)}
        onCreate={() => {
          setShowCreateWO(false);
          queryClient.invalidateQueries({
            queryKey: ["asset-work-orders", assetId],
          });
          queryClient.invalidateQueries({ queryKey: ["work-orders"] });
        }}
        initialRoomId={asset.room_id}
        initialAssetId={asset.id}
      />
      <CreatePMScheduleModal
        isOpen={showCreatePM}
        onClose={() => setShowCreatePM(false)}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: ["asset", assetId] })
        }
        initialAssetId={asset.id}
      />
      <CreateAssetModal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["assets"] });
          queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
        }}
        asset={asset}
      />
      {showDeactivate && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-full max-w-sm rounded-[var(--r-md)] bg-surface p-5 shadow-xl">
            <h3 className="font-semibold text-ink">
              {t("engineering.assetsPage.deactivateConfirmTitle")}
            </h3>
            <p className="mt-2 text-sm text-ink2">
              {t("engineering.assetsPage.deactivateConfirmHelp")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeactivate(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="destructive" onClick={deactivate}>
                {t("engineering.assetsPage.deactivate")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
