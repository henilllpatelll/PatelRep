import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { WorkOrderCard } from "@/components/engineering/WorkOrderCard";
import { WorkFilterSheet } from "@/components/engineering/WorkFilterSheet";
import { AssignTechnicianSheet, type AssignTarget } from "@/components/engineering/team/AssignTechnicianSheet";
import { WorkQueueHeader, type FilterChip } from "@/components/engineering/WorkQueueHeader";
import { WorkSummaryTiles } from "@/components/engineering/work/WorkSummaryTiles";
import { ManagerSummaryTiles } from "@/components/engineering/work/ManagerSummaryTiles";
import { PendingReportsBanner } from "@/components/engineering/report/PendingReportsBanner";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { useWorkQueue } from "@/lib/engineering/useWorkQueue";
import { useWorkSummary } from "@/lib/engineering/useWorkSummary";
import { canManageTeam, isAssignable, teamScope } from "@/lib/engineering/teamModel";
import { useTeamOverview } from "@/lib/engineering/useTeamOverview";
import {
  MANAGER_SUMMARY_KEYS,
  isManagerSummaryActive,
  managerSummaryCount,
  managerSummarySelection,
  showsManagerSummary,
  type ManagerSummaryKey,
} from "@/lib/engineering/managerSummary";
import { useClaimWorkOrder } from "@/lib/engineering/useClaimWorkOrder";
import { dismissClaimConflict, useClaimConflicts } from "@/lib/engineering/claimConflicts";
import { defaultView, isReachableView, primaryViews, resolveView, secondaryViews, showsSummary } from "@/lib/engineering/workNavigation";
import { isSummaryActive, summarySelection, type SummaryKey } from "@/lib/engineering/workSummary";
import { buildWorkRows } from "@/lib/engineering/workRows";
import {
  EMPTY_FILTERS,
  QUEUE_VIEWS,
  activeFilterCount,
  allowedStatuses,
  availableViews,
  buildListParams,
  dateFiltersFor,
  effectiveSort,
  hasAssignmentFilter,
  hasStatusFilter,
  isClaimable,
  defaultSort,
  workOrderLabel,
  type QueueFilters,
  type QueueView,
} from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

/* ─── Work tab — five views over one queue ──────────────────────────────────
   Primary tabs: My Work · Available · Team (chief engineer / GM only), per role (see workNavigation). On hold
   and History are secondary shortcuts and deep links. Each view loads its own pages from the API with the
   search and filters applied server-side, so what is shown is what the hotel actually has — not a filter
   over whatever happened to fit in the first page. */

const SEARCH_DEBOUNCE_MS = 350;
const REALTIME_DEBOUNCE_MS = 700;

type Row =
  | { type: "conflict"; key: string; woId: string; label: string | null; reason: string }
  | { type: "notice"; key: string; kind: "stale" | "offline" }
  | { type: "section"; key: string; title: string; count: string }
  | { type: "wo"; key: string; wo: WorkOrder };

const emptyFiltersByView = (): Record<QueueView, QueueFilters> =>
  Object.fromEntries(QUEUE_VIEWS.map((view) => [view, EMPTY_FILTERS])) as Record<QueueView, QueueFilters>;

