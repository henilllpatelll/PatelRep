import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, monoFont } from "@/components/shared/tokens";
import { FloatingAIButton } from "@/components/shared/mobileHandoff";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";
import { getBeforeEnterWarnings, getRoomAction } from "@/lib/housekeeping/roomWorkflow";

const STATUS_COLOR: Record<string, string> = {
  DIRTY: C.alert,
  OCCUPIED: C.alert,
  PICKUP: C.caution,
  IN_PROGRESS: C.caution,
  CLEAN: C.info,
  INSPECTED: C.ready,
  OOO: C.ooo,
  OUT_OF_ORDER: C.ooo,
  OUT_OF_SERVICE: C.ooo,
};

const STATUS_LABEL: Record<string, string> = {
  DIRTY: "Vacant Dirty",
  OCCUPIED: "Occupied Dirty",
  PICKUP: "Pickup",
  IN_PROGRESS: "In Progress",
  CLEAN: "Submitted",
  INSPECTED: "Ready",
  OOO: "Out of Order / Out of Service",
  OUT_OF_ORDER: "Out of Order / Out of Service",
  OUT_OF_SERVICE: "Out of Order / Out of Service",
};

const CLEAN_TYPE_LABEL: Record<string, string> = {
  DEP: "Departure",
  FULL: "Full",
  LIGHT: "Light",
};

