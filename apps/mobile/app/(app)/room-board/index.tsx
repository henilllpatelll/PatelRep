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
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { localDate } from "@/lib/utils/date";
import {
  fetchAssignableStaff,
  fetchBoard,
  removeAssignment,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  filterBySegment,
  groupByFloor,
  normalizeBoardRooms,
  type AssignableStaff,
  type BoardSegment,
  type FloorRoom,
} from "@/lib/housekeeping/supervisor";
import { C, R, shellTokens } from "@/components/shared/tokens";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { HeroSignalRow, RoomStatusTile, type HeroSignal } from "@/components/supervisor/atoms";
import { HousekeeperPicker } from "@/components/supervisor/HousekeeperPicker";
import { RoomDetailSheet } from "@/components/supervisor/RoomDetailSheet";

/* ─── Room Board — the live floor, one tile per room ────────────────────────
   Dark shell hero with the day's shape, a status segmented, and the board
   grouped by floor in the protected status colors. Tapping a tile opens
   the room sheet: flags, timing, the latest note, and the assign action. */

const SEGMENTS: BoardSegment[] = ["all", "toClean", "working", "ready"];

const SEGMENT_LABEL_KEYS: Record<BoardSegment, string> = {
  all: "roomBoard.segAll",
  toClean: "roomBoard.segToClean",
  working: "roomBoard.segWorking",
  ready: "roomBoard.segReady",
};

