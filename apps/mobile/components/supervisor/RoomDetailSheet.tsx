import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { C, R, monoFont } from "@/components/shared/tokens";
import { StatusPill } from "@/components/shared/evening";
import { Avatar } from "@/components/shared/mobileHandoff";
import { isActionable, type FloorRoom } from "@/lib/housekeeping/supervisor";

/* ─── Room detail sheet — what the supervisor needs before acting ──────────
   Status, flags, timing, the latest staff note, the open work order, and
   the assignment action. Status changes stay in the housekeeper and
   inspection flows; this sheet is about who owns the room. */

function formatClock(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export function RoomDetailSheet({
  room,
  assigneeName,
  locale,
  saving,
  onAssign,
  onRemoveAssignment,
  onClose,
}: {
  room: FloorRoom | null;
  assigneeName: string | null;
  locale: string;
  saving: boolean;
  onAssign: (room: FloorRoom) => void;
  onRemoveAssignment: (room: FloorRoom) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!room) return null;

  const checkout = formatClock(room.checkoutTime, locale);
  const checkin = formatClock(room.checkinTime, locale);
  const canAssign = isActionable(room.status);

  const confirmRemove = () => {
    Alert.alert(
      t("roomBoard.sheet.removeConfirmTitle", { room: room.roomNumber }),
      t("roomBoard.sheet.removeConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("roomBoard.sheet.removeAssignment"),
          style: "destructive",
          onPress: () => onRemoveAssignment(room),
        },
      ],
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <View style={styles.titleRow}>
          <Text style={styles.roomNumber}>{room.roomNumber}</Text>
          <View style={styles.titleBody}>
            {room.roomType ? <Text style={styles.roomType} numberOfLines={1}>{room.roomType}</Text> : null}
            <Text style={styles.floorText}>{t("roomBoard.floor", { floor: room.floor })}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel={t("common.cancel")}>
            <Ionicons name="close" size={22} color={C.ink3} />
          </TouchableOpacity>
        </View>

        <View style={styles.chipRow}>
          <StatusPill status={room.status} />
          {room.cleanTypeLabel ? (
            <View style={[styles.flagChip, room.cleanType === "DEP" ? styles.flagAlert : styles.flagCaution]}>
              <Text style={[styles.flagText, { color: room.cleanType === "DEP" ? C.alert : C.caution }]}>
                {room.cleanTypeLabel}
              </Text>
            </View>
          ) : null}
          {room.vip ? (
            <View style={[styles.flagChip, styles.flagBrass]}>
              <Text style={[styles.flagText, { color: C.brass }]}>VIP</Text>
            </View>
          ) : null}
          {room.dnd ? (
            <View style={[styles.flagChip, styles.flagNeutral]}>
              <Text style={[styles.flagText, { color: C.ink2 }]}>{t("roomBoard.sheet.dnd")}</Text>
            </View>
          ) : null}
          {room.highRisk ? (
            <View style={[styles.flagChip, styles.flagAlert]}>
              <Text style={[styles.flagText, { color: C.alert }]}>{t("roomBoard.sheet.highRisk")}</Text>
            </View>
          ) : null}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Who owns this room today */}
          <View style={styles.assignCard}>
            {assigneeName ? (
              <>
                <Avatar name={assigneeName} size={36} />
                <View style={styles.assignBody}>
                  <Text style={styles.assignLabel}>{t("roomBoard.sheet.assignedTo")}</Text>
                  <Text style={styles.assignName} numberOfLines={1}>{assigneeName}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.assignBtn, styles.assignBtnGhost, saving && styles.dimmed]}
                  onPress={() => onAssign(room)}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  <Text style={styles.assignBtnGhostText}>{t("roomBoard.sheet.reassign")}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.unassignedIcon}>
                  <Ionicons name="person-add-outline" size={17} color={canAssign ? C.alert : C.ink4} />
                </View>
                <View style={styles.assignBody}>
                  <Text style={styles.assignLabel}>{t("roomBoard.sheet.assignedTo")}</Text>
                  <Text style={[styles.assignName, { color: C.ink3 }]}>{t("roomBoard.unassigned")}</Text>
                </View>
                {canAssign ? (
                  <TouchableOpacity
                    style={[styles.assignBtn, saving && styles.dimmed]}
                    onPress={() => onAssign(room)}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.assignBtnText}>{t("roomBoard.sheet.assign")}</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>

          {/* Timing */}
          {checkout || checkin ? (
            <View style={styles.infoCard}>
              {checkout ? (
                <View style={styles.infoRow}>
                  <Ionicons name="log-out-outline" size={14} color={C.ink3} />
                  <Text style={styles.infoLabel}>{t("roomBoard.sheet.checkout")}</Text>
                  <Text style={styles.infoValue}>{checkout}</Text>
                </View>
              ) : null}
              {checkin ? (
                <View style={styles.infoRow}>
                  <Ionicons name="log-in-outline" size={14} color={C.ink3} />
                  <Text style={styles.infoLabel}>{t("roomBoard.sheet.arrival")}</Text>
                  <Text style={styles.infoValue}>{checkin}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Latest staff note */}
          {room.latestNote ? (
            <View style={styles.noteCard}>
              <Ionicons name="chatbox-outline" size={14} color={C.info} />
              <View style={styles.noteBody}>
                <Text style={styles.noteLabel}>{t("roomBoard.sheet.latestNote")}</Text>
                <Text style={styles.noteText}>{room.latestNote}</Text>
              </View>
            </View>
          ) : null}

          {/* Open work order */}
          {room.openWorkOrder ? (
            <View style={styles.noteCard}>
              <Ionicons name="construct-outline" size={14} color={C.caution} />
              <View style={styles.noteBody}>
                <Text style={[styles.noteLabel, { color: C.caution }]}>{t("roomBoard.sheet.openWorkOrder")}</Text>
                <Text style={styles.noteText}>{room.openWorkOrder}</Text>
              </View>
            </View>
          ) : null}

          {room.assignmentId ? (
            <TouchableOpacity
              style={[styles.removeRow, saving && styles.dimmed]}
              onPress={confirmRemove}
              disabled={saving}
              activeOpacity={0.75}
            >
              <Ionicons name="remove-circle-outline" size={15} color={C.alert} />
              <Text style={styles.removeText}>{t("roomBoard.sheet.removeAssignment")}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
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
    paddingBottom: 30,
    maxHeight: "78%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.line,
    marginBottom: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  roomNumber: { fontFamily: monoFont, fontSize: 34, lineHeight: 38, fontWeight: "800", color: C.ink },
  titleBody: { flex: 1, minWidth: 0, gap: 1 },
  roomType: { fontSize: 12.5, fontWeight: "700", color: C.ink2 },
  floorText: { fontSize: 11.5, color: C.ink3 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 11 },
  flagChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  flagText: { fontSize: 10.5, fontWeight: "800" },
  flagAlert: { backgroundColor: C.alertSoft, borderColor: C.alertLine },
  flagCaution: { backgroundColor: C.cautionSoft, borderColor: C.cautionLine },
  flagBrass: { backgroundColor: C.brassSoft, borderColor: C.brassLine },
  flagNeutral: { backgroundColor: C.surface2, borderColor: C.line2 },

  scroll: { flexGrow: 0, marginTop: 14 },
  scrollContent: { gap: 9 },
  assignCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  unassignedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  assignBody: { flex: 1, minWidth: 0, gap: 1 },
  assignLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase", color: C.ink3 },
  assignName: { fontSize: 14, fontWeight: "700", color: C.ink },
  assignBtn: {
    minHeight: 38,
    borderRadius: R.md - 2,
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  assignBtnText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  assignBtnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.accentLine },
  assignBtnGhostText: { color: C.accent, fontSize: 12.5, fontWeight: "800" },

  infoCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 8,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoLabel: { flex: 1, fontSize: 12.5, color: C.ink2 },
  infoValue: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "700", color: C.ink },

  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: R.lg,
    padding: 12,
  },
  noteBody: { flex: 1, minWidth: 0, gap: 2 },
  noteLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase", color: C.info },
  noteText: { fontSize: 12.5, lineHeight: 18, color: C.ink },

  removeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 42,
  },
  removeText: { fontSize: 12.5, fontWeight: "700", color: C.alert },
  dimmed: { opacity: 0.5 },
});