const CLEAN_TYPE_META: Record<string, { icon: ComponentProps<typeof Ionicons>["name"]; bg: string; fg: string; border: string }> = {
  DEP: { icon: "log-out-outline", bg: C.alertSoft, fg: C.alert, border: C.alertLine },
  FULL: { icon: "refresh-circle-outline", bg: C.infoSoft, fg: C.info, border: C.infoLine },
  LIGHT: { icon: "flash-outline", bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
};

const CHECKLISTS: Record<string, string[]> = {
  DEP: ["Strip bed", "Trash removed", "Bathroom cleaned", "Amenities restocked", "Floors cleaned", "Final presentation"],
  FULL: ["Bed made", "Bathroom cleaned", "Towels replaced", "Trash removed", "Amenities restocked", "Floors cleaned"],
  LIGHT: ["Towels refreshed", "Trash removed", "Bed refreshed", "Bathroom checked", "Amenities topped off"],
};

const BLOCKERS = [
  { label: "Can't Enter", note: "BLOCKER: Can't enter" },
  { label: "Guest Inside", note: "BLOCKER: Guest inside" },
  { label: "Need Linen", note: "BLOCKER: Need linen" },
  { label: "Need Supervisor", note: "BLOCKER: Need supervisor" },
];

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

function formatLastActionTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    const now = new Date();
    const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    if (isToday) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

function getActionLabel(status: string): string {
  switch (status) {
    case "IN_PROGRESS":
      return "Started";
    case "CLEAN":
      return "Marked clean";
    case "INSPECTED":
      return "Marked ready";
    case "DIRTY":
      return "Returned to cleaning";
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return "Marked out of order";
    case "PICKUP":
      return "Marked pickup";
    default:
      return "Updated";
  }
}

function buildLastAction(entry: { to_status?: string; created_at?: string; changed_by?: string } | null, room: Room, userId?: string): string | null {
  const status = entry?.to_status ?? room.status;
  const timestamp = entry?.created_at ?? room.updated_at ?? room.last_cleaned_at ?? room.last_inspected_at ?? null;
  if (!timestamp) return null;
  const actor = entry?.changed_by && entry.changed_by === userId ? " by you" : "";
  const time = formatLastActionTime(timestamp);
  return `${getActionLabel(status)}${actor}${time ? ` at ${time}` : ""}`;
}

function getCleanTypeLabel(room: Room): string | null {
  return room.clean_type_label ?? (room.clean_type ? CLEAN_TYPE_LABEL[room.clean_type] ?? room.clean_type : null);
}

function getPrimaryLabel(room: Room): string {
  const action = getRoomAction(room);
  if (action.kind === "start") return "Start Cleaning";
  if (action.kind === "done") return "Mark Clean";
  if (action.kind === "review") return "Review room";
  if (action.kind === "submitted") return "Submitted - Waiting for Supervisor";
  if (action.kind === "ready") return "Ready";
  if (action.kind === "blocked") return "Blocked";
  return "View";
}

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms, enqueueAction, user } = useAppStore();
  const insets = useSafeAreaInsets();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [showFoundItem, setShowFoundItem] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const noteSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (noteSuccessTimer.current) clearTimeout(noteSuccessTimer.current);
    },
    [],
  );

  useEffect(() => {
    const found = myRooms.find((candidate) => candidate.id === roomId) ?? null;
    setRoom(found);
    setLastAction(found ? buildLastAction(null, found, user?.id) : null);
    setLoading(false);
  }, [roomId, myRooms, user?.id]);

  useEffect(() => {
    if (!room || !isOnline) return;
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await api.get<{ data: Array<{ to_status?: string; created_at?: string; changed_by?: string }> }>(
          `/rooms/${room!.id}/history?limit=1`,
        );
        if (!cancelled) setLastAction(buildLastAction(res.data?.[0] ?? null, room!, user?.id));
      } catch {
        // Last action is helpful context, not a blocker for cleaning.
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [isOnline, room?.id, user?.id]);

  useEffect(() => {
    setCheckedItems({});
  }, [room?.clean_type, room?.id]);

  function updateLocalRoom(roomIdToUpdate: string, patch: Partial<Room>) {
    const updatedRooms = myRooms.map((candidate) => (candidate.id === roomIdToUpdate ? { ...candidate, ...patch } : candidate));
    setMyRooms(updatedRooms);
    setRoom((current) => (current?.id === roomIdToUpdate ? { ...current, ...patch } : current));
  }

  async function updateRoomStatus(nextStatus: Room["status"]) {
    if (!room) return;
    const previous = room;
    const updatedAt = new Date().toISOString();
    updateLocalRoom(room.id, { status: nextStatus, updated_at: updatedAt });
    setStatusLoading(true);

    try {
      if (isOnline) {
        await api.patch(`/rooms/${room.id}/status`, { status: nextStatus });
      } else {
        await enqueueAction({ type: "room_status", entityId: room.id, payload: { status: nextStatus } });
      }
    } catch (err: unknown) {
      updateLocalRoom(previous.id, previous);
      Alert.alert("Error", (err as Error).message ?? "Failed to update room");
    } finally {
      setStatusLoading(false);
    }
  }

  function handlePrimaryAction() {
    if (!room) return;
    const action = getRoomAction(room);
    if (!action.targetStatus) return;
    void updateRoomStatus(action.targetStatus);
  }

  function handleUndo() {
    if (!room || !isOnline) return;
    setStatusLoading(true);
    api
      .post<{ data: { status?: Room["status"] } }>(`/rooms/${room.id}/status/undo`, {})
      .then((response) => {
        const nextStatus = response.data?.status;
        if (nextStatus) updateLocalRoom(room.id, { status: nextStatus, updated_at: new Date().toISOString() });
      })
      .catch((err: unknown) => Alert.alert("Error", (err as Error).message ?? "Failed to undo"))
      .finally(() => setStatusLoading(false));
  }

  async function submitNote(text: string) {
    if (!room || !text.trim()) return;
    if (!isOnline) {
      Alert.alert("Offline", "Notes need a connection. Status changes will still queue offline.");
      return;
    }

    setNoteLoading(true);
    try {
      const note = text.trim();
      await api.post(`/rooms/${room.id}/notes`, { text: note });
      updateLocalRoom(room.id, { latest_note: note, latest_note_at: new Date().toISOString() });
      setNoteText("");
      setNoteOpen(false);
      setNoteSuccess(true);
      if (noteSuccessTimer.current) clearTimeout(noteSuccessTimer.current);
      noteSuccessTimer.current = setTimeout(() => setNoteSuccess(false), 4000);
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to save note");
    } finally {
      setNoteLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t("common.error")}</Text>
      </View>
    );
  }

  const status = room.status;
  const action = getRoomAction(room);
  const primaryLabel = getPrimaryLabel(room);
  const primaryDisabled = !action.targetStatus || statusLoading;
  const showUndo = isOnline && Boolean(action.allowUndo);
  const statusColor = STATUS_COLOR[status] ?? C.ink3;
  const statusLabel = STATUS_LABEL[status] ?? status.replace(/_/g, " ");
  const roomType = room.rooms?.room_types?.name ?? null;
  const cleanType = getCleanTypeLabel(room);
  const cleanTypeMeta = room.clean_type ? CLEAN_TYPE_META[room.clean_type] : null;
  const warnings = getBeforeEnterWarnings(room);
  const checklist = CHECKLISTS[room.clean_type ?? ""] ?? CHECKLISTS.LIGHT;
  const timingRows = [
    { label: "Guest", value: room.guest_name },
    { label: "FO status", value: room.fo_status },
    { label: "Check-in", value: formatTime(room.checkin_time) },
    { label: "Scheduled checkout", value: formatTime(room.checkout_time) },
    { label: "Actual checkout", value: formatTime(room.actual_checkout_at) },
    { label: "Predicted ready", value: formatTime(room.predicted_ready_at) },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));

  return (
    <View style={styles.root}>
      <View style={[styles.navBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.push("/(app)/my-rooms" as never)} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={C.accent} />
          <Text style={styles.backLabel}>My rooms</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 132 }]}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.roomEyebrow}>Room</Text>
              <Text style={styles.roomNum}>{room.room_number}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusBadgeText}>{statusLabel}</Text>
            </View>
          </View>
          <View style={styles.heroMeta}>
            {roomType ? <Text style={styles.heroMetaText}>{roomType}</Text> : null}
            <Text style={styles.heroMetaText}>Floor {room.floor}</Text>
            {cleanType ? (
              <View
                accessible
                accessibilityLabel={`${cleanType} clean type`}
                style={[
                  styles.cleanTypeChip,
                  cleanTypeMeta && {
                    backgroundColor: cleanTypeMeta.bg,
                    borderColor: cleanTypeMeta.border,
                  },
                ]}
              >
                {cleanTypeMeta ? <Ionicons name={cleanTypeMeta.icon} size={12} color={cleanTypeMeta.fg} /> : null}
                <Text style={[styles.cleanTypeChipText, cleanTypeMeta && { color: cleanTypeMeta.fg }]}>{cleanType}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {warnings.length > 0 ? (
          <View style={styles.warningSection}>
            <Text style={styles.warningTitle}>Before you enter</Text>
            {warnings.map((warning) => {
              const critical = warning.severity === "critical";
              return (
                <View key={warning.key} style={[styles.warningRow, critical && styles.warningRowCritical]}>
                  <Ionicons name={critical ? "warning" : "alert-circle-outline"} size={16} color={critical ? C.alert : C.caution} />
                  <View style={styles.warningCopy}>
                    <Text style={[styles.warningLabel, critical && styles.warningLabelCritical]}>{warning.label}</Text>
                    <Text style={styles.warningDetail}>{warning.detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.cardSection}>
          <Text style={styles.sectionTitle}>Reservation / Timing</Text>
          {timingRows.length > 0 ? (
            <View style={styles.infoGrid}>
              {timingRows.map((row) => (
                <View key={row.label} style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{row.label}</Text>
                  <Text style={styles.infoValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.mutedText}>No reservation timing attached.</Text>
          )}
        </View>

        <View style={styles.cardSection}>
          <Text style={styles.sectionTitle}>Current Status</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {lastAction ? <Text style={styles.lastActionText}>Last action: {lastAction}</Text> : null}
          {noteSuccess ? <Text style={styles.noteSuccessText}>Note saved</Text> : null}
        </View>

        <View style={styles.cardSection}>
          <Text style={styles.sectionTitle}>Quick blockers</Text>
          <View style={styles.blockerGrid}>
            {BLOCKERS.map((blocker) => (
              <TouchableOpacity
                key={blocker.label}
                style={[styles.blockerBtn, noteLoading && styles.btnDisabled]}
                onPress={() => void submitNote(blocker.note)}
                disabled={noteLoading}
                activeOpacity={0.82}
              >
                <Text style={styles.blockerText}>{blocker.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.cardSection}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionChip} onPress={() => setNoteOpen((value) => !value)} activeOpacity={0.82}>
              <Ionicons name="chatbubble-outline" size={14} color={C.info} />
              <Text style={[styles.actionChipText, { color: C.info }]}>Add Note</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionChip, styles.actionChipWork]} onPress={() => setShowReportIssue(true)} activeOpacity={0.82}>
              <Ionicons name="build-outline" size={14} color={C.brass} />
              <Text style={[styles.actionChipText, { color: C.brass }]}>Work Order</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionChip, styles.actionChipFound]} onPress={() => setShowFoundItem(true)} activeOpacity={0.82}>
              <Ionicons name="bag-outline" size={14} color={C.caution} />
              <Text style={[styles.actionChipText, { color: C.caution }]}>Lost & Found</Text>
            </TouchableOpacity>
          </View>

          {noteOpen ? (
            <View style={styles.noteForm}>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Leave a note for your supervisor or team..."
                placeholderTextColor={C.ink3}
                multiline
                numberOfLines={2}
                autoFocus
              />
              <View style={styles.noteActions}>
                <TouchableOpacity
                  style={[styles.noteSendBtn, (!noteText.trim() || noteLoading) && styles.btnDisabled]}
                  onPress={() => void submitNote(noteText)}
                  disabled={!noteText.trim() || noteLoading}
                  activeOpacity={0.85}
                >
                  {noteLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="send" size={13} color="#fff" />
                      <Text style={styles.noteSendText}>Save Note</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setNoteOpen(false)}>
                  <Text style={styles.noteCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.cardSection}>
          <Text style={styles.sectionTitle}>Cleaning Checklist</Text>
          <View style={styles.checklist}>
            {checklist.map((item) => {
              const checked = Boolean(checkedItems[item]);
              return (
                <TouchableOpacity
                  key={item}
                  style={styles.checkRow}
                  onPress={() => setCheckedItems((current) => ({ ...current, [item]: !current[item] }))}
                  activeOpacity={0.78}
                >
                  <View style={[styles.checkBox, checked && styles.checkBoxActive]}>
                    {checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.checkText, checked && styles.checkTextDone]}>{item}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.stickyAction, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, primaryDisabled && styles.primaryBtnDisabled]}
          onPress={handlePrimaryAction}
          disabled={primaryDisabled}
          activeOpacity={0.86}
        >
          {statusLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>{primaryLabel}</Text>}
        </TouchableOpacity>
        {showUndo ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleUndo} disabled={statusLoading} activeOpacity={0.82}>
            <Text style={styles.secondaryBtnText}>Undo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <FloatingAIButton bottom={insets.bottom + 86} onPress={() => router.push("/(app)/copilot")} />

      <ReportIssueModal visible={showReportIssue} roomId={room.id} roomNumber={room.room_number} onClose={() => setShowReportIssue(false)} />
      <FoundItemModal visible={showFoundItem} roomId={room.id} roomNumber={room.room_number} onClose={() => setShowFoundItem(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.paper },
  errorText: { color: C.ink3, fontSize: 14 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 13,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, padding: 2 },
  backLabel: { fontSize: 15, color: C.accent, fontWeight: "600" },
  scroll: { flex: 1, backgroundColor: C.paper },
  content: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },

  hero: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, gap: 12 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  roomEyebrow: { color: C.ink3, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  roomNum: { fontFamily: monoFont, color: C.ink, fontSize: 48, lineHeight: 52, fontWeight: "800" },
  statusBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 4 },
  statusBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  heroMetaText: { color: C.ink2, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, fontWeight: "700" },
  cleanTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  cleanTypeChipText: { color: C.ink2, fontSize: 12, fontWeight: "800" },

  warningSection: { backgroundColor: C.alertSoft, borderWidth: 1, borderColor: C.alertLine, borderRadius: 16, padding: 14, gap: 10 },
  warningTitle: { fontSize: 16, fontWeight: "900", color: C.alert },
  warningRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: C.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line2 },
  warningRowCritical: { borderColor: C.alertLine, backgroundColor: "#FFF7F7" },
  warningCopy: { flex: 1, gap: 2 },
  warningLabel: { fontSize: 13, fontWeight: "800", color: C.ink },
  warningLabelCritical: { color: C.alert },
  warningDetail: { fontSize: 12, color: C.ink2, lineHeight: 17 },

  cardSection: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, gap: 10 },
  sectionTitle: { color: C.ink3, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  mutedText: { color: C.ink3, fontSize: 13 },
  infoGrid: { gap: 8 },
  infoRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 14, borderBottomWidth: 1, borderBottomColor: C.line2, paddingBottom: 7 },
  infoLabel: { color: C.ink3, fontSize: 12, fontWeight: "700" },
  infoValue: { color: C.ink, fontSize: 13, fontWeight: "700", textAlign: "right", flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 17, fontWeight: "800" },
  lastActionText: { fontSize: 12, color: C.ink3, lineHeight: 17 },
  noteSuccessText: { fontSize: 12, color: C.ready, fontWeight: "700" },

  blockerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  blockerBtn: {
    minWidth: "47%",
    flexGrow: 1,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  blockerText: { fontSize: 13, fontWeight: "800", color: C.ink2 },
  btnDisabled: { opacity: 0.5 },

  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.infoSoft,
    borderRadius: 10,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.infoLine,
  },
  actionChipWork: { backgroundColor: C.brassSoft, borderColor: C.brassLine },
  actionChipFound: { backgroundColor: C.cautionSoft, borderColor: C.cautionLine },
  actionChipText: { fontSize: 12, fontWeight: "800" },
  noteForm: { backgroundColor: C.surface2, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  noteInput: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, fontSize: 13, color: C.ink, minHeight: 64, textAlignVertical: "top" },
  noteActions: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line2 },
  noteSendBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.accent, borderRadius: 9, minHeight: 48, paddingHorizontal: 14, justifyContent: "center" },
  noteSendText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  noteCancelText: { fontSize: 12, color: C.ink3, fontWeight: "700" },

  checklist: { gap: 8 },
  checkRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface2, alignItems: "center", justifyContent: "center" },
  checkBoxActive: { backgroundColor: C.ready, borderColor: C.ready },
  checkText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  checkTextDone: { color: C.ink3, textDecorationLine: "line-through" },

  stickyAction: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.surface,
  },
  primaryBtn: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.accent, paddingHorizontal: 14 },
  primaryBtnDisabled: { backgroundColor: C.ink4 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "900", textAlign: "center" },
  secondaryBtn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    paddingHorizontal: 18,
  },
  secondaryBtnText: { color: C.ink2, fontSize: 14, fontWeight: "800" },
});
