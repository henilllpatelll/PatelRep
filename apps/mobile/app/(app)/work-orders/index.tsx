import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";
import { C, displayFont } from "@/components/shared/tokens";
import { HandoffRow, IconButton, Mono, Pill, Segmented } from "@/components/shared/mobileHandoff";

type WorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: string;
  room_number?: string;
  location_detail?: string;
  claimed_by?: string;
  created_at?: string;
};

type Tab = "open" | "in_progress" | "completed";

function priorityTone(priority: string) {
  if (priority === "emergency" || priority === "urgent") return "alert" as const;
  if (priority === "normal") return "caution" as const;
  return "info" as const;
}

function priorityLabel(priority: string) {
  switch (priority) {
    case "emergency": return "EMER";
    case "urgent": return "HIGH";
    case "normal": return "MED";
    case "low": return "LOW";
    default: return priority.toUpperCase();
  }
}

function locationText(wo: WorkOrder) {
  if (wo.room_number && wo.location_detail) return `R-${wo.room_number} · ${wo.location_detail}`;
  if (wo.room_number) return `R-${wo.room_number}`;
  return wo.location_detail ?? "Property";
}

export default function WorkOrdersScreen() {
  const { t } = useTranslation();
  const { isOnline, user } = useAppStore();
  const [tab, setTab] = useState<Tab>("open");
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadWorkOrders = useCallback(async () => {
    try {
      const data = await api.get<WorkOrder[] | { data: WorkOrder[] }>(`/work-orders?status=${tab}`);
      setWorkOrders(Array.isArray(data) ? data : data.data ?? []);
    } catch {
      setWorkOrders([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    loadWorkOrders();
  }, [loadWorkOrders]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("work-orders-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${user.tenant_id}` },
        () => { loadWorkOrders(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.tenant_id, loadWorkOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWorkOrders();
    setRefreshing(false);
  }, [loadWorkOrders]);

  async function claimWorkOrder(id: string) {
    try {
      if (isOnline) {
        await api.post(`/work-orders/${id}/claim`, {});
      } else {
        await enqueueAction("work_order", "claim", {}, id);
        setWorkOrders((prev) => prev.map((wo) => (wo.id === id ? { ...wo, status: "in_progress" } : wo)));
      }
      loadWorkOrders();
    } catch (err) {
      console.error(err);
    }
  }

  const openCount = tab === "open" ? workOrders.length : undefined;
  const inProgressCount = tab === "in_progress" ? workOrders.length : undefined;
  const completedCount = tab === "completed" ? workOrders.length : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerMeta}>{tab === "open" ? t("workOrders.headerCountOpen", { count: workOrders.length }) : tab === "in_progress" ? t("workOrders.headerCountInProgress", { count: workOrders.length }) : t("workOrders.headerCountCompleted", { count: workOrders.length })}</Text>
        <Text style={styles.title}>{t("workOrders.title")}</Text>
      </View>

      <View style={styles.tabs}>
        <Segmented
          items={[
            { label: t("workOrders.open"), count: openCount, active: tab === "open" },
            { label: t("workOrders.inProgress"), count: inProgressCount, active: tab === "in_progress" },
            { label: t("workOrders.completed"), count: completedCount, active: tab === "completed" },
          ]}
        />
      </View>

      {/* Hidden tab buttons for switching — segmented is display-only above */}
      <View style={styles.tabBar}>
        {(["open", "in_progress", "completed"] as Tab[]).map((t_) => (
          <TouchableOpacity key={t_} style={[styles.tabBtn, tab === t_ && styles.activeTabBtn]} onPress={() => setTab(t_)}>
            <Text style={[styles.tabText, tab === t_ && styles.activeTabText]}>
              {t_ === "open" ? t("workOrders.open") : t_ === "in_progress" ? t("workOrders.inProgress") : t("workOrders.completed")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <FlatList
          data={workOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          renderItem={({ item }) => {
            const active = item.status === "in_progress";
            const tone = priorityTone(item.priority);
            return (
              <View style={styles.rowWrap}>
                <HandoffRow
                  onPress={() => router.push(`/(app)/work-orders/${item.id}`)}
                  lead={<IconButton icon="construct-outline" tone={active ? "accent" : "neutral"} size={46} />}
                  title={
                    <>
                      <Mono style={styles.woId}>{item.id}</Mono>
                      <Pill tone={tone}>{priorityLabel(item.priority)}</Pill>
                    </>
                  }
                  sub={`${item.title} · ${locationText(item)}`}
                  right={
                    active ? (
                      <Pill tone="progress" icon="time-outline">22m</Pill>
                    ) : (
                      <Ionicons name="chevron-forward" size={15} color={C.ink4} />
                    )
                  }
                />
                {tab === "open" && !item.claimed_by ? (
                  <TouchableOpacity style={styles.claimBtn} onPress={() => claimWorkOrder(item.id)}>
                    <Ionicons name="hand-right-outline" size={14} color={C.accent} />
                    <Text style={styles.claimText}>{t("workOrders.claim")}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>{t("workOrders.noOrders")}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: C.paper,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34, marginTop: 4 },
  tabs: { display: "none" },
  tabBar: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  activeTabBtn: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontSize: 13, color: C.ink3, fontWeight: "600" },
  activeTabText: { color: C.accent },
  listContent: { padding: 16, gap: 8 },
  rowWrap: { gap: 6 },
  woId: { color: C.ink3, fontSize: 11, fontWeight: "700" },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.accentLine,
    backgroundColor: C.accentSoft,
  },
  claimText: { color: C.accent, fontSize: 13, fontWeight: "700" },
  emptyText: { color: C.ink4, fontSize: 15 },
});
