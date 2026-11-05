import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { addDaysToYmd } from "@/lib/housekeeping/hotelTime";
import { planWeek, weekStartOf } from "@/lib/engineering/pmCalendar";
import { formatDueDate, type PmScheduleView } from "@/lib/engineering/pmSchedules";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { PmScheduleCard } from "./PmScheduleCard";
import type { PmListProps } from "./PmTodayView";

interface Props extends PmListProps {
  today: string;
}

/** One Monday-Sunday week at a time; each schedule appears once, on its real due day. */
export function PmWeekView({ schedules, today, ...rest }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const plan = useMemo(() => planWeek(schedules, weekStart, today), [schedules, weekStart, today]);
  const range = `${formatDueDate(plan.weekStart, rest.language)} – ${formatDueDate(plan.weekEnd, rest.language)}`;
  const card = (s: PmScheduleView) => (
    <PmScheduleCard
      key={s.id}
      schedule={s}
      language={rest.language}
      hasDraft={rest.draftIds.has(s.id)}
      canInspect={rest.canInspect}
      onOpen={() => rest.onOpen(s.id)}
      onInspect={() => rest.onInspect(s.id)}
    />
  );
  const weekday = (dateKey: string) => {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(rest.language?.startsWith("es") ? "es-US" : "en-US", { weekday: "long", timeZone: "UTC" });
  };

  return (
    <View style={styles.stack}>
      <View style={styles.nav}>
        <Pressable onPress={() => setWeekStart(addDaysToYmd(weekStart, -7))} style={styles.navButton} accessibilityRole="button" accessibilityLabel={t("pm.previousWeek")} testID="pm-week-prev">
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </Pressable>
        <Pressable onPress={() => setWeekStart(weekStartOf(today))} accessibilityRole="button" accessibilityLabel={t("pm.thisWeekGo")} style={styles.range}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rangeText, { color: theme.textPrimary }]}>
            {range}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rangeHint, { color: theme.textMuted }]}>
            {plan.isCurrentWeek ? t("pm.thisWeek") : t("pm.jumpToThisWeek")}
          </Text>
        </Pressable>
        <Pressable onPress={() => setWeekStart(addDaysToYmd(weekStart, 7))} style={styles.navButton} accessibilityRole="button" accessibilityLabel={t("pm.nextWeek")} testID="pm-week-next">
          <Ionicons name="chevron-forward" size={20} color={theme.textPrimary} />
        </Pressable>
      </View>

      {plan.carriedOverdue.length > 0 ? (
        <View style={styles.day} testID="pm-week-carried">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dayTitle, x.label, { color: theme.status.dirty }]}>
            {x.caps(t("pm.earlierOverdue", { count: plan.carriedOverdue.length }))}
          </Text>
          {plan.carriedOverdue.map(card)}
        </View>
      ) : null}

      {plan.days.map((day) =>
        day.schedules.length === 0 ? null : (
          <View key={day.dateKey} style={styles.day} testID={`pm-week-day-${day.dateKey}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dayTitle, x.label, { color: day.isToday ? theme.primaryAction : theme.textMuted }]}>
              {x.caps(`${weekday(day.dateKey)} ${formatDueDate(day.dateKey, rest.language)} · ${t("pm.inspectionsCount", { count: day.schedules.length })}`)}
            </Text>
            {day.schedules.map(card)}
          </View>
        ),
      )}

      {plan.total === 0 ? (
        <Text style={[styles.empty, { color: theme.textMuted }]} testID="pm-week-empty">
          {t("pm.nothingThisWeek")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  nav: { flexDirection: "row", alignItems: "center", gap: 8 },
  navButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  range: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
  rangeText: { fontSize: 16, fontWeight: "700" },
  rangeHint: { fontSize: 12 },
  day: { gap: 8 },
  dayTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  empty: { fontSize: 14, textAlign: "center", paddingVertical: 24 },
});
