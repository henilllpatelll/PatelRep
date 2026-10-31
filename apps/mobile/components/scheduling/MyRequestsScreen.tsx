import { useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { RequestCard } from "@/components/scheduling/RequestCard";
import { ChipRow, FailureNotice } from "@/components/scheduling/requestParts";
import { RequestSheet } from "@/components/scheduling/RequestSheet";
import { ScheduleBanner, ScheduleEmptyCard, ScheduleSkeleton } from "@/components/scheduling/ScheduleStates";
import { ScreenFrame } from "@/components/scheduling/ScreenFrame";
import { Button } from "@/components/ui/Button";
import { fetchMyRequests, type RequestItem } from "@/lib/api/schedulingRequests";
import { validUuid } from "@/lib/scheduling/myWeek";
import { useRemote } from "@/lib/scheduling/requestHooks";
import { filterMine, MY_REQUEST_FILTERS, type MyRequestsFilter } from "@/lib/scheduling/requestsModel";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── My requests (employee) ────────────────────────────────────────────────
   Everything the signed-in employee asked for, and the swap proposals waiting on their answer. Statuses are the server's
   own; "Approved" only appears once a supervisor approved it. No notification is promised: the list is read on open and on
   pull-to-refresh. */

export function MyRequestsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const language = i18n.language;
  const remote = useRemote(fetchMyRequests, []);
  const [filter, setFilter] = useState<MyRequestsFilter>("all");
  const [selected, setSelected] = useState<RequestItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const list = remote.data;
  // A notification can name one request (time off or swap). It opens straight away when it is one of THIS person's requests;
  // anything else (cancelled elsewhere, someone else's, malformed) gets a plain "no longer available" note, never its data.
  const wanted = validUuid(useLocalSearchParams<{ requestId?: string }>().requestId);
  const opened = useRef<string | null>(null);
  const match = wanted && list ? list.items.find((item) => item.id.toLowerCase() === wanted) ?? null : null;
  const requestGone = wanted !== null && list !== null && list !== undefined && match === null;
  useEffect(() => {
    if (match && opened.current !== match.id) {
      opened.current = match.id;
      setSelected(match);
    }
  }, [match]);
  const rows = list ? filterMine(list.items, filter) : [];
  const action = list?.counts.action_required ?? 0;

  const refresh = async () => {
    setRefreshing(true);
    await remote.refresh();
    setRefreshing(false);
  };

  const header = (
    <View style={styles.header}>
      {!isOnline ? <ScheduleBanner icon="cloud-offline-outline" text={t("scheduling.myRequests.offline")} testID="my-requests-offline" /> : null}
      {requestGone ? <ScheduleBanner icon="time-outline" text={t("scheduling.myRequests.unavailable")} testID="my-requests-unavailable" /> : null}
      {remote.failure && list ? <FailureNotice failure={remote.failure} t={t} testID="my-requests-refresh-failed" /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
        {t("scheduling.myRequests.intro")}
      </Text>
      <ChipRow options={MY_REQUEST_FILTERS} value={filter} onChange={setFilter} labelFor={(option) => `${t(`scheduling.myRequests.filter.${option}`)}${option === "action" && action > 0 ? ` (${action})` : ""}`} testID="my-requests-filter" wrap />
      <Button label={t("scheduling.myRequests.newTimeOff")} icon="add" variant="secondary" disabled={!isOnline} onPress={() => router.push("/(app)/scheduling/time-off" as never)} testID="my-requests-new" />
    </View>
  );

  return (
    <ScreenFrame title={t("scheduling.myRequests.title")} kicker={t("scheduling.myRequests.kicker")} fallback="/(app)/scheduling" testID="my-requests">
      {remote.status === "loading" && !list ? (
        <ScheduleSkeleton />
      ) : !list ? (
        <View style={styles.center} testID="my-requests-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textPrimary }]}>
            {t("scheduling.myRequests.loadFailed")}
          </Text>
          <Button label={t("common.retry")} onPress={() => void remote.refresh()} testID="my-requests-retry" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <ScheduleEmptyCard
              title={t(`scheduling.myRequests.empty.${filter === "all" ? "all" : filter === "action" ? "action" : "other"}.title`)}
              body={t(`scheduling.myRequests.empty.${filter === "all" ? "all" : filter === "action" ? "action" : "other"}.body`)}
              testID="my-requests-empty"
            />
          }
          renderItem={({ item }) => <RequestCard item={item} audience="self" language={language} onPress={() => setSelected(item)} t={t} />}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          testID="my-requests-list"
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
  intro: { fontSize: 15, lineHeight: 21 },
  separator: { height: 10 },
});
