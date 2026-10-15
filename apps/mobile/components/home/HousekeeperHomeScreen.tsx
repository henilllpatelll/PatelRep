import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, type Room } from "@/stores/appStore";
import { AIBriefingCard } from "@/components/shared/evening";
import { StateBlock } from "@/components/ui/StateBlock";
import { Button } from "@/components/ui/Button";
import { CurrentRoomCard } from "@/components/home/CurrentRoomCard";
import { EndOfShiftState } from "@/components/home/EndOfShiftState";
import HoldToConfirmSheet from "@/components/home/HoldToConfirmSheet";
import { HomeHeader } from "@/components/home/HomeHeader";
import {
  BeforeShiftState,
  ClockedOutState,
  ConnectionNoticeBanner,
  DataUnavailableState,
  NoAssignmentsState,
  OnBreakState,
  ShiftStartNudge,
  SubmissionBanner,
} from "@/components/home/HomeStateCards";
import { LinkButton, MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { NeedsAttentionPreview } from "@/components/home/NeedsAttentionPreview";
import { ShiftControlCard } from "@/components/home/ShiftControlCard";
import { ShiftProgressSummary } from "@/components/home/ShiftProgressSummary";
import { UpNextPreview } from "@/components/home/UpNextPreview";
import { fetchShiftBriefing, type ShiftBriefing } from "@/lib/ai/briefing";
import { fetchShiftRecap, type ShiftRecap } from "@/lib/ai/shiftRecap";
import { getCompanionCheckin, snapshotFromDashboard } from "@/lib/ai/companion";
import { listItems, type LostFoundItem } from "@/lib/api/lostFound";
import { elapsedSeconds } from "@/lib/housekeeping/cleaningTimer";
import { buildBriefingFromModel, reconcileBriefing } from "@/lib/housekeeping/homeBriefing";
import {
  buildAttentionPreview,
  canQuickMarkClean,
  progressCounts,
  resolveHomeState,
  selectUpNext,
  submissionFor,
  type AttentionPreviewItem,
  type HomeDestinations,
} from "@/lib/housekeeping/homeState";
import {
  dayPartOf,
  describeSync,
  firstNameOf,
  headerMeta,
  shiftStatusLine,
} from "@/lib/housekeeping/homeText";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { setLastTab } from "@/lib/housekeeping/myRoomsDashboard";
import { workedSeconds } from "@/lib/housekeeping/shiftLifecycle";
import { useHousekeeperHome } from "@/lib/housekeeping/useHousekeeperHome";
import { localDate } from "@/lib/utils/date";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

const WORK_KINDS = new Set(["cleaning", "idle", "submitted", "attention"]);
/** A second tap on the same navigation inside this window is ignored. */
const NAV_GUARD_MS = 600;

interface Props {
  enabled: boolean;
  /** Optional upgraded destinations (Phase 3 sheets). Absent ones fall back to existing routes. */
  destinations?: HomeDestinations;
}

/**
 * The housekeeper's "My Shift" Home. Everything it shows comes from the shared
 * HomeModel (via resolveHomeState); this component only wires actions and lays
 * out the cards for whichever of the nine states applies.
 */
export function HousekeeperHome({ enabled, destinations }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user, isOnline, myRooms, setMyRooms, refreshRooms } = useAppStore();
  const unreadCount = useAppStore((state) => state.unreadCount) ?? 0;
  const home = useHousekeeperHome({ enabled });
  const { model, data, rooms, shift, acknowledgeSupervisorNote, refresh: refreshHome } = home;
  const { lifecycle } = model;
  const language: "en" | "es" = user?.language_pref === "es" ? "es" : "en";
  const locale = language === "es" ? "es-MX" : "en-US";
  const ctx = useMemo(() => ({ language, timeZone: model.timeZone }), [language, model.timeZone]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [aiBriefing, setAiBriefing] = useState<ShiftBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [holdConfirmRoom, setHoldConfirmRoom] = useState<Room | null>(null);
  const [shiftRecap, setShiftRecap] = useState<ShiftRecap | null>(null);
  const [shiftRecapLoading, setShiftRecapLoading] = useState(false);
  const [todaysFoundItems, setTodaysFoundItems] = useState<LostFoundItem[]>([]);
  const [dismissedSubmission, setDismissedSubmission] = useState<string | null>(null);

  // Refresh room counts and the shift when navigating back from the room detail screen
  // so Home reflects the latest status immediately. Reads only — never starts a shift.
  const { refresh: refreshShift } = shift;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void refreshRooms();
      void refreshShift();
    }, [enabled, refreshRooms, refreshShift]),
  );

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refreshHome();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refreshHome]);

  /* ─── Navigation (one tap, one navigation) ─────────────────────────────── */

  const lastNav = useRef(0);
  const navigate = useCallback((path: string) => {
    const now = Date.now();
    if (now - lastNav.current < NAV_GUARD_MS) return;
    lastNav.current = now;
    router.push(path as never);
  }, []);
  const openRoom = useCallback((roomId: string) => navigate(`/(app)/my-rooms/${roomId}`), [navigate]);
  const openMyRooms = useCallback(() => navigate("/(app)/my-rooms"), [navigate]);
  const openNotifications = useCallback(() => navigate("/(app)/notifications"), [navigate]);
  const openCompletedRooms = useCallback(() => {
    setLastTab("done");
    navigate("/(app)/my-rooms");
  }, [navigate]);
  const openAttentionItem = useCallback(
    (row: AttentionPreviewItem) => {
      const destination = row.item.destination;
      if (destination.route === "room") openRoom(destination.roomId);
      else if (destination.route === "notification") openNotifications();
      else openMyRooms();
    },
    [openRoom, openNotifications, openMyRooms],
  );

  /* ─── Derived view ─────────────────────────────────────────────────────── */

  const view = useMemo(() => resolveHomeState(model), [model]);
  const counts = useMemo(() => progressCounts(model), [model]);
  const upNext = useMemo(() => (WORK_KINDS.has(view.kind) ? selectUpNext(model, view.lead) : null), [model, view]);
  const preview = useMemo(() => {
    const onScreen = new Set<string>();
    if (view.lead) onScreen.add(view.lead.room.id);
    if (upNext) onScreen.add(upNext.room.id);
    return buildAttentionPreview(model, undefined, onScreen);
  }, [model, view.lead, upNext]);
  const submission = useMemo(() => submissionFor(model), [model]);
  const snapshot = useMemo(() => snapshotFromDashboard(model.dashboard, locale), [model.dashboard, locale]);
  const companionCheckin = useMemo(() => getCompanionCheckin(snapshot, t), [snapshot, t]);
  const showWork = WORK_KINDS.has(view.kind);

  const localBriefing = useMemo(
    () => (rooms.length > 0 ? buildBriefingFromModel(model, t) : null),
    [rooms.length, model, t],
  );
  const briefing = aiBriefing && localBriefing ? reconcileBriefing(aiBriefing, localBriefing) : localBriefing;

  // Fires once per shift when the board clears — fetch-with-local-fallback for the end-of-shift recap.
  useEffect(() => {
    if (!view.allDone || shiftRecap || shiftRecapLoading || rooms.length === 0) return;
    setShiftRecapLoading(true);
    void fetchShiftRecap(rooms, language, t, isOnline).then((result) => {
      setShiftRecap(result);
      setShiftRecapLoading(false);
    });
  }, [view.allDone, shiftRecap, shiftRecapLoading, rooms, language, t, isOnline]);

  // Real "before you clock out" signals: today's lost & found items this housekeeper logged.
  useEffect(() => {
    if (!view.allDone || !isOnline || !user?.id) return;
    listItems()
      .then((res) => {
        const today = localDate();
        setTodaysFoundItems(
          (res.data ?? []).filter(
            (item) => item.found_by === user.id && (item.created_at ?? "").slice(0, 10) === today,
          ),
        );
      })
      .catch(() => {});
  }, [view.allDone, isOnline, user?.id]);

  const shiftDurationLabel = useMemo(() => {
    const worked = workedSeconds(lifecycle, new Date());
    if (worked === null) return null;
    const totalMinutes = Math.max(0, Math.round(worked / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }, [lifecycle]);

  const nextUpEntry = useMemo(() => {
    const next = upNext ?? model.dashboard.upNext[0];
    if (!next) return null;
    return { room: next.room, position: 1, estimateMinutes: next.estimateMinutes, etaMinutes: next.estimateMinutes };
  }, [upNext, model.dashboard.upNext]);

  // Snapshotted when the sheet opens rather than ticking live. Derived from the verified session start.
  const holdConfirmElapsedSec = useMemo(() => {
    if (!holdConfirmRoom) return null;
    const active = model.activeRoom;
    if (!active || active.room.id !== holdConfirmRoom.id) return null;
    return elapsedSeconds(active.startedAt, Date.now());
  }, [holdConfirmRoom, model.activeRoom]);

  const handleMarkClean = useCallback(() => {
    if (model.activeRoom && canQuickMarkClean(model)) setHoldConfirmRoom(model.activeRoom.room);
  }, [model]);

  const handleRoomConfirmed = useCallback(
    (roomId: string) => {
      setHoldConfirmRoom(null);
      const updatedAt = new Date().toISOString();
      setMyRooms(myRooms.map((r) => (r.id === roomId ? { ...r, status: "CLEAN", updated_at: updatedAt } : r)));
      void refreshRooms();
    },
    [myRooms, setMyRooms, refreshRooms],
  );

  /* ─── Shift actions ────────────────────────────────────────────────────── */

  const reportShiftResult = useCallback(
    (result: Awaited<ReturnType<typeof shift.start>>, failureKey: string) => {
      if (result.ok) return;
      if (result.reason === "offline") toast.error(t("home.shift.needsConnection"));
      else if (result.reason === "failed") toast.error(t(failureKey));
    },
    [toast, t],
  );
  const handleStartShift = useCallback(async () => {
    reportShiftResult(await shift.start(), "home.shift.actionFailed");
  }, [shift, reportShiftResult]);
  const handleBreak = useCallback(
    async (action: "start" | "end") => {
      reportShiftResult(await (action === "start" ? shift.startBreak() : shift.endBreak()), "home.shift.actionFailed");
    },
    [shift, reportShiftResult],
  );
  // Clock-out is claimed only after the server confirms; a second tap shares the first request.
  const handleClockOut = useCallback(async () => {
    reportShiftResult(await shift.end(), "home.endOfShift.clockOutFailed");
  }, [shift, reportShiftResult]);

  const requestAiBriefing = useCallback(async () => {
    if (briefingLoading || rooms.length === 0) return;
    setBriefingLoading(true);
    const result = await fetchShiftBriefing(rooms, language, t, isOnline);
    setAiBriefing(result);
    setBriefingLoading(false);
  }, [briefingLoading, rooms, language, t, isOnline]);

  /* ─── Render ───────────────────────────────────────────────────────────── */

  if (view.kind === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]} testID="home-loading">
        <StateBlock status="loading" />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.loadingText, { color: theme.textMuted }]}>
          {t("home.board.updatingDay")}
        </Text>
      </View>
    );
  }

  const name = firstNameOf(user?.full_name) ?? t("home.header.fallbackName");
  const dayPart = dayPartOf(model.timeZone, new Date());
  const greetingKey = dayPart === "morning" ? "home.greetingMorning" : dayPart === "afternoon" ? "home.greetingAfternoon" : "home.greetingEvening";
  const lastCheckedLabel = formatClock(model.board.lastRefreshAt, ctx);
  const submissionKey = submission ? `${submission.roomId}:${submission.at}:${submission.confirmed}` : null;

  const leadCard =
    showWork && (model.activeRoom && !model.activeRoom.completing ? true : Boolean(view.lead)) ? (
      <CurrentRoomCard
        active={model.activeRoom && !model.activeRoom.completing ? model.activeRoom : null}
        recommendation={view.lead}
        canMarkClean={canQuickMarkClean(model)}
        t={t}
        ctx={ctx}
        onOpenRoom={openRoom}
        onMarkClean={handleMarkClean}
      />
    ) : null;

  const progressCard = (
    <ShiftProgressSummary progress={model.progress} counts={counts} t={t} onViewDetails={destinations?.progressDetails} />
  );
  const attentionCard = (
    <NeedsAttentionPreview
      preview={preview}
      note={model.supervisorInstruction}
      t={t}
      ctx={ctx}
      onOpenItem={openAttentionItem}
      onViewAll={destinations?.attentionCenter ?? openMyRooms}
      onAcknowledgeNote={() => void acknowledgeSupervisorNote()}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} />}
        testID="home-scroll"
      >
        <HomeHeader
          meta={headerMeta(model, language, dayPart, t)}
          greeting={t(greetingKey, { name })}
          status={shiftStatusLine(lifecycle.state, t)}
          sync={describeSync(model, t, ctx)}
          unreadCount={unreadCount}
          topInset={insets.top}
          t={t}
          onOpenNotifications={openNotifications}
        />

        <View style={styles.body}>
          {view.notice ? <ConnectionNoticeBanner notice={view.notice} t={t} ctx={ctx} /> : null}

          {view.kind === "unavailable" ? (
            <DataUnavailableState t={t} offline={!isOnline} retrying={refreshing} onRetry={() => void onRefresh()} />
          ) : null}

          {view.kind === "before_shift" ? (
            <BeforeShiftState
              model={model}
              t={t}
              onStart={() => void handleStartShift()}
              onReview={openMyRooms}
              onAcknowledgeNote={() => void acknowledgeSupervisorNote()}
            />
          ) : null}

          {view.kind === "on_break" ? (
            <OnBreakState model={model} t={t} ctx={ctx} onResume={() => void handleBreak("end")} />
          ) : null}

          {view.kind === "clocked_out" ? (
            <ClockedOutState
              model={model}
              t={t}
              ctx={ctx}
              onViewRooms={openCompletedRooms}
              onStartNew={() => void handleStartShift()}
            />
          ) : null}

          {view.kind === "no_assignments" ? (
            <>
              <NoAssignmentsState
                t={t}
                refreshing={refreshing}
                lastCheckedLabel={lastCheckedLabel}
                onRefresh={() => void onRefresh()}
                onOpenMyRooms={openMyRooms}
              />
              {view.startNudge ? <ShiftStartNudge model={model} t={t} onStart={() => void handleStartShift()} /> : null}
            </>
          ) : null}

          {showWork ? (
            <>
              {lifecycle.state === "active" || lifecycle.state === "unknown" || lifecycle.state === "ending" ? (
                <ShiftControlCard
                  lifecycle={lifecycle}
                  timeZone={model.timeZone}
                  language={language}
                  t={t}
                  onStartBreak={() => void handleBreak("start")}
                  onRetry={() => void shift.refresh()}
                />
              ) : null}
              {view.startNudge ? <ShiftStartNudge model={model} t={t} onStart={() => void handleStartShift()} /> : null}

              {view.kind === "submitted" && submission && submissionKey !== dismissedSubmission ? (
                <SubmissionBanner submission={submission} t={t} onDismiss={() => setDismissedSubmission(submissionKey)} />
              ) : null}

              {view.kind === "attention" ? (
                <>
                  {attentionCard}
                  {leadCard}
                  {progressCard}
                </>
              ) : view.allDone ? (
                <>
                  {attentionCard}
                  <EndOfShiftState
                    message={companionCheckin.message}
                    subMessage={t("home.allDone")}
                    roomsCleanedLabel={t("home.endOfShift.roomsCompleted", { count: model.progress.completed })}
                    shiftDurationLabel={
                      shiftDurationLabel ? t("home.endOfShift.shiftDuration", { duration: shiftDurationLabel }) : null
                    }
                    clockOutLabel={t("home.endOfShift.clockOut")}
                    clockedOutLabel={t("home.endOfShift.clockedOut")}
                    clockedOut={lifecycle.state === "ended"}
                    clockingOut={lifecycle.state === "ending"}
                    canClockOut={lifecycle.canEnd || lifecycle.state === "ending"}
                    clockOutHint={
                      !isOnline && lifecycle.state !== "ended" && lifecycle.state !== "ending"
                        ? t("home.endOfShift.needsConnection")
                        : null
                    }
                    onClockOut={() => void handleClockOut()}
                    aiRecap={shiftRecap}
                    aiRecapLoading={shiftRecapLoading}
                    aiRecapKicker={t("home.endOfShift.recapKicker")}
                    aiRecapFootNoteAi={t("ai.briefing.sourceAi")}
                    aiRecapFootNoteLocal={t("ai.briefing.sourceLocal")}
                    handoffRooms={model.endOfShift.handoffs.map((handoff) => ({
                      roomNumber: handoff.roomNumber,
                      workOrderId: handoff.workOrderId,
                      title: handoff.title,
                    }))}
                    foundItemsCount={todaysFoundItems.length}
                    onOpenWorkOrder={(workOrderId) =>
                      router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId: workOrderId } } as never)
                    }
                    onOpenLostFound={() => navigate("/(app)/lost-found")}
                    beforeClockOutLabel={t("home.endOfShift.beforeClockOut")}
                    handoffLabel={(room) =>
                      t("home.endOfShift.handoff", {
                        room: room.roomNumber,
                        title: room.title ?? t("home.endOfShift.handoffGeneric"),
                      })
                    }
                    foundItemsLabel={(count) => t("home.endOfShift.foundItems", { count })}
                  />
                </>
              ) : (
                <>
                  {leadCard}
                  {progressCard}
                  {attentionCard}
                </>
              )}

              {upNext ? (
                <UpNextPreview entry={upNext} t={t} ctx={ctx} onOpenRoom={openRoom} onViewRoute={openMyRooms} />
              ) : null}

              {briefing && !view.allDone ? (
                <View style={styles.briefing}>
                  <LinkButton
                    label={t(briefingOpen ? "home.briefing.hide" : "home.briefing.show")}
                    icon={briefingOpen ? "chevron-up" : "sparkles-outline"}
                    expanded={briefingOpen}
                    onPress={() => setBriefingOpen((open) => !open)}
                    testID="briefing-toggle"
                  />
                  {briefingOpen ? (
                    <AIBriefingCard
                      kicker={t("ai.briefing.kicker")}
                      headline={briefing.headline}
                      planLabel={t("ai.briefing.planLabel")}
                      plan={briefing.plan}
                      watchouts={briefing.watchouts}
                      loading={briefingLoading}
                      footNote={`${briefing.source === "ai" ? t("ai.briefing.sourceAi") : t("ai.briefing.sourceLocal")} · ${t("ai.briefing.estTotal", { minutes: briefing.estimatedMinutes })}`}
                    >
                      <View style={styles.briefingActions}>
                        <Button
                          label={t("ai.briefing.refresh")}
                          onPress={() => void requestAiBriefing()}
                          variant="secondary"
                          size="sm"
                          icon="sparkles"
                          loading={briefingLoading}
                          testID="briefing-refresh"
                        />
                        <Button
                          label={t("home.askAI")}
                          onPress={() => navigate("/(app)/copilot")}
                          variant="secondary"
                          size="sm"
                          testID="briefing-ask-ai"
                        />
                      </View>
                    </AIBriefingCard>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      {holdConfirmRoom ? (
        <HoldToConfirmSheet
          visible
          room={holdConfirmRoom}
          elapsedSec={holdConfirmElapsedSec}
          nextUp={nextUpEntry && nextUpEntry.room.id !== holdConfirmRoom.id ? nextUpEntry : null}
          onClose={() => setHoldConfirmRoom(null)}
          onConfirmed={handleRoomConfirmed}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 13 },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  body: { paddingHorizontal: 18, paddingTop: 10, gap: 14 },
  briefing: { gap: 8 },
  briefingActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, minHeight: MIN_TARGET - 4 },
});
