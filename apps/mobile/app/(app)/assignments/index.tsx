import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { R } from "@/components/shared/tokens";
import { AssignRoomChooserSheet } from "@/components/supervisor/assignments/AssignRoomChooserSheet";
import { BulkActionFooter } from "@/components/supervisor/assignments/BulkActionFooter";
import { BulkAssignHost } from "@/components/supervisor/assignments/BulkAssignHost";
import { BulkSelectionBar } from "@/components/supervisor/assignments/BulkSelectionBar";
import { DraftIndicator } from "@/components/supervisor/assignments/DraftIndicator";
import { SelectableRoomRow } from "@/components/supervisor/assignments/SelectableRoomRow";
import { SmartBalanceEntryCard } from "@/components/supervisor/assignments/SmartBalanceEntryCard";
import { SmartBalanceHost } from "@/components/supervisor/assignments/SmartBalanceHost";
import { AssignmentFilterSheet } from "@/components/supervisor/assignments/AssignmentFilterSheet";
import { AssignmentRoomCard } from "@/components/supervisor/assignments/AssignmentRoomCard";
import { AssignmentRoomSheet } from "@/components/supervisor/assignments/AssignmentRoomSheet";
import { AssignmentEmpty, AssignmentsSkeleton, type AssignmentEmptyKind } from "@/components/supervisor/assignments/AssignmentStates";
import { AssignmentsHeader, type AssignmentsTab } from "@/components/supervisor/assignments/AssignmentsHeader";
import { ActiveFilters, ListCaption, QuickChips, SectionHeader } from "@/components/supervisor/assignments/RoomsListParts";
import { StaffDetailSheet } from "@/components/supervisor/assignments/StaffDetailSheet";
import { TeamFilterSheet } from "@/components/supervisor/assignments/TeamFilterSheet";
import { TeamActiveFilters, TeamEmpty, TeamNotices } from "@/components/supervisor/assignments/TeamParts";
import { TeamStaffCard } from "@/components/supervisor/assignments/TeamStaffCard";
import { BoardSearchBar } from "@/components/supervisor/board/BoardSearchBar";
import { BoardNotice } from "@/components/supervisor/board/BoardStates";
import { selectableIn } from "@/lib/housekeeping/assignmentBulk";
import { buildSelectionRow, proposedLoadLine } from "@/lib/housekeeping/assignmentBulkView";
import { listAssignableRooms } from "@/lib/housekeeping/assignmentPicker";
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
import type { AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import { runTeamQuery, type TeamViewState } from "@/lib/housekeeping/assignmentTeamQuery";
import { buildStaffDetail, buildTeamHeaderMetrics, teamEmptyKind, teamNotices } from "@/lib/housekeeping/assignmentTeamView";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { describeBoardStatus } from "@/lib/housekeeping/roomBoardView";
import { useAssignmentRooms } from "@/lib/housekeeping/useAssignmentRooms";
import { useAssignmentTeam } from "@/lib/housekeeping/useAssignmentTeam";
import { useAssignments } from "@/lib/housekeeping/useAssignments";
import { useAssignmentFlow } from "@/lib/housekeeping/useAssignmentFlow";
import { useBulkAssignment } from "@/lib/housekeeping/useBulkAssignment";
import { useSmartBalance } from "@/lib/housekeeping/useSmartBalance";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

/* ─── Assignments — who cleans what today ───────────────────────────────────
   The supervisor's assignment workspace. This file only wires: the verified model (`useAssignments`, the same
   one shared snapshot Supervisor Today and the Room Board read — no fetch or subscription of its own), the Rooms
   tab state (`useAssignmentRooms`) and the one assignment workflow (`useAssignmentFlow`) to the presentational
   components. Rooms and Team read the SAME model and are both mounted state of this screen, so switching tabs
   keeps each one's search, filters and sort and never refetches or opens a second realtime channel. */

/** What the one list renders: the Rooms tab's items, or the Team tab's people. */
type ListItem = RoomsListItem | { type: "member"; key: string; member: AssignmentTeamMember };

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
  const team = useAssignmentTeam({ model, t, resetKey: scopeKey });
  // Bulk selection, the one unpublished draft and its atomic publication. It reads the SAME model as everything
  // else here (no fetch or subscription of its own) and changes nothing until a reviewed draft is published.
  const bulk = useBulkAssignment({ model, gate, isOnline, refresh, scopeKey, queue: rooms.queue, visible: query.visible, t, toast });
  const selecting = bulk.selection.selecting;
  // Smart Balance: a read-only proposal that, once reviewed, goes into the SAME unpublished draft as manual bulk work and
  // is published through the SAME atomic path. It reads the same model (no snapshot, fetch or subscription of its own).
  const user = useAppStore((current) => current.user);
  const role = user?.effective_role ?? user?.role;
  const canPlan = role === "gm" || role === "housekeeping_supervisor";
  const smart = useSmartBalance({
    model,
    gate,
    isOnline,
    scopeKey,
    hotelId: user?.tenant_id ?? null,
    draft: bulk.draft,
    selectedRoomIds: bulk.selection.selected,
    showReview: bulk.showReview,
    onAdded: (roomIds) => bulk.selection.consume(roomIds),
    refresh,
    t,
    toast,
  });

  const [tab, setTab] = useState<AssignmentsTab>("rooms");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [teamFilterOpen, setTeamFilterOpen] = useState(false);
  // The person whose drawer is open, and the person to return to when a room opened from that drawer is closed.
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const returnStaffRef = useRef<string | null>(null);
  // "Assign more rooms" from a person's drawer: the person whose room chooser is open.
  const [chooserFor, setChooserFor] = useState<string | null>(null);
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
  const assignment = useAssignmentFlow({ model, gate, isOnline, refresh, scopeKey, t, toast });
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;
  const gateRef = useRef(gate);
  gateRef.current = gate;

  // Android Back with unpublished work (or an unclear publication) asks first. (The draft is kept in memory while the
  // app lives - this tab stays mounted when the supervisor goes elsewhere - so only an explicit Back can lose it.)
  const dirtyRef = useRef(bulk.dirty || smart.plan !== null);
  dirtyRef.current = bulk.dirty || smart.plan !== null;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!dirtyRef.current) return false;
      Alert.alert(t("assignments.v2.bulk.leave.title"), t("assignments.v2.bulk.leave.body"), [
        { text: t("assignments.v2.bulk.leave.stay"), style: "cancel" },
        { text: t("assignments.v2.bulk.leave.leave"), style: "destructive", onPress: () => router.back() },
      ]);
      return true;
    });
    return () => subscription.remove();
  }, [t]);
  const bulkRef = useRef(bulk);
  bulkRef.current = bulk;
  const roomsByIdRef = useRef(new Map<string, (typeof query.visible)[number]>());
  roomsByIdRef.current = new Map(query.visible.map((entry) => [entry.room.roomId, entry] as const));
  const onToggleBulk = useCallback((roomId: string) => {
    const entry = roomsByIdRef.current.get(roomId);
    if (entry) bulkRef.current.selection.toggle(entry);
  }, []);
  const anySelectable = useMemo(() => selectableIn(rooms.queue).length > 0, [rooms.queue]);
  const viewTeam = useCallback(() => {
    bulkRef.current.finish();
    setTab("team");
  }, []);

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
    returnStaffRef.current = null;
    if (model.rooms !== null) setRoomGone(true);
  }, [selectedRoomId, selectedEntry, model.rooms]);

  const onOpenRoom = useCallback((roomId: string, cta: CardCtaKind) => {
    setRoomGone(false);
    setSelectedRoomId(roomId);
    // "Assign" goes straight to the picker; every other call to action opens the room itself.
    if (cta === "assign" && gateRef.current.allowed) assignmentRef.current.openAssign(roomId);
  }, []);
  const dismissRoom = useCallback(() => {
    if (assignmentRef.current.flow) assignmentRef.current.close();
    setSelectedRoomId(null);
  }, []);
  // A room opened from a staff drawer returns to that drawer, so the supervisor keeps their place.
  const closeSheet = useCallback(() => {
    dismissRoom();
    const staffId = returnStaffRef.current;
    returnStaffRef.current = null;
    if (staffId) setSelectedStaffId(staffId);
  }, [dismissRoom]);
  // Leaving for the full Room Board is not "going back": the drawer is not restored.
  const openBoard = useCallback(() => {
    const roomId = selectedRoomId;
    returnStaffRef.current = null;
    dismissRoom();
    if (roomId) router.push({ pathname: "/(app)/room-board", params: { roomId } } as never);
  }, [dismissRoom, selectedRoomId]);

  // Staff drawer: follows the person by id through every refresh and reads the full team, so a filter that hides
  // them does not close it. It is one Modal at a time: opening a room closes the drawer and remembers the person.
  const selectedMember = useMemo(
    () => (selectedStaffId === null ? null : (model.team ?? []).find((member) => member.userId === selectedStaffId) ?? null),
    [model.team, selectedStaffId],
  );
  useEffect(() => {
    if (selectedStaffId !== null && selectedMember === null) setSelectedStaffId(null);
  }, [selectedStaffId, selectedMember]);
  const roomEntries = useMemo(() => new Map((model.rooms ?? []).map((entry) => [entry.room.roomId, entry] as const)), [model.rooms]);
  const staffDetail = useMemo(
    () => (selectedMember ? buildStaffDetail(selectedMember, roomEntries, { t, language, timeZone: model.timeZone }) : null),
    [selectedMember, roomEntries, t, language, model.timeZone],
  );
  const onOpenStaff = useCallback((userId: string) => setSelectedStaffId(userId), []);
  // One modal at a time: the drawer gives way to the chooser, and Back from the chooser returns to the drawer.
  const onAssignMore = useCallback(() => {
    setChooserFor(selectedStaffId);
    setSelectedStaffId(null);
  }, [selectedStaffId]);
  const closeChooser = useCallback(() => {
    setSelectedStaffId(chooserFor);
    setChooserFor(null);
  }, [chooserFor]);
  const chooserMember = useMemo(() => (chooserFor === null ? null : (model.team ?? []).find((member) => member.userId === chooserFor) ?? null), [model.team, chooserFor]);
  useEffect(() => {
    if (chooserFor !== null && chooserMember === null) setChooserFor(null);
  }, [chooserFor, chooserMember]);
  const chooserRooms = useMemo(() => (chooserMember ? listAssignableRooms(model) : []), [chooserMember, model]);
  const onChooseRoom = useCallback(
    (roomId: string) => {
      const employeeId = chooserFor;
      returnStaffRef.current = employeeId;
      setChooserFor(null);
      setRoomGone(false);
      setSelectedRoomId(roomId);
      if (employeeId && gateRef.current.allowed) assignmentRef.current.openAssign(roomId, { employeeId });
    },
    [chooserFor],
  );
  const onOpenStaffRoom = useCallback(
    (roomId: string) => {
      returnStaffRef.current = selectedStaffId;
      setSelectedStaffId(null);
      onOpenRoom(roomId, "view_assignment");
    },
    [onOpenRoom, selectedStaffId],
  );

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
  const allNotices = useMemo(() => freshnessNotices(model), [model]);
  // The Team tab words the missing-source case itself (see TeamNotices), so the generic one is not repeated there.
  const notices = useMemo(() => (tab === "team" ? allNotices.filter((notice) => notice.kind !== "aux_partial") : allNotices), [allNotices, tab]);
  const detailContext = useMemo(() => detailContextOf(model.board, gate, verifiedClock, live), [model.board, gate, verifiedClock, live]);

  const teamMetrics = useMemo(() => buildTeamHeaderMetrics(model), [model]);
  const teamNoticeList = useMemo(() => teamNotices(model), [model]);
  const teamPreviewCount = useCallback(
    (draft: TeamViewState) => runTeamQuery({ team: model.team ?? [], search: team.search, filters: draft.filters, sort: draft.sort, rosterVerified: team.rosterVerified }).visible.length,
    [model.team, team.search, team.rosterVerified],
  );
  const teamItems = useMemo<ListItem[]>(
    () => team.query.visible.map((member) => ({ type: "member", key: `team:${member.userId}`, member })),
    [team.query.visible],
  );

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
      teamMetrics={teamMetrics}
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
      {selecting ? null : header}
      <DraftIndicator bulk={bulk} t={t} />
      {tab === "rooms" && boardKnown && canPlan && !selecting ? (
        <SmartBalanceEntryCard onPress={smart.open} paused={smart.paused} proposedChanges={smart.plan ? (smart.preview?.counts.planned ?? 0) : null} t={t} />
      ) : null}
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
          {!selecting && anySelectable ? (
            <View style={styles.selectEntry}>
              <Pressable
                onPress={bulk.selection.start}
                accessibilityRole="button"
                accessibilityLabel={t("assignments.v2.bulk.select")}
                accessibilityHint={t("assignments.v2.bulk.selectHint")}
                style={({ pressed }) => [styles.selectButton, { borderColor: theme.primaryAction, backgroundColor: theme.surface }, pressed && { opacity: 0.85 }]}
                testID="bulk-select-rooms"
              >
                <Text maxFontSizeMultiplier={1.6} style={[styles.selectText, { color: theme.primaryAction }]}>
                  {t("assignments.v2.bulk.select")}
                </Text>
              </Pressable>
            </View>
          ) : null}
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

      {tab === "team" && boardKnown ? (
        <>
          <TeamNotices notices={teamNoticeList} onRetry={() => void onRefresh()} t={t} />
          <BoardSearchBar
            value={team.search}
            onChangeText={team.setSearch}
            onClear={team.clearSearch}
            onOpenFilters={() => setTeamFilterOpen(true)}
            activeCount={team.badge}
            t={t}
            placeholder={t("assignments.v2.team.search.placeholder")}
            label={t("assignments.v2.team.search.label")}
            filterLabel={t("assignments.v2.filters.open")}
            testIDPrefix="assignments-team"
          />
          {team.query.searching || team.chips.length > 0 || team.state.sort !== "available" ? (
            <TeamActiveFilters
              chips={team.chips}
              shown={team.query.visible.length}
              total={team.query.total}
              sortLabel={team.state.sort !== "available" ? t(`assignments.v2.team.sort.${team.query.sortUsed}`) : null}
              onRemove={team.removeChip}
              onClearAll={team.clearAll}
              onEdit={() => setTeamFilterOpen(true)}
              t={t}
            />
          ) : null}
          {!(team.query.searching || team.chips.length > 0 || team.state.sort !== "available") && team.query.sortUsed !== team.state.sort ? (
            <Text style={[styles.pausedHint, { color: theme.textMuted }]} testID="assignments-team-sort-label">
              {t("assignments.v2.team.sortFallback")}
            </Text>
          ) : null}
          {team.query.visible.length > 0 ? <ListCaption title={t("assignments.v2.team.listTitle")} sort={t(`assignments.v2.team.sort.${team.query.sortUsed}`)} /> : null}
        </>
      ) : null}
    </View>
  );

  const teamEmpty = tab === "team" ? teamEmptyKind(model, team.query.emptyReason) : null;
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
    ) : tab === "team" && teamEmpty ? (
      <TeamEmpty
        kind={teamEmpty}
        t={t}
        searchText={team.search.trim()}
        unavailableKey={unavailableKey}
        offline={availability.kind === "unavailable" && availability.cause === "offline"}
        onRefresh={() => void onRefresh()}
        onClearSearch={team.clearSearch}
        onClearFilters={team.clearAll}
      />
    ) : null;

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === "member") {
      const card = team.cards.get(item.member.userId);
      const proposed = bulk.proposedByUser.get(item.member.userId);
      return card ? (
        <View style={styles.rowWrap}>
          <TeamStaffCard model={card} onOpen={onOpenStaff} t={t} {...(proposed ? { proposedText: proposedLoadLine(proposed.proposed, t) } : {})} />
        </View>
      ) : null;
    }
    if (item.type === "section") return <SectionHeader section={item.section} count={item.count} t={t} />;
    const card = cards.get(item.entry.room.roomId);
    if (selecting && card) {
      const change = bulk.draft.draft?.changes[item.entry.room.roomId];
      const draftOwnerName = change ? (change.toUserId ? bulk.nameOf(change.toUserId) : null) : undefined;
      return (
        <View style={styles.rowWrap}>
          <SelectableRoomRow model={buildSelectionRow(item.entry, card, { selected: bulk.selection.selected.has(item.entry.room.roomId), draftOwnerName }, t)} onToggle={onToggleBulk} />
        </View>
      );
    }
    return card ? (
      <View style={styles.rowWrap}>
        <AssignmentRoomCard model={card} onOpen={onOpenRoom} />
      </View>
    ) : null;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {selecting ? <BulkSelectionBar selection={bulk.selection} topInset={insets.top} t={t} /> : null}
      <FlatList
        data={boardKnown ? (tab === "rooms" ? items : teamItems) : []}
        extraData={selecting ? bulk.selection.selected : null}
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

      {selecting ? (
        <BulkActionFooter
          bulk={bulk}
          bottomInset={insets.bottom}
          t={t}
          {...(canPlan
            ? {
                onSmartBalance: () => {
                  smart.setScope("selected");
                  smart.open();
                },
              }
            : {})}
        />
      ) : null}
      <BulkAssignHost bulk={bulk} onViewTeam={viewTeam} />
      <SmartBalanceHost
        smart={smart}
        model={model}
        dateLabel={boardKnown ? operationalDateLabel(model, language) : null}
        onRefresh={() => void onRefresh()}
        onViewRoom={(roomId) => {
          smart.close();
          onOpenRoom(roomId, "view_assignment");
        }}
        onViewStaff={(userId) => {
          smart.close();
          setTab("team");
          onOpenStaff(userId);
        }}
        toast={toast.info}
      />

      {selectedEntry ? (
        <AssignmentRoomSheet
          entry={selectedEntry}
          context={detailContext}
          assignment={assignment}
          outOfView={!query.visible.some((entry) => entry.room.roomId === selectedEntry.room.roomId)}
          onClose={closeSheet}
          onOpenBoard={openBoard}
        />
      ) : null}
      {staffDetail ? (
        <StaffDetailSheet
          detail={staffDetail}
          t={t}
          onClose={() => setSelectedStaffId(null)}
          onOpenRoom={onOpenStaffRoom}
          {...(selectedMember?.listed ? { onAssignMore } : {})}
          assignPaused={!gate.allowed || !isOnline}
        />
      ) : null}
      {chooserMember ? (
        <AssignRoomChooserSheet
          personName={chooserMember.name ?? t("assignments.v2.assign.unnamed")}
          rooms={chooserRooms}
          t={t}
          onChoose={onChooseRoom}
          onClose={closeChooser}
        />
      ) : null}

      <TeamFilterSheet
        visible={teamFilterOpen}
        applied={team.state}
        options={team.options}
        rosterVerified={team.rosterVerified}
        previewCount={teamPreviewCount}
        t={t}
        onApply={(draft) => {
          team.applyState(draft);
          setTeamFilterOpen(false);
        }}
        onClose={() => setTeamFilterOpen(false)}
      />

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
  selectEntry: { paddingHorizontal: 16, paddingBottom: 8, alignItems: "flex-start" },
  selectButton: { minHeight: 48, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  selectText: { fontSize: 15, fontWeight: "800" },
});
