import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { Chip, SectionHeader, StatusPill, StatusRail } from "@/components/shared/evening";

/* ─── Rooms — the property atlas ────────────────────────────────────────────
   Every room in the hotel, grouped by floor, in the Evening Lobby card
   language. The hero answers the floor question at a glance — how many
   rooms are vacant, occupied, and guest-ready — and the Vacant filter
   tells engineers and front desk where it's safe to walk in. */

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

/** Occupied by any signal: Opera FO status, or a stay-driven room status. */
function isOccupiedRoom(room: RoomStatusRow): boolean {
  return room.fo_status === "OCC" || room.status === "OCCUPIED" || room.status === "PICKUP";
}

function roomNumberValue(room: RoomStatusRow): number {
  const parsed = parseInt(room.room_number, 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

const FILTER_OPTIONS = ["all", "VACANT", "DIRTY", "CLEAN", "INSPECTED", "OCCUPIED"];

// Pastel readouts for the dark hero (mirror the mosaic dark-soft text rule).
const HERO_VALUE_COLORS = { vacant: "#A7D2C9", occupied: "#E7A9B0", ready: "#A7D2C9" };

export default function RoomStatusScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>();
  const { isOnline } = useAppStore();
  const [rooms, setRooms] = useState<RoomStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(
    typeof initialFilter === "string" && FILTER_OPTIONS.includes(initialFilter) ? initialFilter : "all"
  );

  const loadRooms = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<{ data: RoomStatusRow[] }>("/housekeeping/board");
      setRooms(res.data ?? []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const vacantCount = useMemo(() => rooms.filter((r) => !isOccupiedRoom(r)).length, [rooms]);
  const occupiedCount = rooms.length - vacantCount;
  const readyCount = useMemo(() => rooms.filter((r) => r.status === "INSPECTED").length, [rooms]);

  const filtered = useMemo(
    () =>
      rooms.filter((r) => {
        const matchStatus =
          statusFilter === "all" ||
          (statusFilter === "VACANT" ? !isOccupiedRoom(r) : r.status === statusFilter);
        const matchSearch =
          !search ||
          r.room_number.includes(search) ||
          (r.guest_name ?? "").toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchSearch;
      }),
    [rooms, statusFilter, search]
  );

  const floors = useMemo(() => {
    const byFloor = new Map<number, RoomStatusRow[]>();
    for (const room of filtered) {
      const list = byFloor.get(room.floor) ?? [];
      list.push(room);
      byFloor.set(room.floor, list);
    }
    return [...byFloor.entries()]
      .sort(([a], [b]) => a - b)
      .map(([floor, list]) => ({
        floor,
        rooms: list.sort((a, b) => roomNumberValue(a) - roomNumberValue(b)),
      }));
  }, [filtered]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        stickyHeaderIndices={[1]}
      >
        <View>
          <View style={styles.topBleed} />
          <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
            <Text style={styles.heroKicker}>{t("roomStatus.kicker")}</Text>
            <Text style={styles.heroTitle}>{t("tabs.roomStatus")}</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatValue, { color: HERO_VALUE_COLORS.vacant }]}>{vacantCount}</Text>
                <Text style={styles.heroStatLabel}>{t("roomStatus.statVacant")}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatValue, { color: HERO_VALUE_COLORS.occupied }]}>{occupiedCount}</Text>
                <Text style={styles.heroStatLabel}>{t("roomStatus.statOccupied")}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatValue, { color: HERO_VALUE_COLORS.ready }]}>{readyCount}</Text>
                <Text style={styles.heroStatLabel}>{t("roomStatus.statReady")}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Sticky search + filters so long hotels stay navigable */}
        <View style={styles.controls}>
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={15} color={C.ink4} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t("roomStatus.searchPlaceholder")}
              placeholderTextColor={C.ink4}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch("")} hitSlop={8} accessibilityRole="button">
                <Ionicons name="close-circle" size={16} color={C.ink4} />
              </TouchableOpacity>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTER_OPTIONS.map((f) => {
              const active = statusFilter === f;
              return (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterBtn, active && styles.filterBtnActive]}
                  onPress={() => setStatusFilter(f)}
                  activeOpacity={0.75}
                  testID={`room-filter-${f}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                    {f === "all"
                      ? t("roomStatus.all")
                      : f === "VACANT"
                        ? t("roomStatus.vacant")
                        : t(STATUS_LABEL_KEYS[f] ?? f)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.body}>
          {floors.map(({ floor, rooms: floorRooms }) => (
            <View key={floor} style={styles.floorSection}>
              <SectionHeader title={t("roomStatus.floorSection", { floor })} hint={String(floorRooms.length)} />
              <View style={styles.roomList}>
                {floorRooms.map((room) => {
                  const occupied = isOccupiedRoom(room);
                  return (
                    <View key={room.id} style={styles.roomCard}>
                      <StatusRail status={room.status} />
                      <View style={styles.roomMain}>
                        <Text style={styles.roomNum}>{room.room_number}</Text>
                        <View style={styles.roomBody}>
                          <View style={styles.occupancyRow}>
                            <View
                              style={[styles.occupancyDot, { backgroundColor: occupied ? C.alert : C.ready }]}
                            />
                            <Text style={styles.occupancyText} numberOfLines={1}>
                              {room.guest_name ??
                                (occupied ? t("roomStatus.occupiedNow") : t("roomStatus.vacantNow"))}
                            </Text>
                          </View>
                          {room.checkout_time || room.vip_flag || room.dnd_flag ? (
                            <View style={styles.flagRow}>
                              {room.checkout_time ? (
                                <Text style={styles.checkoutText}>
                                  {t("roomStatus.checkout", { time: room.checkout_time })}
                                </Text>
                              ) : null}
                              {room.vip_flag ? (
                                <Chip tone="caution" icon="star-outline">
                                  VIP
                                </Chip>
                              ) : null}
                              {room.dnd_flag ? (
                                <Chip tone="neutral" icon="moon-outline">
                                  DND
                                </Chip>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                        <StatusPill status={room.status} label={t(STATUS_LABEL_KEYS[room.status] ?? room.status)} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          {filtered.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="bed-outline" size={32} color={C.ink4} />
              <Text style={styles.emptyTitle}>{t("roomStatus.noRoomsMatch")}</Text>
              <Text style={styles.emptyText}>{t("roomStatus.noRoomsMatchHint")}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: { color: shellTokens.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroStats: { flexDirection: "row", gap: 9, marginTop: 14 },
  heroStat: {
    flex: 1,
    backgroundColor: shellTokens.surface,
    borderWidth: 1,
    borderColor: shellTokens.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroStatValue: { fontSize: 22, lineHeight: 26, fontWeight: "700", fontFamily: monoFont },
  heroStatLabel: { color: shellTokens.ink2, fontSize: 10.5, marginTop: 3 },

  controls: {
    backgroundColor: C.paper,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
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
  searchInput: { flex: 1, fontSize: 13.5, color: C.ink, paddingVertical: 10 },
  filterRow: { gap: 6, paddingRight: 8 },
  filterBtn: {
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  filterBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterLabel: { fontSize: 12, fontWeight: "700", color: C.ink3 },
  filterLabelActive: { color: "#fff" },

  body: { paddingHorizontal: 16, paddingTop: 12, gap: 18 },
  floorSection: { gap: 2 },
  roomList: { gap: 9 },
  roomCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    shadowColor: C.ink,
    shadowOpacity: 0.04,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  roomMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
  },
  roomNum: { fontFamily: monoFont, fontSize: 22, lineHeight: 26, fontWeight: "700", color: C.ink, minWidth: 52 },
  roomBody: { flex: 1, minWidth: 0, gap: 4 },
  occupancyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  occupancyDot: { width: 7, height: 7, borderRadius: 3.5 },
  occupancyText: { color: C.ink2, fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  flagRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  checkoutText: { color: C.caution, fontSize: 11, fontWeight: "600", fontFamily: monoFont },

  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3 },
});
