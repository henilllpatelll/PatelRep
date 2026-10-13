import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StateBlock } from "@/components/ui/StateBlock";
import { fetchCompletedPage, type Task } from "@/lib/api/tasks";
import { formatHotelTime, hotelDateKey } from "@/lib/housekeeping/hotelTime";

/* Read-only list of the tasks I completed (GET /tasks/mine/completed). A basic entry point so the
   header's history button is real; the full history experience is a later phase. */

export default function TaskHistoryScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { hotelTimezone } = useAppStore();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (after: string | null) => {
    try {
      const page = await fetchCompletedPage(after, 30);
      setTasks((prev) => (after ? [...prev, ...page.tasks.filter((task) => !prev.some((p) => p.id === task.id))] : page.tasks));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setMoreFailed(false);
      setStatus("ready");
    } catch {
      if (after) setMoreFailed(true);
      else setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load(null);
    setRefreshing(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line, paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.back")} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.shell.ink }]}>
          {t("tasks.hk.historyTitle")}
        </Text>
      </View>
      {status === "loading" ? (
        <StateBlock status="loading" />
      ) : status === "error" ? (
        <StateBlock status="error" errorMessage={t("tasks.hk.historyFailed")} onRetry={() => { setStatus("loading"); void load(null); }} retryLabel={t("common.retry")} />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(task) => task.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          ListEmptyComponent={<EmptyState icon="checkmark-done-outline" title={t("tasks.hk.historyEmpty")} />}
          renderItem={({ item }) => {
            const when = formatHotelTime(item.completed_at, hotelTimezone, language);
            const day = hotelDateKey(item.completed_at, hotelTimezone);
            return (
              <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]} accessible>
                <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{item.title}</Text>
                <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                  {[item.room_number ? t("tasks.hk.card.room", { room: item.room_number }) : item.location_text, day, when]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <Button
                label={t("tasks.hk.historyLoadMore")}
                onPress={() => void load(cursor)}
                variant="secondary"
                style={styles.more}
              />
            ) : moreFailed ? (
              <Text style={[styles.rowMeta, { color: theme.status.dirty }]}>{t("tasks.hk.historyFailed")}</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700" },
  content: { padding: 16, gap: 10 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  rowTitle: { fontSize: 15.5, fontWeight: "700" },
  rowMeta: { fontSize: 12.5 },
  more: { marginTop: 4 },
});
