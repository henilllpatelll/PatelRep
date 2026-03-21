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
      return [{ label: "rooms.markInProgress", status: "IN_PROGRESS", color: "#F59E0B" }];
    case "IN_PROGRESS":
      return [{ label: "rooms.markClean", status: "CLEAN", color: "#10B981" }];
    default:
      return [];
  }
}

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showReportIssue, setShowReportIssue] = useState(false);

  useEffect(() => {
    api
      .get<Room>(`/rooms/${roomId}`)
      .then(setRoom)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [roomId]);

  async function handleStatusChange(newStatus: string) {
    if (!room) return;
    setUpdating(true);
    const payload = { status: newStatus };

    try {
      if (isOnline) {
        const updated = await api.patch<Room>(`/rooms/${room.id}/status`, payload);
        setRoom(updated);
      } else {
        await enqueueAction("room_status", "update", payload, room.id);
        setRoom({ ...room, status: newStatus as Room["status"] });
        Alert.alert("", t("common.offline"));
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
        <ActivityIndicator size="large" color="#1E40AF" />
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
          <Ionicons name="arrow-back" size={24} color="#1E40AF" />
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
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#E5E7EB",
  },
  backBtn: { marginRight: 12 },
  roomNumber: { fontSize: 20, fontWeight: "700", color: "#111827" },
  section: {
    backgroundColor: "#fff",
    padding: 16,
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  label: { fontSize: 12, color: "#6B7280", marginBottom: 4, textTransform: "uppercase" },
  value: { fontSize: 16, color: "#111827", fontWeight: "500" },
  alertBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7" },
  alertText: { color: "#92400E", fontWeight: "500" },
  riskBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2" },
  riskText: { color: "#991B1B", fontWeight: "500" },
  actions: { padding: 16, gap: 12 },
  actionBtn: { padding: 16, borderRadius: 12, alignItems: "center" },
  actionText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  reportBtn: {
    backgroundColor: "#FEF2F2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  reportText: { color: "#DC2626", fontSize: 16, fontWeight: "600" },
});
