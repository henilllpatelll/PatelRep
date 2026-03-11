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
  DIRTY: "#EF4444",
  IN_PROGRESS: "#F59E0B",
  CLEAN: "#10B981",
  INSPECTED: "#6366F1",
  OOO: "#6B7280",
  PICKUP: "#8B5CF6",
};

function RoomCard({ room, onPress }: { room: Room; onPress: () => void }) {
  const { t } = useTranslation();
  const statusColor = STATUS_COLORS[room.status] ?? "#6B7280";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={[styles.statusBar, { backgroundColor: statusColor }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.roomNumber}>{room.room_number}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {t(`rooms.status.${room.status}`)}
            </Text>
          </View>
        </View>

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
        const rooms = await api.get<Room[]>("/housekeeping/my-rooms");
        setMyRooms(rooms);
        await upsertRooms(rooms);
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
  statusBar: { width: 6, alignSelf: "stretch" },
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
  emptyText: { color: "#9CA3AF", fontSize: 16 },
});
