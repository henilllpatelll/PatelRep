import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/stores/appStore";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { isAssistantRole } from "@/lib/ai/fab";
import { StateBlock } from "@/components/ui/StateBlock";
import { CurrentRoomCard } from "@/components/home/CurrentRoomCard";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeServiceSheets, type HomeServiceGo } from "@/components/home/HomeServiceSheets";
import { HomeSheetHost, useHomeSheet, type HomeSheetGo } from "@/components/home/HomeSheetHost";
import {
  AllHandledCard,
  BeforeShiftState,
  ClockedOutState,
  ConnectionNoticeBanner,
  DataUnavailableState,
  NoAssignmentsState,
  OnBreakState,
  ShiftStartNudge,
  SubmissionBanner,
} from "@/components/home/HomeStateCards";
import { LinkButton, MAX_FONT_SCALE } from "@/components/home/homeUi";
import { NeedsAttentionPreview } from "@/components/home/NeedsAttentionPreview";
import { ShiftControlCard } from "@/components/home/ShiftControlCard";
import { ShiftProgressSummary } from "@/components/home/ShiftProgressSummary";
import { UpNextPreview } from "@/components/home/UpNextPreview";
import { attentionAction } from "@/lib/housekeeping/homeAttention";
import {
  buildAttentionPreview,
  canQuickMarkClean,
  leadOf,
  progressCounts,
  resolveHomeState,
  selectUpNext,
  submissionFor,
  type AttentionPreviewItem,
  type HomeDestinations,
} from "@/lib/housekeeping/homeState";
import { dayPartOf, describeSync, firstNameOf, headerMeta, shiftStatusLine } from "@/lib/housekeeping/homeText";
import { displayNameFor } from "@/lib/settings/displayName";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { setLastTab } from "@/lib/housekeeping/myRoomsDashboard";
import { useHousekeeperHome } from "@/lib/housekeeping/useHousekeeperHome";
import { briefingCacheKey, publishLocalBriefing } from "@/lib/ai/shiftBriefingSource";
import { nextRoomFromRecommendation } from "@/lib/ai/nextRoom";
import { buildBriefingFromModel, restrictedRoomNumbers } from "@/lib/housekeeping/homeBriefing";
import { useShiftBriefing } from "@/lib/housekeeping/useShiftBriefing";
import { resolveAssistantLanguage, useAiPreferences } from "@/lib/ai/preferences";
import { summaryFingerprint } from "@/lib/ai/shiftRecap";
import { buildShiftSummary } from "@/lib/housekeeping/shiftSummary";
import { useShiftRecap } from "@/lib/housekeeping/useShiftRecap";
import { useSyncRun } from "@/lib/housekeeping/useSyncRun";
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
 * out the cards for whichever of the nine states applies. Marking a room clean,
 * finishing the shift, sync status, the shift summary and the AI briefing are
 * drawers opened from here, one at a time.
 */
