import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { C, displayFont } from "@/components/shared/tokens";
import { IconButton, Mono } from "@/components/shared/mobileHandoff";
import { listNotifications, markAllRead, type AppNotification } from "@/lib/api/notifications";

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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerMeta}>{notifications.length} unread</Text>
        <Text style={styles.title}>Alerts</Text>
        <TouchableOpacity onPress={handleMarkAll} disabled={markingAll || notifications.length === 0} style={styles.markReadBtn}>
          <Text style={[styles.markRead, notifications.length === 0 && styles.markReadDim]}>
            {markingAll ? "Clearing…" : "Mark all read"}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        >
          {notifications.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>You're all caught up</Text>
              <Text style={styles.emptySub}>No unread alerts right now.</Text>
            </View>
          ) : groups.map((group) => (
            <View key={group.when}>
              <Text style={styles.groupTitle}>{group.when}</Text>
              <View style={styles.stack}>
                {group.items.map((item) => (
                  <View key={item.id} style={styles.row}>
                    <IconButton icon={iconForType(item.type)} tone={toneForType(item.type)} size={38} />
                    <View style={styles.rowBody}>
                      <View style={styles.rowLine}>
                        <Text style={styles.rowTitle}>{item.title}</Text>
                        <Mono style={styles.rowTime}>{timeLabel(item.created_at)}</Mono>
                      </View>
                      <Text style={styles.rowSub}>{item.body}</Text>
                    </View>
                  </View>
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
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line2 },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  markReadBtn: { position: "absolute", right: 18, bottom: 22 },
  markRead: { color: C.accent, fontSize: 12, fontWeight: "700" },
  markReadDim: { opacity: 0.4 },
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  groupTitle: { color: C.ink3, fontSize: 10.5, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 10 },
  stack: { gap: 8 },
  row: { flexDirection: "row", gap: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 13 },
  rowBody: { flex: 1, minWidth: 0 },
  rowLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowTitle: { flex: 1, color: C.ink, fontSize: 13.5, fontWeight: "600" },
  rowTime: { color: C.ink4, fontSize: 10.5 },
  rowSub: { color: C.ink3, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 24, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptySub: { fontSize: 12, color: C.ink3, marginTop: 4 },
});
