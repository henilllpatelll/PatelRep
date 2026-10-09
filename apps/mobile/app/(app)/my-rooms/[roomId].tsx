import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { useAppStore, type Room } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import type { StatusKey } from "@/components/ui/StatusBadge";
import { StateBlock } from "@/components/ui/StateBlock";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";
import SupplyRequestModal from "@/components/housekeeping/SupplyRequestModal";
import KnockModal from "@/components/housekeeping/KnockModal";
import SessionStatusBanner from "@/components/housekeeping/SessionStatusBanner";
import { ActiveCleaningView } from "@/components/housekeeping/roomDetail/ActiveCleaningView";
import { BeforeCleaningView } from "@/components/housekeeping/roomDetail/BeforeCleaningView";
import { CompleteCleaningSheet } from "@/components/housekeeping/roomDetail/CompleteCleaningSheet";
import { NeedsAttentionView } from "@/components/housekeeping/roomDetail/NeedsAttentionView";
import { ReadyRoomView } from "@/components/housekeeping/roomDetail/ReadyRoomView";
import { LinenExchangeSheet } from "@/components/housekeeping/roomDetail/LinenExchange";
import { ReportMoreSheet, type ReportTarget } from "@/components/housekeeping/roomDetail/ReportMoreSheet";
import { RoomFlagsSheet } from "@/components/housekeeping/roomDetail/RoomFlagsSheet";
import { RoomNoteSheet } from "@/components/housekeeping/roomDetail/RoomNoteSheet";
import { ServiceExceptionSheet } from "@/components/housekeeping/roomDetail/ServiceExceptionSheet";
import { SyncDetailsSheet } from "@/components/housekeeping/roomDetail/SyncDetailsSheet";
import { RoomDetailHeader } from "@/components/housekeeping/roomDetail/RoomDetailHeader";
import { RoomInformationSheet } from "@/components/housekeeping/roomDetail/RoomInformationSheet";
import { RoomStickyActions } from "@/components/housekeeping/roomDetail/RoomStickyActions";
import { SubmittedRoomView } from "@/components/housekeeping/roomDetail/SubmittedRoomView";
import { UnavailableRoomView } from "@/components/housekeeping/roomDetail/UnavailableRoomView";
import { RoomRestrictionPanel, hasRestrictionPanel } from "@/components/housekeeping/RoomRestrictionPanel";
import { classifyRoom } from "@/lib/housekeeping/needsAttention";
import { cleanTypeLabel, locationLabel, type Translate } from "@/lib/housekeeping/myRoomsText";
import { useRoomExceptions } from "@/lib/housekeeping/useRoomExceptions";
import { useRoomReports } from "@/lib/housekeeping/useRoomReports";
import { getBlockersForRoom } from "@/lib/housekeeping/roomBlockers";
import { getReportActions } from "@/lib/housekeeping/reportActions";
import { countPendingSync } from "@/lib/housekeeping/syncDetails";
import { hasRoomInProgress } from "@/lib/housekeeping/roomWorkflow";
import {
  findNextRoom,
  getStickyActions,
  resolveRoomDetailView,
  type StickyActionId,
} from "@/lib/housekeeping/roomDetailState";
import { getPhase, tracksLinen } from "@/lib/housekeeping/cleanSession";
import { selectSession, useCleanSessionStore } from "@/stores/cleanSessionStore";

function getRoomStatusKey(status: string): StatusKey {
  switch (status) {
    case "OCCUPIED":
      return "occupied";
    case "PICKUP":
      return "pickup";
    case "IN_PROGRESS":
      return "inProgress";
    case "CLEAN":
      return "clean";
    case "INSPECTED":
      return "ready";
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return "outOfOrder";
    case "DIRTY":
    default:
      return "dirty";
  }
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  DIRTY: "rooms.detail.status.DIRTY",
  OCCUPIED: "rooms.detail.status.OCCUPIED",
  PICKUP: "rooms.detail.status.PICKUP",
  IN_PROGRESS: "rooms.detail.status.IN_PROGRESS",
  CLEAN: "rooms.detail.status.CLEAN",
  INSPECTED: "rooms.detail.status.INSPECTED",
  OOO: "rooms.detail.status.OOO",
  OUT_OF_ORDER: "rooms.detail.status.OUT_OF_ORDER",
  OUT_OF_SERVICE: "rooms.detail.status.OUT_OF_SERVICE",
};

function formatLastActionTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return isToday
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

