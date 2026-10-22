import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import type { Trend } from "@/lib/inspections/history/insights";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

const CHART_HEIGHT = 72;

function dayLabel(date: string, language: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * First-pass rate per day, drawn on a fixed 0-100% scale so a small change never looks like a collapse. A day with no
 * initial inspections has no rate: it is a visible gap (a dotted mark), never a 0% bar. The whole chart is one
 * accessible summary; the numbers are also written out as text beneath it.
 */
function TrendChartView({ trend, language, t }: { trend: Trend; language: string; t: Translate }) {
  const theme = useTheme();
  const { points } = trend;
  const dense = points.length > 45;
  const withRate = useMemo(() => points.filter((point) => point.percent !== null), [points]);
  const low = useMemo(() => withRate.reduce((best, point) => (point.percent! < best.percent! ? point : best), withRate[0]), [withRate]);
  const high = useMemo(() => withRate.reduce((best, point) => (point.percent! > best.percent! ? point : best), withRate[0]), [withRate]);
  const first = points[0];
  const last = points[points.length - 1];
  const summary = t("inspect.history.insights.trendA11y", {
    days: points.length,
    withData: trend.withData,
    low: low.percent,
    lowDate: dayLabel(low.date, language),
    high: high.percent,
    highDate: dayLabel(high.date, language),
  });
  return (
    <View style={styles.wrap} testID="insights-trend">
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.chart} testID="insights-trend-chart">
        <View style={[styles.guide, { top: 0, borderColor: theme.border }]} />
        <View style={[styles.guide, { top: CHART_HEIGHT / 2, borderColor: theme.border }]} />
        <View style={[styles.bars, { gap: dense ? 1 : 3 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {points.map((point) =>
            point.percent === null ? (
              <View key={point.date} style={styles.slot} testID={`trend-gap-${point.date}`}>
                <View style={[styles.gap, { backgroundColor: theme.border }]} />
              </View>
            ) : (
              <View key={point.date} style={styles.slot} testID={`trend-bar-${point.date}`}>
                <View style={[styles.bar, { height: Math.max(3, (CHART_HEIGHT * point.percent) / 100), backgroundColor: theme.primaryAction }]} />
              </View>
            ),
          )}
        </View>
      </View>
      <View style={styles.axis}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axisText, { color: theme.textMuted }]}>
          {dayLabel(first.date, language)}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axisText, { color: theme.textMuted }]}>
          {t("inspect.history.insights.trendScale")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axisText, { color: theme.textMuted }]}>
          {dayLabel(last.date, language)}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
        {t("inspect.history.insights.trendText", { low: low.percent, lowDate: dayLabel(low.date, language), high: high.percent, highDate: dayLabel(high.date, language) })}
      </Text>
      {trend.withData < points.length ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
          {t("inspect.history.insights.trendGaps")}
        </Text>
      ) : null}
    </View>
  );
}

export const TrendChart = memo(TrendChartView);

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  chart: { height: CHART_HEIGHT, justifyContent: "flex-end" },
  guide: { position: "absolute", left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderStyle: "dashed" },
  bars: { flexDirection: "row", alignItems: "flex-end", height: CHART_HEIGHT },
  slot: { flex: 1, height: CHART_HEIGHT, justifyContent: "flex-end", alignItems: "stretch" },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  gap: { height: 3, borderRadius: 1.5, opacity: 0.8 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 11 },
  note: { fontSize: 12.5, lineHeight: 18 },
});
