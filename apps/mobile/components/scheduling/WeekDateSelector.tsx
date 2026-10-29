import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { dayOfMonth, formatLongDate, formatWeekdayShort, formatWeekRange } from "@/lib/scheduling/teamScheduleDates";
import type { DaySummary } from "@/lib/scheduling/teamScheduleModel";
import type { Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  days: readonly string[];
  selected: string;
  today: string;
  /** null = the week's plan is unknown, so no day shows a count. */
  summaries: readonly DaySummary[] | null;
  language?: string;
  onSelect: (date: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  t: Translate;
}

/** Previous / next week, the range label, a way back to today, and the seven days as 44pt+ touch targets. */
export function WeekDateSelector({ days, selected, today, summaries, language, onSelect, onPrevWeek, onNextWeek, onToday, t }: Props) {
  const theme = useTheme();
  const showingThisWeek = days.includes(today);
  return (
    <View style={styles.wrap} testID="team-schedule-week-selector">
      <View style={styles.rangeRow}>
        <Pressable onPress={onPrevWeek} accessibilityRole="button" accessibilityLabel={t("teamSchedule.prevWeek")} testID="team-schedule-prev-week" style={[styles.nav, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.range, { color: theme.textPrimary }]} numberOfLines={1} testID="team-schedule-week-range">
          {formatWeekRange(days[0], language)}
        </Text>
        <Pressable onPress={onNextWeek} accessibilityRole="button" accessibilityLabel={t("teamSchedule.nextWeek")} testID="team-schedule-next-week" style={[styles.nav, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
          <Ionicons name="chevron-forward" size={20} color={theme.textPrimary} />
        </Pressable>
      </View>

      {!showingThisWeek || selected !== today ? (
        <Pressable onPress={onToday} accessibilityRole="button" accessibilityLabel={t("teamSchedule.backToToday")} testID="team-schedule-week-today" style={({ pressed }) => [styles.todayJump, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, pressed && { opacity: 0.75 }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.todayJumpText, { color: theme.primaryAction }]}>
            {t("teamSchedule.backToToday")}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.days} accessibilityRole="tablist">
        {days.map((date) => {
          const isSelected = date === selected;
          const isToday = date === today;
          const summary = summaries?.find((entry) => entry.date === date) ?? null;
          const count = summary ? summary.people : null;
          const label = [
            formatLongDate(date, language),
            isToday ? t("teamSchedule.todayMarker") : null,
            count === null ? t("teamSchedule.week.countUnknown") : t("teamSchedule.week.peopleCount", { count }),
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <Pressable
              key={date}
              onPress={() => onSelect(date)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={label}
              testID={`team-schedule-day-${date}`}
              style={({ pressed }) => [
                styles.day,
                {
                  backgroundColor: isSelected ? theme.primaryAction : theme.surface,
                  // Today keeps a ring even when another day is selected, so "where am I in time" is never lost.
                  borderColor: isSelected ? theme.primaryAction : isToday ? theme.primaryLine : theme.borderSubtle,
                  borderWidth: isToday && !isSelected ? 2 : 1,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.dow, { color: isSelected ? theme.onPrimary : theme.textMuted }]} numberOfLines={1}>
                {formatWeekdayShort(date, language)}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={[styles.dom, { color: isSelected ? theme.onPrimary : theme.textPrimary }]}>
                {dayOfMonth(date)}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={[styles.count, { color: isSelected ? theme.onPrimary : theme.textSecondary }]} testID={`team-schedule-day-count-${date}`}>
                {count === null ? "–" : count}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, gap: 10 },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  nav: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  range: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700" },
  todayJump: { alignSelf: "center", minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, justifyContent: "center" },
  todayJumpText: { fontSize: 14, fontWeight: "700" },
  days: { flexDirection: "row", gap: 6 },
  day: { flex: 1, minHeight: 72, borderRadius: R.md, alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 1 },
  dow: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  dom: { fontSize: 18, fontWeight: "800" },
  count: { fontSize: 12, fontWeight: "700" },
});
