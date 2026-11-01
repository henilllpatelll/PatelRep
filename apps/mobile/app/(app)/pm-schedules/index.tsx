import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { PM_LIST_ROUTE, pmInspectRoute, pmRecordRoute, pmScheduleRoute } from "@/lib/engineering/routes";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { PmMetricCards } from "@/components/engineering/pm/PmMetricCards";
import { PmTodayView } from "@/components/engineering/pm/PmTodayView";
import { PmWeekView } from "@/components/engineering/pm/PmWeekView";
import { PmCalendarView } from "@/components/engineering/pm/PmCalendarView";
import { PmHistoryView } from "@/components/engineering/pm/PmHistoryView";
import { PmFilterSheet } from "@/components/engineering/pm/PmFilterSheet";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { usePmSchedules } from "@/lib/engineering/usePmSchedules";
import { activeFilterCount, applyPmFilters, categoriesOf, DEFAULT_PM_FILTERS, type PmFilterState } from "@/lib/engineering/pmFilters";
import { listPmDraftIds } from "@/lib/engineering/pmDraftStore";
import { canCompletePm } from "@/lib/engineering/roles";

type PmView = "today" | "week" | "calendar" | "history";
const VIEWS: readonly PmView[] = ["today", "week", "calendar", "history"];

function parseView(value: string | string[] | undefined): PmView {
  const v = Array.isArray(value) ? value[0] : value;
  return VIEWS.includes(v as PmView) ? (v as PmView) : "today";
}

