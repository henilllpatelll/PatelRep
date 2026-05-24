import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";

type WorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: string;
  room_number?: string;
  claimed_by?: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  emergency: "#a6263c",
  urgent: "#a16207",
  normal: "#265d8a",
  low: "#807a70",
};

const STATUS_COLORS: Record<string, string> = {
  open: "#265d8a",
  in_progress: "#a16207",
  completed: "#0c6e63",
};

type Tab = "open" | "in_progress" | "completed";

export default function WorkOrdersScreen() {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [tab, setTab] = useState<Tab>("open");
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkOrders();
  }, [tab]);

  async function loadWorkOrders() {
    setLoading(true);
    try {
      const data = await api.get<WorkOrder[]>(`/work-orders?status=${tab}`);
      setWorkOrders(data);
    } catch {
      setWorkOrders([]);
    } finally {
      setLoading(false);
    }
  }

  async function claimWorkOrder(id: string) {
    try {
      if (isOnline) {
        await api.post(`/work-orders/${id}/claim`, {});
      } else {
        await enqueueAction("work_order", "claim", {}, id);
        setWorkOrders((prev) =>
          prev.map((wo) =>
            wo.id === id ? { ...wo, status: "in_progress" } : wo
          )
        );
      }
      loadWorkOrders();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["open", "in_progress", "completed"] as Tab[]).map((t_) => (
          <TouchableOpacity
            key={t_}
            style={[styles.tab, tab === t_ && styles.activeTab]}
            onPress={() => setTab(t_)}
          >
            <Text style={[styles.tabText, tab === t_ && styles.activeTabText]}>
              {t(`workOrders.${t_ === "in_progress" ? "inProgress" : t_}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#b8431c" />
        </View>
      ) : (
        <FlatList
          data={workOrders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/(app)/work-orders/${item.id}`)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <View
                  style={[
                    styles.priorityBadge,
                    { backgroundColor: (PRIORITY_COLORS[item.priority] ?? "#807a70") + "20" },
                  ]}
                >
                  <Text
                    style={[
                      styles.priorityText,
                      { color: PRIORITY_COLORS[item.priority] ?? "#807a70" },
                    ]}
                  >
                    {t(`workOrders.priority.${item.priority}`)}
                  </Text>
                </View>
              </View>

              {item.room_number && (
                <Text style={styles.meta}>Room {item.room_number}</Text>
              )}

              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: (STATUS_COLORS[item.status] ?? "#807a70") + "20" },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: STATUS_COLORS[item.status] ?? "#807a70" },
                    ]}
                  >
                    {t(`workOrders.status.${item.status}`, item.status)}
                  </Text>
                </View>
              </View>

              {tab === "open" && !item.claimed_by && (
                <TouchableOpacity
                  style={styles.claimBtn}
                  onPress={() => claimWorkOrder(item.id)}
                >
                  <Text style={styles.claimText}>{t("workOrders.claim")}</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>{t("workOrders.noOrders")}</Text>
            </View>
          }
          contentContainerStyle={workOrders.length === 0 ? styles.emptyFlex : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  emptyFlex: { flex: 1 },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderColor: "#e6dfd1",
  },
  tab: { flex: 1, padding: 12, alignItems: "center" },
  activeTab: { borderBottomWidth: 2, borderColor: "#b8431c" },
  tabText: { fontSize: 13, color: "#807a70" },
  activeTabText: { color: "#b8431c", fontWeight: "600" },
  card: {
    backgroundColor: "#ffffff",
    margin: 8,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 14,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#e6dfd1",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  title: { fontSize: 15, fontWeight: "600", color: "#1a1815", flex: 1 },
  priorityBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  priorityText: { fontSize: 11, fontWeight: "600" },
  meta: { fontSize: 13, color: "#807a70", marginTop: 4 },
  statusRow: { marginTop: 6 },
  statusBadge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: "600" },
  claimBtn: {
    marginTop: 10,
    backgroundColor: "#b8431c",
    borderRadius: 8,
    padding: 8,
    alignItems: "center",
  },
  claimText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  emptyText: { color: "#a8a195", fontSize: 15 },
});
