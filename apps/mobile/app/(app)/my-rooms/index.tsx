import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore, type Room } from "@/stores/appStore";
import { getRooms, upsertRooms } from "@/lib/offline/db";

const STATUS_COLORS: Record<string, string> = {
  DIRTY: "#DC2626",
  IN_PROGRESS: "#7C3AED",
  CLEAN: "#2563EB",
  INSPECTED: "#16A34A",
  OOO: "#F97316",
  OUT_OF_ORDER: "#F97316",
  OUT_OF_SERVICE: "#F97316",
  PICKUP: "#EAB308",
};

function formatETA(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function RoomCard({ room, onPress }: { room: Room; onPress: () => void }) {
  const { t } = useTranslation();
  const statusColor = STATUS_COLORS[room.status] ?? "#6B7280";
  const isOccupied = room.status === "OCCUPIED";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={[styles.statusBar, { backgroundColor: statusColor }]}>
        {isOccupied && Array.from({ length: 8 }).map((_, i) => (
          <View key={i} style={[styles.statusStripe, { top: i * 18 }]} />
        ))}
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.roomNumber}>{room.room_number}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {t(`rooms.status.${room.status}`)}
            </Text>
          </View>
        </View>

        <Text style={styles.floorText}>{t("rooms.floor", { floor: room.floor })}</Text>

        {room.vip_flag && (
          <View style={styles.vipBadge}>
            <Ionicons name="star" size={11} color="#92400E" />
            <Text style={styles.vipBadgeText}>{t("rooms.vipGuest")}</Text>
          </View>
        )}

        {room.dnd_flag && (
          <View style={styles.flag}>
            <Ionicons name="moon" size={12} color="#6B7280" />
            <Text style={styles.flagText}>{t("rooms.dndAlert")}</Text>
          </View>
        )}

        {room.guest_name && (
          <Text style={styles.guestName}>{room.guest_name}</Text>
        )}

        {room.risk_level === "HIGH" && (
          <View style={styles.riskBadge}>
            <Ionicons name="warning" size={12} color="#EF4444" />
            <Text style={styles.riskText}>{t("rooms.risk.HIGH")}</Text>
          </View>
        )}

        {room.predicted_ready_at != null && (
          <Text style={styles.etaText}>{t("rooms.eta", { time: formatETA(room.predicted_ready_at) })}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
    </TouchableOpacity>
  );
}

export default function MyRoomsScreen() {
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRooms = useCallback(async () => {
    if (isOnline) {
      try {
        const result = await api.get<{ data: Room[] }>("/housekeeping/my-rooms");
        setMyRooms(result.data);
        await upsertRooms(result.data);
      } catch {
        const cached = (await getRooms()) as Room[];
        setMyRooms(cached);
      }
    } else {
      const cached = (await getRooms()) as Room[];
      setMyRooms(cached);
    }
    setLoading(false);
  }, [isOnline]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Text>{t("common.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={14} color="#fff" />
          <Text style={styles.offlineText}>{t("common.offline")}</Text>
        </View>
      )}
      <FlatList
        data={myRooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RoomCard
            room={item}
            onPress={() => router.push(`/(app)/my-rooms/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>{t("rooms.noRooms")}</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={myRooms.length === 0 ? styles.emptyContainer : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyContainer: { flex: 1 },
  offlineBanner: {
    backgroundColor: "#EF4444",
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    paddingHorizontal: 16,
    gap: 6,
  },
  offlineText: { color: "#fff", fontSize: 12, flex: 1 },
  card: {
    backgroundColor: "#fff",
    margin: 8,
    marginHorizontal: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  statusBar: { width: 6, alignSelf: "stretch", position: "relative", overflow: "hidden" },
  statusStripe: {
    position: "absolute",
    left: -5,
    width: 16,
    height: 4,
    backgroundColor: "#FEE2E2",
    transform: [{ rotate: "-35deg" }],
  },
  cardContent: { flex: 1, padding: 14 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  roomNumber: { fontSize: 18, fontWeight: "700", color: "#111827" },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: "600" },
  floorText: { fontSize: 12, color: "#9CA3AF", marginBottom: 2 },
  vipBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    backgroundColor: "#FEF3C7",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  vipBadgeText: { fontSize: 11, color: "#92400E", fontWeight: "600" },
  guestName: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  flag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  flagText: { fontSize: 12, color: "#6B7280" },
  riskBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    backgroundColor: "#FEE2E2",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  riskText: { fontSize: 11, color: "#EF4444", fontWeight: "600" },
  etaText: { fontSize: 12, color: "#3B82F6", marginTop: 4 },
  emptyText: { color: "#9CA3AF", fontSize: 16 },
});
