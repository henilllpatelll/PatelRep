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
import { Chip, SectionHeader, StatusRail, StatusPill } from "@/components/shared/evening";

/* ─── Rooms — the property atlas ────────────────────────────────────────────
   Every room in the hotel, grouped by floor. The room number IS the card's
   identity tile, colored by the protected status contract, and every card
   answers the walk-in question with a Vacant/Occupied badge. */

/** Raw board row: room_status spread + nested rooms join (no flat fields). */
type BoardRow = {
  room_id: string;
  status: string;
  fo_status: "OCC" | "VAC" | null;
  vip_flag?: boolean | null;
  dnd_flag?: boolean | null;
  guest_name?: string | null;
  checkout_time?: string | null;
  rooms?: { room_number?: string | null; floor?: number | null } | null;
};

type RoomRow = {
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

/** Board rows keep room identity nested under rooms(...) — flatten once here. */
function normalizeBoardRow(row: BoardRow): RoomRow {
  return {
    id: row.room_id,
    room_number: row.rooms?.room_number ?? "—",
    floor: row.rooms?.floor ?? 0,
    status: row.status,
    fo_status: row.fo_status ?? null,
    vip_flag: Boolean(row.vip_flag),
    dnd_flag: Boolean(row.dnd_flag),
    guest_name: row.guest_name ?? null,
    checkout_time: row.checkout_time ?? null,
  };
}

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
function isOccupiedRoom(room: RoomRow): boolean {
  return room.fo_status === "OCC" || room.status === "OCCUPIED" || room.status === "PICKUP";
}

function isOutOfOrderRoom(room: RoomRow): boolean {
  return room.status === "OOO" || room.status === "OUT_OF_ORDER" || room.status === "OUT_OF_SERVICE";
}

function roomNumberValue(room: RoomRow): number {
  const parsed = parseInt(room.room_number, 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

const FILTER_OPTIONS = ["all", "VACANT", "OCCUPIED", "OOO"];

// Pastel readouts for the dark hero (mirror the mosaic dark-soft text rule).
const HERO_VALUE_COLORS = { vacant: "#A7D2C9", occupied: "#E7A9B0", ready: "#A7D2C9" };

export default function RoomStatusScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>();
  const { isOnline } = useAppStore();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
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
      const res = await api.get<{ data: BoardRow[] }>("/housekeeping/board");
      setRooms((res.data ?? []).map(normalizeBoardRow));
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
          (statusFilter === "VACANT"
            ? !isOccupiedRoom(r)
            : statusFilter === "OCCUPIED"
              ? isOccupiedRoom(r)
              : isOutOfOrderRoom(r));
        const matchSearch =
          !search ||
          r.room_number.includes(search) ||
          (r.guest_name ?? "").toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchSearch;
      }),
    [rooms, statusFilter, search]
  );

  const floors = useMemo(() => {
    const byFloor = new Map<number, RoomRow[]>();
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
          <View style={styles.filterRow}>
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
                        : t(STATUS_LABEL_KEYS[f])}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.body}>
          {floors.map(({ floor, rooms: floorRooms }) => (
            <View key={floor} style={styles.floorSection}>
              <SectionHeader title={t("roomStatus.floorSection", { floor })} hint={String(floorRooms.length)} />
              <View style={styles.roomList}>
                {floorRooms.map((room) => {
                  const occupied = isOccupiedRoom(room);
                  const hasMetaRow = Boolean(room.guest_name || room.checkout_time || room.vip_flag || room.dnd_flag);
                  return (
                    <View key={room.id} style={styles.roomCard}>
                      <StatusRail status={room.status} />
                      <View style={styles.cardBody}>
                        <View style={styles.cardTopRow}>
                          <StatusPill status={room.status} />
                          <View style={[styles.occBadge, occupied ? styles.occBadgeOccupied : styles.occBadgeVacant]}>
                            <View style={[styles.occDot, { backgroundColor: occupied ? C.alert : C.ready }]} />
                            <Text style={[styles.occText, { color: occupied ? C.alert : C.ready }]}>
                              {occupied ? t("roomStatus.occupiedNow") : t("roomStatus.vacantNow")}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.roomNumber}>{room.room_number}</Text>
                        {hasMetaRow ? (
                          <View style={styles.metaRow}>
                            {room.guest_name ? (
                              <Text style={styles.guestText} numberOfLines={1}>
                                {room.guest_name}
                              </Text>
                            ) : null}
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
  filterRow: { flexDirection: "row", gap: 6 },
  filterBtn: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
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
    paddingLeft: 16,
    paddingRight: 12,
    shadowColor: C.ink,
    shadowOpacity: 0.04,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardBody: { flex: 1, minWidth: 0, paddingVertical: 13, gap: 7 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  roomNumber: { fontFamily: monoFont, fontSize: 28, lineHeight: 32, fontWeight: "800", color: C.ink },
  occBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  occBadgeVacant: { backgroundColor: C.readySoft, borderColor: C.readyLine },
  occBadgeOccupied: { backgroundColor: C.alertSoft, borderColor: C.alertLine },
  occDot: { width: 6, height: 6, borderRadius: 3 },
  occText: { fontSize: 10.5, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  guestText: { color: C.ink2, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  checkoutText: { color: C.caution, fontSize: 11, fontWeight: "600", fontFamily: monoFont },

  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3 },
});
