import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { displayFont } from "@/components/shared/tokens";
import { IconButton, Mono } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { SupervisorMessageSheet, type MarkReadError, type MessageDetails } from "@/components/home/SupervisorMessageSheet";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { isAssistantRole } from "@/lib/ai/fab";
import { listNotifications, markAllRead, markRead, type AppNotification } from "@/lib/api/notifications";
import { formatHotelTime, hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { notificationLinkIssue, resolveNotificationLink, senderOf, type NotificationLink } from "@/lib/housekeeping/notificationLinks";
import { buildFeedItems, groupByDay, mergeFeed, type FeedDay, type FeedFilter, type FeedKind } from "@/lib/notifications/feed";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

const ALL_LIMIT = 50;

const ICON: Record<FeedKind, ComponentProps<typeof Ionicons>["name"]> = {
  priority: "alert-circle-outline",
  maintenance: "build-outline",
  task: "checkmark-circle-outline",
  room: "bed-outline",
  message: "chatbubble-ellipses-outline",
  other: "notifications-outline",
};

const TONE: Record<FeedKind, "accent" | "caution" | "alert" | "ready" | "neutral"> = {
  priority: "alert",
  maintenance: "caution",
  task: "neutral",
  room: "accent",
  message: "accent",
  other: "neutral",
};

export default function NotificationsScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const myRooms = useAppStore((state) => state.myRooms);
  const hotelTimezone = useAppStore((state) => state.hotelTimezone) ?? null;
  const role = useAppStore((state) => state.user?.effective_role ?? state.user?.role);
  const setUnreadCount = useAppStore((state) => state.setUnreadCount);
  const assistant = useAssistantOptional();
  const [filter, setFilter] = useState<FeedFilter>("unread");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<MarkReadError>(null);
  const [markAllError, setMarkAllError] = useState(false);
  const [unreadRows, setUnreadRows] = useState<AppNotification[]>([]);
  const [allRows, setAllRows] = useState<AppNotification[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const loadUnread = useCallback(async () => {
    try {
      const res = await listNotifications(false);
      setUnreadRows(res.data);
      setLoadFailed(false);
      // The unread list IS the unread count: set from what the server returned, never cleared by merely viewing.
      setUnreadCount?.(res.data.length);
    } catch {
      // A failed refresh keeps what was loaded before; it must never read as "all caught up".
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [setUnreadCount]);

  const loadAll = useCallback(async () => {
    try {
      const res = await listNotifications(true, ALL_LIMIT);
      setAllRows(res.data);
      setAllFailed(false);
    } catch {
      setAllFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadUnread();
  }, [loadUnread]);

  // Read notifications are only fetched when the person looks at them.
  useEffect(() => {
    if (filter === "all" && allRows === null) void loadAll();
  }, [filter, allRows, loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadUnread(), filter === "all" ? loadAll() : Promise.resolve()]);
    setRefreshing(false);
  }, [loadUnread, loadAll, filter]);

  const handleMarkAll = useCallback(async () => {
    setMarkingAll(true);
    setMarkAllError(false);
    try {
      await markAllRead();
      setUnreadRows([]);
      setAllRows((rows) => (rows ? rows.map((row) => ({ ...row, is_read: true })) : rows));
      setUnreadCount?.(0);
    } catch {
      // Nothing was recorded: the list and the unread count stay as they were.
      setMarkAllError(true);
    } finally {
      setMarkingAll(false);
    }
  }, [setUnreadCount]);

  const merged = useMemo(() => mergeFeed(unreadRows, allRows), [unreadRows, allRows]);
  const items = useMemo(() => buildFeedItems(merged, filter), [merged, filter]);
  const groups = useMemo(() => groupByDay(items, hotelTimezone), [items, hotelTimezone]);

  const selected = merged.find((item) => item.id === selectedId) ?? null;
  const details = useMemo<MessageDetails | null>(
    () =>
      selected
        ? {
            id: selected.id,
            title: selected.title,
            body: selected.body,
            createdAt: selected.created_at ?? null,
            sender: senderOf(selected),
            link: resolveNotificationLink(selected, myRooms),
            linkIssue: notificationLinkIssue(selected, myRooms),
            read: selected.is_read,
          }
        : null,
    [selected, myRooms],
  );

  const openDetails = useCallback((id: string) => {
    setSelectedId(id);
    setMarkError(null);
    setSheetOpen(true);
  }, []);
  const closeDetails = useCallback(() => setSheetOpen(false), []);

  // Marking read is a server write: the row leaves the unread list only after the server accepted it.
  const handleMarkRead = useCallback(async () => {
    if (!selected || marking) return;
    setMarking(true);
    setMarkError(null);
    try {
      await markRead(selected.id);
      setUnreadRows((rows) => rows.filter((row) => row.id !== selected.id));
      setAllRows((rows) => (rows ? rows.map((row) => (row.id === selected.id ? { ...row, is_read: true } : row)) : rows));
      const count = useAppStore.getState().unreadCount;
      if (typeof count === "number") setUnreadCount?.(Math.max(0, count - 1));
      setSheetOpen(false);
    } catch {
      setMarkError(useAppStore.getState().isOnline === false ? "offline" : "failed");
    } finally {
      setMarking(false);
    }
  }, [selected, marking, setUnreadCount]);

  const openLink = useCallback((link: Exclude<NotificationLink, { kind: "none" }>) => {
    setSheetOpen(false);
    if (link.kind === "room") router.push(`/(app)/my-rooms/${link.roomId}` as never);
    else router.push({ pathname: "/(app)/tasks", params: { taskId: link.taskId } } as never);
  }, []);

  // Only identifiers this phone can already verify are handed over; the server authorises them again.
  const ask = useMemo(() => {
    if (!assistant || !isAssistantRole(role) || !details) return undefined;
    const { link } = details;
    if (link.kind === "none") return undefined;
    return () => {
      setSheetOpen(false);
      if (link.kind === "room") assistant.openAssistant({ contextType: "room", entityId: link.roomId, label: link.roomNumber });
      else assistant.openAssistant({ contextType: "task", entityId: link.taskId, label: details.title });
    };
  }, [assistant, role, details]);

  const dayTitle = (day: FeedDay) => t(`alertsScreen.day.${day}`);
  const stamp = (notification: AppNotification, day: FeedDay): string => {
    const clock = formatHotelTime(notification.created_at, hotelTimezone, language) ?? "";
    if (day !== "earlier") return clock;
    const key = hotelDateKey(notification.created_at, hotelTimezone);
    const [year, month, date] = (key ?? "").split("-").map(Number);
    if (!year) return clock;
    const label = new Date(Date.UTC(year, month - 1, date, 12)).toLocaleDateString(language.startsWith("es") ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${label}, ${clock}`;
  };

  const unreadTotal = unreadRows.length;
  const showFailureOnly = (filter === "unread" ? loadFailed && unreadRows.length === 0 : allFailed && allRows === null) && !loading;
  const listLoading = loading || (filter === "all" && allRows === null && !allFailed);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{t("alertsScreen.unreadSuffix", { count: unreadTotal })}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>{t("alertsScreen.title")}</Text>
        <Button
          label={markingAll ? t("alertsScreen.clearing") : t("alertsScreen.markAllRead")}
          onPress={handleMarkAll}
          disabled={markingAll || unreadTotal === 0}
          variant="ghost"
          size="sm"
          style={styles.markReadBtn}
        />
      </View>

      <View style={styles.filters} accessibilityRole="tablist">
        {(["all", "unread"] as const).map((value) => {
          const selectedChip = filter === value;
          return (
            <Pressable
              key={value}
              onPress={() => setFilter(value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedChip }}
              style={[styles.chip, { borderColor: selectedChip ? theme.primary : theme.border, backgroundColor: selectedChip ? theme.primary : theme.surfaceSubtle }]}
              testID={`notifications-filter-${value}`}
            >
              <Text style={[styles.chipText, { color: selectedChip ? theme.onPrimary : theme.textPrimary }]}>
                {t(`alertsScreen.filter.${value}`)}
                {value === "unread" && unreadTotal > 0 ? ` ${unreadTotal}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {markAllError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="mark-all-error">
          {t("home.message.markAllFailed")}
        </Text>
      ) : null}

      {(filter === "unread" ? loadFailed : allFailed) && !showFailureOnly && !listLoading ? (
        <View style={styles.staleRow} accessibilityLiveRegion="polite" testID="notifications-stale">
          <Text style={[styles.staleText, { color: theme.textMuted }]}>{t("alertsScreen.stale")}</Text>
          <Button label={t("common.retry")} onPress={() => void onRefresh()} variant="ghost" size="sm" testID="notifications-stale-retry" />
        </View>
      ) : null}

      {listLoading ? (
        <View style={styles.center}>
          <StateBlock status="loading" />
        </View>
      ) : showFailureOnly ? (
        <View style={styles.center}>
          <StateBlock status="error" errorMessage={t("alertsScreen.loadFailed")} onRetry={() => void onRefresh()} retryLabel={t("common.retry")} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}>
          {items.length === 0 ? (
            <StateBlock
              status="empty"
              emptyIcon="notifications-off-outline"
              emptyTitle={t(filter === "unread" ? "alertsScreen.emptyUnreadTitle" : "alertsScreen.emptyAllTitle")}
              emptyBody={t(filter === "unread" ? "alertsScreen.emptyUnreadBody" : "alertsScreen.emptyAllBody")}
              style={styles.empty}
            />
          ) : (
            groups.map((group) => (
              <View key={group.day}>
                <Text accessibilityRole="header" style={[styles.groupTitle, { color: theme.textMuted }]}>{dayTitle(group.day)}</Text>
                <View style={styles.stack}>
                  {group.items.map(({ notification, kind, unread, preview }) => (
                    <Pressable
                      key={notification.id}
                      onPress={() => openDetails(notification.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${unread ? `${t("alertsScreen.unread")}. ` : ""}${notification.title}. ${preview}`}
                      accessibilityHint={t("home.message.openHint")}
                      testID={`notification-${notification.id}`}
                    >
                      <Card style={styles.row}>
                        <IconButton icon={ICON[kind]} tone={TONE[kind]} size={38} />
                        <View style={styles.rowBody}>
                          <View style={styles.rowLine}>
                            {unread ? <View style={[styles.dot, { backgroundColor: theme.primary }]} testID={`notification-unread-${notification.id}`} /> : null}
                            <Text style={[styles.rowTitle, { color: theme.textPrimary, fontWeight: unread ? "700" : "500" }]}>{notification.title}</Text>
                            <Mono style={[styles.rowTime, { color: theme.textDisabled }]}>{stamp(notification, group.day)}</Mono>
                          </View>
                          <Text style={[styles.rowSub, { color: theme.textMuted }]} numberOfLines={2}>
                            {preview}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} style={styles.chevron} />
                      </Card>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <SupervisorMessageSheet
        visible={sheetOpen}
        message={details}
        marking={marking}
        error={markError}
        language={language}
        timeZone={hotelTimezone}
        t={t as never}
        onMarkRead={() => void handleMarkRead()}
        onOpenLink={openLink}
        onAsk={ask}
        onClose={closeDetails}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, borderBottomWidth: 1 },
  headerMeta: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  markReadBtn: { position: "absolute", right: 6, bottom: 5 },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 18, paddingTop: 12 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: 22, paddingHorizontal: 18 },
  chipText: { fontSize: 14, fontWeight: "700" },
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  groupTitle: { fontSize: 10.5, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 10 },
  stack: { gap: 8 },
  row: { flexDirection: "row", gap: 12, borderRadius: 12, padding: 13, alignItems: "center" },
  rowBody: { flex: 1, minWidth: 0 },
  rowLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, alignSelf: "center" },
  rowTitle: { flex: 1, fontSize: 13.5 },
  rowTime: { fontSize: 10.5 },
  rowSub: { fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  chevron: { marginLeft: 2 },
  empty: { padding: 24, alignItems: "center" },
  error: { paddingHorizontal: 18, paddingTop: 10, fontSize: 13 },
  staleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 8, gap: 8 },
  staleText: { flex: 1, fontSize: 12 },
});
