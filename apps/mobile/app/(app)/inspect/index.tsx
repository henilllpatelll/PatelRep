import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View, type ListRenderItemInfo } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { normalizeRoomIdParam } from "@/lib/housekeeping/inspectionTarget";
import { inspectionHref, recordHref } from "@/lib/inspections/route";
import type { QueueItem } from "@/lib/inspections/queue";
import { useInspectionQueue } from "@/lib/inspections/useInspectionQueue";
import { escalateCorrection, reassignCorrection, requestCorrectionAgain, type InspectionDetail } from "@/lib/api/inspections";
import { classifyActionError, shouldReload, type ActionFailure } from "@/lib/inspections/correctionActions";
import { groupCorrections, searchByRoomNumber, type CorrectionAction, type CorrectionItem } from "@/lib/inspections/lists";
import { activeFilterCount, DEFAULT_HISTORY_FILTERS, hasActiveFilters, isDefaultView, removeChip as removeHistoryChip, type FilterChip, type HistoryFilters } from "@/lib/inspections/history/filters";
import { periodLabel } from "@/lib/inspections/history/labels";
import { buildInsightsView } from "@/lib/inspections/history/insights";
import type { HistoryItem } from "@/lib/inspections/history/rows";
import { useInspectionHistory } from "@/lib/inspections/history/useInspectionHistory";
import { pokeSupervisorRealtime } from "@/lib/housekeeping/supervisorRealtime";
import {
  DEFAULT_QUEUE_DRAFT,
  EMPTY_QUEUE_FILTERS,
  activeCount,
  buildAvailability,
  hasQueueFilters,
  previewCount,
  removeChip,
  selectQueue,
  unavailableApplied,
  type QueueChip,
  type QueueDraft,
} from "@/lib/inspections/queueView";
import { staleBanner, statusLine, type Metric } from "@/lib/inspections/viewText";
import { useAppStore } from "@/stores/appStore";
import { InspectHeader } from "@/components/supervisor/inspect/InspectHeader";
import { InspectSearchBar } from "@/components/supervisor/inspect/InspectSearchBar";
import { InspectTabs, type InspectTab } from "@/components/supervisor/inspect/InspectTabs";
import { InspectActiveFilters } from "@/components/supervisor/inspect/InspectActiveFilters";
import { InspectionQueueCard } from "@/components/supervisor/inspect/InspectionQueueCard";
import { CorrectionCard } from "@/components/supervisor/inspect/CorrectionCard";
import { CorrectionDetailSheet } from "@/components/supervisor/inspect/CorrectionDetailSheet";
import { CorrectionSummary } from "@/components/supervisor/inspect/CorrectionSummary";
import { ReassignSheet } from "@/components/supervisor/inspect/ReassignSheet";
import { Button } from "@/components/ui/Button";
import { DoneRow } from "@/components/supervisor/inspect/DoneRow";
import { InspectFilterSheet } from "@/components/supervisor/inspect/InspectFilterSheet";
import { HistoryFilterSheet } from "@/components/supervisor/inspect/history/HistoryFilterSheet";
import { HistoryToolbar } from "@/components/supervisor/inspect/history/HistoryToolbar";
import { InsightsSheet } from "@/components/supervisor/inspect/history/InsightsSheet";
import { QualityInsightsCard } from "@/components/supervisor/inspect/history/QualityInsightsCard";
import { InspectNotice, InspectSkeleton, StaleBanner } from "@/components/supervisor/inspect/InspectListStates";

/* ─── Inspections — find the next room to inspect ───────────────────────────
   A compact header (verified counts + honest freshness), room-number search, three lists (To inspect / Corrections /
   Done) and a Filter & Sort drawer. Choosing a room opens the active inspection workspace (`inspect/[roomId]`) by its
   stable id; this screen stays mounted underneath, so its tab, search, filters and scroll are exactly as left. */

type Row = QueueItem | CorrectionItem | HistoryItem;

/** One drawer at a time: the correction's details, or the owner picker (which returns to the details). */
type Drawer = null | { kind: "detail"; item: CorrectionItem } | { kind: "assign"; item: CorrectionItem; ownerId: string | null; backTo: "detail" | "none" };

