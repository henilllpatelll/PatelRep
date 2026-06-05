import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
import { localDate } from "@/lib/utils/date";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { C, R } from "@/components/shared/tokens";
import { HeroButton, Pill, SectionLabel } from "@/components/shared/mobileHandoff";

type StaffMember = { id: string; full_name: string; role: string };
type AssignedRoom = { id: string; room_number: string; floor: number; status: string; clean_type: string | null };
type HousekeeperAssignment = { housekeeper: StaffMember; rooms: AssignedRoom[] };

function statusPillTone(status: string): "alert" | "progress" | "caution" | "ready" | "info" | "neutral" {
  if (status === "DIRTY") return "alert";
  if (status === "IN_PROGRESS" || status === "PICKUP") return "progress";
  if (status === "CLEAN") return "info";
  if (status === "INSPECTED") return "ready";
  return "neutral";
}

export default function AssignmentsScreen() {
  const { t } = useTranslation();
  const { isOnline, user } = useAppStore();
  const [assignments, setAssignments] = useState<HousekeeperAssignment[]>([]);
  const [unassigned, setUnassigned] = useState<AssignedRoom[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<AssignedRoom | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);

  const loadData = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const [boardRes, staffRes] = await Promise.all([
        api.get<{ data: { rooms: (AssignedRoom & { assigned_to: string | null; assigned_to_name: string | null })[] } }>(
          `/housekeeping/board?date=${localDate()}`
        ),
        api.get<{ data: StaffMember[] }>("/staff?role=housekeeper"),
      ]);

      const rooms = boardRes.data?.rooms ?? [];
      const staffList: StaffMember[] = staffRes.data ?? [];
      setStaff(staffList);

      const grouped: Record<string, HousekeeperAssignment> = {};
      const unassignedRooms: AssignedRoom[] = [];

      for (const room of rooms) {
        if (room.assigned_to) {
          if (!grouped[room.assigned_to]) {
            const member = staffList.find((s) => s.id === room.assigned_to);
            grouped[room.assigned_to] = {
              housekeeper: member ?? { id: room.assigned_to, full_name: room.assigned_to_name ?? "Unknown", role: "housekeeper" },
              rooms: [],
            };
          }
          grouped[room.assigned_to].rooms.push(room);
        } else {
          unassignedRooms.push(room);
        }
      }

      setAssignments(Object.values(grouped));
      setUnassigned(unassignedRooms);
    } catch {
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("assignments-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_assignments", filter: `hotel_id=eq.${user.tenant_id}` },
        () => { loadData(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.tenant_id, loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const autoAssign = async () => {
    setAutoAssigning(true);
    try {
      await api.post("/housekeeping/assignments/auto", { date: localDate() });
      await loadData();
    } catch {
      // endpoint may not exist — silently reload current state
      await loadData();
    } finally {
      setAutoAssigning(false);
    }
  };

  const openPicker = (room: AssignedRoom) => {
    setSelectedRoom(room);
    setPickerVisible(true);
  };

  const assignRoom = async (housekeeper: StaffMember) => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await api.post("/housekeeping/assignments", {
        room_id: selectedRoom.id,
        assigned_to: housekeeper.id,
        assignment_date: localDate(),
      });
      setPickerVisible(false);
      await loadData();
    } catch {
      // silently reload
    } finally {
      setSaving(false);
    }
  };

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
          <Text style={styles.title}>{t("tabs.assignments")}</Text>
          <TouchableOpacity
            style={[styles.autoBtn, autoAssigning && styles.autoBtnDisabled]}
            onPress={autoAssign}
            disabled={autoAssigning}
            activeOpacity={0.75}
          >
            <Ionicons name="shuffle-outline" size={14} color={C.surface} />
            <Text style={styles.autoBtnLabel}>{autoAssigning ? t("assignments.assigning") : t("assignments.autoAssign")}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>{localDate()} · {assignments.reduce((n, a) => n + a.rooms.length, 0)} {t("assignments.assigned")} · {unassigned.length} {t("assignments.unassigned")}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {unassigned.length > 0 ? (
          <View>
            <SectionLabel hint={`${unassigned.length} ${t("assignments.rooms")}`}>{t("assignments.unassignedSection")}</SectionLabel>
            <View style={styles.roomsList}>
              {unassigned.map((room) => (
                <TouchableOpacity key={room.id} style={styles.roomRow} onPress={() => openPicker(room)} activeOpacity={0.75}>
                  <View style={styles.roomRowLeft}>
                    <Text style={styles.roomNum}>{room.room_number}</Text>
                    <Text style={styles.floorLabel}>{t("assignments.floor", { floor: room.floor })}</Text>
                  </View>
                  <Pill tone={statusPillTone(room.status)}>{room.status.replace(/_/g, " ")}</Pill>
                  <Ionicons name="person-add-outline" size={16} color={C.accent} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {assignments.map(({ housekeeper, rooms }) => (
          <View key={housekeeper.id}>
            <SectionLabel hint={`${rooms.length} rooms`}>{housekeeper.full_name}</SectionLabel>
            <View style={styles.roomsList}>
              {rooms.map((room) => (
                <TouchableOpacity key={room.id} style={styles.roomRow} onPress={() => openPicker(room)} activeOpacity={0.75}>
                  <View style={styles.roomRowLeft}>
                    <Text style={styles.roomNum}>{room.room_number}</Text>
                    <Text style={styles.floorLabel}>{t("assignments.floor", { floor: room.floor })}</Text>
                  </View>
                  <Pill tone={statusPillTone(room.status)}>{room.status.replace(/_/g, " ")}</Pill>
                  <Ionicons name="chevron-forward" size={14} color={C.ink4} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {assignments.length === 0 && unassigned.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("assignments.noAssignments")}</Text>
            <Text style={styles.emptyText}>{t("assignments.noAssignmentsHint")}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerVisible(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t("assignments.assignRoom", { room: selectedRoom?.room_number })}</Text>
          <Text style={styles.sheetSub}>{t("assignments.chooseHousekeeper")}</Text>
          <ScrollView style={styles.sheetList}>
            {staff.map((member) => (
              <HeroButton key={member.id} onPress={() => assignRoom(member)}>
                {saving ? t("assignments.saving") : member.full_name}
              </HeroButton>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setPickerVisible(false)}>
            <Text style={styles.cancelText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
    gap: 6,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  subtitle: { fontSize: 12, color: C.ink3 },
  autoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.accent,
    borderRadius: R.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  autoBtnDisabled: { opacity: 0.5 },
  autoBtnLabel: { fontSize: 12, fontWeight: "600", color: C.surface },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 12 },
  roomsList: { gap: 6 },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  roomRowLeft: { flex: 1 },
  roomNum: { fontSize: 15, fontWeight: "700", color: C.ink },
  floorLabel: { fontSize: 11, color: C.ink3 },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "60%",
  },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: C.ink, marginBottom: 4 },
  sheetSub: { fontSize: 13, color: C.ink3, marginBottom: 14 },
  sheetList: { maxHeight: 260 },

  cancelBtn: { paddingVertical: 14, alignItems: "center" },
  cancelText: { fontSize: 15, color: C.ink3, fontWeight: "600" },
});
