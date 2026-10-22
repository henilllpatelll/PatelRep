import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { InsightsState } from "@/lib/inspections/history/useInspectionHistory";
import { buildInsightsView, type InsightsView } from "@/lib/inspections/history/insights";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** "88%" - or the reason there is no rate. Never "0%" for a period with nothing to divide by. */
export function rateText(view: InsightsView, t: Translate): string {
  if (view.rate.kind === "value") return t("inspect.history.insights.percent", { percent: view.rate.percent });
  return t("inspect.history.insights.noRate");
}

/**
 * QUALITY INSIGHTS: a handful of numbers for the selected period and the three most common failed standards. It says
 * what it could not compute instead of showing a stand-in, and the details open in a drawer.
 */
export function QualityInsightsCard({
  state,
  periodLabel,
  t,
  onRetry,
  onOpenDetails,
}: {
  state: InsightsState;
  periodLabel: string;
  t: Translate;
  onRetry: () => void;
  onOpenDetails: () => void;
}) {
  const theme = useTheme();
  const view = state.status === "ready" ? buildInsightsView(state.data) : null;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="quality-insights">
      <View style={styles.head}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.kicker, { color: theme.textMuted }]}>
          {t("inspect.history.insights.title").toUpperCase()}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.period, { color: theme.textMuted }]} numberOfLines={1}>
          {periodLabel}
        </Text>
      </View>

      {state.status === "loading" || state.status === "idle" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} accessibilityRole="progressbar" testID="insights-loading">
          {t("inspect.history.insights.loading")}
        </Text>
      ) : state.status === "failed" ? (
        <View style={styles.block} accessibilityRole="alert" testID="insights-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
            {t("inspect.history.insights.loadFailed")}
          </Text>
          <Button label={t("inspect.states.retry")} variant="secondary" size="sm" onPress={onRetry} testID="insights-retry" />
        </View>
      ) : view ? (
        <>
          {state.status === "ready" && state.stale ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.pickup }]} testID="insights-stale">
              {t(state.stale === "offline" ? "inspect.history.insights.staleOffline" : "inspect.history.insights.staleFailed")}
            </Text>
          ) : null}
          {view.empty ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="insights-empty">
              {t("inspect.history.insights.empty")}
            </Text>
          ) : (
            <>
              <Row label={t("inspect.history.insights.firstPass")} value={rateText(view, t)} testID="insights-first-pass" />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="insights-summary">
                {view.truncated
                  ? t("inspect.history.insights.summaryAtLeast", { completed: view.completed, failed: view.failed, reinspections: view.reinspections })
                  : [
                      t("inspect.history.insights.completedCount", { count: view.completed }),
                      t("inspect.history.insights.failedCount", { count: view.failed }),
                      t("inspect.history.insights.reinspectionCount", { count: view.reinspections }),
                    ].join(" · ")}
              </Text>
              {view.rate.kind === "none" && view.rate.reason === "truncated" ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                  {t("inspect.history.insights.truncated")}
                </Text>
              ) : null}
              {view.topStandards.length > 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} numberOfLines={2} testID="insights-top-issue">
                  {t("inspect.history.insights.topIssue", { label: view.topStandards[0].label ?? t("inspect.history.insights.removedStandard"), count: view.topStandards[0].count })}
                </Text>
              ) : null}
            </>
          )}
          <Button label={t("inspect.history.insights.more")} variant="secondary" size="sm" onPress={onOpenDetails} testID="insights-more" />
        </>
      ) : null}
    </View>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8 },
  period: { fontSize: 12, flexShrink: 1 },
  block: { gap: 8, alignItems: "flex-start" },
  muted: { fontSize: 13.5, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 28 },
  rowLabel: { flex: 1, fontSize: 14 },
  rowValue: { fontSize: 16, fontWeight: "800" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  issue: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  issueLabel: { flex: 1, fontSize: 14, lineHeight: 19 },
  issueCount: { fontSize: 14, fontWeight: "800" },
});