export function HousekeeperHome({ enabled, destinations }: Props) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user, isOnline, setMyRooms, refreshRooms } = useAppStore();
  const lastSyncedAt = useAppStore((state) => state.lastSyncedAt) ?? null;
  const unreadCount = useAppStore((state) => state.unreadCount) ?? 0;
  const assistant = useAssistantOptional();
  const home = useHousekeeperHome({ enabled });
  const { model, rooms, shift, markSupervisorNoteRead, refresh: refreshHome } = home;
  const { lifecycle } = model;
  const language: "en" | "es" = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("es") ? "es" : "en";
  const ctx = useMemo(() => ({ language, timeZone: model.timeZone }), [language, model.timeZone]);
  const scope = user ? `${user.tenant_id}:${user.id}` : null;

  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [dismissedSubmission, setDismissedSubmission] = useState<string | null>(null);
  const sheets = useHomeSheet();

  // Paid AI is opt-in: both hooks only ever act on an explicit request from a drawer.
  const briefing = useShiftBriefing({ scope, shiftDate: model.shiftDate, language, rooms, isOnline, t });
  const recapFingerprint = useMemo(() => summaryFingerprint(buildShiftSummary(model, new Date())), [model]);
  // The recap sentence is requested in the person's AI-language choice; the screen itself stays in the app language.
  const assistantLanguage = useAiPreferences((state) => state.assistantLanguage);
  const recapLanguage = resolveAssistantLanguage({ assistantLanguage }, language);
  const recap = useShiftRecap({ scope, shiftDate: model.shiftDate, language: recapLanguage, fingerprint: recapFingerprint, isOnline });
  const syncRun = useSyncRun(refreshHome);

  // The floating assistant shows this same briefing (read-only): publish the authoritative,
  // deterministic one so it can never differ from Home or cost a credit.
  useEffect(() => {
    if (!scope) return;
    publishLocalBriefing({
      key: briefingCacheKey(scope, model.shiftDate, language),
      local: buildBriefingFromModel(model, t),
      knownRooms: model.dashboard.all.map((entry) => entry.room.room_number),
      restrictedRooms: restrictedRoomNumbers(model),
      nextRoom: nextRoomFromRecommendation(leadOf(model), t, ctx),
    });
  }, [scope, model, language, t, ctx]);

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
  const openAttentionCenter = useCallback(() => navigate("/(app)/attention"), [navigate]);
  const openSync = useCallback(() => sheets.open({ kind: "sync" }), [sheets]);
  const openAttentionItem = useCallback(
    (row: AttentionPreviewItem) => {
      const { target } = attentionAction(row.item);
      if (target.type === "room") openRoom(target.roomId);
      else if (target.type === "details") sheets.open({ kind: "issue", itemId: row.item.id });
      else if (target.type === "message") sheets.open({ kind: "message" });
      else openMyRooms();
    },
    [openRoom, openMyRooms, sheets],
  );

  // Marking read is the only write the server supports for a message; a failure keeps it unread and says so.
  const handleMarkNoteRead = useCallback(async () => {
    const result = await markSupervisorNoteRead();
    if (!result.ok) toast.error(t(result.reason === "offline" ? "home.message.offline" : "home.message.failed"));
  }, [markSupervisorNoteRead, toast, t]);

  const go = useMemo<HomeSheetGo>(
    () => ({
      openRoom,
      roomAction: (roomId, action) => navigate(`/(app)/my-rooms/${roomId}?action=${action}&from=home`),
      openWorkOrder: (woId) => navigate(`/(app)/work-orders/${woId}`),
      openMyRooms,
      openProcedure: (documentId) => navigate(`/(app)/sop/${documentId}`),
      askAboutRoom:
        assistant && isAssistantRole(user?.effective_role ?? user?.role)
          ? (roomId, roomNumber, live) =>
              assistant.openAssistant({ contextType: live ? "cleaningSession" : "room", entityId: roomId, label: roomNumber })
          : undefined,
      openLink: (link) => {
        if (link.kind === "room") openRoom(link.roomId);
        else if (link.kind === "schedule") router.push({ pathname: link.target.pathname, params: link.target.params } as never);
        else router.push({ pathname: "/(app)/tasks", params: { taskId: link.taskId } } as never);
      },
    }),
    [navigate, openRoom, openMyRooms, assistant, user?.effective_role, user?.role],
  );
  const serviceGo = useMemo<HomeServiceGo>(
    () => ({
      openRoom,
      openWorkOrder: (woId) => navigate(`/(app)/work-orders/${woId}`),
      openTasks: () => navigate("/(app)/tasks"),
      openLostFound: () => navigate("/(app)/lost-found"),
      // The shared assistant, about the shift: the same conversation the floating button opens, and no second briefing request.
      openCopilot: () => (assistant ? assistant.openAssistant({ contextType: "shift" }) : navigate("/(app)/copilot")),
    }),
    [navigate, openRoom, assistant],
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
  const showWork = WORK_KINDS.has(view.kind);

  // Quick Mark Clean opens the protected confirmation; the sheet re-checks everything when it opens and again when confirming.
  const handleMarkClean = useCallback(() => {
    if (model.activeRoom && canQuickMarkClean(model)) sheets.open({ kind: "markClean", roomId: model.activeRoom.room.id });
  }, [model, sheets]);

  // The server confirmed the completion: show it now, then let the next refresh settle the rest.
  const handleRoomConfirmed = useCallback(
    (roomId: string) => {
      const updatedAt = new Date().toISOString();
      setMyRooms(useAppStore.getState().myRooms.map((r) => (r.id === roomId ? { ...r, status: "CLEAN", updated_at: updatedAt } : r)));
      void refreshRooms();
    },
    [setMyRooms, refreshRooms],
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

  const name = firstNameOf(displayNameFor(user)) ?? t("home.header.fallbackName");
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
        onMore={(roomId, opener) => sheets.open({ kind: "roomActions", roomId }, opener)}
        onWhy={(roomId, opener) => sheets.open({ kind: "why", roomId }, opener)}
      />
    ) : null;

  const progressCard = (
    <ShiftProgressSummary
      progress={model.progress}
      counts={counts}
      t={t}
      onViewDetails={destinations?.progressDetails ? destinations.progressDetails : (opener) => sheets.open({ kind: "progress" }, opener)}
    />
  );
  const attentionCard = (
    <NeedsAttentionPreview
      preview={preview}
      note={model.supervisorInstruction}
      t={t}
      ctx={ctx}
      onOpenItem={openAttentionItem}
      onViewAll={destinations?.attentionCenter ?? openAttentionCenter}
      onMarkNoteRead={() => void handleMarkNoteRead()}
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
          onOpenSync={openSync}
        />

        <View style={styles.body}>
          {view.notice ? <ConnectionNoticeBanner notice={view.notice} t={t} ctx={ctx} onOpenSync={openSync} /> : null}

          {view.kind === "unavailable" ? (
            <DataUnavailableState t={t} offline={!isOnline} retrying={refreshing} onRetry={() => void onRefresh()} />
          ) : null}

          {view.kind === "before_shift" ? (
            <BeforeShiftState
              model={model}
              t={t}
              onStart={() => void handleStartShift()}
              onReview={openMyRooms}
              onMarkNoteRead={() => void handleMarkNoteRead()}
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
              onViewSummary={() => sheets.open({ kind: "summary" })}
              onViewRooms={openCompletedRooms}
              onStartNew={() => void handleStartShift()}
              onOpenSync={openSync}
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
                  onFinish={() => sheets.open({ kind: "finishShift" })}
                />
              ) : null}
              {view.startNudge ? <ShiftStartNudge model={model} t={t} onStart={() => void handleStartShift()} /> : null}

              {view.kind === "submitted" && submission && submissionKey !== dismissedSubmission ? (
                <SubmissionBanner
                  submission={submission}
                  t={t}
                  onDismiss={() => setDismissedSubmission(submissionKey)}
                  onOpenSync={openSync}
                />
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
                  <AllHandledCard model={model} t={t} onReview={() => sheets.open({ kind: "finishShift" })} />
                </>
              ) : (
                <>
                  {leadCard}
                  {progressCard}
                  {attentionCard}
                </>
              )}

              {upNext ? (
                <UpNextPreview
                  entry={upNext}
                  t={t}
                  ctx={ctx}
                  onOpenRoom={openRoom}
                  onViewRoute={openMyRooms}
                  onWhy={(roomId, opener) => sheets.open({ kind: "why", roomId }, opener)}
                />
              ) : null}
            </>
          ) : null}

          {/* A quiet, optional extra: the plan lives in a drawer, never in competition with the room to clean. */}
          {showWork && !view.allDone && rooms.length > 0 ? (
            <LinkButton
              label={t("home.briefing.open")}
              icon="sparkles-outline"
              onPress={() => sheets.open({ kind: "briefing" })}
              testID="briefing-open"
            />
          ) : null}
        </View>
      </ScrollView>

      <HomeSheetHost
        model={model}
        sheet={sheets.sheet}
        visible={sheets.visible}
        onClose={sheets.close}
        role={user?.role}
        isOnline={isOnline}
        pendingCount={model.sync.pending}
        language={language}
        t={t}
        ctx={ctx}
        go={go}
        markNoteRead={markSupervisorNoteRead}
      />
      <HomeServiceSheets
        model={model}
        sheet={sheets.sheet}
        visible={sheets.visible}
        epoch={sheets.epoch}
        onClose={sheets.close}
        onOpenSheet={sheets.open}
        isOnline={isOnline}
        language={language}
        userId={user?.id}
        lastSyncedAt={lastSyncedAt}
        t={t}
        ctx={ctx}
        go={serviceGo}
        shift={shift}
        briefing={briefing}
        recap={recap}
        syncRun={syncRun}
        onRoomConfirmed={handleRoomConfirmed}
      />
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
});