const LAST_ACTION_KEYS: Record<string, string> = {
  IN_PROGRESS: "rooms.detail.lastAction.started",
  CLEAN: "rooms.detail.lastAction.markedClean",
  INSPECTED: "rooms.detail.lastAction.markedReady",
  DIRTY: "rooms.detail.lastAction.returnedToCleaning",
  OOO: "rooms.detail.lastAction.markedOutOfOrder",
  OUT_OF_ORDER: "rooms.detail.lastAction.markedOutOfOrder",
  OUT_OF_SERVICE: "rooms.detail.lastAction.markedOutOfOrder",
  PICKUP: "rooms.detail.lastAction.markedPickup",
};

function buildLastAction(
  entry: { to_status?: string; created_at?: string; changed_by?: string } | null,
  room: Room,
  userId: string | undefined,
  t: Translate,
): string | null {
  const status = entry?.to_status ?? room.status;
  const timestamp = entry?.created_at ?? room.updated_at ?? room.last_cleaned_at ?? room.last_inspected_at ?? null;
  if (!timestamp) return null;
  const actor = entry?.changed_by && entry.changed_by === userId ? t("rooms.detail.lastAction.byYou") : "";
  const time = formatLastActionTime(timestamp);
  const action = t(LAST_ACTION_KEYS[status] ?? "rooms.detail.lastAction.updated");
  return time ? t("rooms.detail.lastAction.at", { action, actor, time }) : t("rooms.detail.lastAction.only", { action, actor });
}

