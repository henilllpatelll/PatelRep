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
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { C, R } from "@/components/shared/tokens";
import { Pill, SectionLabel } from "@/components/shared/mobileHandoff";

type RoomRow = {
  id: string;
  room_number: string;
  floor: number;
  status: string;
  vip_flag: boolean;
  dnd_flag: boolean;
  assigned_to_name: string | null;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  clean_type: string | null;
};

const STATUS_ORDER = ["DIRTY", "IN_PROGRESS", "PICKUP", "CLEAN", "INSPECTED", "OCCUPIED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"];

const STATUS_LABEL_KEYS: Record<string, string> = {
  DIRTY: "roomBoard.statusLabels.DIRTY",
  IN_PROGRESS: "roomBoard.statusLabels.IN_PROGRESS",
  PICKUP: "roomBoard.statusLabels.PICKUP",
  CLEAN: "roomBoard.statusLabels.CLEAN",
  INSPECTED: "roomBoard.statusLabels.INSPECTED",
  OCCUPIED: "roomBoard.statusLabels.OCCUPIED",
  OOO: "roomBoard.statusLabels.OOO",
  OUT_OF_ORDER: "roomBoard.statusLabels.OUT_OF_ORDER",
  OUT_OF_SERVICE: "roomBoard.statusLabels.OUT_OF_SERVICE",
};

type ToneType = "alert" | "progress" | "caution" | "ready" | "info" | "neutral";

const STATUS_TONES: Record<string, ToneType> = {
  DIRTY: "alert",
  IN_PROGRESS: "progress",
  PICKUP: "caution",
  CLEAN: "info",
  INSPECTED: "ready",
  OCCUPIED: "neutral",
  OOO: "neutral",
  OUT_OF_ORDER: "neutral",
  OUT_OF_SERVICE: "neutral",
};

function groupByStatus(rooms: RoomRow[]): Record<string, RoomRow[]> {
  const grouped: Record<string, RoomRow[]> = {};
  for (const room of rooms) {
    const key = room.status;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(room);
  }
  return grouped;
}

export default function RoomBoardScreen() {
  const { t } = useTranslation();
  const { isOnline, user } = useAppStore();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBoard = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: RoomRow[] }>("/housekeeping/board");
      setRooms(res.data ?? []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("room-board-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_status", filter: `hotel_id=eq.${user.tenant_id}` },
        () => { loadBoard(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.tenant_id, loadBoard]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBoard();
    setRefreshing(false);
  }, [loadBoard]);

  const grouped = groupByStatus(rooms);
  const statusKeys = STATUS_ORDER.filter((s) => (grouped[s]?.length ?? 0) > 0);

  const dirtyCount = grouped["DIRTY"]?.length ?? 0;
  const inProgressCount = grouped["IN_PROGRESS"]?.length ?? 0;
  const cleanCount = (grouped["CLEAN"]?.length ?? 0) + (grouped["INSPECTED"]?.length ?? 0);

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
        <Text style={styles.title}>{t("tabs.roomBoard")}</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryChip}>
            <Text style={[styles.summaryNum, { color: C.alert }]}>{dirtyCount}</Text>
            <Text style={styles.summaryLabel}>{t("roomBoard.dirty")}</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={[styles.summaryNum, { color: C.caution }]}>{inProgressCount}</Text>
            <Text style={styles.summaryLabel}>{t("roomBoard.inProgress")}</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={[styles.summaryNum, { color: C.ready }]}>{cleanCount}</Text>
            <Text style={styles.summaryLabel}>{t("roomBoard.ready")}</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={[styles.summaryNum, { color: C.ink }]}>{rooms.length}</Text>
            <Text style={styles.summaryLabel}>{t("roomBoard.total")}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {statusKeys.map((status) => (
          <View key={status}>
            <SectionLabel hint={`${grouped[status].length} ${t("roomBoard.rooms")}`}>
              {t(STATUS_LABEL_KEYS[status] ?? status)}
            </SectionLabel>
            <View style={styles.roomGrid}>
              {grouped[status].map((room) => (
                <TouchableOpacity key={room.id} style={styles.roomChip} activeOpacity={0.75}>
                  <Text style={styles.roomNumber}>{room.room_number}</Text>
                  {room.vip_flag ? (
                    <Ionicons name="star" size={9} color={C.accent} style={styles.chipIcon} />
                  ) : null}
                  {room.dnd_flag ? (
                    <Ionicons name="moon" size={9} color={C.ink4} style={styles.chipIcon} />
                  ) : null}
                  <Pill tone={STATUS_TONES[status] ?? "neutral"}>
                    {t(STATUS_LABEL_KEYS[status] ?? status)}
                  </Pill>
                  {room.assigned_to_name ? (
                    <Text style={styles.assignedTo} numberOfLines={1}>{room.assigned_to_name}</Text>
                  ) : (
                    <Text style={[styles.assignedTo, { color: C.ink4 }]}>{t("roomBoard.unassigned")}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {rooms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="bed-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("roomBoard.noRoomsLoaded")}</Text>
            <Text style={styles.emptyText}>{t("roomBoard.pullToRefresh")}</Text>
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
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryChip: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingVertical: 10,
    alignItems: "center",
  },
  summaryNum: { fontSize: 22, fontWeight: "700", lineHeight: 26 },
  summaryLabel: { fontSize: 10, color: C.ink3, marginTop: 2, fontWeight: "600" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 12 },
  roomGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roomChip: {
    width: "47%",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 12,
    gap: 4,
  },
  roomNumber: { fontSize: 17, fontWeight: "700", color: C.ink },
  chipIcon: { position: "absolute", top: 10, right: 10 },

  assignedTo: { fontSize: 11, color: C.ink3, fontWeight: "500" },
  emptyCard: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3 },
});
