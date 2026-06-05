import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";

export type GuestRequest = {
  id: string;
  room_number: string;
  guest_name: string | null;
  request_type: string;
  description: string;
  status: "new" | "in_progress" | "resolved" | "escalated";
  priority: "low" | "normal" | "urgent" | "emergency";
  assigned_to_name: string | null;
  created_at: string;
};

type ToneType = "alert" | "caution" | "ready" | "info" | "neutral" | "progress";

const STATUS_TONES: Record<string, ToneType> = {
  new: "info",
  in_progress: "progress",
  resolved: "ready",
  escalated: "alert",
};

const PRIORITY_TONES: Record<string, ToneType> = {
  emergency: "alert",
  urgent: "caution",
  normal: "neutral",
  low: "neutral",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function GuestRequestsScreen() {
  const { t } = useTranslation();
  const { isOnline, user, setUnreadCount } = useAppStore();
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "in_progress" | "escalated">("all");

  const loadRequests = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: GuestRequest[] }>("/guest-requests?per_page=100");
      const data = res.data ?? [];
      setRequests(data);
      setUnreadCount(data.filter((r) => r.status === "new").length);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline, setUnreadCount]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("guest_requests_mobile")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "guest_requests",
        filter: `hotel_id=eq.${user.tenant_id}`,
      }, () => { loadRequests(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.tenant_id, loadRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
  const newCount = requests.filter((r) => r.status === "new").length;
  const escalatedCount = requests.filter((r) => r.status === "escalated").length;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{t("tabs.guestRequests")}</Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => router.push("/(app)/copilot")}
            activeOpacity={0.75}
          >
            <Ionicons name="add" size={18} color={C.surface} />
          </TouchableOpacity>
        </View>
        {(newCount > 0 || escalatedCount > 0) ? (
          <View style={styles.alertBanner}>
            {escalatedCount > 0 ? (
              <Pill tone="alert">{escalatedCount} escalated</Pill>
            ) : null}
            {newCount > 0 ? (
              <Pill tone="info">{newCount} new</Pill>
            ) : null}
          </View>
        ) : null}
        <View style={styles.filters}>
          {(["all", "new", "in_progress", "escalated"] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterLabel, filter === f && styles.filterLabelActive]}>
                {f === "all" ? "All" : f === "new" ? "New" : f === "in_progress" ? "In Progress" : "Escalated"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <SectionLabel hint={`${filtered.length} requests`}>
          {filter === "all" ? "All Requests" : filter === "new" ? "New" : filter === "in_progress" ? "In Progress" : "Escalated"}
        </SectionLabel>

        {filtered.map((req) => (
          <TouchableOpacity
            key={req.id}
            style={[styles.card, req.status === "escalated" && styles.cardEscalated]}
            onPress={() => router.push(`/(app)/guest-requests/${req.id}` as never)}
            activeOpacity={0.75}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardLeft}>
                <Text style={styles.roomLabel}>Room {req.room_number}</Text>
                {req.guest_name ? <Text style={styles.guestName}>{req.guest_name}</Text> : null}
              </View>
              <View style={styles.cardBadges}>
                <Pill tone={STATUS_TONES[req.status] ?? "neutral"}>{req.status.replace(/_/g, " ")}</Pill>
                {req.priority !== "normal" ? (
                  <Pill tone={PRIORITY_TONES[req.priority] ?? "neutral"}>{req.priority}</Pill>
                ) : null}
              </View>
            </View>
            <Text style={styles.requestType}>{req.request_type}</Text>
            <Text style={styles.description} numberOfLines={2}>{req.description}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.metaText}>{timeAgo(req.created_at)}</Text>
              {req.assigned_to_name ? (
                <Text style={styles.assignedTo}>→ {req.assigned_to_name}</Text>
              ) : (
                <Text style={[styles.assignedTo, { color: C.caution }]}>Unassigned</Text>
              )}
            </View>
          </TouchableOpacity>
        ))}

        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>No requests</Text>
            <Text style={styles.emptyText}>
              {filter === "all" ? "No guest requests at the moment." : `No ${filter.replace(/_/g, " ")} requests.`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    backgroundColor: C.paper,
    gap: 10,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  alertBanner: { flexDirection: "row", gap: 6 },
  filters: { flexDirection: "row", gap: 6 },
  filterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  filterBtnActive: { backgroundColor: C.ink, borderColor: C.ink },
  filterLabel: { fontSize: 11, fontWeight: "600", color: C.ink3 },
  filterLabelActive: { color: C.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 14,
    gap: 5,
  },
  cardEscalated: { borderColor: C.alertLine, backgroundColor: C.alertSoft },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardLeft: { flex: 1 },
  roomLabel: { fontSize: 13, fontWeight: "700", color: C.ink },
  guestName: { fontSize: 11, color: C.ink3 },
  cardBadges: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  requestType: { fontSize: 14, fontWeight: "600", color: C.ink },
  description: { fontSize: 12, color: C.ink3, lineHeight: 17 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  metaText: { fontSize: 11, color: C.ink4, fontFamily: monoFont },
  assignedTo: { fontSize: 11, color: C.ink3, fontWeight: "500" },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3, textAlign: "center" },
});
