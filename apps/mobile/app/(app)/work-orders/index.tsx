import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
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
import { WorkQueueHeader, type FilterChip } from "@/components/engineering/WorkQueueHeader";
import CreateWorkOrderModal from "@/components/engineering/CreateWorkOrderModal";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { useWorkQueue } from "@/lib/engineering/useWorkQueue";
import { useClaimWorkOrder } from "@/lib/engineering/useClaimWorkOrder";
import { dismissClaimConflict, useClaimConflicts } from "@/lib/engineering/claimConflicts";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  allowedStatuses,
  availableViews,
  buildListParams,
  compareWorkOrders,
  dateFiltersFor,
  effectiveSort,
  groupMineWork,
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
   My Work · Available · Team (chief engineer / GM only) · Waiting · Done. Each
   view loads its own pages from the API with the search and filters applied
   server-side, so what is shown is what the hotel actually has — not a filter
   over whatever happened to fit in the first page. */

const SEARCH_DEBOUNCE_MS = 350;
const REALTIME_DEBOUNCE_MS = 700;

type Row =
  | { type: "conflict"; key: string; woId: string; label: string | null; reason: string }
  | { type: "notice"; key: string; kind: "stale" | "offline" }
  | { type: "section"; key: string; title: string; count: number }
  | { type: "wo"; key: string; wo: WorkOrder };

const isView = (value: unknown, views: QueueView[]): value is QueueView => typeof value === "string" && (views as string[]).includes(value);

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

  const params = useLocalSearchParams<{ new?: string; view?: string }>();
  const [view, setView] = useState<QueueView>(() => (isView(params.view, views) ? params.view : "mine"));
  const [filtersByView, setFiltersByView] = useState<Record<QueueView, QueueFilters>>({
    mine: EMPTY_FILTERS,
    available: EMPTY_FILTERS,
    team: EMPTY_FILTERS,
    waiting: EMPTY_FILTERS,
    done: EMPTY_FILTERS,
  });
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pulling, setPulling] = useState(false);

  // Home sends `view` to land on the right queue, and a fresh `new` to open the create sheet once per value.
  useEffect(() => {
    if (isView(params.view, views)) setView(params.view);
  }, [params.view, views]);
  const handledNew = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!params.new || handledNew.current === params.new) return;
    handledNew.current = params.new;
    setShowCreate(true);
  }, [params.new]);

  // A view this role cannot see (e.g. a role change) falls back to My Work.
  useEffect(() => {
    if (!views.includes(view)) setView("mine");
  }, [views, view]);

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

  const claimer = useClaimWorkOrder({ isOnline, role, syncMarker: lastSyncedAt });
  const conflicts = useClaimConflicts(scope);

  const refreshRef = useRef(queue.refresh);
  refreshRef.current = queue.refresh;
  const invalidateRef = useRef(queue.invalidateOthers);
  invalidateRef.current = queue.invalidateOthers;
  const refreshQuietly = useCallback(() => {
    invalidateRef.current();
    void refreshRef.current();
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
    await queue.refresh();
    setPulling(false);
  }, [queue]);

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

  const setFilters = useCallback((next: QueueFilters) => setFiltersByView((prev) => ({ ...prev, [view]: next })), [view]);

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    const clear = (patch: Partial<QueueFilters>) => () => setFilters({ ...filters, ...patch });
    const statuses = filters.statuses.filter((s) => allowedStatuses(view).includes(s));
    if (hasStatusFilter(view) && statuses.length > 0 && !(view === "done" && statuses[0] === "completed")) {
      out.push({ key: "status", label: statuses.map((s) => t(`workOrders.status.${s}`)).join(", "), onRemove: clear({ statuses: [] }) });
    }
    if (filters.priority) out.push({ key: "priority", label: t(`workQueue.priority.${filters.priority}`), onRemove: clear({ priority: null }) });
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
    else if (!isOnline && bucket.loaded) list.push({ type: "notice", key: "offline", kind: "offline" });
    if (loadState.status !== "ready") return list;

    const ordered = [...bucket.items].sort(compareWorkOrders(sort));
    if (view === "mine") {
      for (const group of groupMineWork(bucket.items, sort)) {
        list.push({ type: "section", key: `s-${group.key}`, title: t(`workQueue.groups.${group.key}`), count: group.orders.length });
        group.orders.forEach((wo) => list.push({ type: "wo", key: wo.id, wo }));
      }
    } else if (view === "available") {
      const claimable = ordered.filter((wo) => isClaimable(wo, role));
      const needsOwner = ordered.filter((wo) => !isClaimable(wo, role));
      if (needsOwner.length > 0) {
        list.push({ type: "section", key: "s-claim", title: t("workQueue.groups.claimable"), count: claimable.length });
        claimable.forEach((wo) => list.push({ type: "wo", key: wo.id, wo }));
        list.push({ type: "section", key: "s-owner", title: t("workQueue.groups.needsOwner"), count: needsOwner.length });
        needsOwner.forEach((wo) => list.push({ type: "wo", key: wo.id, wo }));
      } else {
        claimable.forEach((wo) => list.push({ type: "wo", key: wo.id, wo }));
      }
    } else {
      ordered.forEach((wo) => list.push({ type: "wo", key: wo.id, wo }));
    }
    return list;
  }, [bucket.items, bucket.loaded, conflicts, isOnline, loadState, role, sort, t, view]);

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
              view={view}
              onPress={() => router.push(`/(app)/work-orders/${item.wo.id}`)}
              onClaim={claimable && !queued ? () => void onClaim(item.wo) : undefined}
              claiming={claimer.claimingIds.has(item.wo.id)}
              claimQueued={claimable && queued}
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
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        ListHeaderComponent={
          <WorkQueueHeader
            views={views}
            view={view}
            onView={setView}
            searchText={searchText}
            onSearchText={setSearchText}
            filterCount={filterCount}
            onOpenFilters={() => setShowFilters(true)}
            chips={chips}
            onNew={() => setShowCreate(true)}
          />
        }
        ListEmptyComponent={listEmpty ?? undefined}
        ListFooterComponent={footer ?? undefined}
        contentContainerStyle={styles.listContent}
        onEndReached={queue.loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={theme.primaryAction} />}
        testID="wo-list"
      />
      <WorkFilterSheet visible={showFilters} view={view} role={role} filters={filters} onApply={(next) => { setFilters(next); setShowFilters(false); }} onClose={() => setShowFilters(false)} />
      <CreateWorkOrderModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          refreshQuietly();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 32 },
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
