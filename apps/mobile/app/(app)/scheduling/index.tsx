import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, displayFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { mySchedule, type ShiftAssignment } from "@/lib/api/scheduling";

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
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerMeta}>{rangeLabel}</Text>
        <Text style={styles.title}>My shifts</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <>
          <View style={[styles.today, !todayAssignment && styles.todayOff]}>
            <Text style={[styles.todayMeta, !todayAssignment && styles.todayMetaOff]}>
              Today — {DAY_LABELS[today.getDay()]} {SHORT_MONTHS[today.getMonth()]} {today.getDate()}
            </Text>
            {todayAssignment?.shifts ? (
              <>
                <Text style={[styles.todayTime, !todayAssignment && styles.todayTimeOff]}>
                  {formatTime(todayAssignment.shifts.start_time)} – {formatTime(todayAssignment.shifts.end_time)}
                </Text>
                <Text style={[styles.todaySub, !todayAssignment && styles.todaySubOff]}>{todayAssignment.shifts.name}</Text>
                <View style={styles.todayPills}>
                  <Pill tone="neutral">{todayAssignment.is_on_shift ? "On shift" : "Scheduled"}</Pill>
                  {todayAssignment.clocked_in_at ? <Pill tone="ready">Clocked in</Pill> : null}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.todayTimeOff}>Day off</Text>
                <Text style={styles.todaySubOff}>No shift scheduled</Text>
              </>
            )}
          </View>

          <View>
            <SectionLabel>This week</SectionLabel>
            <View style={styles.weekList}>
              {weekDates.map(({ date, iso }, index) => {
                const assignment = byDate[iso];
                const isToday = iso === todayIso;
                return (
                  <View key={iso} style={[styles.weekRow, index > 0 && styles.rowBorder, isToday && styles.todayRow]}>
                    <View style={styles.dateCell}>
                      <Text style={styles.day}>{DAY_LABELS[date.getDay()]}</Text>
                      <Text style={[styles.dayNumber, isToday && { color: C.accent }]}>{date.getDate()}</Text>
                    </View>
                    <Text style={[styles.shift, !assignment && styles.offShift]}>
                      {assignment?.shifts
                        ? `${assignment.shifts.name} ${formatTime(assignment.shifts.start_time)}–${formatTime(assignment.shifts.end_time)}`
                        : "Off"}
                    </Text>
                    {assignment ? <View style={[styles.shiftDot, { backgroundColor: C.accent }]} /> : null}
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
  container: { flex: 1, backgroundColor: C.paper },
  content: { padding: 18, gap: 13, paddingBottom: 32 },
  header: { marginBottom: 2 },
  center: { paddingTop: 40, alignItems: "center" },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34 },
  today: { backgroundColor: C.accent, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 16 },
  todayOff: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  todayMeta: { color: "rgba(255,255,255,0.86)", fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  todayMetaOff: { color: C.ink3 },
  todayTime: { color: "#fff", fontFamily: displayFont, fontSize: 32, lineHeight: 34, marginTop: 9 },
  todayTimeOff: { color: C.ink, fontFamily: displayFont, fontSize: 28, lineHeight: 32, marginTop: 9 },
  todaySub: { color: "rgba(255,255,255,0.86)", fontSize: 13, marginTop: 6 },
  todaySubOff: { color: C.ink3, fontSize: 13, marginTop: 6 },
  todayPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  weekList: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden" },
  weekRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: C.line2 },
  todayRow: { backgroundColor: C.accentSoft },
  dateCell: { width: 40, alignItems: "center" },
  day: { color: C.ink3, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 },
  dayNumber: { color: C.ink, fontFamily: displayFont, fontSize: 20, lineHeight: 22 },
  shift: { flex: 1, color: C.ink, fontSize: 13, fontWeight: "600" },
  offShift: { color: C.ink4, fontWeight: "400" },
  shiftDot: { width: 8, height: 8, borderRadius: 4 },
});
