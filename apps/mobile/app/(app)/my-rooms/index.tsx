import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { C, monoFont, displayFont } from "@/components/shared/tokens";
import { localDate } from "@/lib/utils/date";

const STATUS_PRIORITY: Record<string, number> = {
  IN_PROGRESS: 0, DIRTY: 1, PICKUP: 2, CLEAN: 3, INSPECTED: 4,
};

const CLEAN_TYPE_SHORT: Record<string, string> = {
  DEP: "Departure", FULL: "Full", LIGHT: "Light",
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  DIRTY:         { label: "Vacant Dirty",                    bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  OCCUPIED:      { label: "Occupied Dirty",                  bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  PICKUP:        { label: "Pickup",                          bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  IN_PROGRESS:   { label: "In Progress",                     bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  CLEAN:         { label: "Clean",                           bg: C.infoSoft,    fg: C.info,    border: C.infoLine },
  INSPECTED:     { label: "Inspected / Ready",               bg: C.readySoft,   fg: C.ready,   border: C.readyLine },
  OOO:           { label: "Out of Order / Out of Service",   bg: C.surface3,    fg: C.ink3,    border: C.line },
  OUT_OF_ORDER:  { label: "Out of Order / Out of Service",   bg: C.surface3,    fg: C.ink3,    border: C.line },
  OUT_OF_SERVICE:{ label: "Out of Order / Out of Service",   bg: C.surface3,    fg: C.ink3,    border: C.line },
};

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

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
  const cleanTypeLabel = room.clean_type ? (CLEAN_TYPE_SHORT[room.clean_type] ?? null) : null;
  const checkoutIso = room.actual_checkout_at ?? room.checkout_time ?? null;
  const checkoutLabel = room.actual_checkout_at ? "Checked out" : "Due out";
  const checkoutTime = formatTime(checkoutIso);
  const isOccupied = Boolean(room.guest_name);

  useEffect(() => {
    setDonePending(false);
    setUndoPending(false);
  }, [status]);

  async function handleStart(e: { stopPropagation?: () => void }) {
    e.stopPropagation?.();
    setLoading(true);
    try { await onAction(room.id, "IN_PROGRESS"); } finally { setLoading(false); }
  }

  function handleDonePress(e: { stopPropagation?: () => void }) {
    e.stopPropagation?.();
    if (!donePending) { setUndoPending(false); setDonePending(true); return; }
    setDonePending(false);
    setLoading(true);
    onAction(room.id, "CLEAN").finally(() => setLoading(false));
  }

  function handleUndoPress(e: { stopPropagation?: () => void }) {
    e.stopPropagation?.();
    if (!undoPending) { setDonePending(false); setUndoPending(true); return; }
    setUndoPending(false);
    setLoading(true);
    onUndo(room.id).finally(() => setLoading(false));
  }

  function cancelDone(e: { stopPropagation?: () => void }) { e.stopPropagation?.(); setDonePending(false); }
  function cancelUndo(e: { stopPropagation?: () => void }) { e.stopPropagation?.(); setUndoPending(false); }

  let rightContent: React.ReactNode = null;

  if (status === "DIRTY" || status === "PICKUP" || status === "OCCUPIED") {
    rightContent = (
      <TouchableOpacity onPress={handleStart} disabled={loading} style={[styles.btnStart, loading && styles.btnDisabled]} activeOpacity={0.85}>
        <Text style={styles.btnStartText}>{loading ? "…" : "Start"}</Text>
      </TouchableOpacity>
    );
  } else if (status === "IN_PROGRESS") {
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
  } else if (status === "CLEAN") {
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
  } else if (status === "INSPECTED") {
    rightContent = <Text style={styles.readyLabel}>{isOccupied ? "Ready\nOccupied" : "Ready\nVacant"}</Text>;
  }

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardRoomNum}>Room  {room.room_number}</Text>
          {room.vip_flag ? (
            <View style={styles.vipBadge}><Text style={styles.vipText}>VIP</Text></View>
          ) : null}
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

        {checkoutTime ? (
          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={12} color={C.ink3} />
            <Text style={styles.timeText}>{checkoutLabel} {checkoutTime}</Text>
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

  const sortedRooms = useMemo(() =>
    [...myRooms].sort((a, b) => (STATUS_PRIORITY[a.status] ?? 5) - (STATUS_PRIORITY[b.status] ?? 5)),
    [myRooms],
  );

  const todoCount = useMemo(() =>
    myRooms.filter(r => r.status === "DIRTY" || r.status === "PICKUP" || r.status === "OCCUPIED").length,
    [myRooms]);
  const inProgressCount = useMemo(() =>
    myRooms.filter(r => r.status === "IN_PROGRESS").length, [myRooms]);
  const doneCount = useMemo(() =>
    myRooms.filter(r => r.status === "INSPECTED").length, [myRooms]);

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
              <Text style={[styles.summaryNum, { color: C.caution }]}>{inProgressCount}</Text>
              <Text style={styles.summaryLabel}> in progress</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: C.ready }]}>{doneCount}</Text>
              <Text style={styles.summaryLabel}> done</Text>
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  offlineBanner: { backgroundColor: C.alert, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { flex: 1, color: "#fff", fontSize: 12 },

  header: { paddingTop: 12, paddingBottom: 4 },
  title: { fontFamily: displayFont, fontSize: 32, color: C.ink, lineHeight: 38 },
  headerDate: { fontSize: 13, color: C.ink3, marginTop: 2 },

  summaryCard: {
    flexDirection: "row",
    gap: 20,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  summaryItem: { flexDirection: "row", alignItems: "baseline" },
  summaryNum: { fontFamily: displayFont, fontSize: 16, fontWeight: "700" },
  summaryLabel: { fontSize: 13, color: C.ink3 },

  list: { gap: 8, marginTop: 14 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  cardLeft: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  cardRoomNum: { fontFamily: monoFont, fontSize: 15, fontWeight: "700", color: C.ink },
  vipBadge: {
    backgroundColor: C.accentSoft,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: C.accentLine,
  },
  vipText: { fontSize: 9, fontWeight: "700", color: C.accent },
  roomType: { fontFamily: monoFont, fontSize: 11, color: C.ink3, marginBottom: 6 },

  pillRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  pill: { borderRadius: 100, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: "600" },
  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cleanTypeText: { fontSize: 10, fontWeight: "700" },

  timeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  timeText: { fontFamily: monoFont, fontSize: 11, color: C.ink2 },

  cardRight: { alignItems: "flex-end", flexShrink: 0 },
  confirmCol: { alignItems: "flex-end", gap: 6 },

  btnStart: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  btnStartText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  btnDone: { backgroundColor: C.ready, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  btnDoneText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  btnDoneConfirm: { backgroundColor: C.ready, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  btnDoneConfirmText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  btnUndo: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  btnUndoText: { fontSize: 12, fontWeight: "600", color: C.ink2 },

  btnUndoConfirm: { backgroundColor: C.alert, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  btnUndoConfirmText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  btnCancel: { paddingVertical: 4 },
  btnCancelText: { fontSize: 11, color: C.ink3 },

  btnDisabled: { opacity: 0.5 },

  waitingText: { fontSize: 11, color: C.caution, fontWeight: "600", textAlign: "right", lineHeight: 16 },
  readyLabel: { fontSize: 12, color: C.ready, fontWeight: "700", textAlign: "right" },

  emptyCard: { marginTop: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16 },
  emptyTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  emptyText: { color: C.ink3, fontSize: 12, marginTop: 4 },
  errorText: { color: C.alert, fontSize: 11, marginTop: 6, fontFamily: monoFont },
});