interface ViewState {
  tab: InspectTab;
  search: string;
  applied: QueueDraft;
}
const INITIAL_VIEW: ViewState = { tab: "queue", search: "", applied: DEFAULT_QUEUE_DRAFT };

const EMPTY_AVAILABILITY = buildAvailability([]);
const MINUTE = 60_000;

export default function InspectScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const language = i18n.language === "es" ? "es" : "en";

  const hotelTimezone = useAppStore((state) => state.hotelTimezone);
  useHotelTimezone();
  const scopeKey = useAppStore((state) => (state.user?.tenant_id && state.user?.id ? `${state.user.tenant_id}:${state.user.id}` : null));
  // A link that still names a room here (`?roomId=`, from before the workspace had its own route) is handed on to the
  // active inspection. The room is resolved there, by its stable id; nothing is started merely by arriving.
  const params = useLocalSearchParams<{ roomId?: string | string[]; roomNumber?: string | string[]; tab?: string | string[] }>();
  const tabParam = normalizeRoomIdParam(params.tab);
  const roomIdParam = normalizeRoomIdParam(params.roomId);
  const roomLabel = normalizeRoomIdParam(params.roomNumber);

  const data = useInspectionQueue();
  const { queue, items, correctionList, doneList, now, refreshing, refresh, selectionFor } = data;

  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // History is only read once the Done tab has been opened, then kept so coming back is instant.
  const [doneVisited, setDoneVisited] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerFailure, setDrawerFailure] = useState<ActionFailure | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const acting = useRef(false);
  const history = useInspectionHistory({ enabled: doneVisited });

  const dropFocus = useCallback(() => router.setParams({ roomId: undefined, roomNumber: undefined }), []);

  // Another hotel or person: nothing from the previous one (filters, a stale link, a half-written result) carries over.
  const lastScope = useRef(scopeKey);
  useEffect(() => {
    if (lastScope.current === scopeKey) return;
    lastScope.current = scopeKey;
    setView(INITIAL_VIEW);
    setFiltersOpen(false);
    setHistoryFiltersOpen(false);
    setInsightsOpen(false);
    setDoneVisited(false);
    setDrawer(null);
    setDrawerFailure(null);
    dropFocus();
  }, [scopeKey, dropFocus]);

  // "View corrections" from a result screen lands on that tab. Cleared at once so it applies only the one time.
  useEffect(() => {
    if (tabParam !== "corrections" && tabParam !== "done") return;
    setView((previous) => ({ ...previous, tab: tabParam }));
    router.setParams({ tab: undefined });
  }, [tabParam]);

  useEffect(() => {
    if (view.tab === "done") setDoneVisited(true);
  }, [view.tab]);

  // Hand an older room link on to the workspace: clear it from THIS screen first (so it cannot fire twice), then open.
  useEffect(() => {
    if (!roomIdParam) return;
    dropFocus();
    router.push(inspectionHref(roomIdParam, roomLabel, "queue") as never);
  }, [roomIdParam, roomLabel, dropFocus]);

  const minute = Math.floor(now / MINUTE) * MINUTE;
  const ctx = useMemo(() => ({ now: minute, timeZone: hotelTimezone }), [minute, hotelTimezone]);
  const availability = useMemo(() => (items ? buildAvailability(items) : EMPTY_AVAILABILITY), [items]);
  const { filters, sort } = view.applied;
  const selection = useMemo(
    () => (items ? selectQueue({ items, availability, filters, sort, search: view.search, ctx }) : null),
    [items, availability, filters, sort, view.search, ctx],
  );
  const countFor = useCallback(
    (draft: QueueDraft) => (items ? previewCount({ items, availability, search: view.search, ctx, draft }) : 0),
    [items, availability, view.search, ctx],
  );
  const queueRows = useMemo(() => (selection ? selection.shown : null), [selection]);
  const correctionRows = useMemo(() => (correctionList ? searchByRoomNumber(correctionList.items, view.search) : null), [correctionList, view.search]);
  const historyItems = history.list.status === "ready" ? history.list.items : null;
  const queuedIds = useMemo(() => new Set((items ?? []).map((item) => item.roomId)), [items]);
  const itemById = useMemo(() => new Map((items ?? []).map((item) => [item.roomId, item] as const)), [items]);

  // Known-unusable checklists, per room type, so the card says why it cannot start (the room stays visible).
  const blockedByType = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items ?? []) {
      const key = item.roomTypeId ?? "~";
      if (map.has(key)) continue;
      const selected = selectionFor(item.roomTypeId);
      if (selected && !selected.ok) map.set(key, t(`inspect.template.${selected.reason}`));
    }
    return map;
  }, [items, selectionFor, t]);

  const showBuilding = availability.multiBuilding;
  const passedCount = doneList ? doneList.items.filter((item) => item.result === "passed").length : null;
  const metrics = {
    waiting: { value: items ? items.length : null, atLeast: false } satisfies Metric,
    corrections: { value: correctionList ? correctionList.items.length : null, atLeast: correctionList?.truncated ?? false } satisfies Metric,
    passed: { value: passedCount, atLeast: false } satisfies Metric,
  };
  const counts: Record<InspectTab, number | null> = {
    queue: metrics.waiting.value,
    corrections: metrics.corrections.value,
    // The badge counts what the list shows: today's verified count in the default view, else the server's exact match count.
    done: isDefaultView(history.filters) ? (doneList ? doneList.items.length : null) : history.list.status === "ready" ? history.list.total : null,
  };
  const source = view.tab === "queue" ? queue : view.tab === "corrections" ? data.corrections : data.records;
  const historyStale = view.tab === "done" && history.list.status === "ready" ? history.list.stale : null;
  const banner =
    view.tab === "done"
      ? historyStale
        ? t(historyStale === "offline" ? "inspect.history.stale.offline" : "inspect.history.stale.failed")
        : null
      : staleBanner(source, hotelTimezone, language, t);
  const ignoredFilters = items ? unavailableApplied(filters, availability).length > 0 : false;

  /* ─── Actions ─────────────────────────────────────────────────────────── */

  const setSearch = useCallback((search: string) => setView((previous) => ({ ...previous, search })), []);
  const setTab = useCallback((tab: InspectTab) => setView((previous) => ({ ...previous, tab })), []);
  const applyDraft = useCallback((draft: QueueDraft) => {
    setView((previous) => ({ ...previous, applied: draft }));
    setFiltersOpen(false);
  }, []);
  const clearFilters = useCallback(() => setView((previous) => ({ ...previous, applied: { ...previous.applied, filters: EMPTY_QUEUE_FILTERS } })), []);
  const dropChip = useCallback(
    (chip: QueueChip) => setView((previous) => ({ ...previous, applied: { ...previous.applied, filters: removeChip(previous.applied.filters, chip) } })),
    [],
  );
  const openRoomBoard = useCallback((roomId: string) => router.push({ pathname: "/(app)/room-board", params: { roomId } }), []);

  /** Open the active inspection for a room. Only a room the verified queue lists can be started. */
  const startInspection = useCallback(
    (item: QueueItem) => {
      const blocked = blockedByType.get(item.roomTypeId ?? "~");
      if (blocked) {
        toast.error(blocked);
        return;
      }
      if (queue.status === "stale") {
        toast.error(t("inspect.start.needsConnection"));
        void refresh();
        return;
      }
      router.push(inspectionHref(item.roomId, item.roomNumber, "queue") as never);
    },
    [blockedByType, queue.status, refresh, t, toast],
  );
  /* ─── Corrections ───────────────────────────────────────────────────── */

  const afterChange = useCallback(async () => {
    setReloadToken((token) => token + 1);
    pokeSupervisorRealtime();
    await refresh();
  }, [refresh]);

  /** Run one change to a correction: one at a time, with the server's refusal explained and the picture reloaded. */
  const act = useCallback(
    async (work: () => Promise<void>, onDone?: () => void) => {
      if (acting.current) return;
      acting.current = true;
      setDrawerBusy(true);
      setDrawerFailure(null);
      try {
        await work();
        await afterChange();
        onDone?.();
      } catch (error) {
        const failure = classifyActionError(error);
        setDrawerFailure(failure);
        if (shouldReload(failure)) await afterChange();
      } finally {
        acting.current = false;
        setDrawerBusy(false);
      }
    },
    [afterChange],
  );

  const startReinspection = useCallback(
    (correction: CorrectionItem) => {
      const queued = itemById.get(correction.roomId);
      if (!queued) {
        toast.error(t("inspect.correction.notInQueue"));
        void refresh();
        return;
      }
      setDrawer(null);
      startInspection(queued);
    },
    [itemById, refresh, startInspection, t, toast],
  );

  const repairCorrection = useCallback(
    (correction: CorrectionItem) =>
      act(async () => {
        await requestCorrectionAgain(correction.inspectionId);
        toast.success(t("inspect.correction.requestedAgain"));
      }),
    [act, t, toast],
  );

  const openAssign = useCallback((correction: CorrectionItem, backTo: "detail" | "none") => {
    setDrawerFailure(null);
    setDrawer({ kind: "assign", item: correction, ownerId: correction.assignedTo, backTo });
  }, []);

  const assign = useCallback(
    (ownerId: string) => {
      if (drawer?.kind !== "assign") return;
      const { item, backTo, ownerId: seen } = drawer;
      void act(
        async () => {
          await reassignCorrection(item.inspectionId, ownerId, seen);
          toast.success(t("inspect.reassign.done"));
        },
        () => setDrawer(backTo === "detail" ? { kind: "detail", item } : null),
      );
    },
    [drawer, act, t, toast],
  );

  const escalate = useCallback(
    (correction: CorrectionItem) =>
      act(async () => {
        await escalateCorrection(correction.inspectionId);
        toast.success(t("inspect.drawer.escalated"));
      }),
    [act, t, toast],
  );

  const onCorrectionAction = useCallback(
    (correction: CorrectionItem, action: CorrectionAction) => {
      if (action === "reinspect") startReinspection(correction);
      else if (action === "assign") openAssign(correction, "none");
      else if (action === "repair") {
        setDrawer({ kind: "detail", item: correction });
        void repairCorrection(correction);
      } else setDrawer({ kind: "detail", item: correction });
    },
    [startReinspection, openAssign, repairCorrection],
  );

  const openDetail = useCallback((correction: CorrectionItem) => {
    setDrawerFailure(null);
    setDrawer({ kind: "detail", item: correction });
  }, []);

  const closeDrawer = useCallback(() => {
    if (acting.current) return;
    setDrawer(null);
    setDrawerFailure(null);
  }, []);

  /* ─── Done: history ────────────────────────────────────────────────────── */

  const openRecord = useCallback((item: Pick<HistoryItem, "id" | "roomId" | "roomNumber">) => router.push(recordHref(item.id, "done", item.roomId, item.roomNumber) as never), []);
  const setHistoryFilters = history.setFilters;
  const applyHistoryFilters = useCallback(
    (next: HistoryFilters) => {
      setHistoryFilters(next);
      setHistoryFiltersOpen(false);
    },
    [setHistoryFilters],
  );
  const dropHistoryChip = useCallback((chip: FilterChip) => setHistoryFilters((previous) => removeHistoryChip(previous, chip)), [setHistoryFilters]);
  const clearHistoryFilters = useCallback(() => setHistoryFilters((previous) => ({ ...DEFAULT_HISTORY_FILTERS, period: previous.period, custom: previous.custom })), [setHistoryFilters]);
  const drillStandard = useCallback(
    (standard: { id: string; label: string }) => {
      setHistoryFilters((previous) => ({ ...previous, result: "failed", standard }));
      setInsightsOpen(false);
    },
    [setHistoryFilters],
  );
  const drillRoom = useCallback(
    (roomNumber: string) => {
      setHistoryFilters((previous) => ({ ...previous, room: roomNumber, result: "failed" }));
      setInsightsOpen(false);
    },
    [setHistoryFilters],
  );
  const historyPeriod = periodLabel(history.filters, history.today, language, t);
  const insightsData = history.insights.status === "ready" ? history.insights.data : null;

  /* ─── Rows ────────────────────────────────────────────────────────────── */

  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => {
      if (view.tab === "queue") {
        const card = item as QueueItem;
        return (
          <InspectionQueueCard
            item={card}
            now={minute}
            timeZone={hotelTimezone}
            language={language}
            showBuilding={showBuilding}
            blockedReason={blockedByType.get(card.roomTypeId ?? "~") ?? null}
            t={t}
            onPress={startInspection}
          />
        );
      }
      if (view.tab === "corrections") {
        const correction = item as CorrectionItem;
        return <CorrectionCard item={correction} now={minute} roomAwaitingInspection={queuedIds.has(correction.roomId)} t={t} onOpen={openDetail} onAction={onCorrectionAction} />;
      }
      return <DoneRow item={item as HistoryItem} timeZone={hotelTimezone} language={language} t={t} showBuilding={showBuilding} onPress={openRecord} />;
    },
    [view.tab, minute, hotelTimezone, language, showBuilding, blockedByType, t, startInspection, queuedIds, openDetail, onCorrectionAction, openRecord],
  );
  const keyOf = useCallback(
    (row: Row) => (view.tab === "queue" ? (row as QueueItem).roomId : view.tab === "corrections" ? (row as CorrectionItem).inspectionId : (row as HistoryItem).id),
    [view.tab],
  );

  const rows: Row[] | null = view.tab === "queue" ? queueRows : view.tab === "corrections" ? correctionRows : historyItems;
  const searching = view.search.trim().length > 0;

  const doneEmpty = (() => {
    const list = history.list;
    if (history.rangeProblem) {
      return <InspectNotice testID="history-invalid-range" tone="problem" icon="calendar-outline" title={t("inspect.history.states.invalidRangeTitle")} body={t(`inspect.history.filter.problem.${history.rangeProblem}`)} actionLabel={t("inspect.history.toolbar.filter")} onAction={() => setHistoryFiltersOpen(true)} />;
    }
    if (list.status === "idle" || list.status === "loading") return <InspectSkeleton label={t("inspect.states.loadingA11y")} />;
    if (list.status === "failed") {
      const offline = list.failure.kind === "offline";
      return <InspectNotice testID="history-error" tone="problem" icon={offline ? "cloud-offline-outline" : "alert-circle-outline"} title={t(offline ? "inspect.history.states.offlineTitle" : "inspect.history.states.errorTitle")} body={t(offline ? "inspect.history.states.offlineBody" : "inspect.history.states.errorBody")} actionLabel={t("inspect.states.retry")} onAction={() => void history.refresh()} />;
    }
    if (hasActiveFilters(history.filters)) {
      return <InspectNotice testID="history-empty-filters" icon="funnel-outline" title={t("inspect.history.states.noMatchTitle")} body={t("inspect.history.states.noMatchBody")} actionLabel={t("inspect.states.clearFilters")} onAction={clearHistoryFilters} />;
    }
    if (isDefaultView(history.filters)) {
      return <InspectNotice testID="history-empty" icon="moon-outline" title={t("inspect.states.doneEmptyTitle")} body={t("inspect.states.doneEmptyBody")} />;
    }
    return <InspectNotice testID="history-empty-period" icon="calendar-outline" title={t("inspect.history.states.emptyPeriodTitle")} body={t("inspect.history.states.emptyPeriodBody", { period: historyPeriod })} />;
  })();

  const empty = (() => {
    if (view.tab === "done") return doneEmpty;
    if (rows === null) {
      const failed = source.status === "failed";
      if (!failed) return <InspectSkeleton label={t("inspect.states.loadingA11y")} />;
      const kind = view.tab === "queue" ? "" : "corrections";
      const title = t(`inspect.states.${kind ? `${kind}ErrorTitle` : "errorTitle"}`);
      const body = t(`inspect.states.${kind ? `${kind}ErrorBody` : "errorBody"}`);
      return <InspectNotice testID="inspect-error" tone="problem" icon="alert-circle-outline" title={title} body={body} actionLabel={t("inspect.states.retry")} onAction={() => void refresh()} />;
    }
    if (view.tab === "queue") {
      if (selection && selection.totalCount > 0 && selection.filteredCount === 0 && hasQueueFilters(filters)) {
        return <InspectNotice testID="inspect-empty-filters" icon="funnel-outline" title={t("inspect.states.noFilterTitle")} body={t("inspect.states.noFilterBody")} actionLabel={t("inspect.states.clearFilters")} onAction={clearFilters} />;
      }
      if (searching && selection && selection.totalCount > 0) {
        return <InspectNotice testID="inspect-empty-search" icon="search-outline" title={t("inspect.states.noSearchTitle")} body={t("inspect.states.noSearchBody")} actionLabel={t("inspect.states.clearSearch")} onAction={() => setSearch("")} />;
      }
      return <InspectNotice testID="inspect-empty" tone="good" icon="shield-checkmark-outline" title={t("inspect.states.emptyTitle")} body={t("inspect.states.emptyBody")} />;
    }
    const total = correctionList?.items.length ?? 0;
    if (searching && total > 0) {
      return <InspectNotice testID="inspect-empty-search" icon="search-outline" title={t("inspect.states.noMatchCorrectionsTitle")} actionLabel={t("inspect.states.clearSearch")} onAction={() => setSearch("")} />;
    }
    return <InspectNotice testID="inspect-empty" tone="good" icon="checkmark-done-outline" title={t("inspect.states.correctionsEmptyTitle")} body={t("inspect.states.correctionsEmptyBody")} />;
  })();

  const listHeader = (
    <View style={styles.listHeader}>
      {banner ? <StaleBanner message={banner} actionLabel={t("inspect.banner.retry")} onAction={() => void refresh()} /> : null}
      {view.tab === "corrections" && correctionList ? <CorrectionSummary groups={groupCorrections(correctionList.items, queuedIds)} atLeast={correctionList.truncated} t={t} /> : null}
      {view.tab === "corrections" && correctionList?.truncated ? <MutedLine text={t("inspect.correction.truncated")} color={theme.textMuted} /> : null}
      {view.tab === "corrections" && correctionList && correctionList.unreadable > 0 ? <MutedLine text={t("inspect.correction.unreadable", { count: correctionList.unreadable })} color={theme.textMuted} /> : null}
      {view.tab === "done" ? (
        <>
          <HistoryToolbar
            periodText={historyPeriod}
            filters={history.filters}
            inspectors={history.inspectors.rows}
            activeCount={activeFilterCount(history.filters)}
            counts={insightsData ? insightsData.counts : null}
            countsAtLeast={insightsData?.truncated ?? false}
            matchCount={history.list.status === "ready" ? history.list.total ?? history.list.items.length : null}
            matchAtLeast={history.list.status === "ready" && history.list.total === null && history.list.hasMore}
            t={t}
            onOpenFilters={() => setHistoryFiltersOpen(true)}
            onRemoveChip={dropHistoryChip}
            onClearAll={clearHistoryFilters}
          />
          {history.rangeProblem === null ? (
            <QualityInsightsCard state={history.insights} periodLabel={historyPeriod} t={t} onRetry={() => void history.refresh()} onOpenDetails={() => setInsightsOpen(true)} />
          ) : null}
          {history.list.status === "ready" && history.list.unreadable > 0 ? <MutedLine text={t("inspect.done.unreadable", { count: history.list.unreadable })} color={theme.textMuted} /> : null}
        </>
      ) : null}
    </View>
  );

  const listFooter =
    view.tab === "done" && history.list.status === "ready" ? (
      <View style={styles.footer} testID="history-footer">
        {history.list.loadingMore ? (
          <ActivityIndicator color={theme.primaryAction} accessibilityLabel={t("inspect.history.states.loadingMore")} testID="history-loading-more" />
        ) : history.list.moreFailed ? (
          <View style={styles.footerFailed} accessibilityRole="alert">
            <MutedLine text={t("inspect.history.states.moreFailed")} color={theme.textSecondary} />
            <Button label={t("inspect.states.retry")} variant="secondary" size="sm" onPress={history.loadMore} testID="history-more-retry" />
          </View>
        ) : history.list.hasMore ? (
          <Button label={t("inspect.history.states.loadMore")} variant="secondary" size="md" onPress={history.loadMore} testID="history-load-more" />
        ) : history.list.items.length > 0 ? (
          <MutedLine text={t("inspect.history.states.end", { count: history.list.items.length })} color={theme.textMuted} />
        ) : null}
      </View>
    ) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <InspectHeader
        status={statusLine(queue, now, hotelTimezone, language, t)}
        metrics={metrics}
        refreshing={refreshing}
        topInset={insets.top}
        t={t}
        onRefresh={() => void refresh()}
      />
      <InspectSearchBar
        value={view.tab === "done" ? history.filters.room : view.search}
        onChangeText={view.tab === "done" ? (room: string) => setHistoryFilters((previous) => ({ ...previous, room })) : setSearch}
        onClear={view.tab === "done" ? () => setHistoryFilters((previous) => ({ ...previous, room: "" })) : () => setSearch("")}
        onOpenFilters={view.tab === "done" ? () => setHistoryFiltersOpen(true) : () => setFiltersOpen(true)}
        activeCount={view.tab === "done" ? activeFilterCount(history.filters) : activeCount(view.applied)}
        showFilters={view.tab === "queue" || view.tab === "done"}
        t={t}
      />
      <InspectTabs selected={view.tab} counts={counts} t={t} onSelect={setTab} />
      {view.tab === "queue" && selection ? (
        <InspectActiveFilters filters={filters} shown={selection.shown.length} total={selection.totalCount} multiBuilding={availability.multiBuilding} ignored={ignoredFilters} t={t} onRemove={dropChip} onClearAll={clearFilters} />
      ) : null}
      <FlatList
        key={view.tab}
        data={rows ?? []}
        renderItem={renderRow}
        keyExtractor={keyOf}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={listFooter ?? undefined}
        onEndReached={view.tab === "done" ? history.loadMore : undefined}
        onEndReachedThreshold={0.4}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        testID="inspect-list"
      />

      <InspectFilterSheet visible={filtersOpen} applied={view.applied} availability={availability} previewCount={countFor} t={t} onApply={applyDraft} onClose={() => setFiltersOpen(false)} />
      <CorrectionDetailSheet
        correction={drawer?.kind === "detail" ? drawer.item : null}
        reloadToken={reloadToken}
        roomAwaitingInspection={drawer?.kind === "detail" ? queuedIds.has(drawer.item.roomId) : false}
        busy={drawerBusy}
        failure={drawerFailure}
        timeZone={hotelTimezone}
        language={language}
        t={t}
        onReassign={(item: CorrectionItem, detail: InspectionDetail) => {
          setDrawer({ kind: "assign", item, ownerId: detail.correction?.task?.assigned_to ?? null, backTo: "detail" });
          setDrawerFailure(null);
        }}
        onEscalate={(item) => void escalate(item)}
        onReinspect={startReinspection}
        onRepair={(item) => void repairCorrection(item)}
        onViewRoom={(item) => {
          setDrawer(null);
          openRoomBoard(item.roomId);
        }}
        onViewRecord={(item) => {
          setDrawer(null);
          router.push(recordHref(item.inspectionId, "corrections", item.roomId, item.roomNumber) as never);
        }}
        onClose={closeDrawer}
      />
      <ReassignSheet
        roomNumber={drawer?.kind === "assign" ? drawer.item.roomNumber : ""}
        open={drawer?.kind === "assign"}
        currentOwnerId={drawer?.kind === "assign" ? drawer.ownerId : null}
        busy={drawerBusy}
        failure={drawerFailure}
        t={t}
        onAssign={assign}
        onClose={() => {
          if (acting.current) return;
          setDrawerFailure(null);
          setDrawer(drawer?.kind === "assign" && drawer.backTo === "detail" ? { kind: "detail", item: drawer.item } : null);
        }}
      />
      <HistoryFilterSheet
        visible={historyFiltersOpen}
        applied={history.filters}
        today={history.today}
        inspectors={history.inspectors}
        t={t}
        onOpen={history.loadInspectors}
        onApply={applyHistoryFilters}
        onClose={() => setHistoryFiltersOpen(false)}
      />
      <InsightsSheet
        visible={insightsOpen}
        data={insightsData}
        periodLabel={historyPeriod}
        language={language}
        t={t}
        onDrillStandard={drillStandard}
        onDrillRoom={drillRoom}
        onClose={() => setInsightsOpen(false)}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function MutedLine({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.mutedLine, { color }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, flexGrow: 1 },
  listHeader: { gap: 10, marginBottom: 2 },
  footer: { paddingVertical: 14, alignItems: "stretch", gap: 8 },
  footerFailed: { gap: 8, alignItems: "flex-start" },
  separator: { height: 10 },
  mutedLine: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
});
