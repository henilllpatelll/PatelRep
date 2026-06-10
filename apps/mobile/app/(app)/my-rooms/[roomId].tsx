import { useEffect, useRef, useState } from "react";
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
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";
import { getBeforeEnterWarnings, getRoomAction } from "@/lib/housekeeping/roomWorkflow";

const STATUS_COLOR: Record<string, string> = {
  DIRTY: C.alert, OCCUPIED: C.alert, PICKUP: C.caution,
  IN_PROGRESS: C.caution, CLEAN: C.info, INSPECTED: C.ready,
  OOO: C.ooo, OUT_OF_ORDER: C.ooo, OUT_OF_SERVICE: C.ooo,
};

const STATUS_LABEL: Record<string, string> = {
  DIRTY: "Vacant Dirty", OCCUPIED: "Occupied Dirty", PICKUP: "Pickup",
  IN_PROGRESS: "In Progress", CLEAN: "Clean",
  INSPECTED: "Inspected / Ready",
  OOO: "Out of Order / Out of Service",
  OUT_OF_ORDER: "Out of Order / Out of Service",
  OUT_OF_SERVICE: "Out of Order / Out of Service",
};

const CLEAN_TYPE_SHORT: Record<string, string> = {
  DEP: "Departure", FULL: "Full", LIGHT: "Light",
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
  } catch { return null; }
}

function formatLastActionTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return null; }
}

function getActionLabel(status: string): string {
  switch (status) {
    case "IN_PROGRESS": return "Started";
    case "CLEAN": return "Marked clean";
    case "INSPECTED": return "Marked ready";
    case "DIRTY": return "Returned to cleaning";
    case "OOO": case "OUT_OF_ORDER": case "OUT_OF_SERVICE": return "Marked out of order";
    case "PICKUP": return "Marked pickup";
    default: return "Updated";
  }
}

function buildLastAction(entry: { to_status?: string; created_at?: string; changed_by?: string } | null, room: Room, userId?: string): string | null {
  const status = entry?.to_status ?? room.status;
  const ts = entry?.created_at ?? room.updated_at ?? room.last_cleaned_at ?? room.last_inspected_at ?? null;
  if (!ts) return null;
  const actor = entry?.changed_by && entry.changed_by === userId ? " by you" : "";
  const t = formatLastActionTime(ts);
  return `${getActionLabel(status)}${actor}${t ? ` at ${t}` : ""}`;
}

function getPrimaryLabel(room: Room): string {
  if (room.status === "DIRTY" || room.status === "PICKUP" || room.status === "OCCUPIED") return "Start Cleaning";
  if (room.status === "IN_PROGRESS") return "Mark Clean";
  if (room.status === "CLEAN") return "Submitted - Waiting for Supervisor";
  if (room.status === "INSPECTED") return "Ready";
  if (room.status === "OOO" || room.status === "OUT_OF_ORDER" || room.status === "OUT_OF_SERVICE") return "Blocked";
  return "View";
}

