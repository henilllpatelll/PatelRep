import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { R, monoFont } from "@/components/shared/tokens";
import { StatusPill } from "@/components/shared/evening";
import { Avatar } from "@/components/shared/mobileHandoff";
import { isActionable, type FloorRoom } from "@/lib/housekeeping/supervisor";
import { api } from "@/lib/api/client";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";

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

const ROOM_STATUS_BADGE_KEY: Partial<Record<string, StatusKey>> = {
  DIRTY: "dirty",
  OCCUPIED: "occupied",
  PICKUP: "pickup",
  IN_PROGRESS: "inProgress",
  CLEAN: "clean",
  INSPECTED: "ready",
  OOO: "outOfOrder",
  OUT_OF_ORDER: "outOfOrder",
  OUT_OF_SERVICE: "outOfOrder",
};

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
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  if (!room) return null;

  const checkout = formatClock(room.checkoutTime, locale);
  const checkin = formatClock(room.checkinTime, locale);
  const canAssign = isActionable(room.status);
  const statusBadgeKey = ROOM_STATUS_BADGE_KEY[room.status];

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
      <View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(30, insets.bottom + 16), backgroundColor: theme.background },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />

        <View style={styles.titleRow}>
          <Text style={[styles.roomNumber, { color: theme.textPrimary }]}>{room.roomNumber}</Text>
          <View style={styles.titleBody}>
            {room.roomType ? (
              <Text style={[styles.roomType, { color: theme.textSecondary }]} numberOfLines={1}>
                {room.roomType}
              </Text>
            ) : null}
            <Text style={[styles.floorText, { color: theme.textMuted }]}>{t("roomBoard.floor", { floor: room.floor })}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel={t("common.cancel")}>
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.chipRow}>
          {statusBadgeKey ? (
            <StatusBadge statusKey={statusBadgeKey} label={t(`roomBoard.statusLabels.${room.status}`)} />
          ) : (
            <StatusPill status={room.status} />
          )}
          {room.cleanTypeLabel ? (
            <View
              style={[
                styles.flagChip,
                room.cleanType === "DEP"
                  ? { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }
                  : { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
              ]}
            >
              <Text style={[styles.flagText, { color: room.cleanType === "DEP" ? theme.status.dirty : theme.status.pickup }]}>
                {room.cleanTypeLabel}
              </Text>
            </View>
          ) : null}
          {room.dnd ? (
            <View style={[styles.flagChip, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
              <Text style={[styles.flagText, { color: theme.textSecondary }]}>{t("roomBoard.sheet.dnd")}</Text>
            </View>
          ) : null}
          {room.highRisk ? (
            <View style={[styles.flagChip, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
              <Text style={[styles.flagText, { color: theme.status.dirty }]}>{t("roomBoard.sheet.highRisk")}</Text>
            </View>
          ) : null}
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Who owns this room today */}
          <View style={[styles.assignCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {assigneeName ? (
              <>
                <Avatar name={assigneeName} size={36} />
                <View style={styles.assignBody}>
                  <Text style={[styles.assignLabel, { color: theme.textMuted }]}>{t("roomBoard.sheet.assignedTo")}</Text>
                  <Text style={[styles.assignName, { color: theme.textPrimary }]} numberOfLines={1}>{assigneeName}</Text>
                </View>
                <Button
                  label={t("roomBoard.sheet.reassign")}
                  onPress={() => onAssign(room)}
                  loading={saving}
                  variant="secondary"
                  size="sm"
                />
              </>
            ) : (
              <>
                <View style={[styles.unassignedIcon, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="person-add-outline" size={17} color={canAssign ? theme.status.dirty : theme.textDisabled} />
                </View>
                <View style={styles.assignBody}>
                  <Text style={[styles.assignLabel, { color: theme.textMuted }]}>{t("roomBoard.sheet.assignedTo")}</Text>
                  <Text style={[styles.assignName, { color: theme.textMuted }]}>{t("roomBoard.unassigned")}</Text>
                </View>
                {canAssign ? (
                  <Button
                    label={t("roomBoard.sheet.assign")}
                    onPress={() => onAssign(room)}
                    loading={saving}
                    size="sm"
                  />
                ) : null}
              </>
            )}
          </View>

          {/* Timing */}
          {checkout || checkin ? (
            <View style={[styles.infoCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {checkout ? (
                <View style={styles.infoRow}>
                  <Ionicons name="log-out-outline" size={14} color={theme.textMuted} />
                  <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{t("roomBoard.sheet.checkout")}</Text>
                  <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{checkout}</Text>
                </View>
              ) : null}
              {checkin ? (
                <View style={styles.infoRow}>
                  <Ionicons name="log-in-outline" size={14} color={theme.textMuted} />
                  <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{t("roomBoard.sheet.arrival")}</Text>
                  <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{checkin}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Latest staff note */}
          {room.latestNote ? (
            <View style={[styles.noteCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
              <Ionicons name="chatbox-outline" size={14} color={theme.status.clean} />
              <View style={styles.noteBody}>
                <Text style={[styles.noteLabel, { color: theme.status.clean }]}>{t("roomBoard.sheet.latestNote")}</Text>
                <Text style={[styles.noteText, { color: theme.textPrimary }]}>{room.latestNote}</Text>
              </View>
            </View>
          ) : null}

          {/* Open work order */}
          {room.openWorkOrder ? (
            <View style={[styles.noteCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
              <Ionicons name="construct-outline" size={14} color={theme.status.pickup} />
              <View style={styles.noteBody}>
                <Text style={[styles.noteLabel, { color: theme.status.pickup }]}>{t("roomBoard.sheet.openWorkOrder")}</Text>
                <Text style={[styles.noteText, { color: theme.textPrimary }]}>{room.openWorkOrder}</Text>
              </View>
            </View>
          ) : null}

          {room.dnd ? (
            <Button
              label={t("roomBoard.sheet.dndOverride")}
              icon="moon-outline"
              variant="secondary"
              size="sm"
              onPress={() => {
                Alert.alert(
                  t("roomBoard.sheet.dndOverrideTitle", { room: room.roomNumber }),
                  t("roomBoard.sheet.dndOverrideBody"),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("roomBoard.sheet.dndOverrideConfirm"),
                      onPress: async () => {
                        try {
                          await api.post("/tasks", {
                            title: `Supervisor wellness check — Room ${room.roomNumber}`,
                            task_type: "housekeeping",
                            priority: "high",
                            room_id: room.roomId,
                          });
                          toast.success(t("roomBoard.sheet.dndOverrideCreated"));
                        } catch {
                          toast.error(t("roomBoard.sheet.dndOverrideError"));
                        }
                      },
                    },
                  ],
                );
              }}
            />
          ) : null}

          {room.status === "CLEAN" ? (
            <Button
              label={t("roomBoard.sheet.inspectNow")}
              icon="shield-checkmark-outline"
              size="md"
              onPress={() => { onClose(); router.push("/(app)/inspect" as never); }}
            />
          ) : null}

          {room.assignmentId ? (
            <Button
              label={t("roomBoard.sheet.removeAssignment")}
              icon="remove-circle-outline"
              variant="destructive"
              size="sm"
              onPress={confirmRemove}
              loading={saving}
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "90%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  roomNumber: { fontFamily: monoFont, fontSize: 34, lineHeight: 38, fontWeight: "800" },
  titleBody: { flex: 1, minWidth: 0, gap: 1 },
  roomType: { fontSize: 12.5, fontWeight: "700" },
  floorText: { fontSize: 11.5 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 11 },
  flagChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  flagText: { fontSize: 10.5, fontWeight: "800" },

  scroll: { flexGrow: 0, marginTop: 14 },
  scrollContent: { gap: 9 },
  assignCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: R.lg,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  unassignedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  assignBody: { flex: 1, minWidth: 0, gap: 1 },
  assignLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  assignName: { fontSize: 14, fontWeight: "700" },

  infoCard: {
    borderWidth: 1,
    borderRadius: R.lg,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 8,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoLabel: { flex: 1, fontSize: 12.5 },
  infoValue: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "700" },

  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderRadius: R.lg,
    padding: 12,
  },
  noteBody: { flex: 1, minWidth: 0, gap: 2 },
  noteLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  noteText: { fontSize: 12.5, lineHeight: 18 },
});
