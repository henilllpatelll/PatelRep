import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { R } from "@/components/shared/tokens";
import { fetchLogbookReport, type LogbookReport } from "@/lib/api/housekeepingSupervisor";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/** One saved logbook entry, read-only: where "View saved report" lands after a shift handoff. The server scopes the
 *  lookup to the signed-in person's hotel, so an id from anywhere else is "not found", never someone else's data. */
type State = { status: "loading" } | { status: "ready"; report: LogbookReport } | { status: "missing" } | { status: "error" };

export default function LogbookReportScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  const hotelTimezone = useAppStore((state) => state.hotelTimezone);
  const language = useAppStore((state) => state.user?.language_pref) ?? "en";
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!entryId) {
      setState({ status: "missing" });
      return;
    }
    try {
      setState({ status: "ready", report: await fetchLogbookReport(entryId) });
    } catch (error) {
      setState((error as { status?: unknown } | null)?.status === 404 ? { status: "missing" } : { status: "error" });
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/home" as never));

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top + 8 }]} testID="logbook-report">
      <View style={styles.header}>
        <Button label={t("common.back")} icon="chevron-back" variant="ghost" size="sm" onPress={back} testID="logbook-report-back" />
      </View>
      {state.status === "loading" ? <StateBlock status="loading" /> : null}
      {state.status === "missing" ? (
        <StateBlock status="empty" emptyIcon="document-text-outline" emptyTitle={t("logbook.report.missing")} emptyBody={t("logbook.report.missingBody")} />
      ) : null}
      {state.status === "error" ? (
        <StateBlock status="error" errorMessage={t("logbook.report.error")} onRetry={load} retryLabel={t("common.retry")} />
      ) : null}
      {state.status === "ready" ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        >
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
            {t("logbook.report.title")}
          </Text>
          <Text style={[styles.byline, { color: theme.textMuted }]} testID="logbook-report-byline">
            {[state.report.departmentName, state.report.authorName, formatHotelTime(state.report.createdAt, hotelTimezone, language)].filter(Boolean).join(" · ")}
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
            <Text selectable style={[styles.body, { color: theme.textPrimary }]} testID="logbook-report-content">
              {state.report.content}
            </Text>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, alignItems: "flex-start" },
  content: { padding: 18, gap: 10 },
  title: { fontSize: 24, fontWeight: "800" },
  byline: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 16, marginTop: 6 },
  body: { fontSize: 15, lineHeight: 23 },
});
