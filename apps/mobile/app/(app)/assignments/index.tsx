import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { R } from "@/components/shared/tokens";
import { AssignmentFilterSheet } from "@/components/supervisor/assignments/AssignmentFilterSheet";
import { AssignmentRoomCard } from "@/components/supervisor/assignments/AssignmentRoomCard";
import { AssignmentRoomSheet } from "@/components/supervisor/assignments/AssignmentRoomSheet";
import { AssignmentEmpty, AssignmentsSkeleton, type AssignmentEmptyKind } from "@/components/supervisor/assignments/AssignmentStates";
import { AssignmentsHeader, type AssignmentsTab } from "@/components/supervisor/assignments/AssignmentsHeader";
import { ActiveFilters, ListCaption, QuickChips, SectionHeader } from "@/components/supervisor/assignments/RoomsListParts";
import { TeamInterim } from "@/components/supervisor/assignments/TeamInterim";
import { BoardSearchBar } from "@/components/supervisor/board/BoardSearchBar";
import { BoardNotice } from "@/components/supervisor/board/BoardStates";
import { isQuickActive, runAssignmentQuery } from "@/lib/housekeeping/assignmentQuery";
import {
  buildHeaderMetrics,
  detailContextOf,
  freshnessNotices,
  operationalDateLabel,
  type AssignmentViewState,
  type CardCtaKind,
  type RoomsListItem,
} from "@/lib/housekeeping/assignmentRoomsView";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { describeBoardStatus } from "@/lib/housekeeping/roomBoardView";
import { buildTeamLoads } from "@/lib/housekeeping/supervisor";
import { useAssignmentRooms } from "@/lib/housekeeping/useAssignmentRooms";
import { useAssignments } from "@/lib/housekeeping/useAssignments";
import { useRoomAssignment } from "@/lib/housekeeping/useRoomAssignment";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

/* ─── Assignments — who cleans what today ───────────────────────────────────
   The supervisor's assignment workspace. This file only wires: the verified model (`useAssignments`, the same
   one shared snapshot Supervisor Today and the Room Board read — no fetch or subscription of its own), the Rooms
   tab state (`useAssignmentRooms`) and the one assignment workflow (`useRoomAssignment`) to the presentational
   components. Rooms is complete; Team keeps its interim presentation until Phase 3. */

