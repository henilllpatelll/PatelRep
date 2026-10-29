import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { useToneColors } from "@/components/scheduling/ForecastParts";
import { SectionCard } from "@/components/supervisor/today/TodayBlocks";
import type { ForecastDay } from "@/lib/api/schedulingForecast";
import { factText, heroFor, reasonText } from "@/lib/scheduling/forecastModel";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  /** The selected day's forecast. null = the forecast could not be read (or does not cover this day). */
  day: ForecastDay | null;
  /** The forecast is still loading: nothing is shown yet rather than a "not assessed" flash. */
  loading: boolean;
  isToday: boolean;
  onOpen: () => void;
  t: Translate;
}

/**
 * One concise line about coverage on the Today and Week views, never a second dashboard. When the forecast cannot be
 * assessed it says "Coverage not assessed" and why; it never reads as "all good" without the numbers behind it.
 */
export function ForecastSummaryCard({ day, loading, isToday, onOpen, t }: Props) {
  const theme = useTheme();
  const tone = useToneColors();
  if (loading) return null;
  const hero = day ? heroFor(day, t) : null;
  const assessed = day !== null && day.status !== "unknown";
  const colors = tone(assessed && hero ? hero.tone : "neutral");
  const title = assessed && hero ? hero.title : t("teamSchedule.forecast.card.notAssessed");
  const body = assessed && hero ? hero.body : day ? reasonText(day.headline.reason, t) : t("teamSchedule.forecast.card.unreadable");
  const scheduled = day ? factText(day.capacity.productive, t) : null;
  const cta = t(isToday ? "teamSchedule.forecast.card.view" : "teamSchedule.forecast.card.viewDay");
  return (
    <SectionCard testID="team-schedule-forecast-card">
      <View style={styles.top}>
        <Ionicons name={assessed && hero ? hero.icon : "help-circle-outline"} size={20} color={colors.fg} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="team-schedule-forecast-title">
          {title}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="team-schedule-forecast-body">
        {body}
      </Text>
      {!assessed && scheduled ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("teamSchedule.forecast.card.scheduledOnly", { duration: scheduled })}
        </Text>
      ) : null}
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={cta} testID="team-schedule-forecast-open" style={({ pressed }) => [styles.cta, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, pressed && { opacity: 0.8 }]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ctaText, { color: theme.primaryAction }]}>
          {cta}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  cta: { alignSelf: "flex-start", minHeight: MIN_TARGET, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, justifyContent: "center" },
  ctaText: { fontSize: 14, fontWeight: "700" },
});
