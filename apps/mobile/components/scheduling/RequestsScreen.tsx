import { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { RequestCard } from "@/components/scheduling/RequestCard";
import { ChipRow, FailureNotice } from "@/components/scheduling/requestParts";
import { RequestSheet } from "@/components/scheduling/RequestSheet";
import { ScheduleBanner, ScheduleEmptyCard, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { Button } from "@/components/ui/Button";
import { fetchManagerRequests, type RequestItem } from "@/lib/api/schedulingRequests";
import { useRemote } from "@/lib/scheduling/requestHooks";
import { shiftDate, TEAM_FILTERS, type TeamFilter } from "@/lib/scheduling/requestsModel";
import { weekDays } from "@/lib/scheduling/teamScheduleDates";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Requests (supervisor) ─────────────────────────────────────────────────
   One list for time-off requests and shift swaps in the departments this role covers. "Pending" is what needs a decision
   from a supervisor: leave not yet decided, and swaps the coworker has accepted. Everything shown is read from the server;
   a decision is made in the drawer and only counts once the server answers. */

type TypeFilter = "all" | "time_off" | "shift_swap";
type RangeFilter = "all" | "week" | "month";
const TYPES: readonly TypeFilter[] = ["all", "time_off", "shift_swap"];
const RANGES: readonly RangeFilter[] = ["all", "week", "month"];

export function RequestsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const { today } = useHotelToday();
  const language = i18n.language;
  const [status, setStatus] = useState<TeamFilter>("pending");
  const [type, setType] = useState<TypeFilter>("all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RequestItem | null>(null);
  useEffect(() => {
    const handle = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  const bounds = useMemo(() => {
    if (range === "week") { const days = weekDays(today); return { from: days[0], to: days[6] }; }
    if (range === "month") return { from: today, to: shiftDate(today, 30) };
    return { from: null, to: null };
  }, [range, today]);

  const remote = useRemote(() => fetchManagerRequests({ type, status, dateFrom: bounds.from, dateTo: bounds.to, q: search }), [type, status, bounds.from, bounds.to, search]);
  const list = remote.data;
  const waiting = list?.counts.pending ?? 0;
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await remote.refresh();
    setRefreshing(false);
  };

  const empty = (
    <ScheduleEmptyCard title={t(`teamSchedule.requests.empty.${status}.title`)} body={t(`teamSchedule.requests.empty.${status}.body`)} testID="requests-empty" />
  );

  const header = (
    <View style={styles.header}>
      {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("teamSchedule.requests.offline")} testID="requests-offline" /> : null}
      {remote.failure && list ? <FailureNotice failure={remote.failure} t={t} testID="requests-refresh-failed" /> : null}
      {list && list.unreadable > 0 ? <SheetNotice tone="warn" text={t("teamSchedule.requests.someUnreadable", { count: list.unreadable })} testID="requests-unreadable" /> : null}
      {list?.truncated ? <SheetNotice text={t("teamSchedule.requests.truncated")} testID="requests-truncated" /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: waiting > 0 ? theme.status.pickup : theme.textSecondary }]} accessibilityLiveRegion="polite" testID="requests-pending-count">
        {waiting > 0 ? t("teamSchedule.requests.waiting", { count: waiting }) : t("teamSchedule.requests.nothingWaiting")}
      </Text>
      <ChipRow options={TEAM_FILTERS} value={status} onChange={setStatus} labelFor={(option) => t(`teamSchedule.requests.filter.${option}`)} testID="requests-status" />
      <ChipRow options={TYPES} value={type} onChange={setType} labelFor={(option) => t(`teamSchedule.requests.type.${option}`)} testID="requests-type" wrap />
      <ChipRow options={RANGES} value={range} onChange={setRange} labelFor={(option) => t(`teamSchedule.requests.range.${option}`)} testID="requests-range" wrap />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("teamSchedule.requests.search")}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={t("teamSchedule.requests.search")}
        autoCorrect={false}
        testID="requests-search"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.search, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
      />
    </View>
  );

  return (
    <ScreenFrame title={t("teamSchedule.requests.title")} kicker={t("teamSchedule.requests.kicker")} fallback="/(app)/team-schedule" testID="requests">
      {remote.status === "loading" && !list ? (
        <ScheduleSkeleton />
      ) : !list ? (
        <View style={styles.center} testID="requests-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textPrimary }]}>
            {t("teamSchedule.requests.loadFailed")}
          </Text>
          <Button label={t("common.retry")} onPress={() => void remote.refresh()} testID="requests-retry" />
        </View>
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => <RequestCard item={item} audience="manager" language={language} onPress={() => setSelected(item)} t={t} />}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          keyboardShouldPersistTaps="handled"
          testID="requests-list"
        />
      )}
      <RequestSheet item={selected} isOnline={isOnline} language={language} onClose={() => setSelected(null)} onChanged={() => void remote.refresh()} t={t} />
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
  count: { fontSize: 16, fontWeight: "800" },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  separator: { height: 10 },
});
