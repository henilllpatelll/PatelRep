import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StateBlock } from "@/components/ui/StateBlock";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import type { Task } from "@/lib/api/tasks";
import { formatHotelTime, formatShiftDate } from "@/lib/housekeeping/hotelTime";
import { groupHistory } from "@/lib/tasks/offline/history";
import { taskScope } from "@/lib/tasks/offline/taskCache";
import { useCompletedHistory } from "@/lib/tasks/offline/useCompletedHistory";
import { shortPlace } from "@/lib/tasks/taskDisplay";

/* Completed Tasks: the signed-in employee's own completion records, newest first, grouped by the hotel's
   local day. Every row comes from the server (GET /tasks/mine/completed); the first page is also saved so
   the list still opens offline, labelled with when it was last synced. "Completed today" is the server's
   count for the hotel day — never a local counter, and a saved-for-sync completion is not in it. */

const MAX_FONT_SCALE = 1.5;

export default function TaskHistoryScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { hotelTimezone, isOnline, user } = useAppStore();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const zone = hotelTimezone ?? null;
  const scope = taskScope(user);
  const viewer = useMemo(() => ({ userId: user?.id ?? null, role: user?.role ?? null }), [user?.id, user?.role]);

  const history = useCompletedHistory({ isOnline, scope, zone });
  const now = useMemo(() => new Date(), [history.tasks]);
  const sections = useMemo(() => groupHistory(history.tasks, now, zone), [history.tasks, now, zone]);

  const [selected, setSelected] = useState<Task | null>(null);
  const adopt = useCallback((task: Task) => setSelected((current) => (current && current.id === task.id ? task : current)), []);
  const noop = useCallback(() => undefined, []);

  const sectionTitle = (key: string) =>
    key === "today" ? t("tasks.hk.hist.today") : key === "yesterday" ? t("tasks.hk.hist.yesterday") : (formatShiftDate(key, language) ?? key).toUpperCase();

  const doneValue = history.done.value;
  const headline = doneValue
    ? doneValue.atLeast
      ? t("tasks.hk.hist.completedTodayAtLeast", { count: doneValue.count })
      : t("tasks.hk.hist.completedToday", { count: doneValue.count })
    : t("tasks.hk.hist.completedTodayUnknown");

  const savedAt = history.syncedAt ? formatHotelTime(history.syncedAt, zone, language) : null;
  const showSavedBanner = history.status === "ready" && (history.fromCache || !isOnline);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line, paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("tasks.hk.hist.back")} style={styles.back} testID="history-back">
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        </Pressable>
        <View style={styles.headText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.shell.ink }]}>
            {t("tasks.hk.historyTitle")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headline, { color: theme.shell.ink3 }]} testID="history-done-today">
            {headline}
          </Text>
        </View>
      </View>

      {history.status === "loading" ? (
        <StateBlock status="loading" />
      ) : history.status === "error" ? (
        <StateBlock
          status="error"
          errorMessage={t(isOnline ? "tasks.hk.historyFailed" : "tasks.hk.hist.offlineEmpty")}
          onRetry={history.retry}
          retryLabel={t("common.retry")}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(task) => task.id}
          stickySectionHeadersEnabled={false}
          initialNumToRender={12}
          windowSize={7}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={() => void history.refresh()} tintColor={theme.primaryAction} />}
          ListHeaderComponent={
            <View style={styles.listHead}>
              {showSavedBanner ? (
                <View style={[styles.banner, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} accessibilityRole="alert" testID="history-saved-copy">
                  <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
                    {savedAt ? t("tasks.hk.hist.cachedBanner", { time: savedAt }) : t("tasks.hk.hist.cachedBannerNoTime")}
                  </Text>
                </View>
              ) : null}
              {sections.length > 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recent, { color: theme.textMuted }]}>
                  {t("tasks.hk.hist.recent")}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={<EmptyState icon="checkmark-done-outline" title={t(isOnline ? "tasks.hk.historyEmpty" : "tasks.hk.hist.offlineEmpty")} />}
          renderSectionHeader={({ section }) => (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
              {sectionTitle(section.key)}
            </Text>
          )}
          renderItem={({ item }) => {
            const place = shortPlace(item, t);
            const time = formatHotelTime(item.completed_at, zone, language) ?? "";
            return (
              <Pressable
                onPress={() => setSelected(item)}
                accessibilityRole="button"
                accessibilityLabel={
                  place
                    ? t("tasks.hk.hist.rowA11y", { title: item.title, place, time })
                    : t("tasks.hk.hist.rowA11yNoPlace", { title: item.title, time })
                }
                style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
                testID={`history-row-${item.id}`}
              >
                <Ionicons name="checkmark-circle" size={22} color={theme.status.clean} />
                <View style={styles.rowText}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                    {place ? `${place} — ${item.title}` : item.title}
                  </Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMeta, { color: theme.textMuted }]}>
                    {t("tasks.hk.hist.completedAt", { time })}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={
            history.hasMore ? (
              <View style={styles.footer}>
                <Button
                  label={t("tasks.hk.historyLoadMore")}
                  onPress={() => void history.loadMore()}
                  loading={history.loadingMore}
                  disabled={history.loadingMore}
                  variant="secondary"
                  testID="history-load-more"
                />
                {history.moreFailed ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.rowMeta, { color: theme.status.dirty }]}>
                    {t(history.moreFailed === "offline" ? "tasks.hk.hist.offlineMore" : "tasks.hk.historyFailed")}
                  </Text>
                ) : null}
              </View>
            ) : null
          }
        />
      )}

      {/* Read-only: a completed task offers no actions. Notes and activity load when there is a connection. */}
      <TaskDetailSheet
        visible={selected !== null}
        task={selected}
        viewer={viewer}
        zone={zone}
        language={language}
        now={now}
        busy={false}
        offline={!isOnline}
        notice={null}
        canOpenRoom={false}
        onClose={() => setSelected(null)}
        onTaskRefreshed={adopt}
        onAction={noop}
        onRequestComplete={noop}
        onRequestBlocker={noop}
        onOpenNotes={noop}
        onOpenRoom={noop}
        savedCopySyncedAt={history.syncedAt}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 12, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "700" },
  headline: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 8, flexGrow: 1 },
  listHead: { gap: 8 },
  banner: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  recent: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, paddingTop: 4 },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, paddingTop: 12, paddingBottom: 2 },
  row: { minHeight: 60, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  rowMeta: { fontSize: 12.5 },
  footer: { gap: 8, paddingTop: 8 },
});
