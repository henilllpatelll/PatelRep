import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { R, monoFont } from "@/components/shared/tokens";
import { AIInsightCard, Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";

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

const REQUEST_STATUS_BADGE_KEYS: Partial<Record<GuestRequest["status"], StatusKey>> = {
  in_progress: "inProgress",
  resolved: "completed",
};

const REQUEST_PRIORITY_BADGE_KEYS: Partial<Record<GuestRequest["priority"], StatusKey>> = {
  emergency: "emergency",
  urgent: "urgent",
  low: "low",
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
  const insets = useSafeAreaInsets();
  const theme = useTheme();
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
    return <StateBlock status="loading" style={[styles.center, { backgroundColor: theme.background }]} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.shell.ink }]}>{t("tabs.guestRequests")}</Text>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: theme.primaryAction }]}
            onPress={() => router.push("/(app)/copilot")}
            activeOpacity={0.75}
          >
            <Ionicons name="add" size={18} color={theme.shell.ink} />
          </TouchableOpacity>
        </View>
        {(newCount > 0 || escalatedCount > 0) ? (
          <View style={styles.alertBanner}>
            {escalatedCount > 0 ? (
              <Pill tone="alert">{escalatedCount} {t("guestRequests.escalatedSuffix")}</Pill>
            ) : null}
            {newCount > 0 ? (
              <Pill tone="info">{newCount} {t("guestRequests.newSuffix")}</Pill>
            ) : null}
          </View>
        ) : null}
        <View style={styles.filters}>
          {(["all", "new", "in_progress", "escalated"] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[
                styles.filterBtn,
                {
                  backgroundColor: filter === f ? theme.primary : theme.shell.surface,
                  borderColor: filter === f ? theme.primary : theme.shell.line,
                },
              ]}
              onPress={() => setFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterLabel, { color: filter === f ? theme.shell.ink : theme.shell.ink2 }]}>
                {f === "all" ? "All" : f === "new" ? "New" : f === "in_progress" ? "In Progress" : "Escalated"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <AIInsightCard title="AI triage" compact>
          {escalatedCount > 0
            ? "Escalated requests stay surfaced until ownership is clear."
            : newCount > 0
              ? "New requests stay near the top so front desk can route them quickly."
              : "No guest-pressure signals need action right now."}
        </AIInsightCard>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <SectionLabel hint={`${filtered.length} requests`}>
          {filter === "all" ? "All Requests" : filter === "new" ? "New" : filter === "in_progress" ? "In Progress" : "Escalated"}
        </SectionLabel>

        {filtered.map((req) => (
          <Pressable
            key={req.id}
            onPress={() => router.push(`/(app)/guest-requests/${req.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`Room ${req.room_number}`}
          >
            <Card
              style={[
                styles.cardLayoutOverrides,
                req.status === "escalated" && {
                  backgroundColor: theme.status.dirtySoft,
                  borderColor: theme.status.dirtyLine,
                },
              ]}
            >
            <View style={styles.cardTop}>
              <View style={styles.cardLeft}>
                <Text style={[styles.roomLabel, { color: theme.textPrimary }]}>{t("guestRequests.roomLabel", { room: req.room_number })}</Text>
                {req.guest_name ? <Text style={[styles.guestName, { color: theme.textMuted }]}>{req.guest_name}</Text> : null}
              </View>
              <View style={styles.cardBadges}>
                {REQUEST_STATUS_BADGE_KEYS[req.status] ? (
                  <StatusBadge
                    statusKey={REQUEST_STATUS_BADGE_KEYS[req.status]!}
                    label={
                      req.status === "in_progress"
                        ? t("workOrders.status.in_progress")
                        : t("workOrders.status.completed")
                    }
                  />
                ) : (
                  <Pill tone={STATUS_TONES[req.status] ?? "neutral"}>{req.status.replace(/_/g, " ")}</Pill>
                )}
                {REQUEST_PRIORITY_BADGE_KEYS[req.priority] ? (
                  <StatusBadge
                    statusKey={REQUEST_PRIORITY_BADGE_KEYS[req.priority]!}
                    label={
                      req.priority === "emergency"
                        ? t("workOrders.chipEmergency")
                        : req.priority === "urgent"
                          ? t("workOrders.chipUrgent")
                          : "LOW"
                    }
                  />
                ) : req.priority !== "normal" ? (
                  <Pill tone={PRIORITY_TONES[req.priority] ?? "neutral"}>{req.priority}</Pill>
                ) : null}
              </View>
            </View>
            <Text style={[styles.requestType, { color: theme.textPrimary }]}>{req.request_type}</Text>
            <Text style={[styles.description, { color: theme.textMuted }]} numberOfLines={2}>{req.description}</Text>
            <View style={styles.cardFooter}>
              <Text style={[styles.metaText, { color: theme.textDisabled }]}>{timeAgo(req.created_at)}</Text>
              {req.assigned_to_name ? (
                <Text style={[styles.assignedTo, { color: theme.textMuted }]}>→ {req.assigned_to_name}</Text>
              ) : (
                <Text style={[styles.assignedTo, { color: theme.status.pickup }]}>{t("guestRequests.unassigned")}</Text>
              )}
            </View>
            </Card>
          </Pressable>
        ))}

        {filtered.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="chatbubble-ellipses-outline"
            emptyTitle="No requests"
            emptyBody={filter === "all" ? "No guest requests at the moment." : `No ${filter.replace(/_/g, " ")} requests.`}
            style={styles.emptyCard}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 10,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "700" },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  alertBanner: { flexDirection: "row", gap: 6 },
  filters: { flexDirection: "row", gap: 6 },
  filterBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: R.md,
    borderWidth: 1,
  },
  filterLabel: { fontSize: 11, fontWeight: "600" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 12 },
  cardLayoutOverrides: {
    gap: 7,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardLeft: { flex: 1 },
  roomLabel: { fontFamily: monoFont, fontSize: 20, lineHeight: 24, fontWeight: "700" },
  guestName: { fontSize: 11 },
  cardBadges: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  requestType: { fontSize: 15, fontWeight: "600" },
  description: { fontSize: 13, lineHeight: 18 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  metaText: { fontSize: 11, fontFamily: monoFont },
  assignedTo: { fontSize: 11, fontWeight: "500" },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
});
