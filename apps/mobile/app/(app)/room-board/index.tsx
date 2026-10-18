import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { removeAssignmentByPlan, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { planAssignmentRemoval, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import {
  buildAttentionSignals,
  buildBoardSummary,
  buildTileModel,
  describeBoardStatus,
  flattenBoard,
  GRID_GAP,
  GRID_GUTTER,
  gridColumns,
  groupBoard,
  segmentCounts,
  type BoardListItem,
  type BoardSegmentKey,
  type RoomTileModel,
} from "@/lib/housekeeping/roomBoardView";
import { useRoomBoard } from "@/lib/housekeeping/useRoomBoard";
import { buildNameById, buildTeamLoads, type AssignableStaff, type FloorRoom } from "@/lib/housekeeping/supervisor";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { BoardHeader } from "@/components/supervisor/board/BoardHeader";
import { BoardAttentionChips, BoardReadinessCard } from "@/components/supervisor/board/BoardReadinessCard";
import { BoardSegmentBar } from "@/components/supervisor/board/BoardSegmentBar";
import { RoomTileRow } from "@/components/supervisor/board/RoomTile";
import { HousekeeperPicker } from "@/components/supervisor/HousekeeperPicker";
import { RoomDetailSheet } from "@/components/supervisor/RoomDetailSheet";
import { Skeleton } from "@/components/supervisor/today/TodayBlocks";
import { StateBlock } from "@/components/ui/StateBlock";

/* ─── Room Board — the live floor ───────────────────────────────────────────
   Compact header with an honest freshness line, one readiness card, attention chips, a status selector
   and the board grouped by building/floor as readable room cards in a virtualised list. Tapping a card
   opens the room sheet: flags, timing, the latest note, and the assign action. Everything shown comes from
   the Phase 1 verified model (useRoomBoard); nothing here fetches or subscribes on its own. */

export default function RoomBoardScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  // Board, staff and roster are the same verified snapshot Supervisor Today reads; see useRoomBoard.
  const { model, gate, isOnline, refreshing: refreshingBackground, refresh } = useRoomBoard();
  const { availability } = model;
  const views = model.rooms;
  const rooms = useMemo<BoardRoom[]>(() => (views ?? []).map((view) => view.room), [views]);
  const staff = useMemo<AssignableStaff[]>(
    () => model.staff.map((member) => ({ userId: member.userId, name: member.name, role: member.role })),
    [model.staff],
  );
  const [segment, setSegment] = useState<BoardSegmentKey>("all");
  const [pulling, setPulling] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [pickerRoom, setPickerRoom] = useState<FloorRoom | null>(null);
  const [saving, setSaving] = useState(false);
  // The header's age ("Updated 20 seconds ago") is read from the real clock at render; this tick only re-renders it.
  const [, setTick] = useState(0);
  // Deep link from the supervisor Attention Center: `?roomId=` opens that room once, or says it is gone.
  const { roomId: linkedRoomId } = useLocalSearchParams<{ roomId?: string }>();
  const [linkMissing, setLinkMissing] = useState(false);
  // A link is judged only against a board the server verified just now; anything else proves nothing about the room.
  const boardLoaded = availability.kind === "ready" || availability.kind === "verified_empty";

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const nameById = useMemo(() => buildNameById(staff), [staff]);
  const teamLoads = useMemo(() => buildTeamLoads(rooms, nameById), [rooms, nameById]);
  // A room tied to a person is ASSIGNED even when the staff list has no name for them (or failed to load).
  const assigneeLabel = useCallback(
    (room: FloorRoom): string | null =>
      room.assignedTo ? (nameById.get(room.assignedTo) ?? t("roomBoard.assigneeUnknown")) : null,
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

  // Headline numbers, segment counts and signals all come from the same verified rooms, so they cannot disagree.
  const metrics = useMemo(() => buildBoardSummary(views ?? []), [views]);
  const counts = useMemo(() => segmentCounts(metrics), [metrics]);
  const signals = useMemo(
    () => buildAttentionSignals(views ?? [], metrics, model.generatedAt, model.timeZone),
    [views, metrics, model.generatedAt, model.timeZone],
  );

  const columns = gridColumns(width, fontScale);
  const groups = useMemo(() => groupBoard(views ?? []), [views]);
  const items = useMemo(() => flattenBoard(groups, segment, columns), [groups, segment, columns]);
  const tileModels = useMemo(() => {
    const byId = new Map<string, RoomTileModel>();
    for (const view of views ?? []) {
      byId.set(
        view.room.roomId,
        buildTileModel(view, { now: model.generatedAt, timeZone: model.timeZone, language: i18n.language, t }),
      );
    }
    return byId;
  }, [views, model.generatedAt, model.timeZone, i18n.language, t]);
  const onSelectRoom = useCallback((roomId: string) => setSelectedRoomId(roomId), []);

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

  // What the board may claim right now. Anything but a fresh, verified answer says so instead of looking live.
  const verifiedClock =
    availability.kind === "stale" || availability.kind === "previous_day" || availability.kind === "ready" || availability.kind === "verified_empty"
      ? availability.verifiedAt !== null
        ? formatHotelTime(new Date(availability.verifiedAt), model.timeZone, i18n.language)
        : null
      : null;
  const busy = pulling || refreshingBackground;
  const statusLine = describeBoardStatus(availability, { refreshing: busy, isOnline, now: Date.now() });
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
  const boardKnown = views !== null && model.readiness !== null;

  const header = (
    <BoardHeader
      status={statusLine}
      verifiedClock={verifiedClock}
      refreshing={busy}
      topInset={insets.top}
      t={t}
      onRefresh={() => void onRefresh()}
    />
  );

  if (availability.kind === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]} testID="room-board-loading">
        {header}
        <BoardSkeleton />
      </View>
    );
  }

  const listHeader = (
    <View>
      {header}
      {boardKnown ? (
        <>
          <BoardReadinessCard metrics={metrics} t={t} />
          <BoardAttentionChips signals={signals} t={t} />
          <BoardSegmentBar selected={segment} counts={counts} t={t} onSelect={setSegment} />
        </>
      ) : null}

      {linkMissing ? (
        <View
          style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
          accessibilityRole="alert"
          testID="room-board-link-missing"
        >
          <View style={styles.noticeText}>
            <Text style={[styles.noticeTitle, { color: theme.textPrimary }]}>{t("supervisorAttention.roomBoard.missingTitle")}</Text>
            <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>{t("supervisorAttention.roomBoard.missingBody")}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setLinkMissing(false)}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            hitSlop={8}
            testID="room-board-link-missing-close"
          >
            <Text style={[styles.noticeClose, { color: theme.primaryAction }]}>{t("common.close")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {staleNoticeKey || availability.kind === "previous_day" ? (
        <View
          style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
          accessibilityRole="alert"
          testID="room-board-not-live"
        >
          <View style={styles.noticeText}>
            <Text style={[styles.noticeTitle, { color: theme.textPrimary }]}>{t("roomBoard.state.notLiveTitle")}</Text>
            <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>
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
    </View>
  );

  let listEmpty: ReactElement | null = null;
  if (!boardKnown) {
    // Nothing verified to show: say why. A failed or offline load is NOT an empty board.
    listEmpty = (
      <StateBlock
        status="error"
        errorIcon={availability.kind === "unavailable" && availability.cause === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
        errorMessage={t(unavailableMessageKey ?? "roomBoard.state.unavailableError")}
        onRetry={() => void onRefresh()}
        retryLabel={t("roomBoard.state.retry")}
      />
    );
  } else if (rooms.length === 0) {
    listEmpty = (
      <View testID="room-board-empty">
        <StateBlock
          status="empty"
          emptyIcon="bed-outline"
          emptyTitle={t("roomBoard.state.verifiedEmpty")}
          emptyBody={t("roomBoard.state.verifiedEmptyBody")}
        />
        <Pressable
          onPress={() => void onRefresh()}
          accessibilityRole="button"
          accessibilityLabel={t("roomBoard.header.refresh")}
          testID="room-board-empty-refresh"
          style={[styles.emptyAction, { borderColor: theme.primaryLine, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.emptyActionText, { color: theme.primaryAction }]}>{t("roomBoard.header.refresh")}</Text>
        </Pressable>
      </View>
    );
  } else if (items.length === 0) {
    listEmpty = (
      <View testID="room-board-segment-empty">
        <StateBlock status="empty" emptyIcon="bed-outline" emptyTitle={t("roomBoard.segmentEmpty")} />
        <Pressable
          onPress={() => setSegment("all")}
          accessibilityRole="button"
          accessibilityLabel={t("roomBoard.showAll")}
          testID="room-board-show-all"
          style={[styles.emptyAction, { borderColor: theme.primaryLine, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.emptyActionText, { color: theme.primaryAction }]}>{t("roomBoard.showAll")}</Text>
        </Pressable>
      </View>
    );
  }

  const renderItem = ({ item }: { item: BoardListItem }) => {
    if (item.type === "building") {
      return (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
          style={[styles.building, { color: theme.textPrimary }]}
          testID={`room-board-building-${item.key}`}
        >
          {item.building ? t("roomBoard.building", { building: item.building }) : t("roomBoard.buildingNone")}
        </Text>
      );
    }
    if (item.type === "floor") {
      const label = item.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: item.floor });
      const count =
        item.shown === item.total
          ? t("roomBoard.roomCount", { count: item.total })
          : t("roomBoard.roomCountOf", { shown: item.shown, total: item.total });
      return (
        <View style={styles.floorHeader} testID={`room-board-floor-${item.key}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.floorTitle, { color: theme.textPrimary }]}>
            {label}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.floorCount, { color: theme.textMuted }]}>
            {count}
          </Text>
        </View>
      );
    }
    const models = item.views
      .map((view) => tileModels.get(view.room.roomId))
      .filter((model): model is RoomTileModel => model !== undefined);
    return (
      <View style={styles.rowWrap}>
        <RoomTileRow models={models} columns={item.columns} onSelect={onSelectRoom} />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        // `columns` changes the row shape, so a rotation or a font-size change rebuilds the rows cleanly.
        extraData={columns}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS === "android"}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        testID="room-board-list"
      />

      {selectedRoom ? (
        <RoomDetailSheet
          room={selectedRoom}
          assigneeName={assigneeLabel(selectedRoom)}
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

/** Lightweight placeholder while the first answer is in flight — no counts, nothing that reads as data. */
function BoardSkeleton() {
  const theme = useTheme();
  return (
    <View style={styles.skeleton} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.skeletonCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <Skeleton height={12} width="35%" />
        <Skeleton height={34} width="55%" />
        <Skeleton height={10} />
        <Skeleton height={36} />
      </View>
      <View style={styles.skeletonRow}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height={44} width={84} />
        ))}
      </View>
      <View style={styles.skeletonRow}>
        <View style={styles.skeletonCell}>
          <Skeleton height={116} />
        </View>
        <View style={styles.skeletonCell}>
          <Skeleton height={116} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingBottom: 28, gap: GRID_GAP },
  rowWrap: { paddingHorizontal: GRID_GUTTER },

  notice: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 10, padding: 12, borderWidth: 1, borderRadius: R.md },
  noticeText: { flex: 1, gap: 2 },
  noticeTitle: { fontSize: 14, fontWeight: "700" },
  noticeBody: { fontSize: 13, lineHeight: 18 },
  noticeClose: { fontSize: 14, fontWeight: "700", minHeight: 44, textAlignVertical: "center" },
  pausedHint: { marginHorizontal: 16, marginBottom: 8, fontSize: 12 },

  building: { marginHorizontal: GRID_GUTTER, marginTop: 14, fontSize: 19, fontWeight: "800" },
  floorHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginHorizontal: GRID_GUTTER, marginTop: 10 },
  floorTitle: { fontSize: 15, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  floorCount: { fontSize: 12.5, fontWeight: "600" },
  emptyAction: { alignSelf: "center", minHeight: 48, paddingHorizontal: 22, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center", marginTop: 8 },
  emptyActionText: { fontSize: 14, fontWeight: "700" },

  skeleton: { paddingHorizontal: 16, gap: 14 },
  skeletonCard: { borderWidth: 1, borderRadius: R.xl, padding: 16, gap: 12 },
  skeletonRow: { flexDirection: "row", gap: GRID_GAP },
  skeletonCell: { flex: 1 },
});
