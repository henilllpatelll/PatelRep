import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { AttentionCard } from "@/components/supervisor/attention/AttentionCard";
import { AttentionFilters } from "@/components/supervisor/attention/AttentionFilters";
import { AttentionSheetHost } from "@/components/supervisor/attention/AttentionSheetHost";
import { Skeleton, UnavailableBlock } from "@/components/supervisor/today/TodayBlocks";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { subscribeSupervisorRealtime } from "@/lib/housekeeping/supervisorRealtime";
import {
  attentionListState,
  buildAttentionCenter,
  describeCard,
  itemsForFilter,
  partialNotices,
  visibleFilters,
  type AttentionCardView,
  type AttentionFilter,
} from "@/lib/housekeeping/supervisorAttentionCenter";
import { fetchedAtOf } from "@/lib/housekeeping/supervisorSources";
import { describeFreshness, freshnessLabel } from "@/lib/housekeeping/supervisorTodayView";
import { useSupervisorToday } from "@/lib/housekeeping/useSupervisorToday";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/** Coming back to the screen refreshes if the snapshot is older than this (e.g. after assigning a room). */
const FOCUS_REFRESH_AFTER_MS = 20_000;

/**
 * The supervisor Attention Center: an action queue, not a feed. It reads the same shared snapshot as
 * Today (same builder, same order, same counts), re-slices it by filter without any request, and opens a
 * detail sheet before sending anyone anywhere. The housekeeper Attention Center is a different screen.
 */
