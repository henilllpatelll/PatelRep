import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { getRooms, upsertRooms } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, displayFont } from "@/components/shared/tokens";
import { HandoffRow, Mono, Pill, RoomNumberTile, Segmented } from "@/components/shared/mobileHandoff";
import { localDate } from "@/lib/utils/date";

const DONE_STATUSES = new Set(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

type Filter = "all" | "todo" | "done" | "vip";

function dayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function roomTitle(room: Room) {
  if (room.vip_flag) return "VIP guest";
  if (room.status === "IN_PROGRESS") return "Stay-over · in progress";
  if (room.status === "PICKUP") return "Stay-over · pickup";
  if (room.status === "CLEAN") return "Done · awaiting inspection";
  if (room.status === "INSPECTED") return "Done · inspected";
  if (DONE_STATUSES.has(room.status)) return "Out of service";
  return "Checkout";
}

function roomMeta(room: Room, index: number) {
  if (room.status === "IN_PROGRESS") return "active";
  if (room.status === "CLEAN") return "await";
  if (room.status === "INSPECTED") return "done";
  if (room.vip_flag && room.checkin_time) return "by 3pm";
  if (index === 0) return "next";
  return `${index + 1}th`;
}

function roomSub(room: Room) {
  if (room.vip_flag) return "VIP arrival — extra pillows, still water";
  if (room.dnd_flag) return "Do not disturb — check before knocking";
  if (room.risk_level === "HIGH") return "High risk — allow a few extra minutes";
  return `Floor ${room.floor}`;
}

export default function MyRoomsScreen() {
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const loadRooms = useCallback(async () => {
    if (isOnline) {
      try {
        const result = await api.get<{ data: Room[] }>(`/housekeeping/my-rooms?date=${localDate()}`);
        setMyRooms(result.data);
        await upsertRooms(result.data);
      } catch {
        const cached = (await getRooms()) as Room[];
        setMyRooms(cached);
      }
    } else {
      const cached = (await getRooms()) as Room[];
      setMyRooms(cached);
    }
    setLoading(false);
  }, [isOnline, setMyRooms]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const counts = useMemo(() => {
    const done = myRooms.filter((room) => DONE_STATUSES.has(room.status)).length;
    const vip = myRooms.filter((room) => room.vip_flag).length;
    return { done, todo: myRooms.length - done, vip };
  }, [myRooms]);

  const displayRooms = useMemo(() => {
    switch (filter) {
      case "todo": return myRooms.filter((r) => !DONE_STATUSES.has(r.status));
      case "done": return myRooms.filter((r) => DONE_STATUSES.has(r.status));
      case "vip":  return myRooms.filter((r) => r.vip_flag);
      default:     return myRooms;
    }
  }, [myRooms, filter]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>{t("common.offline")}</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.headerMeta}>{dayLabel()} — {myRooms.length} rooms today</Text>
        <Text style={styles.title}>My rooms</Text>
      </View>

      <View style={styles.filters}>
        <Segmented
          items={[
            { label: "All",   count: myRooms.length, active: filter === "all",  onPress: () => setFilter("all") },
            { label: "To do", count: counts.todo,     active: filter === "todo", onPress: () => setFilter("todo") },
            { label: "Done",  count: counts.done,     active: filter === "done", onPress: () => setFilter("done") },
            { label: "VIPs",  count: counts.vip,      active: filter === "vip",  onPress: () => setFilter("vip") },
          ]}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={myRooms.length === 0 ? styles.emptyContent : styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {displayRooms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{myRooms.length === 0 ? t("rooms.noRooms") : "No rooms in this filter."}</Text>
            <Text style={styles.emptyText}>{myRooms.length === 0 ? "Pull to refresh if your supervisor adds assignments." : "Try another tab."}</Text>
          </View>
        ) : (
          displayRooms.map((room, index) => (
            <HandoffRow
              key={room.id}
              onPress={() => router.push(`/(app)/my-rooms/${room.id}`)}
              style={DONE_STATUSES.has(room.status) ? styles.dimRow : undefined}
              lead={<RoomNumberTile roomNumber={room.room_number} status={room.status} size={50} />}
              title={
                <>
                  <Text style={styles.rowTitle}>{roomTitle(room)}</Text>
                  {room.vip_flag ? (
                    <Pill tone="accent" icon="star">
                      VIP
                    </Pill>
                  ) : null}
                  {room.risk_level === "HIGH" ? (
                    <Pill tone="ai" icon="sparkles">
                      AI
                    </Pill>
                  ) : null}
                </>
              }
              sub={roomSub(room)}
              right={<Mono style={styles.meta}>{roomMeta(room, index)}</Mono>}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  offlineBanner: { backgroundColor: C.alert, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { flex: 1, color: "#fff", fontSize: 12 },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line2 },
  headerMeta: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  title: { color: C.ink, fontFamily: displayFont, fontSize: 30, lineHeight: 34 },
  filters: { paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line2 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 8 },
  emptyContent: { flex: 1, padding: 18, justifyContent: "center" },
  emptyCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16 },
  emptyTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  emptyText: { color: C.ink3, fontSize: 12, marginTop: 4 },
  rowTitle: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  meta: { color: C.ink3, fontSize: 10.5 },
  dimRow: { opacity: 0.58 },
});
