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
import { listNotifications, markAllRead, markRead, type AppNotification } from "@/lib/api/notifications";
import { resolveNotificationLink, senderOf, type NotificationLink } from "@/lib/housekeeping/notificationLinks";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

function timeLabel(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return `${Math.floor(diff / 1440)}d`;
}

function iconForType(type: string): ComponentProps<typeof Ionicons>["name"] {
  if (type.includes("vip") || type.includes("arrival")) return "star-outline";
  if (type.includes("inspection") || type.includes("reopen")) return "shield-checkmark-outline";
  if (type.includes("work_order") || type.includes("complete")) return "checkmark-outline";
  if (type.includes("sla") || type.includes("breach")) return "warning-outline";
  if (type.includes("task")) return "checkmark-circle-outline";
  return "notifications-outline";
}

function toneForType(type: string): "accent" | "caution" | "alert" | "ready" | "neutral" {
  if (type.includes("vip") || type.includes("arrival")) return "accent";
  if (type.includes("reopen") || type.includes("inspection")) return "caution";
  if (type.includes("sla") || type.includes("breach")) return "alert";
  if (type.includes("complete") || type.includes("closed")) return "ready";
  return "neutral";
}

function groupByTime(notifications: AppNotification[]): Array<{ when: string; items: AppNotification[] }> {
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const groups: Record<string, AppNotification[]> = {};
  for (const n of notifications) {
    const age = now - new Date(n.created_at).getTime();
    const key = age < 3600000 ? "Just now" : new Date(n.created_at) >= todayStart ? "Earlier today" : "Older";
    groups[key] = [...(groups[key] ?? []), n];
  }
  return ["Just now", "Earlier today", "Older"].filter((k) => groups[k]?.length).map((k) => ({ when: k, items: groups[k] }));
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const myRooms = useAppStore((state) => state.myRooms);
  const hotelTimezone = useAppStore((state) => state.hotelTimezone);
  const setUnreadCount = useAppStore((state) => state.setUnreadCount);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<MarkReadError>(null);
  const [markAllError, setMarkAllError] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications(false);
      setNotifications(res.data);
      // The unread list IS the unread count: set from what the server returned, never cleared by merely viewing.
      setUnreadCount?.(res.data.length);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleMarkAll = useCallback(async () => {
    setMarkingAll(true);
    setMarkAllError(false);
    try {
      await markAllRead();
      setNotifications([]);
      setUnreadCount?.(0);
    } catch {
      // Nothing was recorded: the list and the unread count stay as they were.
      setMarkAllError(true);
    } finally {
      setMarkingAll(false);
    }
  }, []);

  const groups = groupByTime(notifications);

  const selected = notifications.find((item) => item.id === selectedId) ?? null;
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
      setNotifications((current) => current.filter((item) => item.id !== selected.id));
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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>
          {t("alertsScreen.unreadSuffix", { count: notifications.length })}
        </Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("alertsScreen.title")}</Text>
        <Button
          label={markingAll ? "Clearing\u2026" : "Mark all read"}
          onPress={handleMarkAll}
          disabled={markingAll || notifications.length === 0}
          variant="ghost"
          size="sm"
          style={styles.markReadBtn}
        />
      </View>

      {markAllError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="mark-all-error">
          {t("home.message.markAllFailed")}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <StateBlock status="loading" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primaryAction}
            />
          }
        >
          {notifications.length === 0 ? (
            <StateBlock
              status="empty"
              emptyIcon="notifications-off-outline"
              emptyTitle="You're all caught up"
              emptyBody="No unread alerts right now."
              style={styles.empty}
            />
          ) : groups.map((group) => (
            <View key={group.when}>
              <Text style={[styles.groupTitle, { color: theme.textMuted }]}>{group.when}</Text>
              <View style={styles.stack}>
                {group.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => openDetails(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}. ${item.body}`}
                    accessibilityHint={t("home.message.openHint")}
                    testID={`notification-${item.id}`}
                  >
                    <Card style={styles.row}>
                      <IconButton icon={iconForType(item.type)} tone={toneForType(item.type)} size={38} />
                      <View style={styles.rowBody}>
                        <View style={styles.rowLine}>
                          <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{item.title}</Text>
                          <Mono style={[styles.rowTime, { color: theme.textDisabled }]}>
                            {timeLabel(item.created_at)}
                          </Mono>
                        </View>
                        <Text style={[styles.rowSub, { color: theme.textMuted }]} numberOfLines={3}>
                          {item.body}
                        </Text>
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <SupervisorMessageSheet
        visible={sheetOpen}
        message={details}
        marking={marking}
        error={markError}
        language={i18n.language}
        timeZone={hotelTimezone ?? null}
        t={t as never}
        onMarkRead={() => void handleMarkRead()}
        onOpenLink={openLink}
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
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  groupTitle: { fontSize: 10.5, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 10 },
  stack: { gap: 8 },
  row: { flexDirection: "row", gap: 12, borderRadius: 12, padding: 13 },
  rowBody: { flex: 1, minWidth: 0 },
  rowLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: "600" },
  rowTime: { fontSize: 10.5 },
  rowSub: { fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  empty: { padding: 24, alignItems: "center" },
  error: { paddingHorizontal: 18, paddingTop: 10, fontSize: 13 },
});
