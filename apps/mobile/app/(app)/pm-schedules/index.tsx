import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";

type PMSchedule = {
  id: string;
  asset_name: string;
  location: string;
  task_name: string;
  frequency: string;
  next_due: string;
  last_completed: string | null;
  status: "due" | "upcoming" | "overdue" | "completed";
};

function dueTone(status: PMSchedule["status"]): "alert" | "caution" | "ready" | "info" {
  if (status === "overdue") return "alert";
  if (status === "due") return "caution";
  if (status === "completed") return "ready";
  return "info";
}

const TONE_COLORS = {
  alert: { fg: C.alert, bg: C.alertSoft },
  caution: { fg: C.caution, bg: C.cautionSoft },
  ready: { fg: C.ready, bg: C.readySoft },
  info: { fg: C.info, bg: C.infoSoft },
} as const;

function useDueLabel() {
  const { t } = useTranslation();
  return (status: PMSchedule["status"]): string => {
    if (status === "overdue") return t("pmSchedules.overdue");
    if (status === "due") return t("pmSchedules.dueToday");
    if (status === "completed") return t("pmSchedules.done");
    return t("pmSchedules.upcoming");
  };
}

export default function PMSchedulesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const dueLabel = useDueLabel();
  const { isOnline } = useAppStore();
  const [schedules, setSchedules] = useState<PMSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "due" | "overdue">("all");

  const loadSchedules = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: PMSchedule[] }>("/engineering/pm-schedules");
      setSchedules(res.data ?? []);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSchedules();
    setRefreshing(false);
  }, [loadSchedules]);

  const filtered = filter === "all"
    ? schedules
    : schedules.filter((s) => s.status === filter);

  const overdueCount = schedules.filter((s) => s.status === "overdue").length;
  const dueCount = schedules.filter((s) => s.status === "due").length;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={styles.topBleed} />
        <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <Text style={styles.heroKicker}>{t("pmSchedules.kicker")}</Text>
          <Text style={styles.heroTitle}>{t("pmSchedules.title")}</Text>
          <View style={styles.stats}>
            {overdueCount > 0 ? (
              <View style={[styles.statChip, { backgroundColor: C.alertSoft, borderColor: C.alertLine }]}>
                <Text style={[styles.statNum, { color: C.alert }]}>{overdueCount}</Text>
                <Text style={[styles.statLabel, { color: C.alert }]}>{t("pmSchedules.overdue")}</Text>
              </View>
            ) : null}
            {dueCount > 0 ? (
              <View style={[styles.statChip, { backgroundColor: C.cautionSoft, borderColor: C.cautionLine }]}>
                <Text style={[styles.statNum, { color: C.caution }]}>{dueCount}</Text>
                <Text style={[styles.statLabel, { color: C.caution }]}>{t("pmSchedules.dueToday")}</Text>
              </View>
            ) : null}
            <View style={styles.statChip}>
              <Text style={styles.statNum}>{schedules.length}</Text>
              <Text style={styles.statLabel}>{t("pmSchedules.total")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.segmented}>
          {(["all", "due", "overdue"] as const).map((f) => {
            const isActive = filter === f;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.segment, isActive && styles.segmentActive]}
                onPress={() => setFilter(f)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
                  {f === "all" ? t("pmSchedules.all") : f === "due" ? t("pmSchedules.due") : t("pmSchedules.overdue")}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.body}>
        <SectionLabel hint={`${filtered.length} ${t("pmSchedules.schedules")}`}>
          {filter === "all" ? t("pmSchedules.allTasks") : filter === "due" ? t("pmSchedules.dueToday") : t("pmSchedules.overdue")}
        </SectionLabel>

        {filtered.map((schedule) => {
          const tone = TONE_COLORS[dueTone(schedule.status)];
          return (
            <View key={schedule.id} style={styles.card}>
              <View style={[styles.rail, { backgroundColor: tone.fg }]} />
              <View style={styles.cardTop}>
                <View style={[styles.cardTile, { backgroundColor: tone.bg }]}>
                  <Ionicons name="calendar-outline" size={16} color={tone.fg} />
                </View>
                <View style={styles.cardLeft}>
                  <Text style={styles.assetName}>{schedule.asset_name}</Text>
                  <Text style={styles.location}>{schedule.location}</Text>
                </View>
                <Pill tone={dueTone(schedule.status)}>{dueLabel(schedule.status)}</Pill>
              </View>
              <Text style={styles.taskName}>{schedule.task_name}</Text>
              <View style={styles.cardMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="refresh-outline" size={12} color={C.ink4} />
                  <Text style={styles.metaText}>{schedule.frequency}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="calendar-outline" size={12} color={C.ink4} />
                  <Text style={styles.metaText}>{t("pmSchedules.due")} {schedule.next_due}</Text>
                </View>
                {schedule.last_completed ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="checkmark-circle-outline" size={12} color={C.ready} />
                    <Text style={[styles.metaText, { color: C.ready }]}>{t("pmSchedules.done")}: {schedule.last_completed}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}

        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("pmSchedules.noSchedules")}</Text>
            <Text style={styles.emptyText}>
              {filter === "all" ? t("pmSchedules.noSchedulesConfigured") : t("pmSchedules.noItemsFound", { filter })}
            </Text>
          </View>
        ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    gap: 4,
  },
  heroKicker: { color: shellTokens.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600" },
  stats: { flexDirection: "row", gap: 8, marginTop: 10 },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
  },
  statNum: { fontSize: 14, fontWeight: "700", color: C.ink },
  statLabel: { fontSize: 11, color: C.ink3 },
  segmented: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: C.surface3,
    borderRadius: R.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: R.md - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: C.ink,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { color: C.ink3, fontSize: 12.5, fontWeight: "700" },
  segmentLabelActive: { color: C.ink },
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  body: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  card: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 16,
    gap: 6,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardLeft: { flex: 1 },
  assetName: { fontSize: 14, fontWeight: "700", color: C.ink },
  location: { fontSize: 11, color: C.ink3 },
  taskName: { fontSize: 13, color: C.ink2 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, color: C.ink4, fontFamily: monoFont },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3, textAlign: "center" },
});
