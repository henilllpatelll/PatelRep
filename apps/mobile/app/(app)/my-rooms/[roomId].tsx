import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { enqueueAction } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";

function formatETA(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getTransitions(status: string) {
  switch (status) {
    case "DIRTY":
      return [{ label: "rooms.markInProgress", status: "IN_PROGRESS", color: "#7c3aed" }];
    case "IN_PROGRESS":
      return [{ label: "rooms.markClean", status: "CLEAN", color: "#265d8a" }];
    default:
      return [];
  }
}

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { t } = useTranslation();
  const { isOnline, myRooms } = useAppStore();
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showReportIssue, setShowReportIssue] = useState(false);

  useEffect(() => {
    const found = myRooms.find((r) => r.id === roomId);
    setRoom(found ?? null);
    setLoading(false);
  }, [roomId, myRooms]);

  async function handleStatusChange(newStatus: string) {
    if (!room) return;
    setUpdating(true);
    const payload = { status: newStatus };

    try {
      if (isOnline) {
        const res = await api.patch<{ data: Room }>(`/rooms/${room.id}/status`, payload);
        void res;
        setRoom({ ...room, status: newStatus as Room["status"] });
      } else {
        await enqueueAction("room_status", "update", payload, room.id);
        setRoom({ ...room, status: newStatus as Room["status"] });
        // OfflineBanner in the layout already communicates offline state — no Alert needed
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#b8431c" />
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.center}>
        <Text>{t("common.error")}</Text>
      </View>
    );
  }

  const transitions = getTransitions(room.status);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1a1815" />
        </TouchableOpacity>
        <Text style={styles.roomNumber}>Room {room.room_number}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Status</Text>
        <Text style={styles.value}>{t(`rooms.status.${room.status}`)}</Text>
      </View>

      {room.guest_name && (
        <View style={styles.section}>
          <Text style={styles.label}>Guest</Text>
          <Text style={styles.value}>{room.guest_name}</Text>
        </View>
      )}

      {room.dnd_flag && (
        <View style={[styles.section, styles.alertBox]}>
          <Ionicons name="moon" size={16} color="#F59E0B" />
          <Text style={styles.alertText}>{t("rooms.dndAlert")}</Text>
        </View>
      )}

      {room.vip_flag && (
        <View style={[styles.section, styles.vipBox]}>
          <Ionicons name="star" size={16} color="#D97706" />
          <Text style={styles.vipText}>{t("rooms.vipGuest")}</Text>
        </View>
      )}

      {room.checkin_time && (
        <View style={styles.section}>
          <Text style={styles.label}>{t("rooms.checkinTime", { time: formatETA(room.checkin_time) })}</Text>
        </View>
      )}

      {room.risk_level === "HIGH" && (
        <View style={[styles.section, styles.riskBox]}>
          <Ionicons name="warning" size={16} color="#EF4444" />
          <Text style={styles.riskText}>{t("rooms.risk.HIGH")}</Text>
        </View>
      )}

      <View style={styles.actions}>
        {transitions.map((tr) => (
          <TouchableOpacity
            key={tr.status}
            style={[styles.actionBtn, { backgroundColor: tr.color }]}
            onPress={() => handleStatusChange(tr.status)}
            disabled={updating}
          >
            {updating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionText}>{t(tr.label)}</Text>
            )}
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.actionBtn, styles.reportBtn]}
          onPress={() => setShowReportIssue(true)}
        >
          <Ionicons name="warning-outline" size={18} color="#DC2626" />
          <Text style={styles.reportText}>{t("rooms.reportIssue")}</Text>
        </TouchableOpacity>
      </View>

      <ReportIssueModal
        visible={showReportIssue}
        roomId={room.id}
        roomNumber={room.room_number}
        onClose={() => setShowReportIssue(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f4ee" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderColor: "#e6dfd1",
  },
  backBtn: { marginRight: 12 },
  roomNumber: { fontSize: 20, fontWeight: "700", color: "#1a1815" },
  section: {
    backgroundColor: "#ffffff",
    padding: 16,
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e6dfd1",
  },
  label: { fontSize: 11, color: "#807a70", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 },
  value: { fontSize: 16, color: "#1a1815", fontWeight: "500" },
  alertBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f5e9cf", borderColor: "#e0c890" },
  alertText: { color: "#a16207", fontWeight: "500" },
  vipBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f5e9cf", borderColor: "#e0c890" },
  vipText: { color: "#a16207", fontWeight: "500" },
  riskBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f5d8de", borderColor: "#e8a8b3" },
  riskText: { color: "#a6263c", fontWeight: "500" },
  actions: { padding: 16, gap: 12 },
  actionBtn: { padding: 16, borderRadius: 10, alignItems: "center" },
  actionText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  reportBtn: {
    backgroundColor: "#f5d8de",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#e8a8b3",
  },
  reportText: { color: "#a6263c", fontSize: 16, fontWeight: "600" },
});
