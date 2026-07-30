import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
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
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { HeroSignalRow, RoomStatusTile, type HeroSignal } from "@/components/supervisor/atoms";
import { HousekeeperPicker } from "@/components/supervisor/HousekeeperPicker";
import { RoomDetailSheet } from "@/components/supervisor/RoomDetailSheet";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";

/* ─── Room Board — the live floor, one tile per room ────────────────────────
   Dark shell hero with the day's shape, a status segmented, and the board
   grouped by floor in the protected status colors. Tapping a tile opens
   the room sheet: flags, timing, the latest note, and the assign action. */

type ThemeTokens = ReturnType<typeof useTheme>;

const SEGMENTS: BoardSegment[] = ["all", "toClean", "working", "ready"];

/* ─── Status color legend ───────────────────────────────────────────────────
   5 grouped entries matching the tile color contract, rendered via
   StatusBadge so the room StatusKey mapping stays the single source of
   truth for chip color/icon/label. Shown once below the segmented control
   so supervisors can read the board without prior context. */

const LEGEND_ENTRIES: { key: string; statusKey: StatusKey; labelKey: string }[] = [
  { key: "dirty", statusKey: "dirty", labelKey: "roomBoard.legend.dirty" },
  { key: "pickup", statusKey: "pickup", labelKey: "roomBoard.legend.pickup" },
  { key: "submitted", statusKey: "clean", labelKey: "roomBoard.legend.submitted" },
  { key: "ready", statusKey: "ready", labelKey: "roomBoard.legend.ready" },
  { key: "ooo", statusKey: "outOfOrder", labelKey: "roomBoard.legend.ooo" },
];

function ColorLegend({ t, theme }: { t: (key: string) => string; theme: ThemeTokens }) {
  return (
    <View
      style={[
        legendStyles.row,
        { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background },
      ]}
      testID="color-legend"
    >
      {LEGEND_ENTRIES.map(({ key, statusKey, labelKey }) => (
        <StatusBadge key={key} statusKey={statusKey} label={t(labelKey)} />
      ))}
    </View>
  );
}

const legendStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
});

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
  const theme = useTheme();
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
          fg: theme.status.dirty,
          bg: theme.status.dirtySoft,
          line: theme.status.dirtyLine,
        },
        snapshot.submitted > 0 && {
          key: "submitted",
          label: t("roomBoard.signalSubmitted", { count: snapshot.submitted }),
          fg: theme.status.clean,
          bg: theme.status.cleanSoft,
          line: theme.status.cleanLine,
        },
        snapshot.dnd > 0 && {
          key: "dnd",
          label: t("roomBoard.signalDnd", { count: snapshot.dnd }),
          fg: theme.textSecondary,
          bg: theme.surfaceMuted,
          line: theme.border,
        },
      ].filter(Boolean) as HeroSignal[],
    [snapshot, t, theme],
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
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />
        }
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>{t("roomBoard.kicker")}</Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("tabs.roomBoard")}</Text>
          <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
            {t("roomBoard.summary", {
              ready: snapshot.ready,
              total: snapshot.total,
              working: snapshot.inProgress,
            })}
          </Text>
          <HeroSignalRow signals={signals} />
        </View>

        <View style={[styles.segmented, { backgroundColor: theme.surfaceMuted }]}>
          {SEGMENTS.map((key) => {
            const isActive = segment === key;
            const count = segmentCounts[key];
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.segment,
                  isActive && [
                    styles.segmentActive,
                    { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.textPrimary },
                  ],
                ]}
                onPress={() => setSegment(key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: isActive ? theme.textPrimary : theme.textMuted },
                  ]}
                >
                  {t(SEGMENT_LABEL_KEYS[key])}
                  {count > 0 ? ` ${count}` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ColorLegend t={t} theme={theme} />

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
            <StateBlock
              status="empty"
              emptyIcon="bed-outline"
              emptyTitle={rooms.length === 0 ? t("roomBoard.noRoomsLoaded") : t("roomBoard.segmentEmpty")}
              emptyBody={t("roomBoard.pullToRefresh")}
            />
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
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { fontSize: 13, marginTop: 7 },

  segmented: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 12,
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
    borderWidth: 1,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { fontSize: 12, fontWeight: "700" },

  body: { paddingHorizontal: 16, gap: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
});