export default function RoomBoardScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isOnline, user } = useAppStore();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  const [rooms, setRooms] = useState<FloorRoom[]>([]);
  const [staff, setStaff] = useState<AssignableStaff[]>([]);
  const [segment, setSegment] = useState<BoardSegment>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [pickerRoom, setPickerRoom] = useState<FloorRoom | null>(null);
  const [saving, setSaving] = useState(false);

  const loadBoard = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    const [boardRes, staffRes] = await Promise.allSettled([
      fetchBoard(localDate()),
      fetchAssignableStaff(),
    ]);
    if (boardRes.status === "fulfilled") setRooms(normalizeBoardRooms(boardRes.value));
    if (staffRes.status === "fulfilled") setStaff(staffRes.value);
    setLoading(false);
  }, [isOnline]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("room-board-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_status", filter: `tenant_id=eq.${user.tenant_id}` },
        () => {
          loadBoard();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.tenant_id, loadBoard]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBoard();
    setRefreshing(false);
  }, [loadBoard]);

  const nameById = useMemo(() => buildNameById(staff), [staff]);
  const teamLoads = useMemo(() => buildTeamLoads(rooms, nameById), [rooms, nameById]);
  const snapshot = useMemo(() => buildFloorSnapshot(rooms), [rooms]);
  const floors = useMemo(() => groupByFloor(filterBySegment(rooms, segment)), [rooms, segment]);
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.roomId === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const signals = useMemo<HeroSignal[]>(
    () =>
      [
        snapshot.unassigned > 0 && {
          key: "unassigned",
          label: t("roomBoard.signalUnassigned", { count: snapshot.unassigned }),
          fg: C.alert,
          bg: C.alertSoft,
          line: C.alertLine,
        },
        snapshot.submitted > 0 && {
          key: "submitted",
          label: t("roomBoard.signalSubmitted", { count: snapshot.submitted }),
          fg: C.info,
          bg: C.infoSoft,
          line: C.infoLine,
        },
        snapshot.dnd > 0 && {
          key: "dnd",
          label: t("roomBoard.signalDnd", { count: snapshot.dnd }),
          fg: C.ink2,
          bg: C.surface3,
          line: C.line,
        },
        snapshot.vip > 0 && {
          key: "vip",
          label: t("roomBoard.signalVip", { count: snapshot.vip }),
          fg: C.brass,
          bg: C.brassSoft,
          line: C.brassLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [snapshot, t],
  );

  const segmentCounts = useMemo<Record<BoardSegment, number>>(
    () => ({
      all: snapshot.total,
      toClean: filterBySegment(rooms, "toClean").length,
      working: filterBySegment(rooms, "working").length,
      ready: snapshot.ready,
    }),
    [rooms, snapshot],
  );

  const assignTo = useCallback(
    async (member: AssignableStaff) => {
      if (!pickerRoom) return;
      setSaving(true);
      try {
        await saveAssignments(localDate(), [
          { room_id: pickerRoom.roomId, housekeeper_id: member.userId },
        ]);
        setPickerRoom(null);
        await loadBoard();
      } catch (err) {
        console.warn("Assign failed:", err);
      } finally {
        setSaving(false);
      }
    },
    [pickerRoom, loadBoard],
  );

  const handleRemoveAssignment = useCallback(
    async (room: FloorRoom) => {
      if (!room.assignmentId) return;
      setSaving(true);
      try {
        await removeAssignment(room.assignmentId);
        await loadBoard();
      } catch (err) {
        console.warn("Remove assignment failed:", err);
      } finally {
        setSaving(false);
      }
    },
    [loadBoard],
  );

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
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={styles.topBleed} />
        <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <Text style={styles.heroKicker}>{t("roomBoard.kicker")}</Text>
          <Text style={styles.heroTitle}>{t("tabs.roomBoard")}</Text>
          <Text style={styles.heroSummary}>
            {t("roomBoard.summary", {
              ready: snapshot.ready,
              total: snapshot.total,
              working: snapshot.inProgress,
            })}
          </Text>
          <HeroSignalRow signals={signals} />
        </View>

        <View style={styles.segmented}>
          {SEGMENTS.map((key) => {
            const isActive = segment === key;
            const count = segmentCounts[key];
            return (
              <TouchableOpacity
                key={key}
                style={[styles.segment, isActive && styles.segmentActive]}
                onPress={() => setSegment(key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
                  {t(SEGMENT_LABEL_KEYS[key])}
                  {count > 0 ? ` ${count}` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.body}>
          {floors.map(({ floor, rooms: floorRooms }) => (
            <View key={floor}>
              <SectionLabel hint={t("roomBoard.roomCount", { count: floorRooms.length })}>
                {t("roomBoard.floor", { floor })}
              </SectionLabel>
              <View style={styles.grid}>
                {floorRooms.map((room) => (
                  <RoomStatusTile
                    key={room.roomId}
                    room={room}
                    assigneeName={room.assignedTo ? nameById.get(room.assignedTo) ?? null : null}
                    onPress={() => setSelectedRoomId(room.roomId)}
                  />
                ))}
              </View>
            </View>
          ))}

          {floors.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="bed-outline" size={30} color={C.ink4} />
              <Text style={styles.emptyTitle}>
                {rooms.length === 0 ? t("roomBoard.noRoomsLoaded") : t("roomBoard.segmentEmpty")}
              </Text>
              <Text style={styles.emptyHint}>{t("roomBoard.pullToRefresh")}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {selectedRoom ? (
        <RoomDetailSheet
          room={selectedRoom}
          assigneeName={selectedRoom.assignedTo ? nameById.get(selectedRoom.assignedTo) ?? null : null}
          locale={locale}
          saving={saving}
          onAssign={(room) => {
            setSelectedRoomId(null);
            setPickerRoom(room);
          }}
          onRemoveAssignment={(room) => {
            setSelectedRoomId(null);
            void handleRemoveAssignment(room);
          }}
          onClose={() => setSelectedRoomId(null)}
        />
      ) : null}

      <HousekeeperPicker
        visible={pickerRoom != null}
        roomNumber={pickerRoom?.roomNumber ?? null}
        staff={staff}
        loads={teamLoads}
        saving={saving}
        onSelect={(member) => void assignTo(member)}
        onClose={() => setPickerRoom(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: {
    color: shellTokens.ink3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { color: shellTokens.ink2, fontSize: 13, marginTop: 7 },

  segmented: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: C.surface3,
    borderRadius: R.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: R.md - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: C.ink,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { color: C.ink3, fontSize: 12, fontWeight: "700" },
  segmentLabelActive: { color: C.ink },

  body: { paddingHorizontal: 16, gap: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },

  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 32, gap: 7 },
  emptyTitle: { color: C.ink, fontSize: 15.5, fontWeight: "700", marginTop: 4 },
  emptyHint: { color: C.ink3, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
