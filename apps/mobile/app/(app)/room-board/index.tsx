import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { removeAssignmentByPlan, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { planAssignmentRemoval, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { isLive } from "@/lib/housekeeping/roomBoardState";
import { useRoomBoard } from "@/lib/housekeeping/useRoomBoard";
import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  filterBySegment,
  groupByFloor,
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
  const theme = useTheme();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  // Board, staff and roster are the same verified snapshot Supervisor Today reads; see useRoomBoard.
  const { model, gate, refresh } = useRoomBoard();
  const { availability } = model;
  const rooms = useMemo<BoardRoom[]>(() => (model.rooms ?? []).map((view) => view.room), [model.rooms]);
  const staff = useMemo<AssignableStaff[]>(
    () => model.staff.map((member) => ({ userId: member.userId, name: member.name, role: member.role })),
    [model.staff],
  );
  const [segment, setSegment] = useState<BoardSegment>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [pickerRoom, setPickerRoom] = useState<FloorRoom | null>(null);
  const [saving, setSaving] = useState(false);
  // Deep link from the supervisor Attention Center: `?roomId=` opens that room once, or says it is gone.
  const { roomId: linkedRoomId } = useLocalSearchParams<{ roomId?: string }>();
  const [linkMissing, setLinkMissing] = useState(false);
  // A link is judged only against a board the server verified just now; anything else proves nothing about the room.
  const boardLoaded = availability.kind === "ready" || availability.kind === "verified_empty";

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const nameById = useMemo(() => buildNameById(staff), [staff]);
  const teamLoads = useMemo(() => buildTeamLoads(rooms, nameById), [rooms, nameById]);
  const snapshot = useMemo(
    () => buildFloorSnapshot(rooms, { nowMs: model.generatedAt, timeZone: model.timeZone }),
    [rooms, model.generatedAt, model.timeZone],
  );
  const floors = useMemo(() => groupByFloor(filterBySegment(rooms, segment)), [rooms, segment]);
  // A room tied to a person is ASSIGNED even when the staff list has no name for them (or failed to load).
  const assigneeLabel = useCallback(
    (room: FloorRoom, short: boolean): string | null =>
      room.assignedTo
        ? (nameById.get(room.assignedTo) ?? t(short ? "roomBoard.assigneeUnknownShort" : "roomBoard.assigneeUnknown"))
        : null,
    [nameById, t],
  );
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.roomId === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  // The link is single-use. It is only judged against a board that really loaded: a failed or offline load
  // proves nothing about the room, so the link waits for the next successful load.
  useEffect(() => {
    const id = typeof linkedRoomId === "string" ? linkedRoomId.trim() : "";
    if (!id || !boardLoaded) return;
    if (rooms.some((room) => room.roomId === id)) setSelectedRoomId(id);
    else setLinkMissing(true);
    router.setParams({ roomId: undefined });
  }, [linkedRoomId, boardLoaded, rooms]);

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
      // Only a fresh, verified board may be changed; the date is the hotel's, not the phone's.
      if (!pickerRoom || !gate.allowed) return;
      setSaving(true);
      try {
        await saveAssignments(model.hotelDate, [
          { room_id: pickerRoom.roomId, housekeeper_id: member.userId },
        ]);
        setPickerRoom(null);
        await refresh();
      } catch (err) {
        console.warn("Assign failed:", err);
      } finally {
        setSaving(false);
      }
    },
    [pickerRoom, gate.allowed, model.hotelDate, refresh],
  );

  const handleRemoveAssignment = useCallback(
    async (target: FloorRoom) => {
      const room = rooms.find((candidate) => candidate.roomId === target.roomId);
      if (!room || !gate.allowed) return;
      // A dated row is deleted by id; a mirror-only assignment through its room (see planAssignmentRemoval).
      const plan = planAssignmentRemoval(room);
      if (plan.kind === "none") return;
      setSaving(true);
      try {
        await removeAssignmentByPlan(plan);
        await refresh();
      } catch (err) {
        console.warn("Remove assignment failed:", err);
      } finally {
        setSaving(false);
      }
    },
    [rooms, gate.allowed, refresh],
  );

  if (availability.kind === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  // What the board may claim right now. Anything but a fresh, verified answer says so instead of looking live.
  const verifiedClock =
    availability.kind === "stale" || availability.kind === "previous_day" || availability.kind === "ready" || availability.kind === "verified_empty"
      ? availability.verifiedAt !== null
        ? formatHotelTime(new Date(availability.verifiedAt), model.timeZone, i18n.language)
        : null
      : null;
  const staleNoticeKey =
    availability.kind === "stale"
      ? availability.reason === "offline"
        ? "roomBoard.state.staleOffline"
        : availability.reason === "refresh_failed"
          ? "roomBoard.state.staleFailed"
          : "roomBoard.state.staleAge"
      : null;
  const unavailableMessageKey =
    availability.kind === "unavailable"
      ? availability.cause === "offline"
        ? "roomBoard.state.unavailableOffline"
        : availability.cause === "forbidden"
          ? "roomBoard.state.unavailableForbidden"
          : "roomBoard.state.unavailableError"
      : availability.kind === "previous_day"
        ? "roomBoard.state.previousDay"
        : null;
  const boardKnown = model.rooms !== null && model.readiness !== null;

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
          {/* Only a board the server verified just now is a "live floor"; anything else says it is not. */}
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]} testID="room-board-kicker">
            {isLive(availability) ? t("roomBoard.kicker") : t("roomBoard.state.notLiveTitle")}
          </Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("tabs.roomBoard")}</Text>
          {boardKnown && model.readiness ? (
            <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
              {t("roomBoard.summary", {
                ready: model.readiness.ready,
                // Out-of-order rooms are not part of the sellable inventory, so they are not "left to clean".
                total: model.readiness.inService,
                working: model.readiness.inProgress,
              })}
            </Text>
          ) : null}
          {boardKnown ? <HeroSignalRow signals={signals} /> : null}
        </View>

        {boardKnown ? (
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
        ) : null}

        {linkMissing ? (
          <View
            style={[styles.linkNotice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
            accessibilityRole="alert"
            testID="room-board-link-missing"
          >
            <View style={styles.linkNoticeText}>
              <Text style={[styles.linkNoticeTitle, { color: theme.textPrimary }]}>{t("supervisorAttention.roomBoard.missingTitle")}</Text>
              <Text style={[styles.linkNoticeBody, { color: theme.textSecondary }]}>{t("supervisorAttention.roomBoard.missingBody")}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setLinkMissing(false)}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              hitSlop={8}
              testID="room-board-link-missing-close"
            >
              <Text style={[styles.linkNoticeClose, { color: theme.primaryAction }]}>{t("common.close")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {staleNoticeKey || availability.kind === "previous_day" ? (
          <View
            style={[styles.linkNotice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
            accessibilityRole="alert"
            testID="room-board-not-live"
          >
            <View style={styles.linkNoticeText}>
              <Text style={[styles.linkNoticeTitle, { color: theme.textPrimary }]}>{t("roomBoard.state.notLiveTitle")}</Text>
              <Text style={[styles.linkNoticeBody, { color: theme.textSecondary }]}>
                {availability.kind === "previous_day"
                  ? t("roomBoard.state.previousDay")
                  : t(staleNoticeKey as string, { time: verifiedClock ?? "—" })}
              </Text>
            </View>
          </View>
        ) : null}

        {!gate.allowed && boardKnown && availability.kind !== "stale" ? (
          <Text style={[styles.pausedHint, { color: theme.textMuted }]} testID="room-board-actions-paused">
            {t("roomBoard.state.actionsPaused")}
          </Text>
        ) : null}

        {boardKnown ? <ColorLegend t={t} theme={theme} /> : null}

        <View style={styles.body}>
          {!boardKnown ? (
            // Nothing verified to show: say why. A failed or offline load is NOT an empty board.
            <StateBlock
              status="error"
              errorIcon={availability.kind === "unavailable" && availability.cause === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
              errorMessage={t(unavailableMessageKey ?? "roomBoard.state.unavailableError")}
              onRetry={() => void onRefresh()}
              retryLabel={t("roomBoard.state.retry")}
            />
          ) : null}

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
                    assigneeName={assigneeLabel(room, true)}
                    onPress={() => setSelectedRoomId(room.roomId)}
                  />
                ))}
              </View>
            </View>
          ))}

          {boardKnown && floors.length === 0 ? (
            <StateBlock
              status="empty"
              emptyIcon="bed-outline"
              emptyTitle={rooms.length === 0 ? t("roomBoard.state.verifiedEmpty") : t("roomBoard.segmentEmpty")}
              emptyBody={t("roomBoard.pullToRefresh")}
            />
          ) : null}
        </View>
      </ScrollView>

      {selectedRoom ? (
        <RoomDetailSheet
          room={selectedRoom}
          assigneeName={assigneeLabel(selectedRoom, false)}
          locale={locale}
          saving={saving}
          actionsDisabled={!gate.allowed}
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

  pausedHint: { marginHorizontal: 18, marginBottom: 8, fontSize: 12 },
  linkNotice: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 18, marginBottom: 10, padding: 12, borderWidth: 1, borderRadius: R.md },
  linkNoticeText: { flex: 1, gap: 2 },
  linkNoticeTitle: { fontSize: 14, fontWeight: "700" },
  linkNoticeBody: { fontSize: 13, lineHeight: 18 },
  linkNoticeClose: { fontSize: 14, fontWeight: "700", minHeight: 44, textAlignVertical: "center" },

  body: { paddingHorizontal: 16, gap: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
});