export default function PreventiveMaintenanceScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ view?: string }>();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const canInspect = canCompletePm(role);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;

  const data = usePmSchedules();
  const [view, setView] = useState<PmView>(() => parseView(params.view));
  const [filters, setFilters] = useState<PmFilterState>(DEFAULT_PM_FILTERS);
  const [searching, setSearching] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<ReadonlySet<string>>(new Set());
  const [historyToken, setHistoryToken] = useState(0);

  // Tabs stay mounted: coming back from an inspection re-reads schedules (due dates moved), history and local drafts.
  const focusedOnce = useRef(false);
  const { reload } = data;
  useFocusEffect(
    useCallback(() => {
      void listPmDraftIds().then((ids) => setDraftIds(new Set(ids)));
      if (focusedOnce.current) {
        void reload();
        setHistoryToken((n) => n + 1);
      }
      focusedOnce.current = true;
    }, [reload]),
  );

  const visible = useMemo(() => applyPmFilters(data.schedules, filters), [data.schedules, filters]);
  const categories = useMemo(() => categoriesOf(data.schedules), [data.schedules]);
  const filtersActive = activeFilterCount(filters) > 0;

  const load = resolveLoadState({ loading: data.loading && !data.hasData, failure: data.failure, count: data.schedules.length, offline: !isOnline && !data.hasData });
  const showMetrics = data.hasData;
  const listState = view === "history" ? "ready" : load.status === "ready" && visible.length === 0 ? "empty" : load.status;

  const open = (id: string) => router.push((pmScheduleRoute(id) ?? PM_LIST_ROUTE) as never);
  const inspect = (id: string) => router.push((pmInspectRoute(id) ?? PM_LIST_ROUTE) as never);
  const language = i18n.language;
  const listProps = { schedules: visible, language, draftIds, canInspect, onOpen: open, onInspect: inspect };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void data.refresh()} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
          <View style={styles.heroRow}>
            <View style={styles.heroCopy}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroTitle, { color: theme.shell.ink }]} accessibilityRole="header">
                {t("pm.title")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroSub, { color: theme.shell.ink3 }]}>
                {t("pm.subtitle")}
              </Text>
            </View>
            <Pressable
              onPress={() => setSearching((s) => !s)}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={t("pm.search")}
              accessibilityState={{ expanded: searching }}
              testID="pm-search-toggle"
            >
              <Ionicons name="search-outline" size={22} color={theme.shell.ink} />
            </Pressable>
            <Pressable
              onPress={() => setSheetOpen(true)}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={t("pm.filter.title")}
              testID="pm-filter-open"
            >
              <Ionicons name="options-outline" size={22} color={theme.shell.ink} />
              {filtersActive ? <View style={[styles.badge, { backgroundColor: theme.status.pickup }]} /> : null}
            </Pressable>
          </View>
          {searching ? (
            <TextInput
              value={filters.query}
              onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
              placeholder={t("pm.searchPlaceholder")}
              placeholderTextColor={theme.shell.ink3}
              style={[styles.search, { color: theme.shell.ink, borderColor: theme.shell.line, backgroundColor: theme.shell.surface }]}
              autoFocus
              returnKeyType="search"
              accessibilityLabel={t("pm.search")}
              testID="pm-search-input"
            />
          ) : null}
        </View>

        <View style={styles.metrics}>
          <PmMetricCards
            overdue={showMetrics ? data.summary.overdue : null}
            dueToday={showMetrics ? data.summary.dueToday : null}
            thisWeek={showMetrics ? data.summary.thisWeek : null}
            onSelect={(card) => setView(card === "week" ? "week" : "today")}
          />
        </View>

        <View style={[styles.segmented, { backgroundColor: theme.surfaceSubtle }]} accessibilityRole="tablist">
          {VIEWS.map((v) => {
            const active = view === v;
            return (
              <Pressable
                key={v}
                onPress={() => setView(v)}
                style={[styles.segment, active && { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                testID={`pm-view-${v}`}
              >
                <Text maxFontSizeMultiplier={1.3} style={[styles.segmentLabel, { color: active ? theme.textPrimary : theme.textMuted }]}>
                  {t(`pm.views.${v}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filtersActive && view !== "history" ? (
          <View style={styles.activeRow} testID="pm-active-filters">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.activeText, { color: theme.textSecondary }]}>
              {t("pm.filter.showing", { shown: visible.length, total: data.schedules.length })}
            </Text>
            <Pressable onPress={() => setFilters(DEFAULT_PM_FILTERS)} accessibilityRole="button" style={styles.resetButton} testID="pm-filters-reset">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.resetText, { color: theme.primaryAction }]}>
                {t("pm.filter.reset")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {load.stale ? (
          <View style={styles.pad}>
            <StaleBanner onRetry={() => void data.reload()} />
          </View>
        ) : null}
        {!isOnline && data.hasData ? (
          <Text style={[styles.offline, { color: theme.status.pickup }]} accessibilityLiveRegion="polite" testID="pm-offline-note">
            {t("pm.offlineStale")}
          </Text>
        ) : null}

        <View style={styles.body}>
          {view === "history" ? (
            <PmHistoryView
              scope={scope}
              hotelTimezone={hotelTimezone}
              language={language}
              refreshToken={historyToken}
              onOpen={(row) => router.push((pmRecordRoute(row.id, row.pm_schedule_id) ?? PM_LIST_ROUTE) as never)}
            />
          ) : load.status === "ready" && visible.length > 0 ? (
            view === "today" ? (
              <PmTodayView {...listProps} />
            ) : view === "week" ? (
              <PmWeekView {...listProps} today={data.today} />
            ) : (
              <PmCalendarView {...listProps} today={data.today} />
            )
          ) : null}

          <EngineeringState
            status={listState}
            onRetry={() => void data.reload()}
            emptyIcon="calendar-outline"
            emptyTitle={filtersActive ? t("pm.noMatches") : t("pmSchedules.noSchedules")}
            emptyBody={filtersActive ? t("pm.noMatchesBody") : t("pmSchedules.noSchedulesConfigured")}
            style={[styles.emptyCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
          />
        </View>
      </ScrollView>

      <PmFilterSheet
        visible={sheetOpen}
        filters={filters}
        categories={categories}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 10 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroCopy: { flex: 1, gap: 2 },
  heroTitle: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  heroSub: { fontSize: 13 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 9, right: 9, width: 9, height: 9, borderRadius: 5 },
  search: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  metrics: { marginTop: -14 },
  segmented: { flexDirection: "row", marginHorizontal: 16, marginTop: 14, borderRadius: 12, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  segmentLabel: { fontSize: 13, fontWeight: "700" },
  activeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 10 },
  activeText: { fontSize: 13, flex: 1 },
  resetButton: { minHeight: 44, justifyContent: "center", paddingLeft: 12 },
  resetText: { fontSize: 14, fontWeight: "700" },
  pad: { paddingHorizontal: 16, paddingTop: 12 },
  offline: { fontSize: 13, paddingHorizontal: 16, paddingTop: 10 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 8 },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8, borderWidth: 1 },
});