export default function WorkOrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { isOnline, user, hotelTimezone, lastSyncedAt } = useAppStore();
  const locale = user?.language_pref === "es" ? "es" : "en";
  const role = user?.effective_role ?? user?.role;
  const userId = user?.id ?? null;
  const tenantId = user?.tenant_id ?? null;
  const scope = `${tenantId ?? "none"}:${userId ?? "none"}`;
  const views = useMemo(() => availableViews(role), [role]);
  const primary = useMemo(() => primaryViews(role), [role]);
  const secondary = useMemo(() => secondaryViews(role), [role]);
  const home = defaultView(role);
  const hasSummary = showsSummary("mine", role);

  const params = useLocalSearchParams<{ new?: string; view?: string }>();
  const [view, setView] = useState<QueueView>(() => resolveView(params.view, role));
  const [filtersByView, setFiltersByView] = useState<Record<QueueView, QueueFilters>>(emptyFiltersByView);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [pulling, setPulling] = useState(false);

  // Home sends `view` to land on the right queue, and a fresh `new` to open the report form once per value.
  useEffect(() => {
    if (isReachableView(params.view, role)) setView(params.view);
  }, [params.view, role]);
  const handledNew = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!params.new || handledNew.current === params.new) return;
    handledNew.current = params.new;
    router.push("/(app)/work-orders/new" as never);
  }, [params.new]);

  // A view this role cannot reach (e.g. a role change) falls back to the role's default Work screen.
  useEffect(() => {
    if (!views.includes(view)) setView(defaultView(role));
  }, [views, view, role]);

  // A different hotel or person starts clean: no filters, search, scroll position or view carried over.
  const lastScope = useRef(scope);
  const offsets = useRef<Partial<Record<QueueView, number>>>({});
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    offsets.current = {};
    setFiltersByView(emptyFiltersByView());
    setSearchText("");
    setSearch("");
    setView(defaultView(role));
  }, [scope, role]);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchText.trim()), searchText.trim() === "" ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchText]);

  const filters = filtersByView[view];
  const request = useMemo(
    () => buildListParams(view, filters, search, { role, timeZone: hotelTimezone }),
    [view, filters, search, role, hotelTimezone]
  );
  const viewer = useMemo(() => ({ userId, role }), [userId, role]);
  const queue = useWorkQueue({ scope, view, params: request, viewer, enabled: userId != null });
  const { bucket } = queue;
  const summary = useWorkSummary({ scope, enabled: userId != null && hasSummary });

  const claimer = useClaimWorkOrder({ isOnline, role, syncMarker: lastSyncedAt });
  const conflicts = useClaimConflicts(scope);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const manager = canManageTeam(role);
  // Exact hotel-wide counts for the manager's tiles; shares the Team Overview's endpoint, cache and assignment refresh.
  const overview = useTeamOverview(teamScope(user), manager && userId != null);
  const overviewReloadRef = useRef(overview.reload);
  overviewReloadRef.current = overview.reload;

  const refreshRef = useRef(queue.refresh);
  refreshRef.current = queue.refresh;
  const invalidateRef = useRef(queue.invalidateOthers);
  invalidateRef.current = queue.invalidateOthers;
  const summaryRef = useRef({ refresh: summary.refresh, applies: hasSummary });
  summaryRef.current = { refresh: summary.refresh, applies: hasSummary };
  const refreshQuietly = useCallback(() => {
    invalidateRef.current();
    void refreshRef.current();
    if (summaryRef.current.applies) void summaryRef.current.refresh();
    void overviewReloadRef.current();
  }, []);

  // Back from a detail screen: re-read in place (rows and filters stay) so a finished job leaves the list.
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) refreshQuietly();
      focusedBefore.current = true;
    }, [refreshQuietly])
  );

  // Coming back online reloads what the connection could not.
  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) refreshQuietly();
    wasOnline.current = isOnline;
  }, [isOnline, refreshQuietly]);

  // Realtime: one subscription per hotel; any change reloads the pages already loaded in place (no duplicates, no reset).
  useEffect(() => {
    if (!tenantId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`work-orders-queue:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${tenantId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refreshQuietly, REALTIME_DEBOUNCE_MS);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tenantId, refreshQuietly]);

  const onPullRefresh = useCallback(async () => {
    setPulling(true);
    queue.invalidateOthers();
    await Promise.all([queue.refresh(), hasSummary ? summary.refresh() : undefined, manager ? overview.reload() : undefined]);
    setPulling(false);
  }, [queue, summary, hasSummary, manager, overview]);

  const onClaim = useCallback(
    async (wo: WorkOrder) => {
      const label = [workOrderLabel(wo), wo.title].filter(Boolean).join(" · ");
      const outcome = await claimer.claim(wo);
      if (outcome.kind === "ignored") return;
      if (outcome.kind === "confirmed") {
        queue.removeItem(wo.id);
        toast.success(t("workQueue.claimed", { label }));
        refreshQuietly();
      } else if (outcome.kind === "queued") {
        toast.info(t("workQueue.claimSavedOffline"));
      } else if (outcome.failure === "conflict") {
        toast.error(t("workQueue.claimConflict"));
        refreshQuietly();
      } else if (outcome.failure === "forbidden") {
        toast.error(t("workQueue.claimForbidden"));
      } else if (outcome.failure === "not_found") {
        toast.error(t("workQueue.claimGone"));
        refreshQuietly();
      } else {
        toast.error(t("workQueue.claimFailed"));
      }
    },
    [claimer, queue, toast, t, refreshQuietly]
  );

  // Cards are memoised, so the handlers they receive must keep their identity between renders.
  const claimRef = useRef(onClaim);
  claimRef.current = onClaim;
  const claimOrder = useCallback((order: WorkOrder) => void claimRef.current(order), []);
  const openOrder = useCallback((order: WorkOrder) => router.push(`/(app)/work-orders/${order.id}`), []);
  const assignOrder = useCallback(
    (order: WorkOrder) =>
      setAssignTarget({
        id: order.id,
        code: workOrderLabel(order),
        title: order.title,
        priority: order.priority,
        assignedTo: order.assigned_to ?? null,
        assignedToName: order.assigned_to_name,
      }),
    []
  );

  // Due and overdue labels read the clock; one tick a minute keeps them true without refetching.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000) * 60_000), 60_000);
    return () => clearInterval(id);
  }, []);

  const setFilters = useCallback((next: QueueFilters) => setFiltersByView((prev) => ({ ...prev, [view]: next })), [view]);

  // A tile applies the filter it counted (or opens On hold); a second press on an applied tile clears it.
  const onSummary = useCallback(
    (key: SummaryKey) => {
      const next = summarySelection(key, filtersByView.mine);
      setFiltersByView((prev) => ({ ...prev, [next.view]: next.filters }));
      setView(next.view);
    },
    [filtersByView.mine]
  );
  const onManagerSummary = useCallback(
    (key: ManagerSummaryKey) => {
      const next = managerSummarySelection(key, filtersByView.team);
      if (next.filters) setFiltersByView((prev) => ({ ...prev, [next.view]: next.filters as QueueFilters }));
      setView(next.view);
    },
    [filtersByView.team]
  );
  const managerCounts = useMemo(
    () => Object.fromEntries(MANAGER_SUMMARY_KEYS.map((key) => [key, managerSummaryCount(overview.data?.counts, key)])) as Record<ManagerSummaryKey, number | null>,
    [overview.data]
  );
  const managerActive = useMemo(
    () => Object.fromEntries(MANAGER_SUMMARY_KEYS.map((key) => [key, isManagerSummaryActive(key, view, filters)])) as Record<ManagerSummaryKey, boolean>,
    [view, filters]
  );
  const summaryActive = useMemo(
    () => ({ urgent: isSummaryActive("urgent", filtersByView.mine), inProgress: isSummaryActive("inProgress", filtersByView.mine), waiting: false }),
    [filtersByView.mine]
  );

  // Each view keeps its own scroll position: leave and return, and the list is where it was.
  const listRef = useRef<FlatList<Row>>(null);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsets.current[view] = event.nativeEvent.contentOffset.y;
    },
    [view]
  );
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    const offset = offsets.current[view] ?? 0;
    const id = setTimeout(() => listRef.current?.scrollToOffset({ offset, animated: false }), 0);
    return () => clearTimeout(id);
  }, [view]);

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    const clear = (patch: Partial<QueueFilters>) => () => setFilters({ ...filters, ...patch });
    const statuses = filters.statuses.filter((s) => allowedStatuses(view).includes(s));
    if (hasStatusFilter(view) && statuses.length > 0 && !(view === "done" && statuses[0] === "completed")) {
      out.push({ key: "status", label: statuses.map((s) => t(`workOrders.status.${s}`)).join(", "), onRemove: clear({ statuses: [] }) });
    }
    if (filters.urgentOnly) out.push({ key: "urgent", label: t("workQueue.urgentChip"), onRemove: clear({ urgentOnly: false }) });
    else if (filters.priority) out.push({ key: "priority", label: t(`workQueue.priority.${filters.priority}`), onRemove: clear({ priority: null }) });
    if (filters.category) out.push({ key: "category", label: t(`workOrders.category.${filters.category}`), onRemove: clear({ category: null }) });
    if (filters.floor != null || filters.building) {
      const label = [filters.building ? t("workQueue.filter.buildingValue", { building: filters.building }) : null, filters.floor != null ? t("workOrders.floor", { floor: filters.floor }) : null]
        .filter(Boolean)
        .join(" · ");
      out.push({ key: "location", label, onRemove: clear({ floor: null, building: null }) });
    }
    if (filters.date && dateFiltersFor(view).includes(filters.date)) {
      out.push({ key: "date", label: t(`workQueue.filter.dateOptions.${filters.date}`), onRemove: clear({ date: null }) });
    }
    if (hasAssignmentFilter(view) && filters.assignment !== "any") {
      out.push({ key: "assignment", label: t(`workQueue.filter.assignmentOptions.${filters.assignment}`), onRemove: clear({ assignment: "any" }) });
    }
    if (filters.sort && filters.sort !== defaultSort(view)) {
      out.push({ key: "sort", label: t(`workQueue.filter.sortOptions.${filters.sort}`), onRemove: clear({ sort: null }) });
    }
    return out;
  }, [filters, view, t, setFilters]);

  const filterCount = activeFilterCount(view, filters);
  const hasNarrowing = filterCount > 0 || search !== "";
  const sort = effectiveSort(view, filters);

  const loadState = resolveLoadState({
    loading: !bucket.loaded && bucket.failure == null,
    failure: bucket.failure,
    count: bucket.items.length,
    offline: !isOnline && !bucket.loaded,
  });

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = conflicts.map((c) => ({ type: "conflict", key: `conflict-${c.woId}`, woId: c.woId, label: c.label, reason: c.reason }));
    if (loadState.stale) list.push({ type: "notice", key: "stale", kind: "stale" });
    else if (bucket.cached || (!isOnline && bucket.loaded)) list.push({ type: "notice", key: "offline", kind: "offline" });
    if (loadState.status !== "ready") return list;

    for (const row of buildWorkRows(bucket.items, { view, role, sort, hasMore: bucket.hasMore || bucket.cached })) {
      if (row.type === "wo") list.push(row);
      else list.push({ type: "section", key: row.key, title: t(`workQueue.groups.${row.section}`), count: `${row.count}${row.partial ? "+" : ""}` });
    }
    return list;
  }, [bucket.items, bucket.hasMore, bucket.cached, bucket.loaded, conflicts, isOnline, loadState, role, sort, t, view]);

  const emptyCopy = (): { title: string; body: string; action?: { label: string; onPress: () => void } } => {
    if (hasNarrowing) return { title: t("workQueue.empty.noMatches"), body: t("workQueue.empty.noMatchesHint") };
    const action = view === "mine" ? { label: t("workQueue.empty.browseAvailable"), onPress: () => setView("available") } : undefined;
    return { title: t(`workQueue.empty.${view}`), body: t(`workQueue.empty.${view}Hint`), action };
  };

  const clearNarrowing = () => {
    setSearchText("");
    setFilters(EMPTY_FILTERS);
  };

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.type) {
      case "conflict":
        return (
          <View
            style={[styles.banner, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
            accessibilityRole="alert"
            testID={`claim-conflict-${item.woId}`}
          >
            <Ionicons name="alert-circle-outline" size={18} color={theme.status.dirty} />
            <Text style={[styles.bannerText, { color: theme.status.dirty }]} maxFontSizeMultiplier={1.4}>
              {t(`workQueue.conflict.${item.reason}`, { label: item.label ?? t("workQueue.conflict.unknownOrder") })}
            </Text>
            <Pressable onPress={() => void dismissClaimConflict(item.woId)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close")}>
              <Ionicons name="close" size={18} color={theme.status.dirty} />
            </Pressable>
          </View>
        );
      case "notice":
        return item.kind === "stale" ? (
          <View style={styles.bannerWrap}>
            <StaleBanner onRetry={() => void queue.refresh()} />
          </View>
        ) : (
          <View
            style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
            accessibilityRole="text"
            testID="wo-offline-cached"
          >
            <Ionicons name="cloud-offline-outline" size={18} color={theme.status.pickup} />
            <Text style={[styles.bannerText, { color: theme.status.pickup }]} maxFontSizeMultiplier={1.4}>
              {bucket.fetchedAt
                ? t("workQueue.offlineCached", { time: new Date(bucket.fetchedAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) })
                : t("workQueue.offlineCachedNoTime")}
            </Text>
            <Pressable onPress={() => router.push("/(app)/engineering-sync" as never)} accessibilityRole="button" accessibilityLabel={t("workOrders.repair.banner.viewSync")} hitSlop={8} style={styles.noticeAction} testID="wo-offline-sync">
              <Text style={[styles.bannerText, { color: theme.status.pickup, fontWeight: "700", flex: 0 }]} maxFontSizeMultiplier={1.4}>
                {t("workOrders.repair.banner.viewSync")}
              </Text>
            </Pressable>
          </View>
        );
      case "section":
        return (
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
              {item.title}
            </Text>
            <Text style={[styles.sectionCount, { color: theme.textDisabled }]}>{item.count}</Text>
          </View>
        );
      case "wo": {
        const claimable = isClaimable(item.wo, role);
        const queued = claimer.queuedIds.has(item.wo.id);
        return (
          <View style={styles.cardWrap}>
            <WorkOrderCard
              wo={item.wo}
              locale={locale}
              timeZone={hotelTimezone}
              view={view}
              viewerId={userId}
              now={minute}
              onOpen={openOrder}
              claimable={claimable && !queued}
              onClaim={claimOrder}
              claiming={claimer.claimingIds.has(item.wo.id)}
              claimQueued={claimable && queued}
              assignable={manager && view !== "done" && isAssignable(item.wo)}
              onAssign={assignOrder}
            />
          </View>
        );
      }
    }
  };

  const empty = emptyCopy();
  const listEmpty =
    loadState.status === "loading" ? (
      <EngineeringState status="loading" emptyTitle="" style={styles.state} />
    ) : loadState.status === "empty" ? (
      <View>
        <EngineeringState status="empty" emptyIcon="checkmark-done-outline" emptyTitle={empty.title} emptyBody={empty.body} style={styles.state} />
        {hasNarrowing ? (
          <Pressable onPress={clearNarrowing} style={styles.linkButton} accessibilityRole="button" testID="wo-clear-narrowing">
            <Text style={[styles.link, { color: theme.primaryAction }]}>{t("workQueue.empty.clear")}</Text>
          </Pressable>
        ) : empty.action ? (
          <Pressable onPress={empty.action.onPress} style={styles.linkButton} accessibilityRole="button" testID="wo-empty-action">
            <Text style={[styles.link, { color: theme.primaryAction }]}>{empty.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    ) : loadState.status === "ready" ? null : (
      <EngineeringState status={loadState.status} onRetry={() => void queue.refresh()} emptyTitle="" style={styles.state} />
    );

  const footer = bucket.loadingMore ? (
    <ActivityIndicator style={styles.footer} color={theme.primaryAction} accessibilityLabel={t("workQueue.loadingMore")} testID="wo-loading-more" />
  ) : bucket.hasMore && loadState.status === "ready" ? (
    <Pressable onPress={queue.loadMore} style={styles.linkButton} accessibilityRole="button" testID="wo-load-more">
      <Text style={[styles.link, { color: theme.primaryAction }]}>{t("workQueue.loadMore", { count: bucket.items.length })}</Text>
    </Pressable>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        extraData={minute}
        ListHeaderComponent={
          <>
          <WorkQueueHeader
            view={view}
            primary={primary}
            secondary={secondary}
            home={home}
            onView={setView}
            manager={manager}
            summary={
              showsSummary(view, role) ? (
                <WorkSummaryTiles summary={summary.summary} failed={summary.failed} active={summaryActive} onPress={onSummary} />
              ) : showsManagerSummary(view, role) ? (
                <ManagerSummaryTiles
                  counts={managerCounts}
                  truncated={overview.data?.truncated ?? false}
                  unavailable={overview.data == null && overview.failure != null}
                  stale={overview.data != null && (!isOnline || overview.failure != null)}
                  active={managerActive}
                  onPress={onManagerSummary}
                />
              ) : undefined
            }
            searchText={searchText}
            onSearchText={setSearchText}
            filterCount={filterCount}
            onOpenFilters={() => setShowFilters(true)}
            chips={chips}
            onNew={() => router.push("/(app)/work-orders/new" as never)}
          />
          <PendingReportsBanner />
          </>
        }
        ListEmptyComponent={listEmpty ?? undefined}
        ListFooterComponent={footer ?? undefined}
        contentContainerStyle={styles.listContent}
        onEndReached={queue.loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={theme.primaryAction} />}
        testID="wo-list"
      />
      <AssignTechnicianSheet
        visible={assignTarget != null}
        target={assignTarget}
        scope={scope}
        online={isOnline}
        onClose={() => setAssignTarget(null)}
        onNeedsRefresh={refreshQuietly}
        onAssigned={(tech, changed) => {
          toast.success(changed ? t("engineeringTeam.assign.done", { name: tech.name ?? t("engineeringTeam.technician") }) : t("engineeringTeam.assign.alreadyDone"));
          refreshQuietly();
        }}
      />
      <WorkFilterSheet visible={showFilters} view={view} role={role} filters={filters} onApply={(next) => { setFilters(next); setShowFilters(false); }} onClose={() => setShowFilters(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 32 },
  noticeAction: { minHeight: 44, justifyContent: "center" },
  cardWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  sectionRow: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  sectionCount: { fontSize: 12, fontWeight: "700" },
  bannerWrap: { paddingHorizontal: 16, paddingTop: 12 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  state: { paddingVertical: 48 },
  footer: { paddingVertical: 20 },
  linkButton: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  link: { fontSize: 14, fontWeight: "700" },
});
