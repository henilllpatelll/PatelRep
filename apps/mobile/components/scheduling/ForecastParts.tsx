import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { SectionCard, SectionHeader } from "@/components/supervisor/today/TodayBlocks";
import type { ForecastDay, ForecastRecommendation } from "@/lib/api/schedulingForecast";
import { categoryLabel, heroFor, metricsFor, outlookRow, recommendationText, type ForecastTone } from "@/lib/scheduling/forecastModel";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* The Staffing Forecast's building blocks. Words come from forecastModel (server results → text); colour is only ever
   an extra: every state also has an icon and a label. */

export function useToneColors() {
  const theme = useTheme();
  return (tone: ForecastTone) =>
    tone === "warn"
      ? { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine }
      : tone === "ok"
        ? { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }
        : { fg: theme.textSecondary, bg: theme.surfaceMuted, line: theme.borderSubtle };
}

export function Hero({ day, t, testID = "forecast-hero" }: { day: ForecastDay; t: Translate; testID?: string }) {
  const theme = useTheme();
  const tone = useToneColors();
  const hero = heroFor(day, t);
  const colors = tone(hero.tone);
  return (
    <View style={[styles.hero, { backgroundColor: colors.bg, borderColor: colors.line }]} accessible accessibilityLabel={`${hero.title}. ${hero.body}. ${hero.badge}`} testID={testID}>
      <View style={styles.heroTop}>
        <Ionicons name={hero.icon} size={26} color={colors.fg} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroTitle, { color: theme.textPrimary }]} testID={`${testID}-title`}>
          {hero.title}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroBody, { color: theme.textPrimary }]} testID={`${testID}-body`}>
        {hero.body}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badge, { color: theme.textSecondary }]} testID={`${testID}-quality`}>
        {hero.badge}
      </Text>
    </View>
  );
}

export function Metrics({ day, t }: { day: ForecastDay; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.metrics} testID="forecast-metrics">
      {metricsFor(day, t).map((metric) => (
        <View
          key={metric.key}
          style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}
          accessible
          accessibilityLabel={`${metric.label}: ${metric.value ?? t("teamSchedule.forecast.unavailable")}${metric.note ? `. ${metric.note}` : ""}`}
          testID={`forecast-metric-${metric.key}`}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metricLabel, { color: theme.textSecondary }]} numberOfLines={2}>
            {metric.label}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metricValue, { color: metric.value === null ? theme.textMuted : theme.textPrimary }]} testID={`forecast-metric-${metric.key}-value`}>
            {metric.value ?? t("teamSchedule.forecast.unavailable")}
          </Text>
          {metric.note ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metricNote, { color: theme.textMuted }]}>
              {metric.note}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Outlook({ days, selected, language, onOpen, t }: { days: readonly ForecastDay[]; selected: string | null; language?: string; onOpen: (date: string) => void; t: Translate }) {
  const theme = useTheme();
  const tone = useToneColors();
  return (
    <SectionCard testID="forecast-outlook">
      <SectionHeader title={t("teamSchedule.forecast.outlook.title")} />
      <View style={styles.list}>
        {days.map((day) => {
          const row = outlookRow(day, t);
          const colors = tone(row.tone);
          const date = formatLongDate(row.date, language);
          const open = row.openShifts > 0 ? t("teamSchedule.forecast.outlook.openShifts", { count: row.openShifts }) : null;
          const label = [date, row.isToday ? t("teamSchedule.todayMarker") : null, row.statusLabel, row.detail, open].filter(Boolean).join(", ");
          return (
            <Pressable
              key={row.date}
              onPress={() => onOpen(row.date)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: selected === row.date }}
              testID={`forecast-day-${row.date}`}
              style={({ pressed }) => [styles.row, { borderColor: selected === row.date ? theme.primaryAction : theme.borderSubtle, backgroundColor: theme.surface }, pressed && { opacity: 0.8 }]}
            >
              <View style={[styles.dot, { backgroundColor: colors.bg, borderColor: colors.line }]}>
                <Ionicons name={row.status === "short" ? "warning-outline" : row.status === "sufficient" ? "checkmark" : "help"} size={14} color={colors.fg} />
              </View>
              <View style={styles.rowText}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowDate, { color: theme.textPrimary }]} numberOfLines={1}>
                  {row.isToday ? `${date} · ${t("teamSchedule.todayMarker")}` : date}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowStatus, { color: colors.fg }]} testID={`forecast-day-status-${row.date}`}>
                  {row.statusLabel}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowDetail, { color: theme.textSecondary }]}>
                  {row.detail}
                </Text>
                {open ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowDetail, { color: theme.status.pickup }]}>
                    {open}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </Pressable>
          );
        })}
      </View>
    </SectionCard>
  );
}