export default function AssignmentsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const language = i18n.language;

  const { model, gate, isOnline, refreshing: refreshingBackground, scopeKey, refresh } = useAssignments();
  const { availability } = model;
  const rooms = useAssignmentRooms({ model, gate, language, t, resetKey: scopeKey });
  const { query, items, cards, options, chips, state } = rooms;

  const [tab, setTab] = useState<AssignmentsTab>("rooms");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomGone, setRoomGone] = useState(false);
  // The header's age ("Updated 20 seconds ago") is read from the real clock at render; this tick only re-renders it.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // The one assignment workflow (assign / reassign / remove): it follows the room through the live board, re-reads it
  // before every write and reports only what the server confirmed. The sheet renders it; see useRoomAssignment.
  const assignment = useRoomAssignment({ model: model.board, gate, isOnline, refresh, scopeKey, t, toast });
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  // The sheet follows the room by id through every refresh, and reads the FULL model: a room that a search or
  // filter hides is still on the board, so its sheet stays open.
  const selectedEntry = useMemo(
    () => (selectedRoomId === null ? null : (model.rooms ?? []).find((entry) => entry.room.roomId === selectedRoomId) ?? null),
    [model.rooms, selectedRoomId],
  );
  useEffect(() => {
    if (selectedRoomId === null || selectedEntry !== null) return;
    // The open room left the verified board (realtime removal, or the board stopped being today's): close rather
    // than keep showing a room the board no longer vouches for, and say so when the room is truly gone.
    setSelectedRoomId(null);
    if (model.rooms !== null) setRoomGone(true);
  }, [selectedRoomId, selectedEntry, model.rooms]);

  const onOpenRoom = useCallback((roomId: string, cta: CardCtaKind) => {
    setRoomGone(false);
    setSelectedRoomId(roomId);
    // "Assign" goes straight to the picker; every other call to action opens the room itself.
    if (cta === "assign" && gateRef.current.allowed) assignmentRef.current.openAssign(roomId);
  }, []);
  const closeSheet = useCallback(() => {
    if (assignmentRef.current.flow) assignmentRef.current.close();
    setSelectedRoomId(null);
  }, []);
  const openBoard = useCallback(() => {
    const roomId = selectedRoomId;
    closeSheet();
    if (roomId) router.push({ pathname: "/(app)/room-board", params: { roomId } } as never);
  }, [closeSheet, selectedRoomId]);

  const verifiedClock =
    availability.kind === "stale" || availability.kind === "previous_day" || availability.kind === "ready" || availability.kind === "verified_empty"
      ? availability.verifiedAt !== null
        ? formatHotelTime(new Date(availability.verifiedAt), model.timeZone, language)
        : null
      : null;
  const busy = pulling || refreshingBackground;
  const statusLine = describeBoardStatus(availability, { refreshing: busy, isOnline, now: Date.now() });
  const boardKnown = model.rooms !== null;
  const live = availability.kind === "ready" || availability.kind === "verified_empty";

  const metrics = useMemo(() => buildHeaderMetrics(model), [model]);
  const notices = useMemo(() => freshnessNotices(model), [model]);
  const detailContext = useMemo(() => detailContextOf(model.board, gate, verifiedClock, live), [model.board, gate, verifiedClock, live]);

  // Team (interim): the existing per-housekeeper cards over the same verified rooms.
  const teamLoads = useMemo(() => {
    const nameById = new Map<string, string>();
    if (model.board.staffNamesKnown) for (const member of model.board.staff) if (member.name && member.name !== "—") nameById.set(member.userId, member.name);
    return buildTeamLoads((model.rooms ?? []).map((entry) => entry.room), nameById);
  }, [model.rooms, model.board.staff, model.board.staffNamesKnown]);

  const previewCount = useCallback(
    (draft: AssignmentViewState) => runAssignmentQuery({ rooms: rooms.queue, search: rooms.search, filters: draft.filters, scope: draft.scope, sort: draft.sort }).visible.length,
    [rooms.queue, rooms.search],
  );

  const unavailableKey =
    availability.kind === "unavailable"
      ? availability.cause === "offline"
        ? "assignments.v2.state.unavailableOffline"
        : availability.cause === "forbidden"
          ? "assignments.v2.state.unavailableForbidden"
          : "assignments.v2.state.unavailableError"
      : availability.kind === "previous_day"
        ? "assignments.v2.state.previousDay"
        : null;
  const staleNote = availability.kind === "stale" ? t("assignments.v2.state.emptyStaleNote", { time: verifiedClock ?? "—" }) : null;

  const showBlocked = useCallback(() => rooms.applyState({ ...state, scope: "blocked" }), [rooms, state]);
  const showAll = useCallback(() => rooms.applyState({ ...state, scope: "all", filters: { ...state.filters, priority: "any" } }), [rooms, state]);

  // Why there is nothing to list, if there is nothing: each reason has its own words and way out.
  const emptyKind: AssignmentEmptyKind | null = !boardKnown
    ? "unavailable"
    : (model.rooms ?? []).length === 0
      ? "verifiedEmpty"
      : rooms.queue.length === 0
        ? "queueDone"
        : query.emptyReason === "search"
          ? "search"
          : query.emptyReason === "filters"
            ? "filters"
            : query.emptyReason === "scope"
              ? state.scope === "unassigned" && query.counts.blocked > 0
                ? "blockedOnly"
                : "scope"
              : null;

  const header = (
    <AssignmentsHeader
      status={statusLine}
      verifiedClock={verifiedClock}
      refreshing={busy}
      topInset={insets.top}
      dateLabel={boardKnown ? operationalDateLabel(model, language) : null}
      metrics={metrics}
      tab={tab}
      onTab={setTab}
      onRefresh={() => void onRefresh()}
      onShowBlocked={boardKnown ? () => { setTab("rooms"); showBlocked(); } : null}
      t={t}
    />
  );

  if (availability.kind === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]} testID="assignments-loading">
        {header}
        <AssignmentsSkeleton />
      </View>
    );
  }

  const narrowed = query.searching || chips.length > 0 || state.sort !== "priority";
  const listHeader = (
    <View>
      {header}
      {notices.map((notice) => (
        <View
          key={notice.key}
          style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
          accessibilityRole="alert"
          testID={notice.kind === "not_live" ? "assignments-not-live" : "assignments-aux-notice"}
        >
          <View style={styles.noticeText}>
            {notice.kind === "not_live" ? <Text style={[styles.noticeTitle, { color: theme.textPrimary }]}>{t("assignments.v2.state.notLiveTitle")}</Text> : null}
            <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>{t(`assignments.v2.state.${notice.key}`, { time: verifiedClock ?? "—" })}</Text>
          </View>
        </View>
      ))}
      {roomGone ? <BoardNotice body={t("assignments.v2.sheet.roomGone")} closeLabel={t("common.close")} onClose={() => setRoomGone(false)} testID="assignments-room-gone" /> : null}
      {!gate.allowed && boardKnown && availability.kind !== "stale" ? (
        <Text style={[styles.pausedHint, { color: theme.textMuted }]} testID="assignments-actions-paused">
          {t("assignments.v2.state.actionsPaused")}
        </Text>
      ) : null}

      {tab === "rooms" && boardKnown ? (
        <>
          <BoardSearchBar
            value={rooms.search}
            onChangeText={rooms.setSearch}
            onClear={rooms.clearSearch}
            onOpenFilters={() => setFilterSheetOpen(true)}
            activeCount={rooms.badge}
            t={t}
            placeholder={t("assignments.v2.search.placeholder")}
            label={t("assignments.v2.search.label")}
            filterLabel={t("assignments.v2.filters.open")}
            testIDPrefix="assignments"
          />
          <QuickChips views={rooms.quickViews} counts={query.quickCounts} isActive={(view) => isQuickActive(view, { scope: state.scope, priority: state.filters.priority })} onPress={rooms.pressQuick} t={t} />
          {narrowed ? (
            <ActiveFilters
              chips={chips}
              shown={query.visible.length}
              total={query.total}
              sortLabel={state.sort !== "priority" ? t(`assignments.v2.sort.${state.sort}`) : null}
              onRemove={rooms.removeChip}
              onClearAll={rooms.clearAll}
              onEdit={() => setFilterSheetOpen(true)}
              t={t}
            />
          ) : null}
          {query.visible.length > 0 ? <ListCaption title={t("assignments.v2.list.title")} sort={t(`assignments.v2.sort.${state.sort}`)} /> : null}
        </>
      ) : null}

      {tab === "team" && boardKnown ? <TeamInterim loads={teamLoads} onRoomPress={(roomId) => onOpenRoom(roomId, "view_assignment")} t={t} /> : null}
    </View>
  );

  const listEmpty =
    tab === "rooms" && emptyKind ? (
      <AssignmentEmpty
        kind={emptyKind}
        t={t}
        searchText={rooms.search.trim()}
        searching={query.searching}
        staleNote={staleNote}
        unavailableKey={unavailableKey}
        offline={availability.kind === "unavailable" && availability.cause === "offline"}
        onRefresh={() => void onRefresh()}
        onShowAll={showAll}
        onShowBlocked={showBlocked}
        onClearSearch={rooms.clearSearch}
        onClearFilters={rooms.clearAll}
      />
    ) : tab === "team" && !boardKnown ? (
      <AssignmentEmpty
        kind="unavailable"
        t={t}
        searchText=""
        searching={false}
        staleNote={null}
        unavailableKey={unavailableKey}
        offline={availability.kind === "unavailable" && availability.cause === "offline"}
        onRefresh={() => void onRefresh()}
        onShowAll={showAll}
        onShowBlocked={showBlocked}
        onClearSearch={rooms.clearSearch}
        onClearFilters={rooms.clearAll}
      />
    ) : null;

  const renderItem = ({ item }: { item: RoomsListItem }) => {
    if (item.type === "section") return <SectionHeader section={item.section} count={item.count} t={t} />;
    const card = cards.get(item.entry.room.roomId);
    return card ? (
      <View style={styles.rowWrap}>
        <AssignmentRoomCard model={card} onOpen={onOpenRoom} />
      </View>
    ) : null;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={tab === "rooms" && boardKnown ? items : []}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS === "android"}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        testID="assignments-list"
      />

      {selectedEntry ? <AssignmentRoomSheet entry={selectedEntry} context={detailContext} assignment={assignment} onClose={closeSheet} onOpenBoard={openBoard} /> : null}

      <AssignmentFilterSheet
        visible={filterSheetOpen}
        applied={state}
        options={options}
        previewCount={previewCount}
        t={t}
        onApply={(draft) => {
          rooms.applyState(draft);
          setFilterSheetOpen(false);
        }}
        onClose={() => setFilterSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingBottom: 28, gap: 8 },
  rowWrap: { paddingHorizontal: 16 },
  notice: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 10, padding: 12, borderWidth: 1, borderRadius: R.md },
  noticeText: { flex: 1, gap: 2 },
  noticeTitle: { fontSize: 14, fontWeight: "700" },
  noticeBody: { fontSize: 13, lineHeight: 18 },
  pausedHint: { marginHorizontal: 16, marginBottom: 8, fontSize: 12 },
});