/** iOS can't present a modal while another is still dismissing; give it a beat. */
const SHEET_HANDOFF_MS = Platform.OS === "ios" ? 350 : 0;

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { t, i18n } = useTranslation();
  const { isOnline, myRooms, setMyRooms, user, hotelTimezone, refreshRooms, pendingActions = [] } = useAppStore();
  const id = typeof roomId === "string" ? roomId : undefined;
  const session = useCleanSessionStore(selectSession(id));
  const sessions = useCleanSessionStore((state) => state.sessions);
  const theme = useTheme();
  const toast = useToast();
  const tr = t as Translate;

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [knockOpen, setKnockOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [linenOpen, setLinenOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [target, setTarget] = useState<ReportTarget | null>(null);

  // One start/finish at a time: a second tap while the first is in flight does nothing.
  const busyRef = useRef(false);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (handoffTimer.current) clearTimeout(handoffTimer.current);
    },
    [],
  );

  useEffect(() => {
    const found = myRooms.find((candidate) => candidate.id === roomId) ?? null;
    setRoom(found);
    setLastAction(found ? buildLastAction(null, found, user?.id, tr) : null);
    setLoading(false);
  }, [roomId, myRooms, user?.id]);

  useEffect(() => {
    if (!room || !isOnline) return;
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await api.get<{ data: Array<{ to_status?: string; created_at?: string; changed_by?: string }> }>(
          `/rooms/${room!.id}/history?limit=1`,
        );
        if (!cancelled) setLastAction(buildLastAction(res.data?.[0] ?? null, room!, user?.id, tr));
      } catch {
        // Last action is helpful context, not a blocker for cleaning.
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [isOnline, room?.id, user?.id]);

  // Resume the real clean session: restores checklist progress after a restart and
  // attaches rooms that were started elsewhere. Keyed on status so a room that the
  // server moved to IN_PROGRESS is picked up too.
  useEffect(() => {
    if (!room || !isOnline) return;
    void useCleanSessionStore.getState().restoreForRoom({ id: room.id, status: room.status });
  }, [isOnline, room?.id, room?.status]);

  useEffect(() => {
    void useCleanSessionStore.getState().hydrate();
  }, []);

  useEffect(() => {
    setInfoOpen(false);
    setMoreOpen(false);
    setCompleteOpen(false);
    setKnockOpen(false);
    setRecordOpen(false);
    setLinenOpen(false);
    setSyncOpen(false);
    setTarget(null);
  }, [room?.id]);

  const updateLocalRoom = useCallback(
    (roomIdToUpdate: string, patch: Partial<Room>) => {
      const current = useAppStore.getState().myRooms;
      setMyRooms(current.map((candidate) => (candidate.id === roomIdToUpdate ? { ...candidate, ...patch } : candidate)));
      setRoom((existing) => (existing?.id === roomIdToUpdate ? { ...existing, ...patch } : existing));
    },
    [setMyRooms],
  );

  const exceptions = useRoomExceptions({ room, isOnline, updateLocalRoom, refreshRooms, toast, t: tr });
  const reports = useRoomReports({ room, isOnline, hotelTimezone, exceptions, updateLocalRoom, toast, t: tr });

  function describeSessionError(code: string, message: string): string {
    return t(`rooms.detail.session.errors.${code}`, { defaultValue: message });
  }

  /** Entry restrictions are re-read from the freshest list on every action that changes workflow state. */
  function isRestrictedNow(target: Room): boolean {
    const latest = useAppStore.getState().myRooms.find((candidate) => candidate.id === target.id) ?? target;
    return classifyRoom(latest, { hasLiveSession: Boolean(session && !session.completionConfirmed) }).restricted;
  }

  async function runExclusive(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Start (or resume) the persistent clean session; the server flips the room to IN_PROGRESS. */
  async function startCleaning(current: Room, entryAcknowledged: boolean) {
    if (isRestrictedNow(current)) {
      toast.error(t("rooms.dash.detail.restriction.blockedStart"));
      return;
    }
    try {
      const result = await useCleanSessionStore
        .getState()
        .startSession({ id: current.id, clean_type: current.clean_type }, { entryAcknowledged });
      if (result.outcome === "rejected") {
        if (result.code === "ENTRY_PROTOCOL_REQUIRED" && !entryAcknowledged) {
          // The guest situation changed since this page loaded: do the knock first.
          setKnockOpen(true);
          return;
        }
        toast.error(describeSessionError(result.code, result.message));
        // The room may have changed since the detail page opened (DND, reassignment...).
        void refreshRooms();
        return;
      }
      updateLocalRoom(current.id, { status: "IN_PROGRESS", updated_at: new Date().toISOString() });
      if (result.outcome === "queued") toast.info(t("rooms.detail.session.startQueued"));
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t("rooms.detail.alerts.updateRoomFailed"));
    }
  }

  /**
   * The attendant acknowledged every knock step. Before anything starts the room
   * is re-read from the server: a DND set while the protocol was open stops it.
   */
  async function confirmEntry(current: Room) {
    await runExclusive(async () => {
      if (isOnline) {
        try {
          await refreshRooms();
        } catch {
          // Offline-ish: fall back to the last known state; the server re-checks on start.
        }
      }
      if (isRestrictedNow(current)) {
        setKnockOpen(false);
        toast.error(t("rooms.dash.detail.restriction.blockedStart"));
        return;
      }
      setKnockOpen(false);
      await startCleaning(current, true);
    });
  }

  /** Complete through the session API. The room only turns CLEAN once the server says so. */
  async function submitCompletion(current: Room) {
    await runExclusive(async () => {
      try {
        const result = await useCleanSessionStore.getState().completeSession(current.id);
        if (result.outcome === "confirmed") {
          setCompleteOpen(false);
          updateLocalRoom(current.id, { status: "CLEAN", updated_at: new Date().toISOString() });
          void refreshRooms();
        } else if (result.outcome === "queued") {
          setCompleteOpen(false);
          toast.info(t("rooms.detail.session.savedPending"));
        } else {
          setCompleteOpen(false);
          toast.error(describeSessionError(result.code, result.message));
          void refreshRooms();
        }
      } catch (err: unknown) {
        toast.error((err as Error).message ?? t("rooms.detail.alerts.updateRoomFailed"));
      }
    });
  }

  function openAfterHandoff(open: () => void) {
    if (handoffTimer.current) clearTimeout(handoffTimer.current);
    if (SHEET_HANDOFF_MS === 0) {
      open();
      return;
    }
    handoffTimer.current = setTimeout(open, SHEET_HANDOFF_MS);
  }

  /** One sheet at a time: close the hub, then open the chosen sheet once it has finished dismissing. */
  function openReportTarget(next: ReportTarget) {
    setMoreOpen(false);
    openAfterHandoff(() => {
      if (next === "info") setInfoOpen(true);
      else if (next === "linen") setLinenOpen(true);
      else if (next === "sync") setSyncOpen(true);
      else setTarget(next);
    });
  }

  if (loading) {
    return <StateBlock status="loading" style={[styles.center, { backgroundColor: theme.background }]} />;
  }

  if (!room) {
    return (
      <StateBlock
        status="error"
        errorMessage={t("common.error")}
        style={[styles.center, { backgroundColor: theme.background }]}
      />
    );
  }

  const textCtx = { language: i18n.language, timeZone: hotelTimezone };
  const view = resolveRoomDetailView({
    room,
    session,
    isOnline,
    otherRoomInProgress: hasRoomInProgress(myRooms, room.id),
  });
  const nextRoom = view.kind === "submitted" ? findNextRoom(myRooms, sessions, room.id) : null;
  const actions = getStickyActions(view, {
    hasNextRoom: Boolean(nextRoom),
    hasWorkOrder: Boolean(room.open_work_order_id),
    busy,
  });

  const subtitle =
    [cleanTypeLabel(room, tr), room.room_type_code ?? room.rooms?.room_types?.code ?? null, locationLabel(room, tr)]
      .filter(Boolean)
      .join(" · ") || null;
  const statusLabel = t(STATUS_LABEL_KEYS[view.status] ?? "rooms.detail.status.UNKNOWN", { status: view.status.replace(/_/g, " ") });
  const rushVisible = Boolean(view.classification.rush) && view.kind !== "submitted" && view.kind !== "inspected" && view.kind !== "unavailable";
  const phase = session ? getPhase(session) : null;
  const locked = !session || phase === "completed" || phase === "completing" || phase === "conflict";
  const checklistPlaceholder = session
    ? null
    : t(view.working ? (isOnline ? "rooms.detail.session.loadingChecklist" : "rooms.detail.session.checklistNeedsConnection") : "rooms.detail.session.startToLoad");
  const reportable = view.kind === "ready" || view.kind === "reclean" || view.kind === "in_progress" || view.kind === "needs_attention";
  // Access problems live in Can't Enter; what remains here are condition flags that create follow-up work.
  const flags = getBlockersForRoom(room).filter((blocker) => blocker.sideEffect);
  const linenApplicable = Boolean(session) && view.kind !== "reclean" && tracksLinen(session?.cleanType ?? room.clean_type);
  const pendingCount = countPendingSync(sessions, pendingActions);
  const reportActions = getReportActions({
    role: user?.role,
    isOnline,
    room,
    hasLiveSession: Boolean(session && !session.completionConfirmed),
    linenApplicable,
    linenLocked: locked,
    pendingCount,
  });

  function onAction(actionId: StickyActionId) {
    const current = room!;
    switch (actionId) {
      case "start":
        void runExclusive(() => startCleaning(current, false));
        return;
      case "begin_entry":
        if (isRestrictedNow(current)) {
          toast.error(t("rooms.dash.detail.restriction.blockedStart"));
          return;
        }
        setKnockOpen(true);
        return;
      case "complete":
      case "resubmit":
        setCompleteOpen(true);
        return;
      case "record_attempt":
        setRecordOpen(true);
        return;
      case "next_room":
        if (nextRoom) router.replace(`/(app)/my-rooms/${nextRoom.id}` as never);
        return;
      case "view_record":
        setInfoOpen(true);
        return;
      case "view_work_order":
        if (current.open_work_order_id) router.push(`/(app)/work-orders/${current.open_work_order_id}` as never);
        return;
      case "back_to_route":
        router.push("/(app)/my-rooms" as never);
        return;
    }
  }

  const attempts = view.classification.retry?.attempts ?? 0;
  // The sticky bar owns Record / Back only while the room is restricted; a startable
  // room with a "retry time has arrived" note keeps the panel's own buttons.
  const restrictionPanel = hasRestrictionPanel(room, view.classification) ? (
    <RoomRestrictionPanel
      room={room}
      classification={view.classification}
      ctx={textCtx}
      isOnline={isOnline}
      busy={exceptions.busy}
      supervisorNotified={exceptions.notified}
      notifying={exceptions.notifying}
      recordOpen={view.startBlock === "restricted" ? recordOpen : undefined}
      onRecordOpenChange={view.startBlock === "restricted" ? setRecordOpen : undefined}
      compact={view.startBlock === "restricted"}
      onRecord={exceptions.record}
      onNotifySupervisor={() => {
        void exceptions.notify(
          view.classification.reasons.includes("dnd")
            ? `DND active — ${attempts} attempt(s) recorded, needs supervisor follow-up`
            : view.classification.reasons.includes("come_back_later")
              ? "guest asked to come back later — needs supervisor follow-up"
              : "guest declined service — needs supervisor follow-up",
        );
      }}
      onReturnToRoute={() => router.push("/(app)/my-rooms" as never)}
    />
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <RoomDetailHeader
        roomNumber={room.room_number}
        subtitle={subtitle}
        statusKey={getRoomStatusKey(view.status)}
        statusLabel={statusLabel}
        rush={rushVisible}
        onBack={() => router.push("/(app)/my-rooms" as never)}
        onMore={reportable ? () => setMoreOpen(true) : undefined}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="room-detail-scroll"
      >
        {session && !session.completionConfirmed ? (
          <SessionStatusBanner
            session={session}
            isOnline={isOnline}
            onRetry={() => void useCleanSessionStore.getState().retry(room.id)}
            onDiscard={() => {
              useCleanSessionStore.getState().discard(room.id);
              void refreshRooms();
            }}
          />
        ) : null}

        {view.kind === "unavailable" ? <UnavailableRoomView room={room} /> : null}
        {view.kind === "inspected" ? <ReadyRoomView room={room} ctx={textCtx} /> : null}
        {view.kind === "submitted" ? <SubmittedRoomView room={room} session={session} /> : null}
        {view.kind === "needs_attention" ? (
          <NeedsAttentionView room={room} view={view} ctx={textCtx} restriction={restrictionPanel} onOpenInfo={() => setInfoOpen(true)} />
        ) : null}
        {(view.kind === "ready" || view.kind === "reclean") && !view.working ? (
          <BeforeCleaningView room={room} view={view} ctx={textCtx} restriction={restrictionPanel} onOpenInfo={() => setInfoOpen(true)} />
        ) : null}
        {(view.kind === "in_progress" || view.kind === "reclean") && view.working ? (
          <ActiveCleaningView
            room={room}
            view={view}
            session={session}
            ctx={textCtx}
            locked={locked}
            placeholder={checklistPlaceholder}
            onToggle={(key, checked) => useCleanSessionStore.getState().toggleItem(room.id, key, checked)}
            onOpenLinen={() => setLinenOpen(true)}
            onReportFoundItem={() => setTarget("found")}
            onOpenInfo={() => setInfoOpen(true)}
          />
        ) : null}
      </ScrollView>

      <RoomStickyActions actions={actions} busy={busy} onAction={onAction} onMore={() => setMoreOpen(true)} />

      <RoomInformationSheet
        visible={infoOpen}
        room={room}
        session={session}
        lastAction={lastAction}
        ctx={textCtx}
        onClose={() => setInfoOpen(false)}
      />

      <ReportMoreSheet
        visible={moreOpen}
        room={room}
        actions={reportActions}
        hasFlags={flags.length > 0}
        isOnline={isOnline}
        pendingCount={pendingCount}
        onClose={() => setMoreOpen(false)}
        onSelect={openReportTarget}
      />

      <CompleteCleaningSheet
        visible={completeOpen}
        roomNumber={room.room_number}
        reclean={view.kind === "reclean"}
        completion={view.completion}
        startedAt={session?.startedAt}
        cleanType={cleanTypeLabel(room, tr)}
        busy={busy}
        unsure={Boolean(session?.completionUnsure)}
        onConfirm={() => void submitCompletion(room)}
        onKeep={() => setCompleteOpen(false)}
      />

      <KnockModal
        visible={knockOpen}
        roomNumber={room.room_number}
        statusLabel={statusLabel}
        restricted={isRestrictedNow(room)}
        onConfirm={() => void confirmEntry(room)}
        onCancel={() => setKnockOpen(false)}
        onCannotEnter={() => {
          setKnockOpen(false);
          openAfterHandoff(() => setTarget("exception"));
        }}
      />

      {/* Forms mount only while open: nothing is fetched or rendered until it is needed. */}
      {target === "exception" ? (
        <ServiceExceptionSheet
          visible
          room={room}
          isOnline={isOnline}
          timeZone={hotelTimezone}
          busy={exceptions.busy}
          onSubmit={reports.submitException}
          onClearDnd={async () => {
            if (await exceptions.record("dnd_cleared")) setTarget(null);
          }}
          onRestoreService={async () => {
            await reports.toggleDeclineService();
            setTarget(null);
          }}
          onClose={() => setTarget(null)}
        />
      ) : null}
      {target === "issue" ? <ReportIssueModal visible roomId={room.id} roomNumber={room.room_number} onClose={() => setTarget(null)} /> : null}
      {target === "supplies" ? <SupplyRequestModal visible roomId={room.id} roomNumber={room.room_number} onClose={() => setTarget(null)} /> : null}
      {target === "found" ? <FoundItemModal visible roomId={room.id} roomNumber={room.room_number} onClose={() => setTarget(null)} /> : null}
      {target === "note" ? (
        <RoomNoteSheet visible room={room} isOnline={isOnline} ctx={textCtx} saving={reports.noteLoading} onSave={reports.submitNote} onClose={() => setTarget(null)} />
      ) : null}
      {target === "flags" ? <RoomFlagsSheet visible room={room} flags={flags} isOnline={isOnline} reports={reports} onClose={() => setTarget(null)} /> : null}
      {linenApplicable ? (
        <LinenExchangeSheet
          visible={linenOpen}
          roomNumber={room.room_number}
          linen={session?.linen}
          locked={locked}
          onSave={(counts) => useCleanSessionStore.getState().saveLinen(room.id, counts)}
          onClose={() => setLinenOpen(false)}
        />
      ) : null}
      {syncOpen ? <SyncDetailsSheet visible isOnline={isOnline} ctx={textCtx} onClose={() => setSyncOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28, gap: 12 },
});
