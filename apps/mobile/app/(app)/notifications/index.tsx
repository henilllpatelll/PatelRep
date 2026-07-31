import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { displayFont } from "@/components/shared/tokens";
import { IconButton, Mono } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { listNotifications, markAllRead, type AppNotification } from "@/lib/api/notifications";
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
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications(false);
      setNotifications(res.data);
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
    try {
      await markAllRead();
      setNotifications([]);
    } finally {
      setMarkingAll(false);
    }
  }, []);

  const groups = groupByTime(notifications);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle }]}>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>
          {notifications.length} unread
        </Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Alerts</Text>
        <Button
          label={markingAll ? "Clearing\u2026" : "Mark all read"}
          onPress={handleMarkAll}
          disabled={markingAll || notifications.length === 0}
          variant="ghost"
          size="sm"
          style={styles.markReadBtn}
        />
      </View>

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
                  <Card key={item.id} style={styles.row}>
                    <IconButton icon={iconForType(item.type)} tone={toneForType(item.type)} size={38} />
                    <View style={styles.rowBody}>
                      <View style={styles.rowLine}>
                        <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{item.title}</Text>
                        <Mono style={[styles.rowTime, { color: theme.textDisabled }]}>
                          {timeLabel(item.created_at)}
                        </Mono>
                      </View>
                      <Text style={[styles.rowSub, { color: theme.textMuted }]}>{item.body}</Text>
                    </View>
                  </Card>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
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
});
