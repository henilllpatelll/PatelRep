import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore, type Room } from "@/stores/appStore";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { StateBlock } from "@/components/ui/StateBlock";
import ReportIssueModal from "@/components/housekeeping/ReportIssueModal";
import FoundItemModal from "@/components/housekeeping/FoundItemModal";
import SupplyRequestModal from "@/components/housekeeping/SupplyRequestModal";
import KnockModal from "@/components/housekeeping/KnockModal";
import ChecklistSection from "@/components/housekeeping/ChecklistSection";
import {
  getBeforeEnterWarnings,
  getChecklistForRoom,
  getRoomAction,
  hasRoomInProgress,
  LOST_FOUND_CHECK_KEY,
} from "@/lib/housekeeping/roomWorkflow";
import { buildRoomInsight } from "@/lib/ai/briefing";
import {
  buildBlockerNote,
  formatBlockerTimeInput,
  getBlockersForRoom,
  runBlockerSideEffect,
  sendDeclinedServiceAlert,
  sendSupervisorEscalation,
  type RoomBlocker,
} from "@/lib/housekeeping/roomBlockers";

type Theme = ReturnType<typeof useTheme>;

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

function getStatusColor(status: string, theme: Theme): string {
  switch (status) {
    case "DIRTY":
    case "OCCUPIED":
      return theme.status.dirty;
    case "PICKUP":
    case "IN_PROGRESS":
      return theme.status.pickup;
    case "CLEAN":
      return theme.status.clean;
    case "INSPECTED":
      return theme.status.ready;
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return theme.status.outOfOrder;
    default:
      return theme.textMuted;
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

const CLEAN_TYPE_LABEL_KEYS: Record<string, string> = {
  DEP: "rooms.detail.cleanType.DEP",
  FULL: "rooms.detail.cleanType.FULL",
  LIGHT: "rooms.detail.cleanType.LIGHT",
};

function getCleanTypeMeta(
  theme: Theme,
): Record<string, { icon: ComponentProps<typeof Ionicons>["name"]; bg: string; fg: string; border: string }> {
  return {
    DEP: { icon: "log-out-outline", bg: theme.status.dirtySoft, fg: theme.status.dirty, border: theme.status.dirtyLine },
    FULL: { icon: "refresh-circle-outline", bg: theme.status.pickupSoft, fg: theme.status.pickup, border: theme.status.pickupLine },
    LIGHT: { icon: "flash-outline", bg: theme.status.pickupSoft, fg: theme.status.pickup, border: theme.status.pickupLine },
  };
}

const STATUS_ACTION_TIMEOUT_MS = 12000;

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

function formatLastActionTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isToday) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

function getActionLabelKey(status: string): string {
  switch (status) {
    case "IN_PROGRESS": return "rooms.detail.lastAction.started";
    case "CLEAN": return "rooms.detail.lastAction.markedClean";
    case "INSPECTED": return "rooms.detail.lastAction.markedReady";
    case "DIRTY": return "rooms.detail.lastAction.returnedToCleaning";
    case "OOO": case "OUT_OF_ORDER": case "OUT_OF_SERVICE": return "rooms.detail.lastAction.markedOutOfOrder";
    case "PICKUP": return "rooms.detail.lastAction.markedPickup";
    default: return "rooms.detail.lastAction.updated";
  }
}

function buildLastAction(
  entry: { to_status?: string; created_at?: string; changed_by?: string } | null,
  room: Room,
  userId: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const status = entry?.to_status ?? room.status;
  const timestamp = entry?.created_at ?? room.updated_at ?? room.last_cleaned_at ?? room.last_inspected_at ?? null;
  if (!timestamp) return null;
  const actor = entry?.changed_by && entry.changed_by === userId ? t("rooms.detail.lastAction.byYou") : "";
  const time = formatLastActionTime(timestamp);
  return time
    ? t("rooms.detail.lastAction.at", { action: t(getActionLabelKey(status)), actor, time })
    : t("rooms.detail.lastAction.only", { action: t(getActionLabelKey(status)), actor });
}

function getCleanTypeKey(room: Room): string | null {
  return room.clean_type ? CLEAN_TYPE_LABEL_KEYS[room.clean_type] ?? null : null;
}

function getPrimaryLabelKey(room: Room): string {
  const action = getRoomAction(room);
  if (action.kind === "start") return "rooms.detail.primary.startCleaning";
  if (action.kind === "done") return "rooms.detail.primary.markClean";
  if (action.kind === "review") return "rooms.detail.primary.startCleaning";
  if (action.kind === "guest_checkout") return "rooms.detail.primary.guestCheckedOutStart";
  if (action.kind === "submitted") return "rooms.detail.primary.submitted";
  if (action.kind === "ready") return "rooms.detail.primary.ready";
  if (action.kind === "blocked") return "rooms.detail.primary.blocked";
  return "rooms.detail.primary.view";
}

function getWarningCopy(
  warning: { key: string; label: string; detail: string },
  room: Room,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; detail: string } {
  switch (warning.key) {
    case "dnd":
      return { label: t("rooms.detail.warnings.dnd.label"), detail: t("rooms.detail.warnings.dnd.detail") };
    case "checkout":
      return { label: t("rooms.detail.warnings.checkout.label"), detail: t("rooms.detail.warnings.checkout.detail") };
    case "occupied":
      return { label: t("rooms.detail.warnings.occupied.label"), detail: t("rooms.detail.warnings.occupied.detail") };
    case "work_order": {
      const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
      return {
        label: t("rooms.detail.warnings.workOrder.label"),
        detail: room.open_work_order_title
          ? `${room.open_work_order_title}${number}.`
          : t("rooms.detail.warnings.workOrder.detail"),
      };
    }
    case "risk":
      return { label: t("rooms.detail.warnings.risk.label"), detail: t("rooms.detail.warnings.risk.detail") };
    case "note":
      return { label: t("rooms.detail.warnings.note.label"), detail: room.latest_note?.trim() ?? warning.detail };
    case "arrival":
      return { label: t("rooms.detail.warnings.arrival.label"), detail: t("rooms.detail.warnings.arrival.detail") };
    default:
      return { label: warning.label, detail: warning.detail };
  }
}

/** Knock protocol required before entering occupied or stayover rooms. */
function needsKnockProtocol(room: Room): boolean {
  if (room.status === "PICKUP") return true;
  if (room.status === "OCCUPIED") return true;
  return room.status === "DIRTY" && room.fo_status === "OCC" && !room.actual_checkout_at;
}

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { t } = useTranslation();
  const {
    isOnline,
    myRooms,
    setMyRooms,
    enqueueAction,
    user,
    incrementDndAttempt,
    resetDndAttempt,
    refreshRooms,
    roomChecklistProgress,
    setRoomChecklistItem,
    resetRoomChecklist,
  } = useAppStore();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);
  const [cleanSuccess, setCleanSuccess] = useState(false);
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [showFoundItem, setShowFoundItem] = useState(false);
  const [showSupplyRequest, setShowSupplyRequest] = useState(false);
  const [dndLoading, setDndLoading] = useState(false);
  const [declineLoading, setDeclineLoading] = useState(false);
  const checkedItems = room ? (roomChecklistProgress[room.id] ?? {}) : {};
  const [timeEntryKey, setTimeEntryKey] = useState<string | null>(null);
  const [timeText, setTimeText] = useState("");
  const [blockerBusy, setBlockerBusy] = useState<string | null>(null);
  const [lastBlockerKey, setLastBlockerKey] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [showKnockModal, setShowKnockModal] = useState(false);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<Room["status"] | null>(null);
  const [linenOut, setLinenOut] = useState(0);
  const [linenIn, setLinenIn] = useState(0);
  const [removableLatestNote, setRemovableLatestNote] = useState<{
    text: string;
    previousText: string | null;
    previousAt: string | null;
  } | null>(null);

  const noteSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusLoadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRoomRef = useRef<Room | null>(null);

  useEffect(
    () => () => {
      if (noteSuccessTimer.current) clearTimeout(noteSuccessTimer.current);
      if (cleanSuccessTimer.current) clearTimeout(cleanSuccessTimer.current);
      clearStatusLoadingTimer();
    },
    [],
  );

  useEffect(() => {
    const found = myRooms.find((candidate) => candidate.id === roomId) ?? null;
    setRoom(found);
    setLastAction(found ? buildLastAction(null, found, user?.id, t) : null);
    setLoading(false);
  }, [roomId, myRooms, t, user?.id]);

  useEffect(() => {
    if (!room || !isOnline) return;
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await api.get<{ data: Array<{ to_status?: string; created_at?: string; changed_by?: string }> }>(
          `/rooms/${room!.id}/history?limit=1`,
        );
        if (!cancelled) setLastAction(buildLastAction(res.data?.[0] ?? null, room!, user?.id, t));
      } catch {
        // Last action is helpful context, not a blocker for cleaning.
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [isOnline, room?.id, t, user?.id]);

  useEffect(() => {
    setLinenOut(0);
    setLinenIn(0);
  }, [room?.clean_type, room?.id]);

  useEffect(() => {
    setRemovableLatestNote(null);
    setLastBlockerKey(null);
  }, [room?.id]);

  function updateLocalRoom(roomIdToUpdate: string, patch: Partial<Room>) {
    const updatedRooms = myRooms.map((candidate) =>
      candidate.id === roomIdToUpdate ? { ...candidate, ...patch } : candidate,
    );
    setMyRooms(updatedRooms);
    setRoom((current) => (current?.id === roomIdToUpdate ? { ...current, ...patch } : current));
  }

  function clearStatusLoadingTimer() {
    if (statusLoadingTimer.current) {
      clearTimeout(statusLoadingTimer.current);
      statusLoadingTimer.current = null;
    }
  }

  function startStatusLoading() {
    clearStatusLoadingTimer();
    setStatusLoading(true);
    statusLoadingTimer.current = setTimeout(() => {
      statusLoadingTimer.current = null;
      setStatusLoading(false);
    }, STATUS_ACTION_TIMEOUT_MS);
  }

  function stopStatusLoading() {
    clearStatusLoadingTimer();
    setStatusLoading(false);
  }

  async function updateRoomStatus(nextStatus: Room["status"]) {
    if (!room) return;
    const previous = room;
    prevRoomRef.current = previous;
    const updatedAt = new Date().toISOString();
    updateLocalRoom(room.id, { status: nextStatus, updated_at: updatedAt });
    startStatusLoading();

    const payload: Record<string, unknown> = { status: nextStatus };
    if (room.clean_type === "DEP" && nextStatus === "CLEAN") {
      payload.linen_out = linenOut;
      payload.linen_in = linenIn;
    }

    try {
      if (isOnline) {
        await api.patch(`/rooms/${room.id}/status`, payload);
        if (nextStatus === "CLEAN") {
          resetRoomChecklist(room.id);
          void refreshRooms();
          if (Platform.OS === "android") {
            ToastAndroid.show(t("rooms.detail.cleanSuccess"), ToastAndroid.SHORT);
          } else {
            setCleanSuccess(true);
            if (cleanSuccessTimer.current) clearTimeout(cleanSuccessTimer.current);
            cleanSuccessTimer.current = setTimeout(() => setCleanSuccess(false), 2000);
          }
        }
      } else {
        await enqueueAction({ type: "room_status", entityId: room.id, payload });
        if (nextStatus === "CLEAN") resetRoomChecklist(room.id);
      }
    } catch (err: unknown) {
      updateLocalRoom(previous.id, previous);
      toast.error((err as Error).message ?? t("rooms.detail.alerts.updateRoomFailed"));
    } finally {
      stopStatusLoading();
    }
  }

  function handlePrimaryAction() {
    if (!room) return;
    const action = getRoomAction(room);
    if (!action.targetStatus) return;

    if (action.targetStatus === "IN_PROGRESS" && needsKnockProtocol(room)) {
      setPendingStatusUpdate("IN_PROGRESS");
      setShowKnockModal(true);
      return;
    }

    void updateRoomStatus(action.targetStatus);
  }

  function handleKnockConfirm() {
    setShowKnockModal(false);
    if (pendingStatusUpdate) {
      void updateRoomStatus(pendingStatusUpdate);
      setPendingStatusUpdate(null);
    }
  }

  function handleUndo() {
    if (!room || !isOnline) return;
    void undoRoomStatus();
  }

  async function undoRoomStatus() {
    if (!room) return;
    const failsafe = room;
    const snapshot = prevRoomRef.current;
    if (snapshot) {
      updateLocalRoom(room.id, snapshot);
      prevRoomRef.current = null;
    }
    try {
      const response = await api.post<{ data: { status?: Room["status"] } }>(`/rooms/${room.id}/status/undo`, {});
      const nextStatus = response.data?.status;
      if (nextStatus && nextStatus !== snapshot?.status) {
        updateLocalRoom(room.id, { status: nextStatus, updated_at: new Date().toISOString() });
      }
    } catch (err: unknown) {
      updateLocalRoom(failsafe.id, failsafe);
      toast.error((err as Error).message ?? t("rooms.detail.alerts.undoFailed"));
    }
  }

  async function submitNote(text: string) {
    if (!room || !text.trim()) return;
    if (!isOnline) {
      toast.info(t("rooms.detail.alerts.notesNeedConnection"));
      return;
    }

    setNoteLoading(true);
    try {
      const note = text.trim();
      const previousText = room.latest_note ?? null;
      const previousAt = room.latest_note_at ?? null;
      await api.post(`/rooms/${room.id}/notes`, { text: note });
      updateLocalRoom(room.id, { latest_note: note, latest_note_at: new Date().toISOString() });
      setRemovableLatestNote({ text: note, previousText, previousAt });
      setNoteText("");
      setNoteOpen(false);
      setNoteSuccess(true);
      if (noteSuccessTimer.current) clearTimeout(noteSuccessTimer.current);
      noteSuccessTimer.current = setTimeout(() => setNoteSuccess(false), 4000);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t("rooms.detail.alerts.saveNoteFailed"));
    } finally {
      setNoteLoading(false);
    }
  }

  async function submitBlocker(blocker: RoomBlocker, time?: string) {
    if (!room) return;
    if (!isOnline) {
      toast.info(t("rooms.detail.alerts.blockersNeedConnection"));
      return;
    }
    setBlockerBusy(blocker.key);
    try {
      const formattedTime = blocker.needsTime ? formatBlockerTimeInput(time) : time;
      await runBlockerSideEffect(room, blocker, formattedTime);
      await Promise.race([
        submitNote(buildBlockerNote(blocker, formattedTime)),
        new Promise<void>((resolve) => setTimeout(resolve, 12000)),
      ]);
      setLastBlockerKey(blocker.key);
      setTimeEntryKey(null);
      setTimeText("");

      if (blocker.key === "come_back_later") {
        const newCount = incrementDndAttempt(room.id);
        if (newCount >= 2) {
          toast.info(t("rooms.detail.alerts.dndEscalationTitle"));
          await sendSupervisorEscalation(room.room_number);
          resetDndAttempt(room.id);
        }
      }

      if (blocker.key === "declined_service") {
        await sendDeclinedServiceAlert(room.room_number);
      }
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t("rooms.detail.alerts.reportBlockerFailed"));
    } finally {
      setBlockerBusy(null);
    }
  }

  async function handleToggleDnd() {
    if (!room || !isOnline) {
      toast.info(t("rooms.detail.alerts.dndNeedsConnection"));
      return;
    }
    const next = !room.dnd_flag;
    setDndLoading(true);
    updateLocalRoom(room.id, { dnd_flag: next });
    try {
      await api.patch(`/rooms/${room.id}/dnd`, { dnd: next });
    } catch (err: unknown) {
      updateLocalRoom(room.id, { dnd_flag: !next });
      toast.error((err as Error).message ?? t("rooms.detail.alerts.updateDndFailed"));
    } finally {
      setDndLoading(false);
    }
  }

  async function handleToggleDeclineService() {
    if (!room || !isOnline) {
      toast.info(t("rooms.detail.alerts.serviceNeedsConnection"));
      return;
    }
    const next = !room.do_not_service;
    setDeclineLoading(true);
    updateLocalRoom(room.id, { do_not_service: next });
    try {
      await api.patch(`/rooms/${room.id}/decline-service`, { decline: next });
    } catch (err: unknown) {
      updateLocalRoom(room.id, { do_not_service: !next });
      toast.error((err as Error).message ?? t("rooms.detail.alerts.updateServiceFailed"));
    } finally {
      setDeclineLoading(false);
    }
  }

  function removeLatestNote() {
    if (!room || !removableLatestNote || room.latest_note?.trim() !== removableLatestNote.text) return;
    updateLocalRoom(room.id, {
      latest_note: removableLatestNote.previousText,
      latest_note_at: removableLatestNote.previousAt,
    });
    setRemovableLatestNote(null);
    setNoteSuccess(false);
  }

  function handleBlockerUndo() {
    removeLatestNote();
    setLastBlockerKey(null);
  }

  function handleCheckItem(key: string, newVal: boolean) {
    // The L&F check item is one-way — once checked it records the check and cannot be undone.
    if (key === LOST_FOUND_CHECK_KEY && !newVal) return;
    if (!room) return;
    setRoomChecklistItem(room.id, key, newVal);
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

  const status = room.status;
  const action = getRoomAction(room);
  const primaryLabel = t(getPrimaryLabelKey(room));
  const startBlockedByInProgress = action.targetStatus === "IN_PROGRESS" && hasRoomInProgress(myRooms, room.id);
  const primaryDisabled = !action.targetStatus || startBlockedByInProgress;
  const showUndo = isOnline && Boolean(action.allowUndo);
  const statusColor = getStatusColor(status, theme);
  const statusLabel = t(STATUS_LABEL_KEYS[status] ?? "rooms.detail.status.UNKNOWN", { status: status.replace(/_/g, " ") });
  const roomType = room.room_type_code ?? room.rooms?.room_types?.code ?? null;
  const cleanTypeKey = getCleanTypeKey(room);
  const cleanType = cleanTypeKey ? t(cleanTypeKey) : room.clean_type_label ?? null;
  const cleanTypeMeta = room.clean_type ? getCleanTypeMeta(theme)[room.clean_type] : null;
  const hideCleanTypeIcon = room.status === "PICKUP" && (room.clean_type === "FULL" || room.clean_type === "LIGHT");
  const warnings = [...getBeforeEnterWarnings(room)].sort((a, b) => {
    if (a.key === "note") return -1;
    if (b.key === "note") return 1;
    return 0;
  });
  const canRemoveLatestNote = Boolean(removableLatestNote && room.latest_note?.trim() === removableLatestNote.text);
  const checklist = getChecklistForRoom(room);
  const insight = buildRoomInsight(room, myRooms, t);
  const checkedCount = checklist.filter((item) => checkedItems[item]).length;
  const checklistIncomplete = action.kind === "done" && checkedCount < checklist.length;
  const primaryDisabledFinal = primaryDisabled || checklistIncomplete;
  const blockers = getBlockersForRoom(room);
  const sectionLabel = t(
    room.status === "DIRTY" || room.status === "IN_PROGRESS"
      ? "rooms.detail.blockerSections.roomFlags"
      : "rooms.detail.blockerSections.quickBlockers",
  );
  const showDndChip = status === "OCCUPIED" || status === "PICKUP" || room.dnd_flag;
  const isDepRoom = room.clean_type === "DEP" && (status === "DIRTY" || status === "IN_PROGRESS" || status === "OCCUPIED");
  const timingRows = [
    { labelKey: "rooms.detail.timing.guest", value: room.guest_name },
    { labelKey: "rooms.detail.timing.foStatus", value: room.fo_status },
    { labelKey: "rooms.detail.timing.checkin", value: formatTime(room.checkin_time) },
    { labelKey: "rooms.detail.timing.scheduledCheckout", value: formatTime(room.checkout_time) },
    { labelKey: "rooms.detail.timing.actualCheckout", value: formatTime(room.actual_checkout_at) },
    status === "IN_PROGRESS" ? { labelKey: "rooms.detail.timing.cleaningStarted", value: formatTime(room.updated_at) } : null,
    { labelKey: "rooms.detail.timing.predictedReady", value: formatTime(room.predicted_ready_at) },
  ].filter((row): row is { labelKey: string; value: string } => Boolean(row?.value));

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.navBar, { paddingTop: insets.top + 10, backgroundColor: theme.background, borderBottomColor: theme.borderSubtle }]}>
        <TouchableOpacity
          onPress={() => router.push("/(app)/my-rooms" as never)}
          style={styles.backBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("rooms.title")}
        >
          <Ionicons name="chevron-back" size={20} color={theme.primaryAction} />
          <Text style={[styles.backLabel, { color: theme.primaryAction }]}>{t("rooms.title")}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={[styles.scroll, { backgroundColor: theme.background }]} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 132 }]}>
        <View style={[styles.hero, { backgroundColor: theme.shell.bg, borderColor: theme.shell.line }]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={[styles.roomEyebrow, { color: theme.shell.ink3 }]}>{t("rooms.detail.roomEyebrow")}</Text>
              <Text style={[styles.roomNum, { color: theme.shell.ink }]}>{room.room_number}</Text>
            </View>
            <StatusBadge statusKey={getRoomStatusKey(status)} label={statusLabel} />
          </View>
          <View style={styles.heroMeta}>
            {roomType ? <Text style={[styles.heroMetaText, { color: theme.shell.ink2, backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}>{roomType}</Text> : null}
            {cleanType ? (
              <View
                accessible
                accessibilityLabel={t("rooms.detail.cleanTypeAccessibility", { type: cleanType })}
                style={[
                  styles.cleanTypeChip,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle },
                  cleanTypeMeta && { backgroundColor: cleanTypeMeta.bg, borderColor: cleanTypeMeta.border },
                ]}
              >
                {cleanTypeMeta && !hideCleanTypeIcon ? (
                  <Ionicons name={cleanTypeMeta.icon} size={12} color={cleanTypeMeta.fg} />
                ) : null}
                <Text style={[styles.cleanTypeChipText, { color: theme.textSecondary }, cleanTypeMeta && { color: cleanTypeMeta.fg }]}>{cleanType}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {isDepRoom ? (
          <View style={[styles.depBanner, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
            <Ionicons name="log-out-outline" size={16} color={theme.status.dirty} />
            <View style={styles.depBannerCopy}>
              <Text style={[styles.depBannerTitle, { color: theme.status.dirty }]}>{t("rooms.detail.departure.title")}</Text>
              <Text style={[styles.depBannerSub, { color: theme.status.dirty }]}>{t("rooms.detail.departure.subtitle")}</Text>
            </View>
          </View>
        ) : null}

        {insight.lines.length > 0 ? (
          <View style={[styles.aiInsightCard, { backgroundColor: theme.surface, borderColor: theme.ai.line }]}>
            <View style={styles.aiInsightHeader}>
              <Ionicons name="sparkles" size={13} color={theme.ai.primary} />
              <Text style={[styles.aiInsightTitle, { color: theme.ai.primary }]}>{t("ai.insight.title")}</Text>
            </View>
            {insight.lines.map((line) => (
              <View key={line.key} style={styles.aiInsightRow}>
                <View style={[styles.aiInsightDot, { backgroundColor: theme.ai.primary }]} />
                <Text style={[styles.aiInsightText, { color: theme.textSecondary }]}>{line.text}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.aiAskBtn, { borderColor: theme.ai.line, backgroundColor: theme.ai.soft }]}
              onPress={() => router.push("/(app)/copilot")}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={t("ai.askAboutRoom")}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={13} color={theme.ai.primary} />
              <Text style={[styles.aiAskText, { color: theme.ai.primary }]}>{t("ai.askAboutRoom")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {warnings.length > 0 ? (
          <View style={[styles.warningSection, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
            <Text style={[styles.warningTitle, { color: theme.status.dirty }]}>{t("rooms.detail.beforeEnter")}</Text>
            {warnings.map((warning) => {
              const critical = warning.severity === "critical";
              const warningCopy = getWarningCopy(warning, room, t);
              return (
                <View key={warning.key} style={[styles.warningRow, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }, critical && { borderColor: theme.status.dirtyLine, backgroundColor: theme.status.dirtySoft }]}>
                  <Ionicons name={critical ? "warning" : "alert-circle-outline"} size={16} color={critical ? theme.status.dirty : theme.status.pickup} />
                  <View style={styles.warningCopy}>
                    <View style={styles.warningHeaderRow}>
                      <Text style={[styles.warningLabel, { color: theme.textPrimary }, critical && { color: theme.status.dirty }]}>{warningCopy.label}</Text>
                      {warning.key === "note" && canRemoveLatestNote ? (
                        <TouchableOpacity
                          onPress={removeLatestNote}
                          activeOpacity={0.8}
                          style={styles.inlineTextButton}
                          accessibilityRole="button"
                          accessibilityLabel={t("rooms.detail.removeNote")}
                        >
                          <Text style={[styles.removeNoteText, { color: theme.primaryAction }]}>{t("rooms.detail.removeNote")}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <Text style={[styles.warningDetail, { color: theme.textSecondary }]}>{warningCopy.detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={[styles.cardSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t("rooms.detail.reservationTiming")}</Text>
          {timingRows.length > 0 ? (
            <View style={styles.infoGrid}>
              {timingRows.map((row, idx) => (
                <View key={row.labelKey} style={[styles.infoRow, { borderBottomColor: theme.borderSubtle }, idx === timingRows.length - 1 && styles.infoRowLast]}>
                  <Text style={[styles.infoLabel, { color: theme.textMuted }]}>{t(row.labelKey)}</Text>
                  <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{row.value}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.mutedText, { color: theme.textMuted }]}>{t("rooms.detail.noReservationTiming")}</Text>
          )}
        </View>

        {blockers.length > 0 ? (
          <View style={[styles.cardSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{sectionLabel}</Text>
            <View style={styles.blockerGrid}>
              {blockers.map((blocker) => {
                const busy = blockerBusy === blocker.key;
                const open = timeEntryKey === blocker.key;
                const activated = lastBlockerKey === blocker.key && canRemoveLatestNote;
                return (
                  <TouchableOpacity
                    key={blocker.key}
                    style={[
                      styles.blockerBtn,
                      { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                      (open || activated) && { borderColor: theme.primaryLine, backgroundColor: theme.primarySoft },
                      (noteLoading || blockerBusy != null) && !busy && styles.btnDisabled,
                    ]}
                    onPress={() => {
                      if (activated) { handleBlockerUndo(); return; }
                      if (blocker.needsTime) {
                        setTimeEntryKey(open ? null : blocker.key);
                        setTimeText("");
                        return;
                      }
                      void submitBlocker(blocker);
                    }}
                    disabled={noteLoading || blockerBusy != null}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={t(blocker.labelKey)}
                    accessibilityState={{
                      selected: open || activated,
                      disabled: noteLoading || blockerBusy != null,
                      busy,
                    }}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={theme.primaryAction} />
                    ) : (
                      <View style={styles.blockerBtnContent}>
                        <Text style={[styles.blockerText, { color: theme.textSecondary }, activated && { color: theme.primaryAction }]}>{t(blocker.labelKey)}</Text>
                        {activated ? <Ionicons name="arrow-undo-outline" size={13} color={theme.primaryAction} /> : null}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.blockerBtnCustom, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                onPress={() => setCustomOpen(true)}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={t("rooms.detail.customFlag.short")}
              >
                <Ionicons name="pencil-outline" size={13} color={theme.textMuted} />
                <Text style={[styles.blockerText, { color: theme.textSecondary }]}>{t("rooms.detail.customFlag.short")}</Text>
              </TouchableOpacity>
            </View>

            {timeEntryKey ? (() => {
              const active = blockers.find((blocker) => blocker.key === timeEntryKey);
              if (!active) return null;
              return (
                <View style={[styles.timeEntry, { borderTopColor: theme.borderSubtle }]}>
                  <Text style={[styles.timeEntryLabel, { color: theme.textSecondary }]}>{t("blockers.timePrompt")}</Text>
                  <View style={styles.timeChipRow}>
                    {(active.timePresets ?? []).map((preset) => (
                      <TouchableOpacity
                        key={preset}
                        style={[styles.timeChip, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }, timeText === preset && { backgroundColor: theme.primarySoft, borderColor: theme.primaryLine }]}
                        onPress={() => setTimeText(preset)}
                        activeOpacity={0.82}
                        accessibilityRole="button"
                        accessibilityLabel={preset}
                        accessibilityState={{ selected: timeText === preset }}
                      >
                        <Text style={[styles.timeChipText, { color: theme.textSecondary }, timeText === preset && { color: theme.primaryAction }]}>{preset}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.timeEntryActions}>
                    <TextInput
                      style={[styles.timeInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.textPrimary }]}
                      value={timeText}
                      onChangeText={setTimeText}
                      onEndEditing={() => setTimeText(formatBlockerTimeInput(timeText))}
                      placeholder={t("blockers.timePlaceholder")}
                      placeholderTextColor={theme.textMuted}
                    />
                    <Button
                      label={t("blockers.report")}
                      onPress={() => void submitBlocker(active, timeText)}
                      loading={blockerBusy === active.key}
                      disabled={!timeText.trim() || blockerBusy != null}
                      size="sm"
                    />
                  </View>
                </View>
              );
            })() : null}
          </View>
        ) : null}

        {/* Actions — note form renders ABOVE chips to keep chip positions stable when form opens */}
        <View style={[styles.cardSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t("rooms.detailActions.title")}</Text>
          {noteOpen ? (
            <View style={[styles.noteForm, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <TextInput
                style={[styles.noteInput, { color: theme.textPrimary }]}
                value={noteText}
                onChangeText={setNoteText}
                placeholder={t("rooms.detailActions.notePlaceholder")}
                placeholderTextColor={theme.textMuted}
                multiline
                numberOfLines={2}
                autoFocus
              />
              <View style={[styles.noteActions, { borderTopColor: theme.borderSubtle }]}>
                <Button
                  label={t("rooms.detailActions.saveNote")}
                  icon="send"
                  onPress={() => void submitNote(noteText)}
                  loading={noteLoading}
                  disabled={!noteText.trim() || noteLoading}
                  size="sm"
                />
                <TouchableOpacity
                  onPress={() => setNoteOpen(false)}
                  style={styles.inlineTextButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("rooms.detailActions.cancel")}
                >
                  <Text style={[styles.noteCancelText, { color: theme.textMuted }]}>{t("rooms.detailActions.cancel")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionChip, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}
              onPress={() => setNoteOpen((v) => !v)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={t("rooms.detailActions.addNote")}
              accessibilityState={{ selected: noteOpen }}
            >
              <Ionicons name="chatbubble-outline" size={14} color={theme.status.clean} />
              <Text style={[styles.actionChipText, { color: theme.status.clean }]}>{t("rooms.detailActions.addNote")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, { backgroundColor: theme.accentBrassSoft, borderColor: theme.accentBrassLine }]}
              onPress={() => setShowReportIssue(true)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={t("rooms.detailActions.workOrder")}
            >
              <Ionicons name="build-outline" size={14} color={theme.accentBrass} />
              <Text style={[styles.actionChipText, { color: theme.accentBrass }]}>{t("rooms.detailActions.workOrder")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
              onPress={() => setShowFoundItem(true)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={t("rooms.detailActions.lostFound")}
            >
              <Ionicons name="bag-outline" size={14} color={theme.status.pickup} />
              <Text style={[styles.actionChipText, { color: theme.status.pickup }]}>{t("rooms.detailActions.lostFound")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, { backgroundColor: theme.primarySoft, borderColor: theme.primaryLine }]}
              onPress={() => setShowSupplyRequest(true)}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={t("rooms.detailActions.supplies")}
            >
              <Ionicons name="cube-outline" size={14} color={theme.primaryAction} />
              <Text style={[styles.actionChipText, { color: theme.primaryAction }]}>{t("rooms.detailActions.supplies")}</Text>
            </TouchableOpacity>
            {showDndChip ? (
              <TouchableOpacity
                style={[
                  styles.actionChip,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                  room.dnd_flag && { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine },
                ]}
                onPress={() => void handleToggleDnd()}
                disabled={dndLoading}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={room.dnd_flag ? t("rooms.detailActions.clearDnd") : t("rooms.detailActions.skipDnd")}
                accessibilityState={{ selected: room.dnd_flag, disabled: dndLoading, busy: dndLoading }}
              >
                {dndLoading ? (
                  <ActivityIndicator size="small" color={room.dnd_flag ? theme.status.dirty : theme.textMuted} />
                ) : (
                  <>
                    <Ionicons name={room.dnd_flag ? "close-circle-outline" : "hand-left-outline"} size={14} color={room.dnd_flag ? theme.status.dirty : theme.textMuted} />
                    <Text style={[styles.actionChipText, { color: room.dnd_flag ? theme.status.dirty : theme.textMuted }]}>
                      {room.dnd_flag ? t("rooms.detailActions.clearDnd") : t("rooms.detailActions.skipDnd")}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            {room.status === "PICKUP" ? (
              <TouchableOpacity
                style={[
                  styles.actionChip,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                  room.do_not_service && { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine },
                ]}
                onPress={() => void handleToggleDeclineService()}
                disabled={declineLoading}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={room.do_not_service ? t("rooms.detailActions.restoreService") : t("rooms.detailActions.declineService")}
                accessibilityState={{ selected: room.do_not_service, disabled: declineLoading, busy: declineLoading }}
              >
                {declineLoading ? (
                  <ActivityIndicator size="small" color={room.do_not_service ? theme.status.dirty : theme.textMuted} />
                ) : (
                  <>
                    <Ionicons name={room.do_not_service ? "refresh-outline" : "close-outline"} size={14} color={room.do_not_service ? theme.status.dirty : theme.textMuted} />
                    <Text style={[styles.actionChipText, { color: room.do_not_service ? theme.status.dirty : theme.textMuted }]}>
                      {room.do_not_service ? t("rooms.detailActions.restoreService") : t("rooms.detailActions.declineService")}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ChecklistSection
          room={room}
          checklist={checklist}
          checkedItems={checkedItems}
          onCheck={handleCheckItem}
          linenOut={linenOut}
          linenIn={linenIn}
          onLinenOut={setLinenOut}
          onLinenIn={setLinenIn}
          onReportFoundItem={() => setShowFoundItem(true)}
        />
      </ScrollView>

      <View style={[styles.stickyAction, { paddingBottom: insets.bottom + 12, borderTopColor: theme.border, backgroundColor: theme.surface }]}>
        <View style={styles.stickyStatusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.stickyStatusText, { color: statusColor }]}>{statusLabel}</Text>
          {lastAction ? (
            <Text style={[styles.stickyLastAction, { color: theme.textMuted }]} numberOfLines={1}>· {lastAction}</Text>
          ) : null}
          {cleanSuccess ? (
            <Text style={[styles.cleanSuccessText, { color: theme.status.ready }]}>{t("rooms.detail.cleanSuccess")}</Text>
          ) : noteSuccess ? (
            <Text style={[styles.noteSuccessText, { color: theme.status.ready }]}>{t("rooms.detailActions.noteSaved")}</Text>
          ) : null}
        </View>
        {startBlockedByInProgress ? (
          <Text style={[styles.inProgressBlockText, { color: theme.status.pickup }]}>{t("rooms.detail.finishCurrentRoom")}</Text>
        ) : checklistIncomplete ? (
          <Text style={[styles.inProgressBlockText, { color: theme.status.pickup }]}>
            {t("rooms.detail.checklistGateHint", { done: checkedCount, total: checklist.length })}
          </Text>
        ) : null}
        <View style={styles.stickyButtons}>
          <Button
            label={primaryLabel}
            onPress={handlePrimaryAction}
            disabled={primaryDisabledFinal}
            size="lg"
            style={styles.primaryBtnFlex}
          />
          {showUndo ? (
            <Button
              label={t("rooms.detail.primary.undo")}
              onPress={handleUndo}
              variant="secondary"
              size="lg"
            />
          ) : null}
        </View>
      </View>

      <ReportIssueModal visible={showReportIssue} roomId={room.id} roomNumber={room.room_number} onClose={() => setShowReportIssue(false)} />
      <FoundItemModal visible={showFoundItem} roomId={room.id} roomNumber={room.room_number} onClose={() => setShowFoundItem(false)} />
      <SupplyRequestModal visible={showSupplyRequest} roomId={room.id} roomNumber={room.room_number} onClose={() => setShowSupplyRequest(false)} />

      <KnockModal visible={showKnockModal} onConfirm={handleKnockConfirm} />

      <Modal visible={customOpen} transparent animationType="slide" onRequestClose={() => setCustomOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCustomOpen(false)}>
          <TouchableOpacity style={[styles.modalSheet, { paddingBottom: insets.bottom + 16, backgroundColor: theme.surface }]} activeOpacity={1}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{t("rooms.detail.customFlag.title")}</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, color: theme.textPrimary }]}
              value={customText}
              onChangeText={setCustomText}
              placeholder={t("rooms.detail.customFlag.placeholder")}
              placeholderTextColor={theme.textMuted}
              multiline
              numberOfLines={3}
              autoFocus
            />
            <View style={[styles.noteActions, { borderTopColor: theme.borderSubtle }]}>
              <Button
                label={t("rooms.detail.customFlag.add")}
                icon="send"
                onPress={() => {
                  void submitNote(customText).then(() => {
                    setCustomText("");
                    setCustomOpen(false);
                  });
                }}
                loading={noteLoading}
                disabled={!customText.trim() || noteLoading}
                size="sm"
              />
              <TouchableOpacity
                onPress={() => setCustomOpen(false)}
                style={styles.inlineTextButton}
                accessibilityRole="button"
                accessibilityLabel={t("rooms.detailActions.cancel")}
              >
                <Text style={[styles.noteCancelText, { color: theme.textMuted }]}>{t("rooms.detailActions.cancel")}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, padding: 2, minHeight: 44 },
  backLabel: { fontSize: 15, fontWeight: "600" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, gap: 14 },

  hero: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 12 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  roomEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  roomNum: { fontFamily: monoFont, fontSize: 48, lineHeight: 52, fontWeight: "800" },
  heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  heroMetaText: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, fontWeight: "700" },

  depBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  depBannerCopy: { flex: 1 },
  depBannerTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.9, textTransform: "uppercase" },
  depBannerSub: { fontSize: 12, fontWeight: "600", marginTop: 1 },

  aiInsightCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  aiInsightHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiInsightTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  aiInsightRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  aiInsightDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  aiInsightText: { flex: 1, fontSize: 13, lineHeight: 18 },
  aiAskBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 3, minHeight: 44, borderRadius: 10, borderWidth: 1,
  },
  aiAskText: { fontSize: 12.5, fontWeight: "800" },

  cleanTypeChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  cleanTypeChipText: { fontSize: 12, fontWeight: "800" },

  warningSection: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  warningTitle: { fontSize: 16, fontWeight: "900" },
  warningRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: 12, padding: 10, borderWidth: 1 },
  warningCopy: { flex: 1, gap: 2 },
  warningHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  warningLabel: { fontSize: 13, fontWeight: "800" },
  warningDetail: { fontSize: 12, lineHeight: 17 },
  removeNoteText: { fontSize: 12, fontWeight: "900" },
  inlineTextButton: { minHeight: 44, justifyContent: "center" },

  cardSection: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  mutedText: { fontSize: 13 },
  infoGrid: { gap: 8 },
  infoRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 14, borderBottomWidth: 1, paddingBottom: 7 },
  infoRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  infoLabel: { fontSize: 12, fontWeight: "700" },
  infoValue: { fontSize: 13, fontWeight: "700", textAlign: "right", flexShrink: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  noteSuccessText: { fontSize: 12, fontWeight: "700" },
  cleanSuccessText: { fontSize: 12, fontWeight: "800" },

  blockerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  blockerBtn: {
    minWidth: "47%", flexGrow: 1, borderWidth: 1,
    borderRadius: 12, minHeight: 44, paddingVertical: 12, paddingHorizontal: 10, alignItems: "center",
  },
  blockerBtnContent: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockerText: { fontSize: 13, fontWeight: "800" },
  blockerBtnCustom: {
    minWidth: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    borderWidth: 1, borderStyle: "dashed",
    borderRadius: 12, minHeight: 44, paddingVertical: 12, paddingHorizontal: 10,
  },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  modalTitle: { fontSize: 15, fontWeight: "900" },
  modalInput: {
    minHeight: 88, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingTop: 10, fontSize: 14, textAlignVertical: "top",
  },
  btnDisabled: { opacity: 0.5 },

  timeEntry: { gap: 9, borderTopWidth: 1, paddingTop: 11 },
  timeEntryLabel: { fontSize: 12.5, fontWeight: "700" },
  timeChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  timeChip: {
    minHeight: 44, borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 13, alignItems: "center", justifyContent: "center",
  },
  timeChipText: { fontSize: 12.5, fontWeight: "700" },
  timeEntryActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  timeInput: {
    flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, fontSize: 13,
  },

  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionChip: {
    flex: 1, minWidth: "47%", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, borderRadius: 10, minHeight: 46, paddingHorizontal: 12,
    borderWidth: 1,
  },
  actionChipText: { fontSize: 12, fontWeight: "800" },
  noteForm: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  noteInput: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, fontSize: 13, minHeight: 64, textAlignVertical: "top" },
  noteActions: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  noteCancelText: { fontSize: 12, fontWeight: "700" },

  stickyAction: {
    position: "absolute", left: 0, right: 0, bottom: 0, gap: 9,
    paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1,
  },
  inProgressBlockText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  stickyStatusRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  stickyStatusText: { fontSize: 13, fontWeight: "800" },
  stickyLastAction: { flex: 1, fontSize: 11.5, minWidth: 0 },
  stickyButtons: { flexDirection: "row", gap: 10 },
  primaryBtnFlex: { flex: 1 },
});