export function SupervisorAttentionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const zone = useAppStore((state) => state.hotelTimezone);
  const tenantId = user?.tenant_id ?? null;
  const userId = user?.id ?? null;
  const role = user?.effective_role ?? user?.role;
  const isSupervisor = role === "housekeeping_supervisor";
  const language = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("es") ? "es" : "en";
  const scopeKey = tenantId && userId ? `${tenantId}:${userId}` : null;

  const { today, refresh, refreshing } = useSupervisorToday({
    enabled: isSupervisor,
    viewerId: userId,
    scopeKey,
    reuseFresh: true,
  });
  const [filter, setFilter] = useState<AttentionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  // A different hotel or person starts clean: no filter, no open sheet.
  useEffect(() => {
    setFilter("all");
    setSelectedId(null);
  }, [scopeKey]);

  // Realtime: the one shared channel (Today's), not a second subscription.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!tenantId || !isSupervisor) return;
    return subscribeSupervisorRealtime(tenantId, () => refreshRef.current());
  }, [tenantId, isSupervisor]);

  // Back from a destination screen: bring the queue up to date if it has aged.
  const firstFocus = useRef(true);
  const lastRefreshRef = useRef(0);
  lastRefreshRef.current = today.sources.board.status === "loading" ? Date.now() : (fetchedAtOf(today.sources.board) ?? 0);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (Date.now() - lastRefreshRef.current > FOCUS_REFRESH_AFTER_MS) void refreshRef.current();
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/home" as never);
  }, []);

  const center = useMemo(() => buildAttentionCenter(today.attention), [today.attention]);
  const state = attentionListState(center, filter, today.sources);
  const someone = t("supervisorToday.attention.someone");
  const cards = useMemo(
    () =>
      itemsForFilter(center, filter)
        .map((item) => describeCard(item, { zone, language, someone }))
        .filter((card): card is AttentionCardView => card !== null),
    [center, filter, zone, language, someone],
  );
  const filters = visibleFilters(center, filter);
  const notices = useMemo(() => partialNotices(center, today.sources), [center, today.sources]);
  const freshness = useMemo(
    () => freshnessLabel(describeFreshness(today.sources.board, today.generatedAt), t, zone, language),
    [today.sources.board, today.generatedAt, t, zone, language],
  );
  const filterLabel = t(`supervisorAttention.filter.${filter}`);
  const countKnown = state !== "loading" && state !== "unavailable";

  const verifiedAt = useCallback(
    (card: AttentionCardView) => (card.stale && card.fetchedAt ? formatHotelTime(new Date(card.fetchedAt), zone, language) : null),
    [zone, language],
  );
  const renderItem = useCallback(
    ({ item }: { item: AttentionCardView }) => <AttentionCard card={item} verifiedAt={verifiedAt(item)} t={t} onPress={setSelectedId} />,
    [t, verifiedAt],
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t("supervisorAttention.back")}
        hitSlop={8}
        style={styles.back}
        testID="attention-back"
      >
        <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
      </Pressable>
      <View style={styles.headerText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("supervisorAttention.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t("supervisorAttention.subtitle")}
        </Text>
        {freshness || countKnown ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="attention-meta">
            {[countKnown ? t("supervisorAttention.itemCount", { count: center.counts.all }) : null, freshness].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const banners = (
    <View style={styles.banners}>
      {!isOnline ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.banner, styles.bannerBox, { color: theme.status.pickup, backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
          accessibilityLiveRegion="polite"
          testID="attention-offline"
        >
          {t("supervisorAttention.offline")}
        </Text>
      ) : null}
      {notices.length > 0 ? (
        <View
          style={[styles.bannerBox, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
          accessibilityLiveRegion="polite"
          testID="attention-partial"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
            {t("supervisorAttention.partial")}
          </Text>
          {notices.map((notice) => (
            <Text key={notice.key} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
              {t(notice.key)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );

  let empty = null;
  if (state === "loading") {
    empty = (
      <View style={styles.empty} accessibilityLabel={t("supervisorAttention.loading")} testID="attention-loading">
        <Skeleton height={92} />
        <Skeleton height={92} />
        <Skeleton height={92} />
      </View>
    );
  } else if (state === "unavailable") {
    empty = (
      <UnavailableBlock
        testID="attention-unavailable"
        title={t("supervisorAttention.unavailable.title")}
        hint={t("supervisorAttention.unavailable.body")}
        retryLabel={t("supervisorAttention.unavailable.retry")}
        onRetry={onRefresh}
      />
    );
  } else if (state === "filter_empty") {
    empty = (
      <View style={styles.emptyCenter} testID="attention-filter-empty">
        <Ionicons name="funnel-outline" size={26} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: theme.textPrimary }]}>
          {t("supervisorAttention.filterEmpty.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyBody, { color: theme.textSecondary }]}>
          {t("supervisorAttention.filterEmpty.body", { label: filterLabel })}
        </Text>
        <Pressable
          onPress={() => setFilter("all")}
          accessibilityRole="button"
          testID="attention-show-all"
          style={[styles.showAll, { borderColor: theme.primaryLine }]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.showAllText, { color: theme.primaryAction }]}>
            {t("supervisorAttention.filterEmpty.showAll")}
          </Text>
        </Pressable>
      </View>
    );
  } else if (state === "unconfirmed_empty") {
    empty = (
      <View style={styles.emptyCenter} testID="attention-unconfirmed-empty">
        <Ionicons name="help-circle-outline" size={26} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: theme.textPrimary }]}>
          {t("supervisorAttention.staleEmpty.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyBody, { color: theme.textSecondary }]}>
          {t("supervisorAttention.staleEmpty.body")}
        </Text>
      </View>
    );
  } else if (state === "caught_up") {
    empty = (
      <View style={styles.emptyCenter} testID="attention-empty">
        <Ionicons name="checkmark-circle-outline" size={30} color={theme.status.ready} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: theme.textPrimary }]}>
          {t("supervisorAttention.empty.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyBody, { color: theme.textSecondary }]}>
          {t("supervisorAttention.empty.body")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="supervisor-attention">
      {header}
      {/* While nothing is known the counts would read "0": show no filters rather than a false zero. */}
      {countKnown ? <AttentionFilters filters={filters} selected={filter} counts={center.counts} t={t} onSelect={setFilter} /> : null}
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={banners}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={[styles.list, { paddingBottom: 110 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={pulling || (refreshing && state === "loading")} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        initialNumToRender={10}
        windowSize={7}
        testID="attention-list"
      />
      <AttentionSheetHost itemId={selectedId} today={today} isOnline={isOnline} zone={zone} language={language} onClose={() => setSelectedId(null)} />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1 },
  back: { width: MIN_TARGET - 4, height: MIN_TARGET - 4, alignItems: "center", justifyContent: "center", marginTop: 2 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 24, fontWeight: "800", lineHeight: 30 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12.5, fontWeight: "600", marginTop: 2 },
  list: { paddingHorizontal: 18, paddingTop: 4, flexGrow: 1 },
  separator: { height: 10 },
  banners: { gap: 8, marginBottom: 10 },
  bannerBox: { borderWidth: 1, borderRadius: R.md, paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
  banner: { fontSize: 13, fontWeight: "600" },
  bannerText: { fontSize: 13, lineHeight: 18 },
  empty: { gap: 10, paddingTop: 6 },
  emptyCenter: { alignItems: "center", gap: 8, paddingTop: 36, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  showAll: { marginTop: 6, minHeight: MIN_TARGET, paddingHorizontal: 22, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  showAllText: { fontSize: 14, fontWeight: "700" },
});
