import { useCallback, useEffect, useState } from "react";
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
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { monoFont } from "@/components/shared/tokens";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

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

function dueStatusKey(status: PMSchedule["status"]): StatusKey {
  if (status === "overdue") return "overdue";
  if (status === "due") return "pickup";
  if (status === "completed") return "completed";
  return "clean";
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
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const dueLabel = useDueLabel();
  const { isOnline } = useAppStore();
  const [schedules, setSchedules] = useState<PMSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "due" | "overdue">("all");
  const [completing, setCompleting] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: PMSchedule[] }>("/assets/pm-schedules");
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

  const handleComplete = useCallback(async (scheduleId: string) => {
    if (completing) return;
    setCompleting(scheduleId);
    try {
      await api.post(`/assets/pm-schedules/${scheduleId}/complete`, {});
      await loadSchedules();
    } catch {
      toast.error(t("pmSchedules.completeError"));
    } finally {
      setCompleting(null);
    }
  }, [completing, loadSchedules, t, toast]);

  const filtered = filter === "all"
    ? schedules
    : schedules.filter((s) => s.status === filter);

  const overdueCount = schedules.filter((s) => s.status === "overdue").length;
  const dueCount = schedules.filter((s) => s.status === "due").length;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

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
          <View style={styles.stats}>
            {overdueCount > 0 ? (
              <View style={[styles.statChip, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
                <Text style={[styles.statNum, { color: theme.status.dirty }]}>{overdueCount}</Text>
                <Text style={[styles.statLabel, { color: theme.status.dirty }]}>{t("pmSchedules.overdue")}</Text>
              </View>
            ) : null}
            {dueCount > 0 ? (
              <View style={[styles.statChip, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}>
                <Text style={[styles.statNum, { color: theme.status.pickup }]}>{dueCount}</Text>
                <Text style={[styles.statLabel, { color: theme.status.pickup }]}>{t("pmSchedules.dueToday")}</Text>
              </View>
            ) : null}
            <View style={[styles.statChip, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
              <Text style={[styles.statNum, { color: theme.shell.ink }]}>{schedules.length}</Text>
              <Text style={[styles.statLabel, { color: theme.shell.ink2 }]}>{t("pmSchedules.total")}</Text>
            </View>
          </View>
        </View>

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
        <View style={styles.body}>
        <SectionLabel hint={`${filtered.length} ${t("pmSchedules.schedules")}`}>
          {filter === "all" ? t("pmSchedules.allTasks") : filter === "due" ? t("pmSchedules.dueToday") : t("pmSchedules.overdue")}
        </SectionLabel>

        {filtered.map((schedule) => {
          const tone = {
            overdue: { fg: theme.status.dirty, bg: theme.status.dirtySoft },
            due: { fg: theme.status.pickup, bg: theme.status.pickupSoft },
            completed: { fg: theme.status.ready, bg: theme.status.readySoft },
            upcoming: { fg: theme.status.clean, bg: theme.status.cleanSoft },
          }[schedule.status];
          return (
            <Card key={schedule.id} style={styles.card}>
              <View style={[styles.rail, { backgroundColor: tone.fg }]} />
              <View style={styles.cardTop}>
                <View style={[styles.cardTile, { backgroundColor: tone.bg }]}>
                  <Ionicons name="calendar-outline" size={16} color={tone.fg} />
                </View>
                <View style={styles.cardLeft}>
                  <Text style={[styles.assetName, { color: theme.textPrimary }]}>{schedule.asset_name}</Text>
                  <Text style={[styles.location, { color: theme.textMuted }]}>{schedule.location}</Text>
                </View>
                <StatusBadge statusKey={dueStatusKey(schedule.status)} label={dueLabel(schedule.status)} />
              </View>
              <Text style={[styles.taskName, { color: theme.textSecondary }]}>{schedule.task_name}</Text>
              <View style={styles.cardMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="refresh-outline" size={12} color={theme.textDisabled} />
                  <Text style={[styles.metaText, { color: theme.textDisabled }]}>{schedule.frequency}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="calendar-outline" size={12} color={theme.textDisabled} />
                  <Text style={[styles.metaText, { color: theme.textDisabled }]}>
                    {t("pmSchedules.due")} {schedule.next_due}
                  </Text>
                </View>
                {schedule.last_completed ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="checkmark-circle-outline" size={12} color={theme.status.ready} />
                    <Text style={[styles.metaText, { color: theme.status.ready }]}>
                      {t("pmSchedules.done")}: {schedule.last_completed}
                    </Text>
                  </View>
                ) : null}
              </View>
              {schedule.status !== "completed" ? (
                <Button
                  label={t("pmSchedules.logComplete")}
                  onPress={() => void handleComplete(schedule.id)}
                  disabled={completing !== null}
                  loading={completing === schedule.id}
                  variant="secondary"
                  size="sm"
                  icon="checkmark-circle-outline"
                  style={[
                    styles.completeBtn,
                    { backgroundColor: theme.status.readySoft, borderColor: theme.status.readyLine },
                  ]}
                />
              ) : null}
            </Card>
          );
        })}

        {filtered.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="calendar-outline"
            emptyTitle={t("pmSchedules.noSchedules")}
            emptyBody={filter === "all" ? t("pmSchedules.noSchedulesConfigured") : t("pmSchedules.noItemsFound", { filter })}
            style={[styles.emptyCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
          />
        ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  completeBtn: {
    marginTop: 4,
  },
});
