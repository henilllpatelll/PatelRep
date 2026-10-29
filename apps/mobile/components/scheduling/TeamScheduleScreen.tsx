import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { AttentionList } from "@/components/scheduling/AttentionList";
import { CoverageAttention } from "@/components/scheduling/CoverageAttention";
import { PersonScheduleCard } from "@/components/scheduling/PersonScheduleCard";
import { ScheduleFilterSheet } from "@/components/scheduling/ScheduleFilterSheet";
import { ScheduleHeader } from "@/components/scheduling/ScheduleHeader";
import { ScheduleBanner, ScheduleEmpty, ScheduleError, ScheduleSkeleton, type EmptyKind } from "@/components/scheduling/ScheduleStates";
import { ShiftManager, type FormRequest } from "@/components/scheduling/ShiftManager";
import { ShiftGroupCard } from "@/components/scheduling/ShiftGroupCard";
import { StaffingSummary } from "@/components/scheduling/StaffingSummary";
import { WeekDateSelector } from "@/components/scheduling/WeekDateSelector";
import { BoardNotice } from "@/components/supervisor/board/BoardStates";
import { Button } from "@/components/ui/Button";
import type { TeamSchedule } from "@/lib/api/schedulingTeam";
import { knownValue } from "@/lib/housekeeping/supervisorSources";
import { BoardSearchBar } from "@/components/supervisor/board/BoardSearchBar";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { assignmentsHref } from "@/lib/navigation/supervisorRoutes";
import type { TeamScheduleLink, TeamScheduleView } from "@/lib/navigation/teamScheduleLink";
import { onCoverageChanged } from "@/lib/scheduling/coverageSignal";
import { addDaysToYmd, formatLongDate, shiftWeek } from "@/lib/scheduling/teamScheduleDates";
import type { RosterPerson, ShiftGroup } from "@/lib/scheduling/teamScheduleModel";
import {
  applyView,
  buildFilterOptions,
  DEFAULT_VIEW_STATE,
  filterGroups,
  isDefaultView,
  pruneFilters,
  viewBadge,
  type ScheduleViewState,
} from "@/lib/scheduling/teamScheduleQuery";
import { selectDayView, selectWeekView } from "@/lib/scheduling/teamScheduleView";
import { useCoverageGaps } from "@/lib/scheduling/useCoverageGaps";
import { useHotelToday, useTeamSchedule } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

type Row = { kind: "person"; person: RosterPerson } | { kind: "group"; group: ShiftGroup };

/* ─── Team Schedule — Today and Week ────────────────────────────────────────
   Read-only. "Who is expected to work, and when" (the plan) beside "who has actually started" (verified
   attendance, only for the hotel's current day). Room work stays in Assignments; nothing here edits a shift. */

