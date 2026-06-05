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
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont } from "@/components/shared/tokens";
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
      <View style={styles.header}>
        <Text style={styles.title}>{t("pmSchedules.title")}</Text>
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
        <View style={styles.filters}>
          {(["all", "due", "overdue"] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterLabel, filter === f && styles.filterLabelActive]}>
                {f === "all" ? t("pmSchedules.all") : f === "due" ? t("pmSchedules.due") : t("pmSchedules.overdue")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <SectionLabel hint={`${filtered.length} ${t("pmSchedules.schedules")}`}>
          {filter === "all" ? t("pmSchedules.allTasks") : filter === "due" ? t("pmSchedules.dueToday") : t("pmSchedules.overdue")}
        </SectionLabel>

        {filtered.map((schedule) => (
          <View key={schedule.id} style={styles.card}>
            <View style={styles.cardTop}>
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
        ))}

        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("pmSchedules.noSchedules")}</Text>
            <Text style={styles.emptyText}>
              {filter === "all" ? t("pmSchedules.noSchedulesConfigured") : t("pmSchedules.noItemsFound", { filter })}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    backgroundColor: C.paper,
    gap: 10,
  },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  stats: { flexDirection: "row", gap: 8 },
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
  filters: { flexDirection: "row", gap: 6 },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  filterBtnActive: { backgroundColor: C.ink, borderColor: C.ink },
  filterLabel: { fontSize: 12, fontWeight: "600", color: C.ink3 },
  filterLabelActive: { color: C.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 14,
    gap: 6,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
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
