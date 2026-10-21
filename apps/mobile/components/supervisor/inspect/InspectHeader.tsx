import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { metricText, type Metric, type StatusLine, type Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

export interface HeaderMetrics {
  waiting: Metric;
  corrections: Metric;
  passed: Metric;
}

/**
 * The compact top of the Inspections screen: where we are, whether the numbers can be trusted right now, and three
 * counts. An unverified count shows "—", never 0.
 */
export function InspectHeader({
  status,
  metrics,
  refreshing,
  topInset,
  t,
  onRefresh,
}: {
  status: StatusLine;
  metrics: HeaderMetrics;
  refreshing: boolean;
  topInset: number;
  t: Translate;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const tone = status.tone === "live" ? theme.status.ready : status.tone === "busy" ? theme.primaryAction : theme.status.pickup;
  const icon = status.tone === "live" ? "radio-button-on" : status.tone === "busy" ? "sync" : "alert-circle-outline";
  const cells: { key: keyof HeaderMetrics; fg: string; bg: string; line: string }[] = [
    { key: "waiting", fg: theme.status.clean, bg: theme.status.cleanSoft, line: theme.status.cleanLine },
    { key: "corrections", fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine },
    { key: "passed", fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine },
  ];

  return (
    <View style={[styles.wrap, { paddingTop: topInset + 10 }]} testID="inspect-header">
      <View style={styles.titleRow}>
        <View style={styles.titleCol}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]} numberOfLines={1}>
            {t("inspect.header.kicker").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
            {t("inspect.title")}
          </Text>
          <View style={styles.statusRow} accessibilityLiveRegion="polite" testID="inspect-status">
            <Ionicons name={icon} size={12} color={tone} />
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.status, { color: status.tone === "live" ? theme.textSecondary : tone }]}
              numberOfLines={2}
              testID="inspect-status-text"
            >
              {status.text}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel={t("inspect.header.refreshA11y")}
          accessibilityState={{ disabled: refreshing, busy: refreshing }}
          testID="inspect-refresh"
          style={({ pressed }) => [styles.refresh, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && { opacity: 0.8 }]}
        >
          {refreshing ? <ActivityIndicator size="small" color={theme.primaryAction} /> : <Ionicons name="refresh" size={16} color={theme.primaryAction} />}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.refreshText, { color: theme.primaryAction }]}>
            {refreshing ? t("inspect.header.refreshing") : t("inspect.header.refresh")}
          </Text>
        </Pressable>
      </View>
      <View style={styles.metrics}>
        {cells.map((cell) => {
          const shown = metricText(metrics[cell.key], t);
          const label = t(`inspect.metric.${cell.key}`);
          return (
            <View
              key={cell.key}
              style={[styles.metric, { backgroundColor: cell.bg, borderColor: cell.line }]}
              accessible
              accessibilityLabel={t("inspect.metric.a11y", { label, value: shown.a11y })}
              testID={`inspect-metric-${cell.key}`}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.metricValue, { color: cell.fg }]} testID={`inspect-metric-${cell.key}-value`}>
                {shown.text}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={[styles.metricLabel, { color: theme.textSecondary }]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCol: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 26, lineHeight: 31, fontWeight: "700", marginTop: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  status: { flexShrink: 1, fontSize: 12.5, fontWeight: "600" },
  refresh: {
    minHeight: MIN_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 999,
  },
  refreshText: { fontSize: 13.5, fontWeight: "700" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: R.md, paddingVertical: 8, paddingHorizontal: 10, alignItems: "flex-start" },
  metricValue: { fontSize: 22, lineHeight: 26, fontWeight: "800" },
  metricLabel: { fontSize: 11.5, fontWeight: "700" },
});
