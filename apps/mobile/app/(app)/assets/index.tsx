import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { AssetCard } from "@/components/engineering/assets/AssetCard";
import { AssetFilterSheet } from "@/components/engineering/assets/AssetFilterSheet";
import { Pill, StaleNote } from "@/components/engineering/assets/assetUi";
import { getFailurePredictions, listAssetCategories } from "@/lib/api/assets";
import {
  ASSET_QUICK_FILTERS,
  EMPTY_ASSET_FILTERS,
  activeAssetFilterCount,
  hasAnyAssetFilter,
  type AssetFilters,
  type AssetRow,
} from "@/lib/engineering/assetModel";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { canManageAssets, canRetireAssets } from "@/lib/engineering/roles";
import { ASSET_NEW_ROUTE } from "@/lib/engineering/routes";
import { recallAssetView, rememberAssetView, takeAssetListStale, useAssetBrowse } from "@/lib/engineering/useAssetBrowse";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { useAppStore } from "@/stores/appStore";

const SEARCH_DEBOUNCE_MS = 350;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export default function AssetsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const canAdd = canManageAssets(user?.effective_role ?? user?.role);

  const [filters, setFilters] = useState<AssetFilters>(() => recallAssetView(scope)?.filters ?? EMPTY_ASSET_FILTERS);
  const [text, setText] = useState(() => recallAssetView(scope)?.text ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const query = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    rememberAssetView(scope, { filters, text });
  }, [scope, filters, text]);

  const browse = useAssetBrowse({ scope, filters, query });
  const refreshBrowse = browse.refresh;
  // Hidden tab screens stay mounted: a work order opened or a signal handled elsewhere is picked up on return.
  useFocusEffect(
    useCallback(() => {
      if (takeAssetListStale()) void refreshBrowse();
    }, [refreshBrowse]),
  );
  const categories = useAsyncResource((signal) => listAssetCategories(signal), { scope, key: "asset-categories" });
  const signals = useAsyncResource(async () => (await getFailurePredictions()).data.filter((p) => !p.is_acknowledged), { scope, key: "open-predictions" });

  const openAsset = useCallback((assetId: string) => router.push({ pathname: "/(app)/assets/[assetId]", params: { assetId } } as never), []);
  const scan = useCallback(() => router.push("/(app)/assets/scan" as never), []);
  const add = useCallback(() => router.push(ASSET_NEW_ROUTE as never), []);
  const clearAll = useCallback(() => {
    setFilters(EMPTY_ASSET_FILTERS);
    setText("");
  }, []);

  const filtered = hasAnyAssetFilter(filters, query);
  const sheetCount = activeAssetFilterCount(filters);
  const state = resolveLoadState({ loading: browse.loading, failure: browse.failure, count: browse.rows.length, offline: !isOnline && !browse.loaded });
  // A finished read with no rows is "empty"; a failed one never is.
  const emptyStatus = state.status === "ready" || !browse.loaded ? state.status : "empty";
  const signalCount = signals.data?.length ?? 0;

  const renderItem = useCallback(({ item }: { item: AssetRow }) => <AssetCard row={item} onPress={openAsset} />, [openAsset]);

  const header = useMemo(
    () => (
      <View style={styles.listHeader}>
        <ScrollChips
          filters={filters}
          onQuick={(quick) => setFilters((f) => ({ ...f, quick }))}
          sheetCount={sheetCount}
          onOpenSheet={() => setSheetOpen(true)}
        />
        {signalCount > 0 && filters.reliability !== "active_prediction" ? (
          <Pressable
            onPress={() => setFilters((f) => ({ ...f, quick: "all", reliability: "active_prediction" }))}
            accessibilityRole="button"
            accessibilityLabel={t("assets.signals.open", { count: signalCount })}
            style={[styles.signalRow, { backgroundColor: theme.status.pickupSoft }]}
            testID="asset-signals-row"
          >
            <Ionicons name="pulse-outline" size={16} color={theme.status.pickup} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.signalText, { color: theme.textPrimary }]}>
              {t("assets.signals.open", { count: signalCount })}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
          </Pressable>
        ) : null}
        {state.status === "ready" && filtered ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]} accessibilityLiveRegion="polite" testID="asset-result-count">
            {t("assets.resultCount", { count: browse.total })}
          </Text>
        ) : null}
        {state.stale ? (
          <StaleNote testID="asset-stale">
            {browse.failure === "offline" || !isOnline
              ? t("assets.stale.offline", { time: formatTime(browse.syncedAt) })
              : t("assets.stale.failed", { time: formatTime(browse.syncedAt) })}
          </StaleNote>
        ) : null}
      </View>
    ),
    [filters, sheetCount, signalCount, state.status, state.stale, filtered, browse.total, browse.failure, browse.syncedAt, isOnline, t, theme],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="assets-screen">
      <View style={[styles.hero, { paddingTop: insets.top + 12, backgroundColor: theme.shell.bg }]}>
        <View style={styles.heroRow}>
          <View style={styles.heroText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]}>
              {t("assets.title")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroSub, { color: theme.shell.ink2 }]}>
              {t("assets.subtitle")}
            </Text>
          </View>
          {canRetireAssets(user?.effective_role ?? user?.role) ? (
            <Pressable
              onPress={() => router.push("/(app)/assets/management" as never)}
              accessibilityRole="button"
              accessibilityLabel={t("assets.management.open")}
              style={[styles.scanButton, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
              testID="asset-management-open"
            >
              <Ionicons name="shield-checkmark-outline" size={22} color={theme.shell.ink} />
            </Pressable>
          ) : null}
          {canAdd ? (
            <Pressable
              onPress={add}
              accessibilityRole="button"
              accessibilityLabel={t("assets.add")}
              style={[styles.scanButton, { backgroundColor: theme.primaryAction, borderColor: theme.primaryAction }]}
              testID="asset-add-button"
            >
              <Ionicons name="add" size={26} color={theme.onPrimary} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={scan}
            accessibilityRole="button"
            accessibilityLabel={t("assets.scan.open")}
            style={[styles.scanButton, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
            testID="asset-scan-button"
          >
            <Ionicons name="qr-code-outline" size={22} color={theme.shell.ink} />
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
          <Ionicons name="search-outline" size={18} color={theme.shell.ink3} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("assets.searchPlaceholder")}
            placeholderTextColor={theme.shell.ink3}
            style={[styles.searchInput, { color: theme.shell.ink }]}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={100}
            accessibilityLabel={t("assets.searchPlaceholder")}
            testID="asset-search"
          />
          {text.length > 0 ? (
            <Pressable onPress={() => setText("")} accessibilityRole="button" accessibilityLabel={t("assets.clearSearch")} hitSlop={12} testID="asset-search-clear">
              <Ionicons name="close-circle" size={18} color={theme.shell.ink3} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={state.status === "ready" ? browse.rows : []}
        keyExtractor={(row) => row.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={
          state.status === "ready" ? undefined : (
            <EngineeringState
              status={emptyStatus}
              onRetry={browse.retry}
              emptyIcon="cube-outline"
              emptyTitle={filtered ? t("assets.noMatches") : t("assets.empty")}
              emptyBody={filtered ? t("assets.noMatchesHint") : t("assets.emptyHint")}
              style={styles.empty}
            />
          )
        }
        ListFooterComponent={
          browse.loadingMore ? (
            <ActivityIndicator style={styles.footer} color={theme.primaryAction} accessibilityLabel={t("common.loading")} />
          ) : emptyStatus === "empty" && filtered ? (
            <Button label={t("assets.clearFilters")} variant="secondary" onPress={clearAll} style={styles.clear} testID="asset-clear-filters" />
          ) : undefined
        }
        onEndReached={browse.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={browse.refreshing} onRefresh={browse.refresh} tintColor={theme.primaryAction} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={10}
        windowSize={7}
        removeClippedSubviews
      />

      <AssetFilterSheet
        visible={sheetOpen}
        filters={filters}
        categories={categories.data ?? []}
        categoriesFailed={categories.failure != null && !categories.data}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function formatTime(at: Date | null): string {
  return at ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

function ScrollChips({
  filters,
  onQuick,
  sheetCount,
  onOpenSheet,
}: {
  filters: AssetFilters;
  onQuick: (quick: AssetFilters["quick"]) => void;
  sheetCount: number;
  onOpenSheet: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.chipRow}>
      <View style={styles.chips} accessibilityRole="tablist">
        {ASSET_QUICK_FILTERS.map((quick) => (
          <Pill key={quick} label={t(`assets.quick.${quick}`)} selected={filters.quick === quick} onPress={() => onQuick(quick)} testID={`asset-quick-${quick}`} />
        ))}
      </View>
      <Pressable
        onPress={onOpenSheet}
        accessibilityRole="button"
        accessibilityLabel={sheetCount > 0 ? t("assets.filter.openActive", { count: sheetCount }) : t("assets.filter.open")}
        style={[styles.filterButton, { borderColor: sheetCount > 0 ? theme.primaryAction : theme.border, backgroundColor: sheetCount > 0 ? theme.primarySoft : theme.surface }]}
        testID="asset-filter-open"
      >
        <Ionicons name="options-outline" size={18} color={sheetCount > 0 ? theme.primary : theme.textSecondary} />
        {sheetCount > 0 ? (
          <Text style={[styles.filterCount, { color: theme.primary }]} maxFontSizeMultiplier={1.3}>
            {sheetCount}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 16, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 14 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroText: { flex: 1 },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600" },
  heroSub: { fontSize: 13, marginTop: 2 },
  scanButton: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, minHeight: 44 },
  content: { paddingHorizontal: 18 },
  listHeader: { paddingTop: 14, paddingBottom: 12, gap: 10 },
  chipRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterButton: { minWidth: 44, minHeight: 44, borderRadius: 22, borderWidth: 1, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  filterCount: { fontSize: 13, fontWeight: "800" },
  signalRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, paddingHorizontal: 12 },
  signalText: { flex: 1, fontSize: 13.5, fontWeight: "600" },
  count: { fontSize: 12.5 },
  separator: { height: 8 },
  empty: { marginTop: 24 },
  footer: { paddingVertical: 16 },
  clear: { marginTop: 14 },
});
