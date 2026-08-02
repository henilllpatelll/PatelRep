import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { displayFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { mySchedule, type ShiftAssignment } from "@/lib/api/scheduling";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getWeekDates(): { date: Date; iso: string }[] {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date: d, iso };
  });
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function SchedulingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const weekDates = getWeekDates();
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const load = useCallback(async () => {
    try {
      const from = weekDates[0].iso;
      const to = weekDates[6].iso;
      const res = await mySchedule(from, to);
      setAssignments(res.data);
    } catch {
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const byDate = Object.fromEntries(assignments.map((a) => [a.work_date, a]));
  const todayAssignment = byDate[todayIso];
  const rangeLabel = `${SHORT_MONTHS[weekDates[0].date.getMonth()]} ${weekDates[0].date.getDate()}–${weekDates[6].date.getDate()}`;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
    >
      <View style={styles.header}>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{rangeLabel}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("scheduling.title")}</Text>
      </View>

      {loading ? (
        <StateBlock status="loading" style={styles.center} />
      ) : (
        <>
          <View
            style={[
              styles.today,
              !todayAssignment && styles.todayOff,
              { backgroundColor: todayAssignment ? theme.primaryAction : theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.todayMeta, { color: todayAssignment ? theme.onPrimary : theme.textMuted }]}>
              {t("scheduling.todayPrefix", { day: DAY_LABELS[today.getDay()], month: SHORT_MONTHS[today.getMonth()], date: today.getDate() })}
            </Text>
            {todayAssignment?.shifts ? (
              <>
                <Text style={[styles.todayTime, { color: theme.onPrimary }]}>
                  {formatTime(todayAssignment.shifts.start_time)} – {formatTime(todayAssignment.shifts.end_time)}
                </Text>
                <Text style={[styles.todaySub, { color: theme.onPrimary }]}>{todayAssignment.shifts.name}</Text>
                <View style={styles.todayPills}>
                  <Pill tone="neutral">{todayAssignment.is_on_shift ? "On shift" : "Scheduled"}</Pill>
                  {todayAssignment.clocked_in_at ? <Pill tone="ready">{t("scheduling.clockedIn")}</Pill> : null}
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.todayTimeOff, { color: theme.textPrimary }]}>{t("scheduling.dayOff")}</Text>
                <Text style={[styles.todaySubOff, { color: theme.textMuted }]}>{t("scheduling.noShiftScheduled")}</Text>
              </>
            )}
          </View>

          <View>
            <SectionLabel>{t("scheduling.thisWeek")}</SectionLabel>
            <View style={[styles.weekList, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {weekDates.map(({ date, iso }, index) => {
                const assignment = byDate[iso];
                const isToday = iso === todayIso;
                return (
                  <View
                    key={iso}
                    style={[
                      styles.weekRow,
                      index > 0 && styles.rowBorder,
                      { borderTopColor: theme.borderSubtle, backgroundColor: isToday ? theme.primarySoft : undefined },
                    ]}
                  >
                    <View style={styles.dateCell}>
                      <Text style={[styles.day, { color: theme.textMuted }]}>{DAY_LABELS[date.getDay()]}</Text>
                      <Text style={[styles.dayNumber, { color: isToday ? theme.primaryAction : theme.textPrimary }]}>{date.getDate()}</Text>
                    </View>
                    <Text style={[styles.shift, !assignment && styles.offShift, { color: assignment ? theme.textPrimary : theme.textDisabled }]}>
                      {assignment?.shifts
                        ? `${assignment.shifts.name} ${formatTime(assignment.shifts.start_time)}–${formatTime(assignment.shifts.end_time)}`
                        : "Off"}
                    </Text>
                    {assignment ? <View style={[styles.shiftDot, { backgroundColor: theme.primaryAction }]} /> : null}
                  </View>
                );
              })}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, gap: 13, paddingBottom: 32 },
  header: { marginBottom: 2 },
  center: { paddingTop: 40, alignItems: "center" },
  headerMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 34 },
  today: { borderRadius: 16, paddingHorizontal: 18, paddingVertical: 16 },
  todayOff: { borderWidth: 1 },
  todayMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  todayTime: { fontFamily: displayFont, fontSize: 32, lineHeight: 34, marginTop: 9 },
  todayTimeOff: { fontFamily: displayFont, fontSize: 28, lineHeight: 32, marginTop: 9 },
  todaySub: { fontSize: 13, marginTop: 6 },
  todaySubOff: { fontSize: 13, marginTop: 6 },
  todayPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  weekList: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  weekRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1 },
  dateCell: { width: 40, alignItems: "center" },
  day: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 },
  dayNumber: { fontFamily: displayFont, fontSize: 20, lineHeight: 22 },
  shift: { flex: 1, fontSize: 13, fontWeight: "600" },
  offShift: { fontWeight: "400" },
  shiftDot: { width: 8, height: 8, borderRadius: 4 },
});
