import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { CoverageSheet } from "@/components/scheduling/CoverageSheet";
import { ChipRow, FailureNotice, SectionTitle, StatePill } from "@/components/scheduling/requestParts";
import { ScheduleBanner, ScheduleEmptyCard, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import {
  fetchMemberAvailability, fetchTeamAvailability, type MemberAvailability, type TeamAvailabilityFilter, type TeamAvailabilityPerson,
} from "@/lib/api/schedulingRequests";
import { useRemote } from "@/lib/scheduling/requestHooks";
import { clockLabel, dateRangeLabel, dayLine, statusText, weekSummary, windowsLabel } from "@/lib/scheduling/requestsModel";
import { formatLongDate, formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import { roleLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Team availability (supervisor) ────────────────────────────────────────
   What each person in this supervisor's departments SAID they can work. It is evidence, not attendance and not approved time
   off: a blank day means nothing was submitted ("unknown"), and a label like "Updated" is recency, not verification. */

const FILTERS: readonly TeamAvailabilityFilter[] = ["all", "submitted", "none", "stale"];

function freshText(person: Pick<TeamAvailabilityPerson, "freshness" | "lastUpdatedAt">, language: string | undefined, t: Translate): string {
  const date = person.lastUpdatedAt ? formatShortDate(person.lastUpdatedAt.slice(0, 10), language) : "";
  return t(`teamSchedule.availability.fresh.${person.freshness}`, { date });
}

function PersonCard({ person, language, onPress, t }: { person: TeamAvailabilityPerson; language?: string; onPress: () => void; t: Translate }) {
  const theme = useTheme();
  const name = person.name ?? t("teamSchedule.unnamed");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("teamSchedule.availability.open", { name })}
      testID={`team-availability-${person.id}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: person.freshness === "stale" ? theme.status.pickup : theme.borderSubtle }, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {name}
          </Text>
          {person.role ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>{roleLabel(person.role, t)}</Text> : null}
        </View>
        <StatePill text={person.submitted ? t("teamSchedule.availability.filters.submitted") : t("teamSchedule.availability.notSubmitted")} tone={person.submitted ? (person.freshness === "stale" ? "warn" : "good") : "neutral"} />
      </View>
      {person.submitted ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID={`team-availability-week-${person.id}`}>
          {weekSummary(person.weekly, t)}
        </Text>
      ) : null}
      {person.exceptionCount > 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>{t("teamSchedule.availability.exceptionsCount", { count: person.exceptionCount })}</Text> : null}
      {person.leave[0] ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.pickup }]}>
          {t("teamSchedule.availability.leaveSoon", { range: dateRangeLabel(person.leave[0].startDate, person.leave[0].endDate, language), status: statusText(person.leave[0].status, t) })}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, styles.flex, { color: theme.textMuted }]}>
          {freshText(person, language, t)}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>
    </Pressable>
  );
}

function MemberSheet({ person, language, onClose, t }: { person: TeamAvailabilityPerson | null; language?: string; onClose: () => void; t: Translate }) {
  const theme = useTheme();
  const remote = useRemote<MemberAvailability>(() => fetchMemberAvailability(person?.id ?? ""), [person?.id], Boolean(person));
  if (!person) return null;
  const detail = remote.data;
  return (
    <CoverageSheet visible title={person.name ?? t("teamSchedule.unnamed")} subtitle={person.role ? roleLabel(person.role, t) : null} closeLabel={t("teamSchedule.requests.detail.close")} onClose={onClose} testID="member-availability">
      {!detail ? (
        remote.failure ? <FailureNotice failure={remote.failure} t={t} testID="member-availability-failed" /> : <ScheduleSkeleton rows={3} />
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="member-availability-fresh">
            {freshText(detail, language, t)}
          </Text>
          {!detail.submitted ? <SheetNotice text={t("teamSchedule.availability.fresh.none")} testID="member-availability-none" /> : null}
          <SectionTitle>{t("teamSchedule.availability.week")}</SectionTitle>
          {detail.weekly.map((rule) => (
            <Text key={rule.weekday} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: rule.state === "unset" ? theme.textMuted : theme.textPrimary }]} testID={`member-availability-day-${rule.weekday}`}>
              {dayLine(rule, language, t)}
            </Text>
          ))}
          {detail.upcomingChange ? (
            <SheetNotice text={`${t("teamSchedule.availability.upcoming", { date: formatLongDate(detail.upcomingChange.effectiveFrom, language) })}: ${detail.upcomingChange.weekly.filter((d) => d.state !== "unset").map((d) => dayLine(d, language, t)).join(" · ")}`} testID="member-availability-upcoming" />
          ) : null}
          <SectionTitle>{t("teamSchedule.availability.exceptions")}</SectionTitle>
          {detail.exceptions.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>{t("teamSchedule.availability.noExceptions")}</Text> : null}
          {detail.exceptions.map((ex) => (
            <Text key={ex.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
              {ex.mode === "unavailable" ? t("teamSchedule.availability.unavailableOn", { date: formatLongDate(ex.date, language) }) : t("teamSchedule.availability.availableOn", { date: formatLongDate(ex.date, language), windows: windowsLabel(ex.windows, language, t) })}
            </Text>
          ))}
          <SectionTitle>{t("teamSchedule.availability.leave")}</SectionTitle>
          {detail.leave.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>{t("teamSchedule.availability.noLeave")}</Text> : null}
          {detail.leave.map((leave) => (
            <Text key={leave.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
              {`${dateRangeLabel(leave.startDate, leave.endDate, language)} · ${statusText(leave.status, t)}`}
            </Text>
          ))}
          {detail.clashes.length > 0 ? (
            <>
              <SectionTitle>{t("teamSchedule.availability.clash.title")}</SectionTitle>
              <SheetNotice tone="warn" text={t("teamSchedule.availability.clash.body")} testID="member-availability-clash-note" />
              {detail.clashes.map((clash) => (
                <View key={clash.id} style={[styles.clash, { borderColor: theme.status.pickup, backgroundColor: theme.surfaceSubtle }]} testID={`member-availability-clash-${clash.id}`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.strong, { color: theme.textPrimary }]}>
                    {`${formatShortDate(clash.workDate, language)} · ${clash.shiftName ?? ""} · ${clockLabel(clash.startTime, language)} – ${clockLabel(clash.endTime, language)}`}
                  </Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
                    {t(clash.availability === "unavailable" ? "teamSchedule.availability.clash.unavailable" : "teamSchedule.availability.clash.outside")}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
    </CoverageSheet>
  );
}

export function TeamAvailabilityScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const language = i18n.language;
  const [filter, setFilter] = useState<TeamAvailabilityFilter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TeamAvailabilityPerson | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);
  const remote = useRemote(() => fetchTeamAvailability({ q: search, filter }), [search, filter]);
  const list = remote.data;

  const header = (
    <View style={styles.header}>
      {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("teamSchedule.requests.offline")} testID="team-availability-offline" /> : null}
      {remote.failure && list ? <FailureNotice failure={remote.failure} t={t} testID="team-availability-refresh-failed" /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="team-availability-note">
        {t("teamSchedule.availability.note")}
      </Text>
      <ChipRow options={FILTERS} value={filter} onChange={setFilter} labelFor={(option) => t(`teamSchedule.availability.filters.${option}`)} testID="team-availability-filter" wrap />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("teamSchedule.availability.search")}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={t("teamSchedule.availability.search")}
        autoCorrect={false}
        testID="team-availability-search"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.search, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
      />
      {list ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>{t("teamSchedule.availability.count", { shown: list.people.length, total: list.total })}</Text> : null}
    </View>
  );

  return (
    <ScreenFrame title={t("teamSchedule.availability.title")} kicker={t("teamSchedule.availability.kicker")} fallback="/(app)/team-schedule" testID="team-availability">
      {remote.status === "loading" && !list ? (
        <ScheduleSkeleton />
      ) : !list ? (
        <View style={styles.center} testID="team-availability-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {t("teamSchedule.requests.loadFailed")}
          </Text>
          <Button label={t("common.retry")} onPress={() => void remote.refresh()} testID="team-availability-retry" />
        </View>
      ) : (
        <FlatList
          data={list.people}
          keyExtractor={(person) => person.id}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.center} testID="team-availability-empty">
              <ScheduleEmptyCard title={t("teamSchedule.availability.empty.title")} body={t("teamSchedule.availability.empty.body")} testID="team-availability-empty-card" />
              {filter !== "all" || search ? <Button label={t("teamSchedule.availability.empty.clear")} variant="secondary" onPress={() => { setFilter("all"); setQuery(""); }} testID="team-availability-clear" /> : null}
            </View>
          }
          renderItem={({ item }) => <PersonCard person={item} language={language} onPress={() => setSelected(item)} t={t} />}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void remote.refresh().finally(() => setRefreshing(false)); }} tintColor={theme.primaryAction} />}
          keyboardShouldPersistTaps="handled"
          testID="team-availability-list"
        />
      )}
      <MemberSheet person={selected} language={language} onClose={() => setSelected(null)} t={t} />
    </ScreenFrame>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: { gap: 10, paddingBottom: 12 },
  list: { padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 6 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 17, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: "700" },
  muted: { fontSize: 13, lineHeight: 18 },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  separator: { height: 10 },
  clash: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
});
