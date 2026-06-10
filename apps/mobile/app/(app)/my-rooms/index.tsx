import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { getRooms, upsertRooms } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, monoFont } from "@/components/shared/tokens";
import { localDate } from "@/lib/utils/date";
import {
  compareRoomsByPriority,
  getPrimaryTimingLine,
  getRoomAction,
  getRoomBadges,
  hasRoomException,
} from "@/lib/housekeeping/roomWorkflow";

const CLEAN_TYPE_SHORT: Record<string, string> = {
  DEP: "Departure", FULL: "Full", LIGHT: "Light",
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  DIRTY:         { label: "Vacant Dirty",                    bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  OCCUPIED:      { label: "Occupied Dirty",                  bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  PICKUP:        { label: "Pickup",                          bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  IN_PROGRESS:   { label: "In Progress",                     bg: C.aiSoft,      fg: C.ai,      border: C.aiLine },
  CLEAN:         { label: "Submitted",                       bg: C.infoSoft,    fg: C.info,    border: C.infoLine },
  INSPECTED:     { label: "Ready",                           bg: C.readySoft,   fg: C.ready,   border: C.readyLine },
  OOO:           { label: "Out of Order / Out of Service",   bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
  OUT_OF_ORDER:  { label: "Out of Order / Out of Service",   bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
  OUT_OF_SERVICE:{ label: "Out of Order / Out of Service",   bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
};

function dayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

type RoomItemProps = {
  room: Room;
  onAction: (roomId: string, status: string) => Promise<void>;
  onUndo: (roomId: string) => Promise<void>;
  onPress: () => void;
};

function RoomItem({ room, onAction, onUndo, onPress }: RoomItemProps) {
  const [loading, setLoading] = useState(false);
  const [donePending, setDonePending] = useState(false);
  const [undoPending, setUndoPending] = useState(false);

  const status = room.status ?? "DIRTY";
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: C.surface3, fg: C.ink3, border: C.line };
  const roomType = room.rooms?.room_types?.name ?? null;
  const action = getRoomAction(room);
  const badges = getRoomBadges(room);
  const timing = getPrimaryTimingLine(room);
  const cleanTypeLabel = room.clean_type_label ?? (room.clean_type ? (CLEAN_TYPE_SHORT[room.clean_type] ?? null) : null);

  useEffect(() => {
    setDonePending(false);
    setUndoPending(false);
  }, [status]);

  async function handleStart(e: GestureResponderEvent) {
    e.stopPropagation();
    setLoading(true);
    try { await onAction(room.id, "IN_PROGRESS"); } finally { setLoading(false); }
  }

  function handleDonePress(e: GestureResponderEvent) {
    e.stopPropagation();
    if (!donePending) { setUndoPending(false); setDonePending(true); return; }
    setDonePending(false);
    setLoading(true);
    onAction(room.id, "CLEAN").finally(() => setLoading(false));
  }

  function handleUndoPress(e: GestureResponderEvent) {
    e.stopPropagation();
    if (!undoPending) { setDonePending(false); setUndoPending(true); return; }
    setUndoPending(false);
    setLoading(true);
    onUndo(room.id).finally(() => setLoading(false));
  }

  function handleReview(e: GestureResponderEvent) {
    e.stopPropagation();
    onPress();
  }

  function cancelDone(e: GestureResponderEvent) { e.stopPropagation(); setDonePending(false); }
  function cancelUndo(e: GestureResponderEvent) { e.stopPropagation(); setUndoPending(false); }

  let rightContent: ReactNode = null;

  if (action.kind === "start") {
    rightContent = (
      <TouchableOpacity onPress={handleStart} disabled={loading} style={[styles.btnStart, loading && styles.btnDisabled]} activeOpacity={0.85}>
        <Text style={styles.btnStartText}>{loading ? "…" : "Start"}</Text>
      </TouchableOpacity>
    );
  } else if (action.kind === "review" || action.kind === "review_done") {
    rightContent = (
      <TouchableOpacity onPress={handleReview} disabled={loading} style={styles.btnReview} activeOpacity={0.85}>
        <Text style={styles.btnReviewText}>{action.label}</Text>
      </TouchableOpacity>
    );
  } else if (action.kind === "done") {
    if (donePending) {
      rightContent = (
        <View style={styles.confirmCol}>
          <TouchableOpacity onPress={handleDonePress} disabled={loading} style={[styles.btnDoneConfirm, loading && styles.btnDisabled]} activeOpacity={0.85}>
            <Text style={styles.btnDoneConfirmText}>Confirm Done</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cancelDone} style={styles.btnCancel}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    } else if (undoPending) {
      rightContent = (
        <View style={styles.confirmCol}>
          <TouchableOpacity onPress={handleUndoPress} disabled={loading} style={[styles.btnUndoConfirm, loading && styles.btnDisabled]} activeOpacity={0.85}>
            <Text style={styles.btnUndoConfirmText}>Confirm Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cancelUndo} style={styles.btnCancel}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    } else {
      rightContent = (
        <View style={styles.confirmCol}>
          <TouchableOpacity onPress={handleDonePress} disabled={loading} style={[styles.btnDone, loading && styles.btnDisabled]} activeOpacity={0.85}>
            <Text style={styles.btnDoneText}>{loading ? "…" : "Done"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleUndoPress} disabled={loading} style={[styles.btnUndo, loading && styles.btnDisabled]} activeOpacity={0.85}>
            <Text style={styles.btnUndoText}>Undo</Text>
          </TouchableOpacity>
        </View>
      );
    }
  } else if (action.kind === "submitted") {
    if (undoPending) {
      rightContent = (
        <View style={styles.confirmCol}>
          <TouchableOpacity onPress={handleUndoPress} disabled={loading} style={[styles.btnUndoConfirm, loading && styles.btnDisabled]} activeOpacity={0.85}>
            <Text style={styles.btnUndoConfirmText}>Confirm Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cancelUndo} style={styles.btnCancel}>
            <Text style={styles.btnCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    } else {
      rightContent = (
        <View style={styles.confirmCol}>
          <Text style={styles.waitingText}>{"Waiting for\nsupervisor"}</Text>
          <TouchableOpacity onPress={handleUndoPress} disabled={loading} style={[styles.btnUndo, loading && styles.btnDisabled]} activeOpacity={0.85}>
            <Text style={styles.btnUndoText}>Undo</Text>
          </TouchableOpacity>
        </View>
      );
    }
  } else if (action.kind === "ready") {
    rightContent = <Text style={styles.readyLabel}>Ready</Text>;
  } else if (action.kind === "blocked") {
    rightContent = <Text style={styles.blockedLabel}>Blocked</Text>;
  } else {
    rightContent = (
      <TouchableOpacity onPress={handleReview} style={styles.btnReview} activeOpacity={0.85}>
        <Text style={styles.btnReviewText}>{action.label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
      {status === "OCCUPIED" ? (
        <View style={styles.occupiedRail}>
          {[0, 1, 2].map((stripe) => (
            <View key={stripe} style={styles.occupiedRailStripe} />
          ))}
        </View>
      ) : (
        <View style={[styles.statusRail, { backgroundColor: cfg.fg }]} />
      )}
      <View style={styles.cardLeft}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardRoomNum}>{room.room_number}</Text>
          {badges.map((badge) => (
            <View key={badge.key} style={styles.vipBadge}><Text style={styles.vipText}>{badge.label}</Text></View>
          ))}
        </View>

        {roomType ? <Text style={styles.roomType}>{roomType}</Text> : null}

        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
            <Text style={[styles.pillText, { color: cfg.fg }]}>{cfg.label}</Text>
          </View>
          {cleanTypeLabel ? (
            <View style={styles.cleanTypeRow}>
              {room.clean_type === "DEP" ? (
                <Ionicons name="log-out-outline" size={10} color={C.alert} />
              ) : null}
              <Text style={[styles.cleanTypeText, { color: room.clean_type === "DEP" ? C.alert : C.caution }]}>
                {cleanTypeLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {timing ? (
          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={12} color={C.ink3} />
            <Text style={styles.timeText}>{timing.label} {timing.value}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardRight}>{rightContent}</View>
    </TouchableOpacity>
  );
}

export default function MyRoomsScreen() {
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms, enqueueAction } = useAppStore();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    if (isOnline) {
      try {
        const result = await api.get<{ data: Room[] }>(`/housekeeping/my-rooms?date=${localDate()}`);
        setMyRooms(result.data);
        setApiError(null);
        await upsertRooms(result.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setApiError(msg);
        const cached = (await getRooms()) as Room[];
        setMyRooms(cached);
      }
    } else {
      const cached = (await getRooms()) as Room[];
      setMyRooms(cached);
    }
    setLoading(false);
  }, [isOnline, setMyRooms]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const sortedRooms = useMemo(() => {
    const now = new Date();
    return [...myRooms].sort((a, b) => compareRoomsByPriority(a, b, now));
  }, [myRooms]);

  const todoCount = useMemo(() =>
    myRooms.filter(r => r.status === "DIRTY" || r.status === "PICKUP" || r.status === "OCCUPIED").length,
    [myRooms]);
  const inProgressCount = useMemo(() =>
    myRooms.filter(r => r.status === "IN_PROGRESS").length, [myRooms]);
  const doneCount = useMemo(() =>
    myRooms.filter(r => r.status === "INSPECTED").length, [myRooms]);
  const priorityCount = useMemo(() =>
    myRooms.filter(r => r.status !== "CLEAN" && r.status !== "INSPECTED" && hasRoomException(r)).length,
    [myRooms]);

  async function handleAction(roomId: string, status: string) {
    const { myRooms: current, setMyRooms: set } = useAppStore.getState();
    set(current.map(r => r.id === roomId ? { ...r, status: status as Room["status"] } : r));
    try {
      if (isOnline) {
        await api.patch(`/rooms/${roomId}/status`, { status });
      } else {
        await enqueueAction({ type: "room_status", entityId: roomId, payload: { status } });
      }
    } catch {
      loadRooms();
    }
  }

  async function handleUndo(roomId: string) {
    try {
      const response = await api.post<{ data: { status: string } }>(`/rooms/${roomId}/status/undo`, {});
      const nextStatus = response?.data?.status;
      if (nextStatus) {
        const { myRooms: current, setMyRooms: set } = useAppStore.getState();
        set(current.map(r => r.id === roomId ? { ...r, status: nextStatus as Room["status"] } : r));
      }
    } catch {
      // silently ignore — room list will reload on next refresh
    } finally {
      loadRooms();
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {!isOnline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>{t("common.offline")}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>My Rooms</Text>
          <Text style={styles.headerDate}>{dayLabel()}</Text>
        </View>

        {myRooms.length > 0 ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: C.alert }]}>{todoCount}</Text>
              <Text style={styles.summaryLabel}> to do</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: C.ai }]}>{inProgressCount}</Text>
              <Text style={styles.summaryLabel}> in progress</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: C.ready }]}>{doneCount}</Text>
              <Text style={styles.summaryLabel}> done</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: C.caution }]}>{priorityCount}</Text>
              <Text style={styles.summaryLabel}> priority</Text>
            </View>
          </View>
        ) : null}

        {sortedRooms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("rooms.noRooms")}</Text>
            <Text style={styles.emptyText}>Pull to refresh if your supervisor adds assignments.</Text>
            {apiError ? <Text style={styles.errorText}>API error: {apiError}</Text> : null}
          </View>
        ) : (
          <View style={styles.list}>
            {sortedRooms.map(room => (
              <RoomItem
                key={room.id}
                room={room}
                onAction={handleAction}
                onUndo={handleUndo}
                onPress={() => router.push(`/(app)/my-rooms/${room.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 40 },

  offlineBanner: { backgroundColor: C.alert, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { flex: 1, color: "#fff", fontSize: 12 },

  header: { paddingTop: 12, paddingBottom: 4 },
  title: { fontSize: 29, fontWeight: "600", color: C.ink, lineHeight: 35 },
  headerDate: { fontSize: 13, color: C.ink3, marginTop: 2 },

  summaryCard: {
    flexDirection: "row",
    gap: 20,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  summaryItem: { flexDirection: "row", alignItems: "baseline" },
  summaryNum: { fontSize: 18, fontWeight: "700" },
  summaryLabel: { fontSize: 13, color: C.ink3 },

  list: { gap: 15, marginTop: 16 },

  card: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    paddingLeft: 18,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
  },
  statusRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  occupiedRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    justifyContent: "space-evenly",
    backgroundColor: C.alertSoft,
  },
  occupiedRailStripe: { height: "22%", backgroundColor: C.occupied },
  cardLeft: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  cardRoomNum: { fontFamily: monoFont, fontSize: 30, lineHeight: 34, fontWeight: "700", color: C.ink },
  vipBadge: {
    backgroundColor: C.accentSoft,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: C.accentLine,
  },
  vipText: { fontSize: 9, fontWeight: "700", color: C.accent },
  roomType: { fontSize: 14, color: C.ink3, marginTop: 2 },

  pillRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 },
  pill: { borderRadius: 100, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3, minHeight: 24 },
  pillText: { fontSize: 11.5, fontWeight: "700", textTransform: "uppercase" },
  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  cleanTypeText: { fontSize: 10, fontWeight: "600" },

  timeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  timeText: { fontFamily: monoFont, fontSize: 12, color: C.ink2 },

  cardRight: { alignItems: "flex-end", flexShrink: 0 },
  confirmCol: { alignItems: "flex-end", gap: 6 },

  btnStart: { minHeight: 52, backgroundColor: C.accent, borderRadius: 13, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  btnStartText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  btnReview: { minHeight: 48, backgroundColor: C.surface3, borderWidth: 1, borderColor: C.line, borderRadius: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  btnReviewText: { color: C.ink2, fontSize: 13, fontWeight: "700" },

  btnDone: { minHeight: 48, backgroundColor: C.ready, borderRadius: 13, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  btnDoneText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  btnDoneConfirm: { minHeight: 48, backgroundColor: C.ready, borderRadius: 13, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  btnDoneConfirmText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  btnUndo: { minHeight: 44, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  btnUndoText: { fontSize: 12, fontWeight: "600", color: C.ink2 },

  btnUndoConfirm: { minHeight: 48, backgroundColor: C.alert, borderRadius: 13, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  btnUndoConfirmText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  btnCancel: { paddingVertical: 4 },
  btnCancelText: { fontSize: 12, color: C.ink3 },

  btnDisabled: { opacity: 0.5 },

  waitingText: { fontSize: 12, color: C.caution, fontWeight: "500", textAlign: "right", lineHeight: 17 },
  readyLabel: { fontSize: 14, color: C.ready, fontWeight: "600", textAlign: "right" },
  blockedLabel: { fontSize: 13, color: C.ink3, fontWeight: "700", textAlign: "right" },

  emptyCard: { marginTop: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16 },
  emptyTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  emptyText: { color: C.ink3, fontSize: 12, marginTop: 4 },
  errorText: { color: C.alert, fontSize: 11, marginTop: 6, fontFamily: monoFont },
});
