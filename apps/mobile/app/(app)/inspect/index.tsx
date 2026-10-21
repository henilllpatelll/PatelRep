import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View, type ListRenderItemInfo } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { normalizeRoomIdParam } from "@/lib/housekeeping/inspectionTarget";
import { inspectionHref } from "@/lib/inspections/route";
import type { QueueItem } from "@/lib/inspections/queue";
import { useInspectionQueue } from "@/lib/inspections/useInspectionQueue";
import { searchByRoomNumber, type CorrectionItem, type DoneItem } from "@/lib/inspections/lists";
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
import { DoneRow } from "@/components/supervisor/inspect/DoneRow";
import { InspectFilterSheet } from "@/components/supervisor/inspect/InspectFilterSheet";
import { InspectionRecordSheet } from "@/components/supervisor/inspect/InspectionRecordSheet";
import { InspectNotice, InspectSkeleton, StaleBanner } from "@/components/supervisor/inspect/InspectListStates";

/* ─── Inspections — find the next room to inspect ───────────────────────────
   A compact header (verified counts + honest freshness), room-number search, three lists (To inspect / Corrections /
   Done) and a Filter & Sort drawer. Choosing a room opens the active inspection workspace (`inspect/[roomId]`) by its
   stable id; this screen stays mounted underneath, so its tab, search, filters and scroll are exactly as left. */

type Row = QueueItem | CorrectionItem | DoneItem;

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
  const params = useLocalSearchParams<{ roomId?: string | string[]; roomNumber?: string | string[] }>();
  const roomIdParam = normalizeRoomIdParam(params.roomId);
  const roomLabel = normalizeRoomIdParam(params.roomNumber);

  const data = useInspectionQueue();
  const { queue, items, correctionList, doneList, now, refreshing, refresh, selectionFor } = data;

  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [record, setRecord] = useState<DoneItem | null>(null);

  const dropFocus = useCallback(() => router.setParams({ roomId: undefined, roomNumber: undefined }), []);

  // Another hotel or person: nothing from the previous one (filters, a stale link, a half-written result) carries over.
  const lastScope = useRef(scopeKey);
  useEffect(() => {
    if (lastScope.current === scopeKey) return;
    lastScope.current = scopeKey;
    setView(INITIAL_VIEW);
    setFiltersOpen(false);
    setRecord(null);
    dropFocus();
  }, [scopeKey, dropFocus]);

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
  const doneRows = useMemo(() => (doneList ? searchByRoomNumber(doneList.items, view.search) : null), [doneList, view.search]);
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
    done: doneList ? doneList.items.length : null,
  };
  const source = view.tab === "queue" ? queue : view.tab === "corrections" ? data.corrections : data.records;
  const banner = staleBanner(source, hotelTimezone, language, t);
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
  const openCorrection = useCallback(
    (correction: CorrectionItem, intent: "reinspect" | "view") => {
      const queued = itemById.get(correction.roomId);
      if (intent === "reinspect" && queued) startInspection(queued);
      else openRoomBoard(correction.roomId);
    },
    [itemById, openRoomBoard, startInspection],
  );

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
        return <CorrectionCard item={correction} now={minute} canReinspect={queuedIds.has(correction.roomId) && correction.stage === "awaiting_reinspection"} t={t} onPress={openCorrection} />;
      }
      return <DoneRow item={item as DoneItem} timeZone={hotelTimezone} language={language} t={t} onPress={setRecord} />;
    },
    [view.tab, minute, hotelTimezone, language, showBuilding, blockedByType, t, startInspection, queuedIds, openCorrection],
  );
  const keyOf = useCallback(
    (row: Row) => (view.tab === "queue" ? (row as QueueItem).roomId : view.tab === "corrections" ? (row as CorrectionItem).inspectionId : (row as DoneItem).id),
    [view.tab],
  );

  const rows: Row[] | null = view.tab === "queue" ? queueRows : view.tab === "corrections" ? correctionRows : doneRows;
  const searching = view.search.trim().length > 0;

  const empty = (() => {
    if (rows === null) {
      const failed = source.status === "failed";
      if (!failed) return <InspectSkeleton label={t("inspect.states.loadingA11y")} />;
      const kind = view.tab === "queue" ? "" : view.tab === "corrections" ? "corrections" : "done";
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
    const total = view.tab === "corrections" ? correctionList?.items.length ?? 0 : doneList?.items.length ?? 0;
    if (searching && total > 0) {
      return <InspectNotice testID="inspect-empty-search" icon="search-outline" title={t(view.tab === "corrections" ? "inspect.states.noMatchCorrectionsTitle" : "inspect.states.noMatchDoneTitle")} actionLabel={t("inspect.states.clearSearch")} onAction={() => setSearch("")} />;
    }
    return view.tab === "corrections" ? (
      <InspectNotice testID="inspect-empty" tone="good" icon="checkmark-done-outline" title={t("inspect.states.correctionsEmptyTitle")} body={t("inspect.states.correctionsEmptyBody")} />
    ) : (
      <InspectNotice testID="inspect-empty" icon="moon-outline" title={t("inspect.states.doneEmptyTitle")} body={t("inspect.states.doneEmptyBody")} />
    );
  })();

  const listHeader = (
    <View style={styles.listHeader}>
      {banner ? <StaleBanner message={banner} actionLabel={t("inspect.banner.retry")} onAction={() => void refresh()} /> : null}
      {view.tab === "corrections" && correctionList?.truncated ? <MutedLine text={t("inspect.correction.truncated")} color={theme.textMuted} /> : null}
      {view.tab === "corrections" && correctionList && correctionList.unreadable > 0 ? <MutedLine text={t("inspect.correction.unreadable", { count: correctionList.unreadable })} color={theme.textMuted} /> : null}
      {view.tab === "done" && doneList && doneList.unreadable > 0 ? <MutedLine text={t("inspect.done.unreadable", { count: doneList.unreadable })} color={theme.textMuted} /> : null}
    </View>
  );

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
      <InspectSearchBar value={view.search} onChangeText={setSearch} onClear={() => setSearch("")} onOpenFilters={() => setFiltersOpen(true)} activeCount={activeCount(view.applied)} showFilters={view.tab === "queue"} t={t} />
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
      <InspectionRecordSheet
        record={record}
        timeZone={hotelTimezone}
        language={language}
        t={t}
        onViewRoom={(roomId) => {
          setRecord(null);
          openRoomBoard(roomId);
        }}
        onClose={() => setRecord(null)}
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
  listHeader: { gap: 8, marginBottom: 2 },
  separator: { height: 10 },
  mutedLine: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
});
