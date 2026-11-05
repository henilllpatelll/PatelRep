import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { dayMarkers, monthGrid, schedulesOnDay, shiftMonth } from "@/lib/engineering/pmCalendar";
import { formatDueDate, type PmScheduleView } from "@/lib/engineering/pmSchedules";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { PmScheduleCard } from "./PmScheduleCard";
import type { PmListProps } from "./PmTodayView";

interface Props extends PmListProps {
  today: string;
}

const WEEKDAY_KEYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;

/** A month of real due dates only (nothing is projected), with the selected day's agenda underneath. */
export function PmCalendarView({ schedules, today, ...rest }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const grid = useMemo(() => monthGrid(month), [month]);
  const markers = useMemo(() => dayMarkers(schedules), [schedules]);
  const agenda = useMemo(() => schedulesOnDay(schedules, selected), [schedules, selected]);
  const title = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)).toLocaleDateString(
    rest.language?.startsWith("es") ? "es-US" : "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <View style={styles.stack}>
      <View style={styles.nav}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel={t("pm.previousMonth")} testID="pm-cal-prev">
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          onPress={() => {
            setMonth(today.slice(0, 7));
            setSelected(today);
          }}
          style={styles.todayButton}
          accessibilityRole="button"
          testID="pm-cal-today"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.primaryAction, fontSize: 13, fontWeight: "700" }}>
            {t("pm.views.today")}
          </Text>
        </Pressable>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel={t("pm.nextMonth")} testID="pm-cal-next">
          <Ionicons name="chevron-forward" size={20} color={theme.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_KEYS.map((k) => (
          <Text key={k} maxFontSizeMultiplier={1.2} style={[styles.weekday, { color: theme.textMuted }]}>
            {t(`pm.weekday.${k}`)}
          </Text>
        ))}
      </View>
      {grid.map((row) => (
        <View key={row[0].dateKey} style={styles.weekRow}>
          {row.map((cell) => {
            const marker = markers.get(cell.dateKey);
            const isSelected = cell.dateKey === selected;
            const isToday = cell.dateKey === today;
            const spoken = marker
              ? `${formatDueDate(cell.dateKey, rest.language)}, ${t("pm.inspectionsCount", { count: marker.count })}${marker.overdue ? `, ${t("pmSchedules.overdue")}` : ""}`
              : formatDueDate(cell.dateKey, rest.language) ?? cell.dateKey;
            return (
              <Pressable
                key={cell.dateKey}
                onPress={() => setSelected(cell.dateKey)}
                style={[
                  styles.cell,
                  isSelected && { backgroundColor: theme.primaryAction },
                  !isSelected && isToday && { borderColor: theme.primaryAction, borderWidth: 1.5 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={spoken}
                testID={`pm-cal-day-${cell.dateKey}`}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={[styles.dayNum, { color: isSelected ? theme.surface : cell.inMonth ? theme.textPrimary : theme.textDisabled }]}
                >
                  {Number(cell.dateKey.slice(8))}
                </Text>
                {marker ? (
                  <View style={styles.markerRow}>
                    <View style={[styles.dot, { backgroundColor: isSelected ? theme.surface : marker.overdue ? theme.status.dirty : theme.status.clean }]} />
                    {marker.count > 1 ? (
                      <Text maxFontSizeMultiplier={1.2} style={[styles.count, { color: isSelected ? theme.surface : theme.textMuted }]}>
                        {marker.count}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.agenda} testID="pm-cal-agenda">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.agendaTitle, x.label, { color: theme.textMuted }]}>
          {x.caps(`${formatDueDate(selected, rest.language)} · ${t("pm.inspectionsCount", { count: agenda.length })}`)}
        </Text>
        {agenda.length === 0 ? <Text style={[styles.empty, { color: theme.textMuted }]}>{t("pm.nothingScheduledDay")}</Text> : null}
        {agenda.map((s: PmScheduleView) => (
          <PmScheduleCard
            key={s.id}
            schedule={s}
            language={rest.language}
            hasDraft={rest.draftIds.has(s.id)}
            canInspect={rest.canInspect}
            onOpen={() => rest.onOpen(s.id)}
            onInspect={() => rest.onInspect(s.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 6 },
  nav: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  navButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  todayButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700" },
  weekRow: { flexDirection: "row", gap: 2 },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", paddingBottom: 2 },
  cell: { flex: 1, minHeight: 46, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 1 },
  dayNum: { fontSize: 14, fontWeight: "600" },
  markerRow: { flexDirection: "row", alignItems: "center", gap: 2, height: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: { fontSize: 9, fontWeight: "700" },
  agenda: { gap: 8, marginTop: 14 },
  agendaTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  empty: { fontSize: 14, paddingVertical: 12 },
});
