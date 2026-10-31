import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listPmSchedules, type PmScheduleRow } from "@/lib/api/assets";
import { useAppStore } from "@/stores/appStore";
import { monoFont } from "@/components/shared/tokens";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { useTheme } from "@/lib/theme/useTheme";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import {
  adaptPmSchedules,
  countPmSchedules,
  filterPmSchedules,
  formatDueDate,
  type PmDueState,
  type PmFilter,
  type PmScheduleView,
} from "@/lib/engineering/pmSchedules";
import { canCompletePm } from "@/lib/engineering/roles";
import { classifyLoadFailure, resolveLoadState, type LoadFailure } from "@/lib/engineering/loadState";

const STATUS_KEY: Record<PmDueState, StatusKey> = {
  overdue: "overdue",
  due_today: "pickup",
  due_soon: "clean",
  upcoming: "clean",
  unscheduled: "low",
};

export default function PMSchedulesScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  useHotelTimezone();
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const isOnline = useAppStore((s) => s.isOnline);
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role);
  const [rows, setRows] = useState<PmScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [filter, setFilter] = useState<PmFilter>("all");
  const [now, setNow] = useState(() => new Date());

  const loadSchedules = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    try {
      setRows(await listPmSchedules());
      setFailure(null);
      setNow(new Date());
    } catch (err) {
      setFailure(classifyLoadFailure(err));
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSchedules();
    setRefreshing(false);
  }, [loadSchedules]);

  const schedules = useMemo(() => adaptPmSchedules(rows, hotelTimezone, now), [rows, hotelTimezone, now]);
  const counts = useMemo(() => countPmSchedules(schedules), [schedules]);
  const filtered = useMemo(() => filterPmSchedules(schedules, filter), [schedules, filter]);

  // Filtering down to nothing is an honest empty list; only a failed load is an error.
  const load = resolveLoadState({ loading, failure, count: schedules.length, offline: !isOnline });
  const listState = load.status === "ready" && filtered.length === 0 ? "empty" : load.status;

  const stateLabel = (state: PmDueState): string => {
    switch (state) {
      case "overdue": return t("pmSchedules.overdue");
      case "due_today": return t("pmSchedules.dueToday");
      case "due_soon": return t("pmSchedules.dueSoon");
      case "unscheduled": return t("pmSchedules.unscheduled");
      default: return t("pmSchedules.upcoming");
    }
  };
  const intervalLabel = (s: PmScheduleView): string | null => {
    if (s.intervalType === "custom" && s.intervalDays) return t("pmSchedules.everyDays", { count: s.intervalDays });
    return s.intervalType ? t(`pmSchedules.interval.${s.intervalType}`) : null;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>{t("pmSchedules.kicker")}</Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("pmSchedules.title")}</Text>
          {schedules.length > 0 ? (
            <View style={styles.stats}>
              {counts.overdue > 0 ? (
                <View style={[styles.statChip, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
                  <Text style={[styles.statNum, { color: theme.status.dirty }]}>{counts.overdue}</Text>
                  <Text style={[styles.statLabel, { color: theme.status.dirty }]}>{t("pmSchedules.overdue")}</Text>
                </View>
              ) : null}
              {counts.dueToday > 0 ? (
                <View style={[styles.statChip, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
                  <Text style={[styles.statNum, { color: theme.status.pickup }]}>{counts.dueToday}</Text>
                  <Text style={[styles.statLabel, { color: theme.status.pickup }]}>{t("pmSchedules.dueToday")}</Text>
                </View>
              ) : null}
              <View style={[styles.statChip, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
                <Text style={[styles.statNum, { color: theme.shell.ink }]}>{counts.total}</Text>
                <Text style={[styles.statLabel, { color: theme.shell.ink2 }]}>{t("pmSchedules.total")}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {load.stale ? (
          <View style={styles.banner}>
            <StaleBanner onRetry={() => void loadSchedules()} />
          </View>
        ) : null}

        {canCompletePm(role) && schedules.length > 0 ? (
          <View
            style={[styles.inspectionNote, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
            testID="pm-inspection-required"
          >
            <Ionicons name="clipboard-outline" size={18} color={theme.textMuted} />
            <View style={styles.inspectionCopy}>
              <Text style={[styles.inspectionTitle, { color: theme.textPrimary }]}>{t("pmSchedules.inspectionRequiredTitle")}</Text>
              <Text style={[styles.inspectionBody, { color: theme.textMuted }]}>{t("pmSchedules.inspectionRequiredBody")}</Text>
            </View>
          </View>
        ) : null}

        {schedules.length > 0 ? (
          <View style={styles.segmented}>
            {(["all", "due", "overdue"] as const).map((f) => {
              const isActive = filter === f;
              return (
                <Pressable
                  key={f}
                  style={({ pressed }) => [
                    styles.segment,
                    isActive && styles.segmentActive,
                    isActive && { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.textPrimary },
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => setFilter(f)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive, { color: isActive ? theme.textPrimary : theme.textMuted }]}>
                    {f === "all" ? t("pmSchedules.all") : f === "due" ? t("pmSchedules.due") : t("pmSchedules.overdue")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.body}>
          {schedules.length > 0 ? (
            <SectionLabel hint={`${filtered.length} ${t("pmSchedules.schedules")}`}>
              {filter === "all" ? t("pmSchedules.allTasks") : filter === "due" ? t("pmSchedules.dueToday") : t("pmSchedules.overdue")}
            </SectionLabel>
          ) : null}

          {filtered.map((schedule) => {
            const tone = {
              overdue: { fg: theme.status.dirty, bg: theme.status.dirtySoft },
              due_today: { fg: theme.status.pickup, bg: theme.status.pickupSoft },
              due_soon: { fg: theme.status.clean, bg: theme.status.cleanSoft },
              upcoming: { fg: theme.status.clean, bg: theme.status.cleanSoft },
              unscheduled: { fg: theme.textMuted, bg: theme.surfaceSubtle },
            }[schedule.state];
            const dueText = formatDueDate(schedule.dueDate, i18n.language);
            const lastText = formatDueDate(hotelDateKey(schedule.lastCompletedAt, hotelTimezone), i18n.language);
            const interval = intervalLabel(schedule);
            return (
              <Card key={schedule.id} style={styles.card}>
                <View style={[styles.rail, { backgroundColor: tone.fg }]} />
                <View style={styles.cardTop}>
                  <View style={[styles.cardTile, { backgroundColor: tone.bg }]}>
                    <Ionicons name="calendar-outline" size={16} color={tone.fg} />
                  </View>
                  <View style={styles.cardLeft}>
                    <Text style={[styles.assetName, { color: theme.textPrimary }]}>{schedule.name || t("pmSchedules.title")}</Text>
                    <Text style={[styles.location, { color: theme.textMuted }]}>{schedule.assetName ?? t("pmSchedules.unknownAsset")}</Text>
                  </View>
                  <StatusBadge statusKey={STATUS_KEY[schedule.state]} label={stateLabel(schedule.state)} />
                </View>
                {schedule.description ? (
                  <Text style={[styles.taskName, { color: theme.textSecondary }]}>{schedule.description}</Text>
                ) : null}
                <View style={styles.cardMeta}>
                  {interval ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="refresh-outline" size={12} color={theme.textDisabled} />
                      <Text style={[styles.metaText, { color: theme.textDisabled }]}>{interval}</Text>
                    </View>
                  ) : null}
                  {schedule.estimatedMinutes ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="time-outline" size={12} color={theme.textDisabled} />
                      <Text style={[styles.metaText, { color: theme.textDisabled }]}>{t("pmSchedules.minutes", { count: schedule.estimatedMinutes })}</Text>
                    </View>
                  ) : null}
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-outline" size={12} color={theme.textDisabled} />
                    <Text style={[styles.metaText, { color: schedule.state === "overdue" ? theme.status.dirty : theme.textDisabled }]}>
                      {schedule.state === "overdue" && schedule.daysUntilDue != null
                        ? t("pmSchedules.daysOverdue", { count: Math.abs(schedule.daysUntilDue) })
                        : dueText
                          ? t("pmSchedules.dueOn", { date: dueText })
                          : t("pmSchedules.unscheduled")}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="checkmark-circle-outline" size={12} color={lastText ? theme.status.ready : theme.textDisabled} />
                    <Text style={[styles.metaText, { color: lastText ? theme.status.ready : theme.textDisabled }]}>
                      {lastText ? t("pmSchedules.lastDone", { date: lastText }) : t("pmSchedules.never")}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })}

          <EngineeringState
            status={listState}
            onRetry={() => void loadSchedules()}
            emptyIcon="calendar-outline"
            emptyTitle={t("pmSchedules.noSchedules")}
            emptyBody={filter === "all" ? t("pmSchedules.noSchedulesConfigured") : t("pmSchedules.noItemsFound", { filter })}
            style={[styles.emptyCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    gap: 4,
  },
  heroKicker: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600" },
  stats: { flexDirection: "row", gap: 8, marginTop: 10 },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 12,
  },
  statNum: { fontSize: 14, fontWeight: "700" },
  statLabel: { fontSize: 11 },
  banner: { paddingHorizontal: 16, paddingTop: 12 },
  inspectionNote: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  inspectionCopy: { flex: 1, gap: 2 },
  inspectionTitle: { fontSize: 13, fontWeight: "700" },
  inspectionBody: { fontSize: 12, lineHeight: 17 },
  segmented: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    borderWidth: 1,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { fontSize: 12.5, fontWeight: "700" },
  segmentLabelActive: {},
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  body: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  card: {
    position: "relative",
    overflow: "hidden",
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 16,
    gap: 6,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardLeft: { flex: 1 },
  assetName: { fontSize: 14, fontWeight: "700" },
  location: { fontSize: 11 },
  taskName: { fontSize: 13 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, fontFamily: monoFont },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8, borderWidth: 1 },
});