function getNextStatus(room: Room): Room["status"] | null {
  if (room.status === "DIRTY" || room.status === "PICKUP" || room.status === "OCCUPIED") return "IN_PROGRESS";
  if (room.status === "IN_PROGRESS") return "CLEAN";
  return null;
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
  const noteSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (noteSuccessTimer.current) clearTimeout(noteSuccessTimer.current);
  }, []);

  useEffect(() => {
    const found = myRooms.find((r) => r.id === roomId) ?? null;
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
      } catch { /* ignore */ }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [isOnline, room?.id, user?.id]);

  function updateLocalRoom(roomIdToUpdate: string, patch: Partial<Room>) {
    const updatedRooms = myRooms.map((r) => r.id === roomIdToUpdate ? { ...r, ...patch } : r);
    setMyRooms(updatedRooms);
    setRoom((current) => current?.id === roomIdToUpdate ? { ...current, ...patch } : current);
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
    const nextStatus = getNextStatus(room);
    if (!nextStatus) return;

    if (nextStatus === "CLEAN") {
      Alert.alert("Mark clean?", "Submit this room for supervisor inspection?", [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Clean", onPress: () => void updateRoomStatus(nextStatus) },
      ]);
      return;
    }

    void updateRoomStatus(nextStatus);
  }

  function handleUndo() {
    if (!room || !isOnline) return;
    Alert.alert("Undo last step?", "This will roll the room back to its previous status.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Undo",
        style: "destructive",
        onPress: () => {
          setStatusLoading(true);
          api.post<{ data: { status?: Room["status"] } }>(`/rooms/${room.id}/status/undo`, {})
            .then((response) => {
              const nextStatus = response.data?.status;
              if (nextStatus) updateLocalRoom(room.id, { status: nextStatus, updated_at: new Date().toISOString() });
            })
            .catch((err: unknown) => Alert.alert("Error", (err as Error).message ?? "Failed to undo"))
            .finally(() => setStatusLoading(false));
        },
      },
    ]);
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
    return <View style={styles.center}><ActivityIndicator size="large" color={C.accent} /></View>;
  }
  if (!room) {
    return <View style={styles.center}><Text style={styles.errorText}>{t("common.error")}</Text></View>;
  }

  const status = room.status;
  const statusColor = STATUS_COLOR[status] ?? C.ink3;
  const statusLabel = STATUS_LABEL[status] ?? status.replace(/_/g, " ");
  const roomType = room.rooms?.room_types?.name ?? null;
  const cleanTypeShort = room.clean_type ? (CLEAN_TYPE_SHORT[room.clean_type] ?? null) : null;
  const checkoutIso = room.actual_checkout_at ?? room.checkout_time ?? null;
  const checkoutLabel = room.actual_checkout_at ? "Checked out" : "Due out";
  const checkoutTime = formatTime(checkoutIso);
  const checkinTime = formatTime(room.checkin_time);
  const etaTime = formatTime(room.predicted_ready_at);
  const warnings = getBeforeEnterWarnings(room);
  const action = getRoomAction(room);
  const primaryLabel = getPrimaryLabel(room);
  const primaryDisabled = !getNextStatus(room) || statusLoading;
  const showUndo = isOnline && Boolean(action.allowUndo);
  return (
    <View style={styles.root}>
      {/* Nav header */}
      <View style={[styles.navBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.push("/(app)/my-rooms")} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={C.accent} />
          <Text style={styles.backLabel}>My rooms</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 132 }]}>

        {/* Room title block */}
        <View style={styles.titleBlock}>
          <Text style={styles.roomNum}>Room  {room.room_number}</Text>
          {roomType ? <Text style={styles.roomTypeName}>{roomType}</Text> : null}

          {/* Meta chips */}
          <View style={styles.metaRow}>
            {room.vip_flag ? (
              <View style={styles.vipChip}>
                <Ionicons name="star" size={11} color={C.caution} />
                <Text style={styles.vipChipText}>VIP</Text>
              </View>
            ) : null}
            {room.guest_name ? (
              <Text style={styles.metaText}>Guest: {room.guest_name}</Text>
            ) : null}
            {cleanTypeShort ? (
              <View style={styles.cleanTypeRow}>
                {room.clean_type === "DEP" ? (
                  <Ionicons name="log-out-outline" size={10} color={C.alert} />
                ) : null}
                <Text style={[styles.cleanTypeText, { color: room.clean_type === "DEP" ? C.alert : C.caution }]}>
                  {cleanTypeShort}
                </Text>
              </View>
            ) : null}
            {room.dnd_flag ? (
              <View style={styles.dndChip}>
                <Ionicons name="moon" size={11} color={C.caution} />
                <Text style={styles.dndChipText}>DND</Text>
              </View>
            ) : null}
          </View>

          {/* Times */}
          {(checkoutTime || checkinTime) ? (
            <View style={styles.timesRow}>
              {checkinTime ? (
                <Text style={styles.metaText}>Check-in: {checkinTime}</Text>
              ) : null}
              {checkoutTime ? (
                <Text style={[styles.metaText, room.actual_checkout_at && { color: C.alert }]}>
                  {checkoutLabel}: {checkoutTime}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.divider} />

        {/* Current status section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CURRENT STATUS</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {lastAction ? (
            <Text style={styles.lastActionText}>Last action: {lastAction}</Text>
          ) : null}
          {noteSuccess ? (
            <Text style={styles.noteSuccessText}>Note saved</Text>
          ) : null}
        </View>

        <View style={styles.divider} />

        {warnings.length > 0 ? (
          <>
            <View style={styles.warningSection}>
              <Text style={styles.warningTitle}>Before you enter</Text>
              {warnings.map((warning) => (
                <View key={warning.key} style={styles.warningRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={C.alert} />
                  <View style={styles.warningCopy}>
                    <Text style={styles.warningLabel}>{warning.label}</Text>
                    <Text style={styles.warningDetail}>{warning.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
          </>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Quick blockers</Text>
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

        <View style={styles.divider} />

        {/* AI ETA */}
        {etaTime ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>AI PREDICTION</Text>
              <View style={styles.statusRow}>
                <Ionicons name="sparkles" size={14} color={C.ai} />
                <Text style={[styles.metaValue, { color: C.ai }]}>Ready at {etaTime}</Text>
              </View>
              {room.risk_level === "HIGH" ? (
                <Text style={[styles.lastActionText, { color: C.alert }]}>High risk room flagged by AI</Text>
              ) : null}
            </View>
            <View style={styles.divider} />
          </>
        ) : null}

        {/* Status actions */}
        <View style={styles.section}>
          {/* Inline action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionChip}
              onPress={() => { setNoteOpen((v) => !v); setNoteText(""); }}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-outline" size={13} color={C.info} />
              <Text style={[styles.actionChipText, { color: C.info }]}>Add Note</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, styles.actionChipOrange]}
              onPress={() => setShowReportIssue(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="build-outline" size={13} color={C.brass} />
              <Text style={[styles.actionChipText, { color: C.brass }]}>Work Order</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, styles.actionChipCaution]}
              onPress={() => setShowFoundItem(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="bag-outline" size={13} color={C.caution} />
              <Text style={[styles.actionChipText, { color: C.caution }]}>Lost & Found</Text>
            </TouchableOpacity>
          </View>

          {/* Note form */}
          {noteOpen ? (
            <View style={styles.noteForm}>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Leave a note for your supervisor or team…"
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
                  {noteLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                        <Ionicons name="send" size={13} color="#fff" />
                        <Text style={styles.noteSendText}>Save Note</Text>
                      </>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setNoteOpen(false)}>
                  <Text style={styles.noteCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>

      </ScrollView>

      <View style={[styles.stickyAction, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, primaryDisabled && styles.primaryBtnDisabled]}
          onPress={handlePrimaryAction}
          disabled={primaryDisabled}
          activeOpacity={0.86}
        >
          {statusLoading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.primaryBtnText}>{primaryLabel}</Text>}
        </TouchableOpacity>
        {showUndo ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleUndo} disabled={statusLoading} activeOpacity={0.82}>
            <Text style={styles.secondaryBtnText}>Undo</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ReportIssueModal
        visible={showReportIssue}
        roomId={room.id}
        roomNumber={room.room_number}
        onClose={() => setShowReportIssue(false)}
      />
      <FoundItemModal
        visible={showFoundItem}
        roomId={room.id}
        roomNumber={room.room_number}
        onClose={() => setShowFoundItem(false)}
      />
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
    gap: 10,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, padding: 2 },
  backLabel: { fontSize: 15, color: C.accent, fontWeight: "500" },

  scroll: { flex: 1, backgroundColor: C.paper },
  content: { paddingBottom: 48 },

  titleBlock: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16 },
  roomNum: { fontSize: 46, fontWeight: "700", color: C.ink, lineHeight: 52 },
  roomTypeName: { fontSize: 14, color: C.ink3, marginTop: 3 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 },
  metaText: { fontSize: 12, color: C.ink3 },
  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cleanTypeText: { fontSize: 10, fontWeight: "700" },
  metaValue: { fontSize: 13, fontWeight: "600" },
  timesRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6 },

  vipChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.cautionSoft, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: C.cautionLine,
  },
  vipChipText: { fontSize: 10, fontWeight: "700", color: C.caution },
  dndChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.cautionSoft, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: C.cautionLine,
  },
  dndChipText: { fontSize: 10, fontWeight: "700", color: C.caution },

  divider: { height: 1, backgroundColor: C.line2, marginHorizontal: 0 },

  section: { paddingHorizontal: 18, paddingVertical: 16, gap: 10 },
  sectionLabel: {
    fontSize: 10.5, fontWeight: "700", color: C.ink3,
    letterSpacing: 0.9, textTransform: "uppercase",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 17, fontWeight: "700" },
  lastActionText: { fontSize: 12, color: C.ink3, lineHeight: 17 },
  noteSuccessText: { fontSize: 12, color: C.ready, fontWeight: "600" },

  btnDisabled: { opacity: 0.5 },

  warningSection: {
    marginHorizontal: 18,
    marginVertical: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.alertLine,
    backgroundColor: C.alertSoft,
    gap: 10,
  },
  warningTitle: { fontSize: 15, fontWeight: "800", color: C.alert },
  warningRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  warningCopy: { flex: 1, gap: 2 },
  warningLabel: { fontSize: 13, fontWeight: "800", color: C.ink },
  warningDetail: { fontSize: 12, color: C.ink2, lineHeight: 17 },

  blockerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  blockerBtn: {
    minWidth: "47%",
    flexGrow: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  blockerText: { fontSize: 13, fontWeight: "700", color: C.ink2 },

  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.infoSoft, borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: C.infoLine,
  },
  actionChipOrange: { backgroundColor: C.brassSoft, borderColor: C.brassLine },
  actionChipCaution: { backgroundColor: C.cautionSoft, borderColor: C.cautionLine },
  actionChipText: { fontSize: 12, fontWeight: "600" },

  noteForm: {
    backgroundColor: C.surface, borderRadius: 12,
    borderWidth: 1, borderColor: C.line, overflow: "hidden",
  },
  noteInput: {
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6,
    fontSize: 13, color: C.ink, minHeight: 64, textAlignVertical: "top",
  },
  noteActions: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: C.line2,
  },
  noteSendBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.accent, borderRadius: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  noteSendText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  noteCancelText: { fontSize: 12, color: C.ink3 },

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
  primaryBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
    paddingHorizontal: 14,
  },
  primaryBtnDisabled: { backgroundColor: C.ink4 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "800", textAlign: "center" },
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
  secondaryBtnText: { color: C.ink2, fontSize: 14, fontWeight: "700" },
});
