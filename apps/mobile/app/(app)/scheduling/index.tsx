import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { displayFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { mySchedule, type ShiftAssignment } from "@/lib/api/scheduling";
import { SwapRequestSheet, type SwapSource } from "@/components/scheduling/SwapRequestSheet";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { fetchMyOffers } from "@/lib/api/schedulingOffers";
import { fetchMyRequests } from "@/lib/api/schedulingRequests";
import { ScheduleBanner } from "@/components/scheduling/ScheduleStates";
import { addDays, groupByDate, localToday, resolveHighlight, validUuid, validYmd, weekOf } from "@/lib/scheduling/myWeek";
import { useRemote } from "@/lib/scheduling/requestHooks";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function SchedulingScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const isOnline = useAppStore((state) => state.isOnline);
  // Phase 5: swap proposals waiting on this employee's answer. No number is shown when the read failed.
  const myRequests = useRemote(fetchMyRequests, [], isOnline);
  const waiting = myRequests.data?.counts.action_required ?? 0;
  // Phase 7: shift offers waiting for an answer. An offer is a question, not a shift; no number is shown when the read failed.
  const myOffers = useRemote(fetchMyOffers, [], isOnline);
  const offersWaiting = (myOffers.data ?? []).filter((offer) => offer.status === "pending").length;
  const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // A notification opens the week of the shift it is about. The params are data from the network: a date must be a real
  // calendar day and a shift id a UUID, anything else is ignored and the current week opens.
  const params = useLocalSearchParams<{ date?: string; assignmentId?: string }>();
  const target = useMemo(() => ({ date: validYmd(params.date), assignmentId: validUuid(params.assignmentId) }), [params.date, params.assignmentId]);
  const todayIso = localToday();
  const [anchor, setAnchor] = useState<string>(target.date ?? todayIso);
  useEffect(() => { if (target.date) setAnchor(target.date); }, [target.date]);

  const weekIso = useMemo(() => weekOf(anchor), [anchor]);
  const weekDates = useMemo(() => weekIso.map((iso) => ({ iso, date: new Date(`${iso}T12:00:00`) })), [weekIso]);
  const today = new Date();
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current; // a slow answer for a week the person already left must not overwrite the one on screen
    setFailed(false);
    try {
      const res = await mySchedule(weekIso[0], weekIso[6]);
      if (ticket !== latest.current) return;
      setAssignments(res.data);
    } catch {
      if (ticket !== latest.current) return;
      setAssignments([]);
      setFailed(true);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [weekIso]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const byDate = useMemo(() => groupByDate(assignments), [assignments]);
  const todayAssignment = byDate[todayIso]?.[0];
  const showingThisWeek = weekIso.includes(todayIso);
  const highlight = !loading && !failed ? resolveHighlight(target, byDate) : "none";
  const first = weekDates[0].date;
  const last = weekDates[6].date;
  const rangeLabel = first.getMonth() === last.getMonth()
    ? `${SHORT_MONTHS[first.getMonth()]} ${first.getDate()}–${last.getDate()}`
    : `${SHORT_MONTHS[first.getMonth()]} ${first.getDate()} – ${SHORT_MONTHS[last.getMonth()]} ${last.getDate()}`;

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

      <View style={styles.weekNav}>
        <Button label={t("scheduling.week.previous")} icon="chevron-back" variant="secondary" onPress={() => setAnchor(addDays(weekIso[0], -7))} testID="week-previous" />
        {showingThisWeek ? null : <Button label={t("scheduling.week.current")} variant="secondary" onPress={() => setAnchor(todayIso)} testID="week-current" />}
        <Button label={t("scheduling.week.next")} icon="chevron-forward" variant="secondary" onPress={() => setAnchor(addDays(weekIso[0], 7))} testID="week-next" />
      </View>

      {loading ? (
        <StateBlock status="loading" style={styles.center} />
      ) : failed ? (
        <View style={styles.center} testID="my-schedule-failed">
          <Text style={[styles.headerMeta, { color: theme.textPrimary }]}>{t("scheduling.week.loadFailed")}</Text>
          <Button label={t("common.retry")} onPress={() => { setLoading(true); void load(); }} testID="my-schedule-retry" />
        </View>
      ) : (
        <>
          {highlight === "missing" ? <ScheduleBanner icon="time-outline" text={t("scheduling.week.shiftUnavailable")} testID="my-schedule-shift-unavailable" /> : null}
          {showingThisWeek ? (
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
                  <Pill tone="neutral">{todayAssignment.is_on_shift ? t("scheduling.week.onShift") : t("scheduling.week.scheduled")}</Pill>
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
          ) : null}

          <View>
            <SectionLabel>{showingThisWeek ? t("scheduling.thisWeek") : rangeLabel}</SectionLabel>
            <View style={[styles.weekList, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {weekDates.map(({ date, iso }, index) => {
                const day = byDate[iso] ?? [];
                const isToday = iso === todayIso;
                const isTarget = target.assignmentId ? day.some((a) => a.id === target.assignmentId) : target.date === iso && day.length > 0;
                return (
                  <View
                    key={iso}
                    testID={isTarget ? "my-schedule-highlight" : `week-row-${iso}`}
                    style={[
                      styles.weekRow,
                      index > 0 && styles.rowBorder,
                      isTarget && styles.targetRow,
                      { borderTopColor: theme.borderSubtle, backgroundColor: isToday || isTarget ? theme.primarySoft : undefined },
                      isTarget && { borderLeftColor: theme.primaryAction },
                    ]}
                  >
                    <View style={styles.dateCell}>
                      <Text style={[styles.day, { color: theme.textMuted }]}>{DAY_LABELS[date.getDay()]}</Text>
                      <Text style={[styles.dayNumber, { color: isToday ? theme.primaryAction : theme.textPrimary }]}>{date.getDate()}</Text>
                    </View>
                    <View style={styles.dayShifts}>
                      {day.length === 0 ? (
                        <Text style={[styles.shift, styles.offShift, { color: theme.textDisabled }]}>{t("scheduling.week.off")}</Text>
                      ) : (
                        day.map((assignment) => (
                          <View key={assignment.id} style={styles.shiftLine}>
                            <Text style={[styles.shift, { color: theme.textPrimary }]}>
                              {assignment.shifts
                                ? `${assignment.shifts.name} ${formatTime(assignment.shifts.start_time)}–${formatTime(assignment.shifts.end_time)}`
                                : t("scheduling.week.scheduled")}
                            </Text>
                            {assignment.shifts && iso >= todayIso && !assignment.clocked_in_at ? (
                              <Pressable
                                onPress={() => setSwapSource({ id: assignment.id, workDate: iso, shiftName: assignment.shifts?.name ?? null, startTime: assignment.shifts?.start_time ?? null, endTime: assignment.shifts?.end_time ?? null })}
                                accessibilityRole="button"
                                accessibilityLabel={t("scheduling.swapFromShiftFor", { shift: assignment.shifts.name, date: iso })}
                                hitSlop={6}
                                testID={`swap-from-${assignment.id}`}
                                style={[styles.swapHit, { borderColor: theme.border }]}
                              >
                                <Text maxFontSizeMultiplier={1.6} style={[styles.swapText, { color: theme.primaryAction }]}>{t("scheduling.swapFromShift")}</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ))
                      )}
                    </View>
                    {day.length > 0 ? <View style={[styles.shiftDot, { backgroundColor: theme.primaryAction }]} /> : null}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.actions}>
            <SectionLabel>{t("scheduling.actions.title")}</SectionLabel>
            <Button label={t("scheduling.actions.availability")} icon="time-outline" variant="secondary" onPress={() => router.push("/(app)/scheduling/availability" as never)} testID="schedule-action-availability" />
            <Button label={t("scheduling.actions.timeOff")} icon="sunny-outline" variant="secondary" onPress={() => router.push("/(app)/scheduling/time-off" as never)} testID="schedule-action-time-off" />
            <Button label={waiting > 0 ? t("scheduling.actions.requestsCount", { count: waiting }) : t("scheduling.actions.requests")} icon="mail-outline" variant={waiting > 0 ? "primary" : "secondary"} onPress={() => router.push("/(app)/scheduling/requests" as never)} testID="schedule-action-requests" />
            <Button label={offersWaiting > 0 ? t("scheduling.actions.offersCount", { count: offersWaiting }) : t("scheduling.actions.offers")} icon="swap-horizontal-outline" variant={offersWaiting > 0 ? "primary" : "secondary"} onPress={() => router.push("/(app)/scheduling/offers" as never)} testID="schedule-action-offers" />
          </View>
        </>
      )}
      <SwapRequestSheet source={swapSource} isOnline={isOnline} language={i18n.language} onClose={() => setSwapSource(null)} onSent={() => void myRequests.refresh()} t={t} />
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
  weekNav: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  targetRow: { borderLeftWidth: 4 },
  dayShifts: { flex: 1, gap: 8 },
  shiftLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  weekRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1 },
  dateCell: { width: 40, alignItems: "center" },
  day: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 },
  dayNumber: { fontFamily: displayFont, fontSize: 20, lineHeight: 22 },
  shift: { flex: 1, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  offShift: { fontWeight: "400" },
  shiftDot: { width: 8, height: 8, borderRadius: 4 },
  swapHit: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderRadius: 10 },
  swapText: { fontSize: 12, fontWeight: "700" },
  actions: { gap: 10 },
});
