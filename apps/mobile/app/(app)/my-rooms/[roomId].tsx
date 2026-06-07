import { useEffect, useState } from "react";
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
import { enqueueAction } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, monoFont, displayFont } from "@/components/shared/tokens";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";

const STATUS_COLOR: Record<string, string> = {
  DIRTY: C.alert, OCCUPIED: C.alert, PICKUP: C.caution,
  IN_PROGRESS: C.caution, CLEAN: C.info, INSPECTED: C.ready,
  OOO: C.ink3, OUT_OF_ORDER: C.ink3, OUT_OF_SERVICE: C.ink3,
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

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms, user } = useAppStore();
  const insets = useSafeAreaInsets();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [showFoundItem, setShowFoundItem] = useState(false);

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

  async function performUndo() {
    if (!room) return;
    setUpdating(true);
    try {
      if (isOnline) {
        const res = await api.post<{ data: Room }>(`/rooms/${room.id}/status/undo`, {});
        const next = { ...room, status: res.data.status, updated_at: new Date().toISOString() };
        setRoom(next);
        setMyRooms(myRooms.map((r) => (r.id === room.id ? next : r)));
      } else {
        Alert.alert(t("common.error"), t("rooms.undoNeedsConnection"));
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  function handleUndo() {
    Alert.alert(t("rooms.confirmUndoTitle"), t("rooms.confirmUndoMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("rooms.confirmUndoAction"), style: "destructive", onPress: () => void performUndo() },
    ]);
  }

  async function handleAddNote() {
    if (!room || !noteText.trim()) return;
    setNoteLoading(true);
    try {
      await api.post(`/rooms/${room.id}/notes`, { text: noteText.trim() });
      setNoteText("");
      setNoteOpen(false);
      setNoteSuccess(true);
      setTimeout(() => setNoteSuccess(false), 4000);
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
  const canUndo = status === "IN_PROGRESS" || status === "CLEAN";

  return (
    <>
      {/* Nav header */}
      <View style={[styles.navBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.push("/(app)/my-rooms")} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={C.accent} />
          <Text style={styles.backLabel}>My rooms</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

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
          {canUndo ? (
            <TouchableOpacity
              style={[styles.secondaryBtn, updating && styles.btnDisabled]}
              onPress={handleUndo}
              disabled={updating}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-undo-outline" size={15} color={C.ink2} />
              <Text style={styles.secondaryBtnText}>{t("rooms.undoLastStep")}</Text>
            </TouchableOpacity>
          ) : null}

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
              <Ionicons name="build-outline" size={13} color="#c2410c" />
              <Text style={[styles.actionChipText, { color: "#c2410c" }]}>Work Order</Text>
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
                  onPress={handleAddNote}
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
    </>
  );
}

const styles = StyleSheet.create({
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

  titleBlock: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 },
  roomNum: { fontFamily: displayFont, fontSize: 28, color: C.ink, lineHeight: 32 },
  roomTypeName: { fontFamily: monoFont, fontSize: 12, color: C.ink3, marginTop: 3 },
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

  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18,
  },
  secondaryBtnText: { color: C.ink2, fontSize: 14, fontWeight: "600" },
  btnDisabled: { opacity: 0.5 },

  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.infoSoft, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: C.infoLine,
  },
  actionChipOrange: { backgroundColor: "#fff7ed", borderColor: "#fed7aa" },
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
    paddingHorizontal: 12, paddingVertical: 6,
  },
  noteSendText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  noteCancelText: { fontSize: 12, color: C.ink3 },
});
