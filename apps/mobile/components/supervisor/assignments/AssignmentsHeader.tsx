import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { statusText } from "@/components/supervisor/board/BoardHeader";
import type { HeaderMetrics } from "@/lib/housekeeping/assignmentRoomsView";
import type { TeamHeaderMetrics } from "@/lib/housekeeping/assignmentTeamView";
import type { BoardStatusLine } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type AssignmentsTab = "rooms" | "team";

interface Props {
  status: BoardStatusLine;
  /** Already-formatted hotel clock for the last verified answer, or null when none exists. */
  verifiedClock: string | null;
  refreshing: boolean;
  topInset: number;
  /** "Thursday, October 22" for the hotel's operational date; null while the board is unknown. */
  dateLabel: string | null;
  metrics: HeaderMetrics;
  /** The Team tab's three counts (shown instead of `metrics` while the Team tab is selected). */
  teamMetrics: TeamHeaderMetrics;
  tab: AssignmentsTab;
  onTab: (tab: AssignmentsTab) => void;
  onRefresh: () => void;
  /** Opens the blocked-rooms view; null hides the note. */
  onShowBlocked: (() => void) | null;
  t: Translate;
}

/** Compact operational header: title, an honest freshness pill, the date, three metrics and the Rooms/Team switch. */
export function AssignmentsHeader({ status, verifiedClock, refreshing, topInset, dateLabel, metrics, teamMetrics, tab, onTab, onRefresh, onShowBlocked, t }: Props) {
  const theme = useTheme();
  const live = status.kind === "live";
  const busy = status.kind === "updating" || status.kind === "loading";
  const tone = live ? theme.status.ready : busy ? theme.primaryAction : theme.status.pickup;
  const icon = live ? "radio-button-on" : busy ? "sync" : status.kind === "offline" ? "cloud-offline-outline" : "alert-circle-outline";
  const detail = statusText(status, verifiedClock, t);

  return (
    <View style={[styles.wrap, { paddingTop: topInset + 10 }]} testID="assignments-header">
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]} numberOfLines={1}>
            {t("assignments.v2.header.kicker").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
            {t("assignments.title")}
          </Text>
        </View>
        <View
          style={[styles.pill, { borderColor: tone, backgroundColor: theme.surface }]}
          accessible
          accessibilityLabel={detail}
          accessibilityLiveRegion="polite"
          testID="assignments-status"
        >
          <Ionicons name={icon} size={12} color={tone} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: tone }]} numberOfLines={1} testID="assignments-status-pill">
            {t(`assignments.v2.status.${status.kind}`)}
          </Text>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          testID="assignments-refresh"
          accessibilityRole="button"
          accessibilityLabel={t("assignments.v2.header.refresh")}
          accessibilityState={{ disabled: refreshing, busy: refreshing }}
          style={({ pressed }) => [styles.refresh, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }, pressed && { opacity: 0.7 }]}
        >
          {refreshing ? <ActivityIndicator size="small" color={theme.primaryAction} /> : <Ionicons name="refresh" size={20} color={theme.textPrimary} />}
        </Pressable>
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textSecondary }]} numberOfLines={2} testID="assignments-date">
        {dateLabel ? t("assignments.v2.header.today", { date: dateLabel }) : t("assignments.v2.header.todayUnknown")}
      </Text>
      {!live ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusDetail, { color: tone }]} testID="assignments-status-text">
          {detail}
        </Text>
      ) : null}

      {tab === "rooms" ? (
        <View style={styles.metrics} testID="assignments-metrics">
          <Metric testID="assignments-metric-unassigned" value={metrics.unassigned} label={t("assignments.v2.metric.unassigned")} unknown={t("assignments.v2.metric.unknown")} tone={metrics.unassigned ? theme.status.dirty : theme.textPrimary} />
          <Metric testID="assignments-metric-onShift" value={metrics.onShift} label={t("assignments.v2.metric.onShift")} unknown={t("assignments.v2.metric.unknown")} tone={theme.textPrimary} />
          <Metric testID="assignments-metric-urgent" value={metrics.urgent} label={t("assignments.v2.metric.urgent")} unknown={t("assignments.v2.metric.unknown")} tone={metrics.urgent ? theme.status.pickup : theme.textPrimary} />
        </View>
      ) : (
        <View style={styles.metrics} testID="assignments-team-metrics">
          <Metric testID="assignments-team-metric-onShift" value={teamMetrics.onShift} label={t("assignments.v2.metric.onShift")} unknown={t("assignments.v2.metric.unknown")} tone={theme.textPrimary} />
          <Metric testID="assignments-team-metric-onBreak" value={teamMetrics.onBreak} label={t("assignments.v2.metric.onBreak")} unknown={t("assignments.v2.metric.unknown")} tone={theme.textPrimary} />
          <Metric
            testID="assignments-team-metric-needReview"
            value={teamMetrics.needReview}
            atLeast={teamMetrics.needReviewAtLeast}
            atLeastLabel={t("assignments.v2.metric.atLeast")}
            label={t("assignments.v2.metric.needReview")}
            unknown={t("assignments.v2.metric.unknown")}
            tone={teamMetrics.needReview ? theme.status.dirty : theme.textPrimary}
          />
        </View>
      )}

      {tab === "rooms" && onShowBlocked && metrics.blocked ? (
        <Pressable
          onPress={onShowBlocked}
          accessibilityRole="button"
          accessibilityLabel={t("assignments.v2.metric.blockedNote", { count: metrics.blocked })}
          testID="assignments-blocked-note"
          style={({ pressed }) => [styles.blocked, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="alert-circle-outline" size={15} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockedText, { color: theme.textSecondary }]}>
            {t("assignments.v2.metric.blockedNote", { count: metrics.blocked })}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
        </Pressable>
      ) : null}

      <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: theme.surfaceMuted }]} testID="assignments-tabs">
        {(["rooms", "team"] as const).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => onTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(`assignments.v2.tab.${key}`)}
              testID={`assignments-tab-${key}`}
              style={({ pressed }) => [styles.tab, active && { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tabText, { color: active ? theme.textPrimary : theme.textSecondary }]}>
                {t(`assignments.v2.tab.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Metric({
  value,
  label,
  unknown,
  tone,
  testID,
  atLeast = false,
  atLeastLabel,
}: {
  value: number | null;
  label: string;
  unknown: string;
  tone: string;
  testID: string;
  /** The figure is a lower bound ("at least N"): shown with a "+" and announced as such. */
  atLeast?: boolean;
  atLeastLabel?: string;
}) {
  const theme = useTheme();
  const known = value !== null;
  return (
    <View
      style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}
      accessible
      accessibilityLabel={`${label}: ${known ? (atLeast && atLeastLabel ? `${atLeastLabel} ${value}` : value) : unknown}`}
      testID={testID}
    >
      <Text maxFontSizeMultiplier={1.3} style={[styles.metricValue, { color: known ? tone : theme.textMuted }]} testID={`${testID}-value`}>
        {known ? (atLeast ? `${value}+` : value) : "—"}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.metricLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 6, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleText: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 28, lineHeight: 33, fontWeight: "700" },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 28 },
  pillText: { fontSize: 12, fontWeight: "800" },
  refresh: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  date: { fontSize: 14, fontWeight: "600" },
  statusDetail: { fontSize: 12.5, fontWeight: "600" },
  metrics: { flexDirection: "row", gap: 8, marginTop: 2 },
  metric: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 10, paddingVertical: 6, gap: 0 },
  metricValue: { fontSize: 22, lineHeight: 26, fontWeight: "800" },
  metricLabel: { fontSize: 12, fontWeight: "700" },
  blocked: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  blockedText: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  tabs: { flexDirection: "row", borderRadius: R.md, padding: 3, marginTop: 2 },
  tab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: R.md - 2, borderWidth: 1, borderColor: "transparent" },
  tabText: { fontSize: 14.5, fontWeight: "800" },
});