export function TeamScheduleScreen({ link }: { link: TeamScheduleLink }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const language = i18n.language;

  const { today, zone, nowMs } = useHotelToday();
  const [view, setView] = useState<TeamScheduleView>(link.view);
  // null follows the hotel's current day, including across midnight.
  const [picked, setPicked] = useState<string | null>(link.date);
  const date = picked ?? today;
  const [viewState, setViewState] = useState<ScheduleViewState>(DEFAULT_VIEW_STATE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);
  const [form, setForm] = useState<FormRequest | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(link.userId);
  const [linkMissing, setLinkMissing] = useState(false);

  const openShift = useCallback((userId: string, shiftId?: string) => {
    setOpenShiftId(shiftId ?? null);
    setOpenUserId(userId);
  }, []);
  const closeDetail = useCallback(() => {
    setOpenUserId(null);
    setOpenShiftId(null);
  }, []);

  const { week, day, refreshing, refresh: refreshSchedule } = useTeamSchedule({ date, today, nowMs });
  const coverage = useCoverageGaps(isOnline);
  const reloadCoverage = coverage.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshSchedule(), reloadCoverage()]);
  }, [refreshSchedule, reloadCoverage]);
  // Find Coverage / Open Shifts sit on top of this screen; when they change a gap, read coverage again.
  useEffect(() => onCoverageChanged(() => void reloadCoverage()), [reloadCoverage]);
  const dayGaps = useMemo(() => coverage.byDate.get(date) ?? [], [coverage.byDate, date]);
  const uncoveredByDay = useMemo(() => Object.fromEntries([...coverage.byDate].map(([key, list]) => [key, list.length])), [coverage.byDate]);
  const findCoverage = useCallback((gapId: string) => router.push({ pathname: "/(app)/team-schedule/coverage", params: { gapId } } as never), []);
  const openOpenShifts = useCallback(() => router.push({ pathname: "/(app)/team-schedule/open-shifts", params: { date } } as never), [date]);
  const ctx = useMemo(() => ({ zone, language, nowMs }), [zone, language, nowMs]);
  const dayView = useMemo(() => selectDayView(date, today, week, day, ctx), [date, today, week, day, ctx]);
  const weekView = useMemo(() => selectWeekView(date, week), [date, week]);
  const roster = dayView.roster;
  const isToday = date === today;

  const options = useMemo(() => buildFilterOptions(roster?.people ?? [], dayView.groups), [roster, dayView.groups]);
  // A filter that names something this day does not have is dropped, so it cannot empty the list invisibly.
  const filters = useMemo(() => pruneFilters(viewState.filters, options), [viewState.filters, options]);
  const effective = useMemo<ScheduleViewState>(() => ({ ...viewState, filters }), [viewState, filters]);
  const people = useMemo(() => applyView(roster?.people ?? [], effective), [roster, effective]);
  const groups = useMemo(() => filterGroups(dayView.groups, new Set(people.map((person) => person.userId)), filters), [dayView.groups, people, filters]);
  const rows = useMemo<Row[]>(() => (view === "today" ? people.map((person) => ({ kind: "person", person })) : groups.map((group) => ({ kind: "group", group }))), [view, people, groups]);

  // A deep link names a person: open them once the day has loaded, or say they are not on this schedule.
  useEffect(() => {
    if (!pendingLink || dayView.state !== "ready" || !roster) return;
    const found = roster.people.some((person) => person.userId === pendingLink);
    if (found) openShift(pendingLink);
    else setLinkMissing(true);
    setPendingLink(null);
  }, [pendingLink, dayView.state, roster, openShift]);

  // Today's attendance read and the week's plan both hold shifts; either may be the only one that has answered.
  const weekData = knownValue<TeamSchedule | null>(week, null);
  const dayData = knownValue<TeamSchedule | null>(day, null);
  const scopePeople = useMemo(() => [...new Map([...(weekData?.people ?? []), ...(dayData?.people ?? [])].map((person) => [person.userId, person])).values()], [weekData, dayData]);
  const scopeShifts = useMemo(() => [...new Map([...(weekData?.shifts ?? []), ...(dayData?.shifts ?? [])].map((shift) => [shift.id, shift])).values()], [weekData, dayData]);
  const openTemplates = useCallback(() => router.push("/(app)/team-schedule/templates" as never), []);

  const select = useCallback((next: string) => setPicked(next === today ? null : next), [today]);
  const dateLabel = formatLongDate(date, language);
  const clock = dayView.verifiedAt !== null ? formatHotelTime(new Date(dayView.verifiedAt), zone, language) : null;
  const freshness = dayView.state !== "ready" || !clock ? null : { text: t(dayView.stale ? "teamSchedule.freshness.stale" : "teamSchedule.freshness.updated", { time: clock }), stale: dayView.stale };
  const asOf = dayView.attendanceAsOf !== null ? formatHotelTime(new Date(dayView.attendanceAsOf), zone, language) : null;

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/home" as never);
  }, []);
  const openAssignments = useCallback((userId: string) => {
    closeDetail();
    openSupervisorHref(assignmentsHref({ staffId: userId }));
  }, [closeDetail]);
  const clearAll = useCallback(() => setViewState(DEFAULT_VIEW_STATE), []);

  const emptyKind: EmptyKind | null =
    dayView.state !== "ready" || rows.length > 0
      ? null
      : (roster?.people.length ?? 0) === 0
        ? dayView.verifiedEmpty || dayView.staffInScope === 0
          ? "noStaff"
          : "nobodyScheduled"
        : viewState.query.trim()
          ? "search"
          : "filters";

  const listHeader = (
    <View style={styles.listHeader}>
      {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("teamSchedule.offline")} testID="team-schedule-offline" /> : null}
      {dayView.state === "ready" ? (
        <>
          <StaffingSummary scheduled={dayView.scheduledCount} counts={dayView.counts} attendanceNote={asOf ? t("teamSchedule.summary.attendanceAsOf", { time: asOf }) : null} attendanceMissing={isToday && roster?.mode === "unavailable"} isToday={isToday} t={t} />
          <CoverageAttention gaps={dayGaps} status={coverage.status} zone={zone} language={language} onFind={findCoverage} onRetry={() => void reloadCoverage()} t={t} />
          <AttentionList items={dayView.attention} nowMs={nowMs} zone={zone} language={language} onOpenPerson={openShift} t={t} />
          {linkMissing ? <BoardNotice body={t("teamSchedule.linkMissing")} closeLabel={t("common.close")} onClose={() => setLinkMissing(false)} testID="team-schedule-link-missing" /> : null}
          <View style={styles.actions}>
            <View style={styles.actionCell}>
              <Button label={t("teamSchedule.manage.addShift")} icon="add" onPress={() => setForm({ mode: "add", source: null, date: date < today ? today : date })} disabled={!isOnline} testID="team-schedule-add-shift" />
            </View>
            <View style={styles.actionCell}>
              <Button label={coverage.todo.length > 0 ? t("teamSchedule.coverage.openShiftsCount", { count: coverage.todo.length }) : t("teamSchedule.coverage.openShifts")} icon="people-circle-outline" variant="secondary" onPress={openOpenShifts} testID="team-schedule-open-shifts" />
            </View>
            <View style={styles.actionCell}>
              <Button label={t("teamSchedule.manage.templatesLink")} icon="layers-outline" variant="secondary" onPress={openTemplates} testID="team-schedule-open-templates" />
            </View>
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.section, { color: theme.textPrimary }]} testID="team-schedule-list-title">
            {t(view === "today" ? "teamSchedule.team.title" : "teamSchedule.team.weekTitle", { count: people.length, date: dateLabel })}
          </Text>
          {(roster?.people.length ?? 0) > 0 ? (
            <View style={styles.searchBleed}>
            <BoardSearchBar
              value={viewState.query}
              onChangeText={(query) => setViewState((held) => ({ ...held, query }))}
              onClear={() => setViewState((held) => ({ ...held, query: "" }))}
              onOpenFilters={() => setFiltersOpen(true)}
              activeCount={viewBadge(effective)}
              t={t}
              placeholder={t("teamSchedule.search.placeholder")}
              label={t("teamSchedule.search.label")}
              filterLabel={t("teamSchedule.filters.open")}
              testIDPrefix="team-schedule"
            />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (item.kind === "person" ? <PersonScheduleCard person={item.person} onOpen={openShift} t={t} /> : <ShiftGroupCard group={item.group} onOpen={openShift} t={t} />),
    [t, openShift],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="team-schedule">
      <ScheduleHeader
        topInset={insets.top}
        view={view}
        onView={setView}
        dateLabel={dateLabel}
        isToday={isToday}
        onPrevDay={() => select(addDaysToYmd(date, -1))}
        onNextDay={() => select(addDaysToYmd(date, 1))}
        onToday={() => setPicked(null)}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onBack={onBack}
        freshness={freshness}
        t={t}
      />
      {view === "week" ? (
        <WeekDateSelector
          days={weekView.days}
          selected={date}
          today={today}
          summaries={weekView.summaries}
          uncovered={uncoveredByDay}
          language={language}
          onSelect={select}
          onPrevWeek={() => select(shiftWeek(date, -1))}
          onNextWeek={() => select(shiftWeek(date, 1))}
          onToday={() => setPicked(null)}
          t={t}
        />
      ) : null}

      {dayView.state === "loading" ? (
        <ScheduleSkeleton />
      ) : dayView.state === "failed" ? (
        <ScheduleError failure={dayView.failure} onRetry={() => void refresh()} t={t} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => (row.kind === "person" ? `p:${row.person.userId}` : `g:${row.group.key}`)}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyKind ? <ScheduleEmpty kind={emptyKind} dateLabel={dateLabel} onClear={emptyKind === "search" || emptyKind === "filters" ? clearAll : undefined} t={t} /> : undefined}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={10}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          testID="team-schedule-list"
        />
      )}

      <ScheduleFilterSheet
        visible={filtersOpen}
        applied={effective}
        options={options}
        showStatus={roster?.mode !== "not_applicable"}
        previewCount={(draft) => applyView(roster?.people ?? [], draft).length}
        t={t}
        onApply={(draft) => {
          setViewState(draft);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
      <ShiftManager
        roster={roster}
        people={scopePeople}
        rows={scopeShifts}
        openUserId={openUserId}
        openShiftId={openShiftId}
        onCloseDetail={closeDetail}
        form={form}
        onForm={setForm}
        today={today}
        zone={zone}
        language={language}
        isOnline={isOnline}
        onChanged={refresh}
        onOpenAssignments={openAssignments}
        onOpenTemplates={openTemplates}
        coverageFor={coverage.forAssignment}
        onFindCoverage={findCoverage}
        onCoverageChanged={() => void reloadCoverage()}
        t={t}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  listHeader: { gap: 12, paddingBottom: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCell: { flex: 1 },
  section: { fontSize: 17, fontWeight: "800", marginTop: 4 },
  separator: { height: 10 },
  // The shared search bar brings its own 16pt gutter; cancel the list's so it lines up with the cards.
  searchBleed: { marginHorizontal: -16 },
});
