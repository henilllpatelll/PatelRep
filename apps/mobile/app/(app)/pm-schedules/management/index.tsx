import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { EngineeringSegmented } from "@/components/engineering/EngineeringSegmented";
import { ManagementHeader, SectionTitle } from "@/components/engineering/pm/management/ManagementChrome";
import { DeferralReviewSheet } from "@/components/engineering/pm/management/DeferralReviewSheet";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { getPmSummary, getPmWorkload, listPmDeferralRequests, type PmDeferralRequest } from "@/lib/api/pmManagement";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { coverageHealth, sortWorkload } from "@/lib/engineering/pmManagement";
import { useManagementResource } from "@/lib/engineering/useManagementResource";
import { canManagePmSchedules } from "@/lib/engineering/roles";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

const PROGRAMS = "/(app)/pm-schedules/management/programs";
const APPROVALS = "/(app)/pm-schedules/management/approvals";
const PERFORMANCE = "/(app)/pm-schedules/management/performance";

export default function PmManagementScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const timezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const allowed = canManagePmSchedules(role);

  const [period, setPeriod] = useState<"today" | "week">("today");
  const [reviewing, setReviewing] = useState<PmDeferralRequest | null>(null);
  const summary = useManagementResource(getPmSummary, [], allowed);
  const workload = useManagementResource(() => getPmWorkload(period), [period], allowed);
  const pending = useManagementResource(() => listPmDeferralRequests("pending"), [], allowed);

  const refreshAll = useCallback(async () => {
    await Promise.all([summary.reload(), workload.reload(), pending.reload()]);
  }, [summary, workload, pending]);

  // Tabs stay mounted: coming back from Programs / Approvals re-reads the counts so they reflect what was just done.
  const focused = useRef(false);
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void refreshRef.current();
      focused.current = true;
    }, []),
  );

  const cards = summary.data;
  const health = coverageHealth(cards);
  const load = resolveLoadState({
    loading: summary.loading && !cards,
    failure: allowed ? summary.failure : "forbidden",
    count: cards ? 1 : 0,
    offline: !isOnline && !cards,
  });
  const team = useMemo(() => sortWorkload(workload.data?.cards ?? []), [workload.data]);
  const go = (path: string, params?: Record<string, string>) => router.push({ pathname: path, params } as never);

  const tiles: Array<{ key: string; label: string; value: number | null; tone: string; soft: string; onPress: () => void }> = [
    { key: "overdue", label: t("pmMgmt.cards.overdue"), value: cards?.overdue ?? null, tone: theme.status.dirty, soft: theme.status.dirtySoft, onPress: () => go(PROGRAMS, { filter: "overdue" }) },
    { key: "unassigned", label: t("pmMgmt.cards.unassigned"), value: cards?.unassigned ?? null, tone: theme.status.pickup, soft: theme.status.pickupSoft, onPress: () => go(PROGRAMS, { filter: "unassigned" }) },
    { key: "approvals", label: t("pmMgmt.cards.approvals"), value: cards?.pending_approvals ?? null, tone: theme.status.inProgress, soft: theme.status.inProgressSoft, onPress: () => go(APPROVALS) },
    { key: "week", label: t("pmMgmt.cards.dueThisWeek"), value: cards?.due_this_week ?? null, tone: theme.status.clean, soft: theme.status.cleanSoft, onPress: () => go(PROGRAMS) },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ManagementHeader title={t("pmMgmt.title")} subtitle={t("pmMgmt.subtitle")} testID="pm-mgmt" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refreshAll()} tintColor={theme.primaryAction} />}
      >
        {load.status !== "ready" ? (
          <EngineeringState status={load.status} onRetry={() => void refreshAll()} emptyTitle={t("pmMgmt.empty")} />
        ) : (
          <>
            <View style={styles.grid}>
              {tiles.map((tile) => (
                <Pressable
                  key={tile.key}
                  onPress={tile.onPress}
                  style={[styles.tile, { backgroundColor: tile.soft, borderColor: theme.borderSubtle }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${tile.label}: ${tile.value ?? t("pm.unknownCount")}`}
                  testID={`pm-mgmt-card-${tile.key}`}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileValue, { color: tile.tone }]}>
                    {tile.value ?? "–"}
                  </Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tileLabel, { color: tile.tone }]} numberOfLines={2}>
                    {tile.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {health === "ok" ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="pm-mgmt-all-clear">
                {t("pmMgmt.allClear")}
              </Text>
            ) : null}

            <SectionTitle action={{ label: t("pmMgmt.seeAll"), onPress: () => go(APPROVALS), testID: "pm-mgmt-approvals-all" }}>{t("pmMgmt.sections.attention")}</SectionTitle>
            {pending.failure && !pending.data ? (
              <EngineeringState status="error" onRetry={() => void pending.reload()} emptyTitle="" />
            ) : (pending.data ?? []).length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="pm-mgmt-no-pending">
                {pending.data ? t("pmMgmt.noPending") : t("pmMgmt.loading")}
              </Text>
            ) : (
              (pending.data ?? []).slice(0, 3).map((request) => (
                <Pressable key={request.id} onPress={() => setReviewing(request)} accessibilityRole="button" testID={`pm-mgmt-pending-${request.id}`}>
                  <Card style={styles.rowCard}>
                    <Ionicons name="time-outline" size={20} color={theme.status.inProgress} />
                    <View style={styles.rowCopy}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                        {request.schedule_name}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} numberOfLines={2}>
                        {t("pmMgmt.pendingLine", {
                          name: request.requested_by_name ?? t("pmMgmt.assign.unknownPerson"),
                          date: formatDayYear(request.requested_due_at, timezone, i18n.language) ?? "",
                        })}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </Card>
                </Pressable>
              ))
            )}

            <SectionTitle>{t("pmMgmt.sections.workload")}</SectionTitle>
            <EngineeringSegmented
              options={[
                { key: "today", label: t("pmMgmt.period.today"), testID: "pm-mgmt-period-today" },
                { key: "week", label: t("pmMgmt.period.week"), testID: "pm-mgmt-period-week" },
              ]}
              value={period}
              onChange={setPeriod}
              accessibilityLabel={t("pmMgmt.sections.workload")}
              compact
            />
            {workload.failure && !workload.data ? (
              <EngineeringState status="error" onRetry={() => void workload.reload()} emptyTitle="" />
            ) : !workload.data ? (
              <Text style={{ color: theme.textMuted }}>{t("pmMgmt.loading")}</Text>
            ) : team.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>{t("pmMgmt.workload.none")}</Text>
            ) : (
              team.map((tech) => (
                <Pressable key={tech.id} onPress={() => go(PROGRAMS, { assignee: tech.id, assigneeName: tech.name ?? "" })} accessibilityRole="button" testID={`pm-mgmt-tech-${tech.id}`}
                  accessibilityLabel={t("pmMgmt.workload.a11y", { name: tech.name ?? t("pmMgmt.assign.unknownPerson"), assigned: tech.assigned, overdue: tech.overdue, completed: tech.completed })}>
                  <Card style={styles.techCard}>
                    <View style={styles.rowCopy}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                        {tech.name ?? t("pmMgmt.assign.unknownPerson")}
                      </Text>
                      {tech.ineligible ? (
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.status.dirty }]}>{t("pmMgmt.workload.ineligible")}</Text>
                      ) : null}
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]} numberOfLines={2}>
                        {t("pmMgmt.workload.line", { assigned: tech.assigned, today: tech.due_today, overdue: tech.overdue, completed: tech.completed })}
                      </Text>
                      {tech.next_due_at ? (
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>
                          {t("pmMgmt.workload.next", { date: formatDayYear(tech.next_due_at, timezone, i18n.language) ?? "" })}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </Card>
                </Pressable>
              ))
            )}
            {workload.data && workload.data.unassignedSchedules > 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="pm-mgmt-unassigned-note">
                {t("pmMgmt.workload.unassigned", { count: workload.data.unassignedSchedules })}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>{t("pmMgmt.workload.disclaimer")}</Text>

            <SectionTitle>{t("pmMgmt.sections.programs")}</SectionTitle>
            <Pressable onPress={() => go(PROGRAMS)} accessibilityRole="button" testID="pm-mgmt-open-programs">
              <Card style={styles.rowCard}>
                <Ionicons name="list-outline" size={20} color={theme.textSecondary} />
                <View style={styles.rowCopy}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>{t("pmMgmt.programs.title")}</Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]}>
                    {cards ? t("pmMgmt.programs.count", { count: cards.active_schedules }) : t("pmMgmt.programs.subtitle")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
              </Card>
            </Pressable>
            <Pressable onPress={() => go(PERFORMANCE)} accessibilityRole="button" testID="pm-mgmt-open-performance">
              <Card style={styles.rowCard}>
                <Ionicons name="stats-chart-outline" size={20} color={theme.textSecondary} />
                <View style={styles.rowCopy}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>{t("pmMgmt.performance.title")}</Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textSecondary }]}>{t("pmMgmt.performance.subtitle")}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
              </Card>
            </Pressable>
          </>
        )}
      </ScrollView>

      <DeferralReviewSheet
        visible={reviewing != null}
        request={reviewing}
        role={role}
        userId={user?.id}
        timezone={timezone}
        language={i18n.language}
        isOnline={isOnline}
        onClose={() => setReviewing(null)}
        onDecided={(decision) => {
          toast.success(t(decision === "approved" ? "pmMgmt.review.approvedToast" : "pmMgmt.review.rejectedToast"));
          void refreshAll();
        }}
        onNeedsRefresh={() => void refreshAll()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "47%", minHeight: 76, borderRadius: 14, borderWidth: 1, padding: 12, justifyContent: "center", gap: 2 },
  tileValue: { fontSize: 28, fontWeight: "700" },
  tileLabel: { fontSize: 13, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 18 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 56 },
  techCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "700" },
  rowSub: { fontSize: 13, lineHeight: 18 },
});
