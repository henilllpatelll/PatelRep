import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { C, R } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import type { AssignableStaff, TeamLoad } from "@/lib/housekeeping/supervisor";

/* ─── Housekeeper picker — bottom sheet used by Board and Assignments ───────
   Shows each assignable staff member with today's live load so the
   supervisor can see who has room for one more. */

export function HousekeeperPicker({
  visible,
  roomNumber,
  staff,
  loads,
  saving,
  onSelect,
  onClose,
}: {
  visible: boolean;
  roomNumber: string | null;
  staff: AssignableStaff[];
  loads: TeamLoad[];
  saving: boolean;
  onSelect: (member: AssignableStaff) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loadById = new Map(loads.map((load) => [load.housekeeperId, load]));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.title}>
          {roomNumber ? t("picker.title", { room: roomNumber }) : t("picker.titleGeneric")}
        </Text>
        <Text style={styles.subtitle}>{t("picker.subtitle")}</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {staff.length === 0 ? (
            <Text style={styles.emptyText}>{t("picker.noStaff")}</Text>
          ) : (
            staff.map((member) => {
              const load = loadById.get(member.userId);
              return (
                <TouchableOpacity
                  key={member.userId}
                  style={[styles.row, saving && styles.rowDimmed]}
                  onPress={() => onSelect(member)}
                  disabled={saving}
                  activeOpacity={0.8}
                  testID={`picker-${member.userId}`}
                >
                  <Avatar name={member.name} size={38} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>{member.name}</Text>
                    <Text style={styles.rowLoad}>
                      {load
                        ? t("picker.load", { count: load.total, minutes: load.minutesLeft })
                        : t("picker.noRooms")}
                    </Text>
                  </View>
                  <Ionicons name="person-add-outline" size={17} color={C.accent} />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
          <Text style={styles.cancelText}>{saving ? t("picker.saving") : t("common.cancel")}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: C.paper,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: "70%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.line,
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: "700", color: C.ink },
  subtitle: { fontSize: 12.5, color: C.ink3, marginTop: 3, marginBottom: 13 },
  list: { flexGrow: 0 },
  listContent: { gap: 7 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  rowDimmed: { opacity: 0.55 },
  rowBody: { flex: 1, minWidth: 0, gap: 1 },
  rowName: { fontSize: 14, fontWeight: "700", color: C.ink },
  rowLoad: { fontSize: 11.5, color: C.ink3 },
  emptyText: { fontSize: 13, color: C.ink3, textAlign: "center", paddingVertical: 18 },
  cancelBtn: { marginTop: 12, minHeight: 46, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontWeight: "600", color: C.ink3 },
});
