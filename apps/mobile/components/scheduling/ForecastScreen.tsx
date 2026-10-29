import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { ForecastDaySheet } from "@/components/scheduling/ForecastDaySheet";
import { Breakdown, Hero, Metrics, Outlook, Recommendations } from "@/components/scheduling/ForecastParts";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { ScheduleBanner, ScheduleError, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import type { ForecastDay, ForecastRecommendation } from "@/lib/api/schedulingForecast";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { assignmentsHref } from "@/lib/navigation/supervisorRoutes";
import { teamScheduleParams } from "@/lib/navigation/teamScheduleLink";
import { fetchedAtOf } from "@/lib/housekeeping/supervisorSources";
import { dayOf, targetFor, type ForecastTarget } from "@/lib/scheduling/forecastModel";
import { formatLongDate } from "@/lib/scheduling/teamScheduleDates";
import { useStaffingForecast } from "@/lib/scheduling/useStaffingForecast";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_ATTENTION = 6;

/** Opens an existing screen for a recommendation. It navigates; it never performs the action. */
export function openForecastTarget(target: ForecastTarget): void {
  switch (target.screen) {
    case "coverage":
      router.push({ pathname: "/(app)/team-schedule/coverage", params: { gapId: target.gapId } } as never);
      return;
    case "schedule":
      router.push({ pathname: "/(app)/team-schedule", params: teamScheduleParams({ view: target.view, date: target.date, compose: target.compose ?? undefined }) } as never);
      return;
    case "requests":
      router.push("/(app)/team-schedule/requests" as never);
      return;
    case "assignments":
      openSupervisorHref(assignmentsHref({}));
      return;
  }
}

/* ─── Staffing Forecast ─────────────────────────────────────────────────────
   Read-only. The server compares estimated housekeeping work with scheduled room-attendant labour; this screen shows its
   answer, where it came from and how sure it is. It never publishes a schedule, assigns anyone or moves a room. */

export function ForecastScreen({ openDate = null }: { openDate?: string | null }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const language = i18n.language;
  const { today, zone, nowMs } = useHotelToday();
  const { state, forecast, reload } = useStaffingForecast({ today, nowMs });
  const [refreshing, setRefreshing] = useState(false);
  const [opened, setOpened] = useState<string | null>(openDate);

  // A change made on a screen opened from here (add a shift, find coverage) is read again on return.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false;
      else void reload();
    }, [reload]),
  );
  useEffect(() => setOpened(openDate), [openDate]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const days = forecast?.days ?? [];
  const todayForecast = dayOf(forecast, today) ?? days[0] ?? null;
  const openDay = opened ? dayOf(forecast, opened) : null;
  const attention = useMemo<ForecastRecommendation[]>(() => {
    const seen = new Set<string>();
    const own = todayForecast?.recommendations ?? [];
    const others = days.filter((day) => day !== todayForecast).flatMap((day) => day.recommendations.filter((rec) => rec.severity === "attention"));
    return [...own, ...others].filter((rec) => (seen.has(rec.id) ? false : (seen.add(rec.id), true))).slice(0, MAX_ATTENTION);
  }, [days, todayForecast]);

  const onAction = useCallback((item: ForecastRecommendation) => {
    const target = item.action ? targetFor(item.action) : null;
    if (!target) return;
    setOpened(null);
    openForecastTarget(target);
  }, []);

  const fetchedAt = fetchedAtOf(state);
  const when = fetchedAt !== null ? formatHotelTime(new Date(fetchedAt), zone, language) : null;
  const banner =
    state.status === "stale" && when
      ? { icon: state.reason === "offline" || !isOnline ? ("cloud-offline-outline" as const) : ("time-outline" as const), text: t(state.reason === "offline" || !isOnline ? "teamSchedule.forecast.offlineStale" : "teamSchedule.forecast.stale", { time: when }) }
      : !isOnline && state.status !== "failed"
        ? { icon: "cloud-offline-outline" as const, text: t("teamSchedule.offline") }
        : null;
  const dateLine = [forecast?.hotelName, todayForecast ? formatLongDate(todayForecast.date, language) : null, when && state.status !== "stale" ? t("teamSchedule.forecast.updated", { time: when }) : null].filter(Boolean).join(" · ");

  return (
    <ScreenFrame title={t("teamSchedule.forecast.title")} kicker={t("teamSchedule.forecast.kicker")} fallback="/(app)/team-schedule" testID="forecast-screen">
      {state.status === "loading" ? (
        <ScheduleSkeleton rows={3} />
      ) : state.status === "failed" ? (
        <ScheduleError failure={state.failure} onRetry={() => void refresh()} t={t} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          testID="forecast-scroll"
        >
          {banner ? <ScheduleBanner icon={banner.icon} text={banner.text} testID="forecast-banner" /> : null}
          {dateLine ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dateLine, { color: theme.textSecondary }]} testID="forecast-dateline">
              {dateLine}
            </Text>
          ) : null}
          {todayForecast ? (
            <>
              <Hero day={todayForecast} t={t} />
              <Metrics day={todayForecast} t={t} />
              <Recommendations items={attention} onAction={onAction} t={t} />
              <Breakdown day={todayForecast} t={t} />
            </>
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dateLine, { color: theme.textSecondary }]} testID="forecast-nodata">
              {t("teamSchedule.forecast.noData")}
            </Text>
          )}
          {forecast && forecast.unreadableDays > 0 ? <ScheduleBanner icon="time-outline" text={t("teamSchedule.forecast.unreadableDays", { count: forecast.unreadableDays })} testID="forecast-unreadable" /> : null}
          {days.length > 0 ? <Outlook days={days} selected={opened} language={language} onOpen={setOpened} t={t} /> : null}
        </ScrollView>
      )}
      <ForecastDaySheet day={openDay as ForecastDay | null} zone={zone} language={language} onClose={() => setOpened(null)} onAction={onAction} t={t} />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  dateLine: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