export function Breakdown({ day, t }: { day: ForecastDay; t: Translate }) {
  const theme = useTheme();
  const rows = day.demand.byCategory.filter((row) => row.rooms > 0);
  if (rows.length === 0 && !day.demand.unestimatedRooms && !day.demand.declinedServiceRooms) return null;
  return (
    <SectionCard testID="forecast-breakdown">
      <SectionHeader title={t("teamSchedule.forecast.breakdown.title")} />
      {rows.map((row) => (
        <View key={row.category} style={styles.line} testID={`forecast-breakdown-${row.category}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textPrimary }]}>
            {categoryLabel(row.category, t)}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textSecondary }]}>
            {t("teamSchedule.forecast.roomsCount", { count: row.rooms })}
          </Text>
        </View>
      ))}
      {day.demand.unestimatedRooms ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.pickup }]} testID="forecast-unestimated">
          {t("teamSchedule.forecast.breakdown.unestimated", { count: day.demand.unestimatedRooms })}
        </Text>
      ) : null}
      {day.demand.declinedServiceRooms ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
          {t("teamSchedule.forecast.breakdown.declined", { count: day.demand.declinedServiceRooms })}
        </Text>
      ) : null}
    </SectionCard>
  );
}

export function Recommendations({ items, onAction, t }: { items: readonly ForecastRecommendation[]; onAction: (item: ForecastRecommendation) => void; t: Translate }) {
  const theme = useTheme();
  const shown = items.flatMap((item) => {
    const text = recommendationText(item, t);
    return text ? [{ item, text }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <SectionCard testID="forecast-recommendations">
      <SectionHeader title={t("teamSchedule.forecast.rec.title")} />
      <View style={styles.list}>
        {shown.map(({ item, text }) => (
          <View key={item.id} style={[styles.rec, { borderColor: theme.borderSubtle, backgroundColor: theme.surfaceMuted }]} testID={`forecast-rec-${item.id}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recTitle, { color: theme.textPrimary }]}>
              {text.title}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
              {text.why}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badge, { color: theme.textMuted }]}>
              {text.basis}
            </Text>
            {item.action && text.actionLabel ? (
              <Pressable
                onPress={() => onAction(item)}
                accessibilityRole="button"
                accessibilityLabel={`${text.actionLabel}. ${text.title}`}
                testID={`forecast-rec-action-${item.id}`}
                style={({ pressed }) => [styles.action, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, pressed && { opacity: 0.8 }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
                  {text.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  hero: { borderWidth: 1, borderRadius: R.lg, padding: 16, gap: 8 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  heroTitle: { flex: 1, fontSize: 20, fontWeight: "800" },
  heroBody: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  badge: { fontSize: 12.5, fontWeight: "700" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderRadius: R.md, padding: 12, gap: 3 },
  metricLabel: { fontSize: 12.5, fontWeight: "700" },
  metricValue: { fontSize: 20, fontWeight: "800" },
  metricNote: { fontSize: 12, lineHeight: 16 },
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 1 },
  rowDate: { fontSize: 15, fontWeight: "800" },
  rowStatus: { fontSize: 13.5, fontWeight: "800" },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, minHeight: 32, alignItems: "center" },
  lineLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  lineValue: { fontSize: 15, fontWeight: "700" },
  note: { fontSize: 13.5, lineHeight: 19, fontWeight: "500" },
  rec: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  recTitle: { fontSize: 15.5, fontWeight: "800" },
  action: { alignSelf: "flex-start", minHeight: MIN_TARGET, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, justifyContent: "center", marginTop: 2 },
  actionText: { fontSize: 14, fontWeight: "700" },
});
