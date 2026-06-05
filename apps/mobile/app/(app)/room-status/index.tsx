import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R } from "@/components/shared/tokens";
import { Pill } from "@/components/shared/mobileHandoff";

type RoomStatusRow = {
  id: string;
  room_number: string;
  floor: number;
  status: string;
  fo_status: "OCC" | "VAC" | null;
  vip_flag: boolean;
  dnd_flag: boolean;
  guest_name: string | null;
  checkout_time: string | null;
};

type ToneType = "alert" | "caution" | "ready" | "info" | "neutral" | "progress";

const STATUS_TONES: Record<string, ToneType> = {
  DIRTY: "alert",
  IN_PROGRESS: "progress",
  PICKUP: "caution",
  CLEAN: "info",
  INSPECTED: "ready",
  OCCUPIED: "neutral",
  OOO: "neutral",
  OUT_OF_ORDER: "neutral",
  OUT_OF_SERVICE: "neutral",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  DIRTY: "roomStatus.statusLabels.DIRTY",
  IN_PROGRESS: "roomStatus.statusLabels.IN_PROGRESS",
  PICKUP: "roomStatus.statusLabels.PICKUP",
  CLEAN: "roomStatus.statusLabels.CLEAN",
  INSPECTED: "roomStatus.statusLabels.INSPECTED",
  OCCUPIED: "roomStatus.statusLabels.OCCUPIED",
  OOO: "roomStatus.statusLabels.OOO",
  OUT_OF_ORDER: "roomStatus.statusLabels.OUT_OF_ORDER",
  OUT_OF_SERVICE: "roomStatus.statusLabels.OUT_OF_SERVICE",
};

function floorLabel(floor: number) {
  if (floor === 1) return "1st";
  if (floor === 2) return "2nd";
  if (floor === 3) return "3rd";
  return `${floor}th`;
}

export default function RoomStatusScreen() {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [rooms, setRooms] = useState<RoomStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadRooms = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: RoomStatusRow[] }>("/housekeeping/board");
      setRooms(res.data ?? []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const filterOptions = ["all", "DIRTY", "CLEAN", "INSPECTED", "OCCUPIED"];
  const filtered = rooms.filter((r) => {
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    const matchSearch = !search || r.room_number.includes(search) || (r.guest_name ?? "").toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const vacantDirty = rooms.filter((r) => r.status === "DIRTY" && r.fo_status === "VAC").length;
  const occupiedCount = rooms.filter((r) => r.fo_status === "OCC").length;
  const readyCount = rooms.filter((r) => r.status === "INSPECTED").length;

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
        <Text style={styles.title}>{t("tabs.roomStatus")}</Text>
        <View style={styles.stats}>
          <View style={[styles.statChip, { backgroundColor: C.alertSoft, borderColor: C.alertLine }]}>
            <Text style={[styles.statNum, { color: C.alert }]}>{vacantDirty}</Text>
            <Text style={[styles.statLabel, { color: C.alert }]}>{t("roomStatus.vacantDirty")}</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNum}>{occupiedCount}</Text>
            <Text style={styles.statLabel}>{t("roomStatus.occupied")}</Text>
          </View>
          <View style={[styles.statChip, { backgroundColor: C.readySoft, borderColor: C.readyLine }]}>
            <Text style={[styles.statNum, { color: C.ready }]}>{readyCount}</Text>
            <Text style={[styles.statLabel, { color: C.ready }]}>{t("roomStatus.ready")}</Text>
          </View>
        </View>
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={15} color={C.ink4} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t("roomStatus.searchPlaceholder")}
            placeholderTextColor={C.ink4}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          {filterOptions.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, statusFilter === f && styles.filterBtnActive]}
              onPress={() => setStatusFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterLabel, statusFilter === f && styles.filterLabelActive]}>
                {f === "all" ? t("roomStatus.all") : t(STATUS_LABEL_KEYS[f] ?? f)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {filtered.map((room) => (
          <View key={room.id} style={styles.roomRow}>
            <View style={styles.roomLeft}>
              <Text style={styles.roomNum}>{room.room_number}</Text>
              <Text style={styles.floorLabel}>{floorLabel(room.floor)} {t("roomStatus.floorSuffix")}</Text>
            </View>
            <View style={styles.roomMiddle}>
              {room.guest_name ? (
                <Text style={styles.guestName} numberOfLines={1}>{room.guest_name}</Text>
              ) : null}
              {room.checkout_time ? (
                <Text style={styles.checkoutTime}>{t("roomStatus.checkout", { time: room.checkout_time })}</Text>
              ) : null}
              <View style={styles.flags}>
                {room.vip_flag ? <Pill tone="accent">VIP</Pill> : null}
                {room.dnd_flag ? <Pill tone="neutral">DND</Pill> : null}
                {room.fo_status === "OCC" ? <Pill tone="neutral">OCC</Pill> : null}
              </View>
            </View>
            <Pill tone={STATUS_TONES[room.status] ?? "neutral"}>
              {t(STATUS_LABEL_KEYS[room.status] ?? room.status)}
            </Pill>
          </View>
        ))}

        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="bed-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("roomStatus.noRoomsMatch")}</Text>
            <Text style={styles.emptyText}>{t("roomStatus.noRoomsMatchHint")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    backgroundColor: C.paper,
    gap: 10,
  },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  stats: { flexDirection: "row", gap: 8 },
  statChip: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
  },
  statNum: { fontSize: 18, fontWeight: "700", color: C.ink },
  statLabel: { fontSize: 10, color: C.ink3, fontWeight: "600" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.md,
    paddingHorizontal: 10,
  },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13, color: C.ink, paddingVertical: 9 },
  filterScroll: { flexGrow: 0 },
  filterBtn: {
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  filterBtnActive: { backgroundColor: C.ink, borderColor: C.ink },
  filterLabel: { fontSize: 11, fontWeight: "600", color: C.ink3 },
  filterLabelActive: { color: C.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 6 },
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
  roomLeft: { width: 52 },
  roomNum: { fontSize: 16, fontWeight: "700", color: C.ink },
  floorLabel: { fontSize: 10, color: C.ink4 },
  roomMiddle: { flex: 1, gap: 2 },
  guestName: { fontSize: 12, fontWeight: "600", color: C.ink2 },
  checkoutTime: { fontSize: 11, color: C.caution },
  flags: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3 },
});
