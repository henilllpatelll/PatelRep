import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { formatReadingValue, trendDirection, trendGeometry, type TrendPoint } from "@/lib/engineering/assetReadings";
import { formatDay } from "@/lib/engineering/assetFormat";

const HEIGHT = 120;
const PAD = 10;
const DOT = 8;

interface Props {
  name: string;
  unit: string;
  points: readonly TrendPoint[];
  language: string;
  timezone: string | null | undefined;
}

/**
 * A plain line of the real recorded values of ONE meter (one unit), oldest to newest. The vertical axis spans the
 * recorded minimum to maximum and the horizontal axis is spaced by the actual times, so a gap in readings looks like a
 * gap. No smoothing, no forecast. The text alternative says the same thing in words.
 */
export function ReadingTrend({ name, unit, points, language, timezone }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  if (points.length < 2) return null;

  const geometry = trendGeometry(points);
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const direction = trendDirection(points);
  const first = formatDay(points[0].at, timezone, language) ?? "";
  const last = formatDay(points[points.length - 1].at, timezone, language) ?? "";
  const summary = t("assets.readings.trendSummary", {
    name,
    count: points.length,
    from: first,
    to: last,
    first: formatReadingValue(points[0].value, language),
    last: formatReadingValue(points[points.length - 1].value, language),
    unit,
    direction: direction ? t(`assets.readings.direction.${direction}`) : "",
  });

  const plotW = Math.max(0, width - PAD * 2);
  const plotH = HEIGHT - PAD * 2;
  const at = (g: { x: number; y: number }) => ({ x: PAD + g.x * plotW, y: PAD + g.y * plotH });
  const spots = geometry.map(at);

  return (
    <View testID="reading-trend" accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View style={styles.row}>
        <View style={styles.yAxis} importantForAccessibility="no-hide-descendants">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axis, { color: theme.textMuted }]}>{formatReadingValue(max, language)}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axis, { color: theme.textMuted }]}>{formatReadingValue(min, language)}</Text>
        </View>
        <View
          style={[styles.plot, { height: HEIGHT, borderColor: theme.borderSubtle, backgroundColor: theme.surfaceSubtle }]}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {width > 0
            ? spots.slice(1).map((to, i) => {
                const from = spots[i];
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                return (
                  <View
                    key={`seg-${i}`}
                    style={{
                      position: "absolute",
                      left: (from.x + to.x) / 2 - length / 2,
                      top: (from.y + to.y) / 2 - 1,
                      width: length,
                      height: 2,
                      backgroundColor: theme.primaryAction,
                      transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                    }}
                  />
                );
              })
            : null}
          {width > 0
            ? spots.map((spot, i) => (
                <View
                  key={`dot-${i}`}
                  style={{ position: "absolute", left: spot.x - DOT / 2, top: spot.y - DOT / 2, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.primaryAction }}
                />
              ))
            : null}
        </View>
      </View>
      <View style={styles.xAxis} importantForAccessibility="no-hide-descendants">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axis, { color: theme.textMuted }]}>{first}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axis, { color: theme.textMuted }]}>{unit}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.axis, { color: theme.textMuted }]}>{last}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  yAxis: { width: 48, justifyContent: "space-between", paddingVertical: 4 },
  plot: { flex: 1, borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  xAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingLeft: 56 },
  axis: { fontSize: 11 },
});
