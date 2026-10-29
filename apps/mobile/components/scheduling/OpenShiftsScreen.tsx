import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { PostOpenShiftSheet, WaiveGapSheet } from "@/components/scheduling/CoverageActionSheets";
import { ScheduleBanner, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { CoverageGap } from "@/lib/api/schedulingCoverage";
import { gapStatusLabel, gapTitle, gapWindow, requiredRoleText } from "@/lib/scheduling/coverageText";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import { emitCoverageChanged, onCoverageChanged } from "@/lib/scheduling/coverageSignal";
import { useCoverageGaps } from "@/lib/scheduling/useCoverageGaps";
import { useTemplates } from "@/lib/scheduling/useTemplates";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

type Filter = "all" | "callouts" | "open";
const FILTERS: readonly Filter[] = ["all", "callouts", "open"];

/* ─── Open Shifts ───────────────────────────────────────────────────────────
   Every shift that still needs a person: shifts opened by a call-out and shifts posted as open. Read from the server;
   an empty list means "nothing to cover" only when the read succeeded — a failed read says so instead. Reached from the
   Team Schedule (not a tab). */

export function OpenShiftsScreen({ initialDate }: { initialDate: string | null }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const language = i18n.language;
  const { today, zone } = useHotelToday();
  const coverage = useCoverageGaps(isOnline);
  const templates = useTemplates({ enabled: true });
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [waiving, setWaiving] = useState<CoverageGap | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Coming back from Find Coverage: re-read, so a shift someone just filled does not linger.
  const reloadCoverage = coverage.refresh;
  useEffect(() => onCoverageChanged(() => void reloadCoverage()), [reloadCoverage]);

  const rows = useMemo(
    () => coverage.todo.filter((gap) => filter === "all" || (filter === "callouts" ? gap.source === "absence" : gap.source === "open_shift")),
    [coverage.todo, filter],
  );

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/team-schedule" as never);
  }, []);
  const find = useCallback((gap: CoverageGap) => router.push({ pathname: "/(app)/team-schedule/coverage", params: { gapId: gap.id } } as never), []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await coverage.refresh();
    setRefreshing(false);
  }, [coverage]);

  const header = (
    <View style={styles.header}>
      {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("teamSchedule.coverage.offlineReadOnly")} testID="open-shifts-offline" /> : null}
      {coverage.status === "stale" ? <ScheduleBanner icon="time-outline" text={t("teamSchedule.coverage.staleList")} testID="open-shifts-stale" /> : null}
      {notice ? <SheetNotice text={notice} testID="open-shifts-notice" /> : null}
      <Button label={t("teamSchedule.coverage.post.open")} icon="add" onPress={() => setPosting(true)} disabled={!isOnline} testID="open-shifts-post" />
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((option) => {
          const selected = option === filter;
          return (
            <Pressable key={option} onPress={() => setFilter(option)} accessibilityRole="tab" accessibilityState={{ selected }} testID={`open-shifts-filter-${option}`} style={[styles.filter, { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryLine : theme.borderSubtle }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.filterText, { color: theme.textPrimary }]}>
                {t(`teamSchedule.coverage.openFilter.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="open-shifts">
      <View style={[styles.bar, { paddingTop: insets.top + 8, borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="open-shifts-back" style={styles.backHit}>
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.barTitle, { color: theme.textPrimary }]}>
          {t("teamSchedule.coverage.openShiftsTitle")}
        </Text>
      </View>
      {coverage.status === "loading" && !isOnline ? (
        <View style={styles.center} testID="open-shifts-offline-empty">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
            {t("teamSchedule.coverage.offlineReadOnly")}
          </Text>
        </View>
      ) : coverage.status === "loading" ? (
        <ScheduleSkeleton />
      ) : coverage.status === "failed" ? (
        <View style={styles.center} testID="open-shifts-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
            {t("teamSchedule.coverage.listFailed")}
          </Text>
          <Button label={t("common.retry")} onPress={() => void coverage.refresh()} testID="open-shifts-retry" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(gap) => gap.id}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, styles.empty, { color: theme.textMuted }]} testID="open-shifts-empty">
              {t("teamSchedule.coverage.noOpenShifts")}
            </Text>
          }
          renderItem={({ item }) => (
            <GapCard gap={item} zone={zone} language={language} isOnline={isOnline} onFind={() => find(item)} onCancel={() => setWaiving(item)} t={t} />
          )}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          testID="open-shifts-list"
        />
      )}
      <PostOpenShiftSheet
        visible={posting}
        templates={templates.state.templates}
        templatesFailed={templates.state.status === "failed"}
        initialDate={initialDate ?? today}
        today={today}
        isOnline={isOnline}
        language={language}
        onPosted={(gap) => {
          setPosting(false);
          setNotice(t("teamSchedule.coverage.post.posted", { date: formatLongDate(gap.workDate, language) }));
          emitCoverageChanged();
        }}
        onClose={() => setPosting(false)}
        t={t}
      />
      <WaiveGapSheet
        gap={waiving}
        isOnline={isOnline}
        onClose={() => setWaiving(null)}
        onResult={(next) => {
          setWaiving(null);
          if (next) setNotice(t("teamSchedule.coverage.waived"));
          emitCoverageChanged();
        }}
        t={t}
      />
    </View>
  );
}

function GapCard({ gap, zone, language, isOnline, onFind, onCancel, t }: { gap: CoverageGap; zone: string | null; language?: string; isOnline: boolean; onFind: () => void; onCancel: () => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  const theme = useTheme();
  const claims = gap.pendingClaims;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={`open-shift-${gap.id}`}>
      <View style={styles.titleRow}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {gapTitle(gap, t)}
        </Text>
        <View style={[styles.chip, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
            {gapStatusLabel(gap, t)}
          </Text>
        </View>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {formatLongDate(gap.workDate, language)} · {gapWindow(gap, zone, language, t)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("teamSchedule.coverage.requiredRole", { role: requiredRoleText(gap.requiredRole, t) })}
      </Text>
      {gap.absentUserName ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("teamSchedule.coverage.callOutBy", { name: gap.absentUserName, kind: gap.absenceKind ? t(`teamSchedule.coverage.kind.${gap.absenceKind}`) : "" })}
        </Text>
      ) : null}
      {gap.pendingOffers > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("teamSchedule.coverage.offersCount", { count: gap.pendingOffers })}
        </Text>
      ) : null}
      <View style={styles.row}>
        <View style={styles.cell}>
          <Button label={t(claims > 0 ? "teamSchedule.coverage.action.reviewClaims" : "teamSchedule.coverage.action.findCoverage")} size="sm" onPress={onFind} testID={`open-shift-find-${gap.id}`} />
        </View>
        <View style={styles.cell}>
          <Button label={t(gap.source === "open_shift" ? "teamSchedule.coverage.action.cancelOpen" : "teamSchedule.coverage.action.waive")} size="sm" variant="secondary" disabled={!isOnline} onPress={onCancel} testID={`open-shift-cancel-${gap.id}`} />
        </View>
      </View>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  backHit: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  barTitle: { flex: 1, fontSize: 20, fontWeight: "800" },
  list: { paddingHorizontal: 16, paddingTop: 12 },
  header: { gap: 12, paddingBottom: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { minHeight: MIN_TARGET - 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, justifyContent: "center" },
  filterText: { fontSize: 14, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "800" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12.5, fontWeight: "800" },
  body: { fontSize: 14.5, lineHeight: 20 },
  hint: { fontSize: 13.5, lineHeight: 19 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  cell: { flex: 1 },
  separator: { height: 10 },
  empty: { textAlign: "center", paddingVertical: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
});
