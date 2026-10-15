import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AddTaskSheet, type CreatedTask } from "@/components/tasks/AddTaskSheet";
import { ActivityNotesSheet } from "@/components/tasks/ActivityNotesSheet";
import { CompleteTaskSheet, type CompletePhase } from "@/components/tasks/CompleteTaskSheet";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import { UnableToCompleteSheet } from "@/components/tasks/UnableToCompleteSheet";
import { TaskCard, type TaskCardVariant } from "@/components/tasks/TaskCard";
import { TaskSyncSheet } from "@/components/tasks/TaskSyncSheet";
import { TasksHeader, type Segment, type SummaryValue } from "@/components/tasks/TasksHeader";
import { formatHotelTime, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { addTaskComment, fetchTask, TASK_NOTE_MAX, type BlockerReason, type Task } from "@/lib/api/tasks";
import { linkFailureOutcome } from "@/lib/tasks/taskLink";
import { validateBlockerDraft } from "@/lib/tasks/blockers";
import { newRequestId } from "@/lib/tasks/addTask/draft";
import { conflictReason, type TaskAction, type Viewer } from "@/lib/tasks/taskActions";
import { buildWorkBuckets } from "@/lib/tasks/workQueue";
import { useWorkQueue, type ListState, type MutationResult } from "@/lib/tasks/useWorkQueue";
import { checkQueueable } from "@/lib/tasks/offline/outboxPolicy";
import { buildSyncRows, deriveSyncKey } from "@/lib/tasks/offline/syncStatus";
import { taskScope } from "@/lib/tasks/offline/taskCache";
import { entriesForCurrentUser, flushTaskOutbox, useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { useTaskOutboxSync } from "@/lib/tasks/offline/useTaskOutboxSync";

const MAX_FONT_SCALE = 1.5;
const CLOCK_TICK_MS = 60_000;

type Row =
  | { key: string; kind: "intro" }
  | { key: string; kind: "header"; section: "pendingSync" | "needsAttention" | "nextUp" | "inProgress" | "upNext" | "later" | "available"; count?: number; toggle?: boolean; open?: boolean }
  | { key: string; kind: "card"; task: Task; variant: TaskCardVariant };

function dateLabel(now: Date, zone: string | null, language: string): string {
  return now.toLocaleDateString(language.startsWith("es") ? "es-US" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: resolveTimeZone(zone),
  });
}

type Failure = Extract<MutationResult, { ok: false }>;
type Sheet = "detail" | "complete" | "notes" | "blocker";

/** An unsent "Unable to complete?" form. Kept in memory (this session only) until it is sent or cancelled. */
interface BlockerDraft {
  taskId: string;
  reason: BlockerReason | null;
  details: string;
  /** Idempotency key, reused by every resend of this draft so a retry can never report twice. */
  requestId: string;
}
/** Where a sheet was opened from, so closing it lands back where the employee was. */
type Origin = "list" | "detail";

const SPECIFIC_REASONS = new Set(["completed", "cancelled", "reassigned", "claimed", "unavailable", "blocked"]);

/** Plain-language reason for a refused/failed lifecycle request (sheet or list), or null when nothing should be said. */
function failureText(
  t: (key: string) => string,
  action: TaskAction,
  failure: Failure,
  viewer: Viewer,
): string | null {
  if (failure.code === "busy") return null;
  if (failure.code === "offline") return t("tasks.hk.sheet.reason.offline");
  if (failure.code === "conflict" && failure.current !== undefined) {
    const reason = conflictReason(action, failure.current, viewer);
    if (SPECIFIC_REASONS.has(reason)) return t(`tasks.hk.sheet.reason.${reason}`);
  }
  if (failure.uncertain) return t("tasks.hk.sheet.reason.uncertain");
  const key = messageKey(action, failure);
  return key ? t(key) : null;
}

function messageKey(action: TaskAction, result: Failure): string | null {
  if (result.code === "busy") return null;
  if (result.code === "offline") return "tasks.hk.msg.offline";
  if (action === "resume") return result.code === "conflict" ? "tasks.hk.msg.resumeConflict" : "tasks.hk.msg.resumeFailed";
  if (action === "claim") return result.code === "conflict" ? "tasks.hk.msg.claimConflict" : "tasks.hk.msg.claimFailed";
  if (action === "start") return result.code === "conflict" ? "tasks.hk.msg.startConflict" : "tasks.hk.msg.startFailed";
  return result.code === "conflict" ? "tasks.hk.msg.completeConflict" : "tasks.hk.msg.completeFailed";
}

function Skeleton() {
  const theme = useTheme();
  return (
    <View style={styles.skeletonStack} testID="tasks-skeleton" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]} />
      ))}
    </View>
  );
}

interface HousekeeperTasksScreenProps {
  /** A task a tapped notification pointed at. Only an id: the screen re-reads it as the signed-in person. */
  linkedTaskId?: string | null;
  onLinkHandled?: () => void;
  /** Open the Add Task sheet (single use; `onAddHandled` clears the request). */
  openAdd?: boolean;
  /** Text to start the new task's description with. */
  addPrefill?: string | null;
  onAddHandled?: () => void;
}

export function HousekeeperTasksScreen({ linkedTaskId = null, onLinkHandled, openAdd = false, addPrefill = null, onAddHandled }: HousekeeperTasksScreenProps = {}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const { isOnline, hotelTimezone, user, myRooms } = useAppStore();
  const zone = hotelTimezone ?? null;
  const viewer = useMemo<Viewer>(() => ({ userId: user?.id ?? null, role: user?.role ?? null }), [user?.id, user?.role]);

  const scope = taskScope(user);
  const queue = useWorkQueue({ isOnline, timeZone: zone, userId: viewer.userId, scope });
  const { mine, available, done } = queue;

  // Completions saved on this device (this person + hotel only), until the server confirms them.
  useTaskOutboxSync(isOnline);
  const outboxEntries = useTaskOutbox((state) => entriesForCurrentUser(state));
  const outboxSending = useTaskOutbox((state) => state.sending);
  const syncRows = useMemo(() => buildSyncRows(outboxEntries, outboxSending), [outboxEntries, outboxSending]);
  const queuedById = useMemo(() => new Map(syncRows.map((row) => [row.taskId, row])), [syncRows]);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const [segment, setSegment] = useState<Segment>("mine");
  const [laterOpen, setLaterOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // `task` is set for a just-created task: the banner then offers "View task" and stays a little longer.
  const [success, setSuccess] = useState<{ text: string; task?: Task } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addInitialText, setAddInitialText] = useState<string | null>(null);
  useEffect(() => {
    if (!openAdd) return;
    setAddInitialText(addPrefill);
    setAddOpen(true);
    onAddHandled?.();
  }, [openAdd, addPrefill, onAddHandled]);

  // One sheet at a time: opening another replaces it, so sheets never stack or fight over gestures.
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  const [origin, setOrigin] = useState<Origin>("list");
  const [notice, setNotice] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState("");
  const [completePhase, setCompletePhase] = useState<CompletePhase>("confirm");
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const completeLock = useRef(false);
  const [blockerDraft, setBlockerDraft] = useState<BlockerDraft | null>(null);
  const [blockerError, setBlockerError] = useState<string | null>(null);
  const [blockerSending, setBlockerSending] = useState(false);
  const blockerLock = useRef(false);

  // Relative labels ("12m overdue") re-evaluate on data changes and once a minute.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(), [mine.tasks, available.tasks, tick]);

  // Counts include saved completions (the server has not confirmed them, so they are still unfinished);
  // the lists show those tasks once, in their own "Pending sync" section.
  const allBuckets = useMemo(() => buildWorkBuckets(mine.tasks, now), [mine.tasks, now]);
  const buckets = useMemo(
    () => buildWorkBuckets(mine.tasks.filter((task) => !queuedById.has(task.id)), now),
    [mine.tasks, queuedById, now],
  );
  const mineKnown = mine.status === "ready";
  const availableKnown = available.status === "ready";

  const summary = {
    remaining: { value: mineKnown ? allBuckets.remaining : null, atLeast: mine.truncated } as SummaryValue,
    inProgress: { value: mineKnown ? allBuckets.started : null } as SummaryValue,
    doneToday: { value: done.value ? done.value.count : null, atLeast: done.value?.atLeast } as SummaryValue,
  };
  const counts = {
    mine: mineKnown ? allBuckets.remaining + allBuckets.started : null,
    // Offline the pool is unknown: a saved copy of it must never look claimable.
    available: availableKnown && isOnline ? available.tasks.length : null,
  };

  const sync = deriveSyncKey({
    isOnline,
    entries: outboxEntries,
    sending: outboxSending,
    refreshing: queue.refreshing || queue.busyIds.size > 0,
    stale: mine.stale || available.stale,
  });

  // A success line clears itself; it never needs dismissing.
  useEffect(() => {
    if (!success) return;
    const id = setTimeout(() => setSuccess(null), success.task ? 8000 : 4000);
    return () => clearTimeout(id);
  }, [success]);

  const closeSheets = useCallback(() => {
    setSheet(null);
    setSheetTask(null);
    setNotice(null);
    setCompleteNote("");
    setCompleteError(null);
    setCompletePhase("confirm");
    setBlockerError(null);
  }, []);

  const openDetails = useCallback(
    (task: Task) => {
      if (sheet) return; // repeated taps never open a second sheet
      setSheetTask(task);
      setNotice(null);
      setOrigin("list");
      setSheet("detail");
    },
    [sheet],
  );

  // A tapped notification: fetch the task as THIS signed-in person and open it only if the server still shows
  // it to them. Nothing is read from the cache, so another account's data can never surface here.
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedTaskId) {
      handledLink.current = null; // a later tap on the same task is a new request
      return;
    }
    if (!viewer.userId || handledLink.current === linkedTaskId) return;
    handledLink.current = linkedTaskId;
    const forUser = viewer.userId;
    const finish = () => onLinkHandled?.();
    if (!isOnline) {
      setMessage(t("tasks.hk.link.offline"));
      finish();
      return;
    }
    fetchTask(linkedTaskId)
      .then((task) => {
        if (useAppStore.getState().user?.id !== forUser) return; // the account changed while we were asking
        setMessage(null);
        setSheetTask(task);
        setNotice(null);
        setOrigin("list");
        setSheet("detail");
      })
      .catch((error) => {
        if (useAppStore.getState().user?.id !== forUser) return;
        setMessage(t(linkFailureOutcome(error) === "retry" ? "tasks.hk.link.retry" : "tasks.hk.link.unavailable"));
      })
      .finally(finish);
  }, [linkedTaskId, viewer.userId, isOnline, t, onLinkHandled]);

  // The lists are re-read after every change; an open sheet follows its task.
  useEffect(() => {
    if (!sheetTask) return;
    const fresher = [...mine.tasks, ...available.tasks].find((candidate) => candidate.id === sheetTask.id);
    if (fresher && fresher !== sheetTask) setSheetTask(fresher);
  }, [mine.tasks, available.tasks]);

  const queuedForSheet = sheetTask ? (queuedById.get(sheetTask.id) ?? null) : null;
  // A refused item's snapshot is the server's latest word; keep the open sheet on it.
  useEffect(() => {
    if (queuedForSheet && sheetTask && queuedForSheet.state !== "pending" && queuedForSheet.state !== "sending") {
      if (queuedForSheet.entry.task.status !== sheetTask.status || queuedForSheet.entry.task.assigned_to !== sheetTask.assigned_to) {
        setSheetTask(queuedForSheet.entry.task);
      }
    }
  }, [queuedForSheet?.entry.task]);

  const adoptRefreshed = useCallback((task: Task) => {
    setSheetTask((current) => (current && current.id === task.id ? task : current));
  }, []);

  /** Start / claim from a card button or from the detail sheet — one code path for both. */
  const run = useCallback(
    async (action: "start" | "claim" | "resume", task: Task, fromSheet: boolean) => {
      setMessage(null);
      setNotice(null);
      if (action === "resume" && !task.blocker) return;
      const result =
        action === "resume" && task.blocker ? await queue.resume(task.id, task.blocker.id) : await queue[action === "resume" ? "start" : action](task.id);
      if (result.ok) {
        if (fromSheet && result.task) setSheetTask(result.task);
        return;
      }
      const text = failureText(t, action, result, viewer);
      if (fromSheet) {
        if (result.current) setSheetTask(result.current);
        if (result.current === null) {
          closeSheets();
          if (text) setMessage(text);
        } else if (text) {
          setNotice(text);
        }
      } else if (text) {
        setMessage(text);
      }
    },
    [queue, t, viewer, closeSheets],
  );

  const openComplete = useCallback(
    (task: Task, from: Origin) => {
      if (sheet && sheet !== "detail") return;
      setSheetTask(task);
      setOrigin(from);
      setCompleteNote("");
      setCompleteError(null);
      setCompletePhase("confirm");
      setNotice(null);
      setSheet("complete");
    },
    [sheet],
  );

  const onPrimary = useCallback(
    (task: Task, variant: TaskCardVariant) => {
      if (sheet) return;
      if (variant === "inProgress") {
        openComplete(task, "list"); // completion is never one accidental tap
      } else if (variant === "available") {
        void run("claim", task, false);
      } else {
        void run("start", task, false);
      }
    },
    [run, openComplete, sheet],
  );

  const backFromComplete = useCallback(() => {
    if (completing) return;
    setCompleteError(null);
    setCompleteNote("");
    setCompletePhase("confirm");
    if (origin === "detail") setSheet("detail");
    else closeSheets();
  }, [completing, origin, closeSheets]);

  const finishCompleted = useCallback(() => {
    closeSheets();
    setSuccess({ text: t("tasks.hk.msg.completed") });
  }, [closeSheets, t]);

  const confirmComplete = useCallback(async () => {
    if (!sheetTask || completeLock.current) return;
    completeLock.current = true;
    setCompleting(true);
    setCompleteError(null);
    try {
      const note = completeNote.trim();
      if (!isOnline) {
        // Offline: save it durably first; it is "done" only once the server confirms it.
        const saved = await useTaskOutbox.getState().enqueueComplete(sheetTask, note);
        if (saved.ok) {
          closeSheets();
          setSuccess({ text: t("tasks.hk.offline.complete.queued") });
        } else {
          setCompleteError(t(`tasks.hk.offline.complete.refusal.${saved.reason}`));
        }
        return;
      }
      const result = await queue.complete(sheetTask.id, note || undefined);
      if (result.ok) {
        if (note && result.noteSaved === false) {
          // Completed, but the note was not stored: say so and keep the note for a retry.
          if (result.task) setSheetTask(result.task);
          setCompletePhase("noteFailed");
        } else {
          finishCompleted();
        }
        return;
      }
      if (result.current) setSheetTask(result.current);
      const text = failureText(t, "complete", result, viewer);
      if (text) setCompleteError(text);
    } finally {
      completeLock.current = false;
      setCompleting(false);
    }
  }, [sheetTask, completeNote, queue, viewer, t, finishCompleted, isOnline, closeSheets]);

  const offlineRefusal = !isOnline && sheet === "complete" && sheetTask ? checkQueueable(sheetTask, viewer, outboxEntries, completeNote, TASK_NOTE_MAX) : null;

  const retryCompletionNote = useCallback(async () => {
    if (!sheetTask || completeLock.current || !completeNote.trim()) return;
    completeLock.current = true;
    setCompleting(true);
    setCompleteError(null);
    try {
      await addTaskComment(sheetTask.id, completeNote);
      finishCompleted();
    } catch {
      setCompleteError(t("tasks.hk.sheet.notes.postFailed"));
    } finally {
      completeLock.current = false;
      setCompleting(false);
    }
  }, [sheetTask, completeNote, t, finishCompleted]);

  /** Open "Unable to complete?" from Task Detail. The task is not touched until the employee sends. */
  const openBlocker = useCallback(
    (task: Task) => {
      if (sheet && sheet !== "detail") return;
      setSheetTask(task);
      setBlockerError(null);
      setBlockerDraft((draft) =>
        draft && draft.taskId === task.id ? draft : { taskId: task.id, reason: null, details: "", requestId: newRequestId() },
      );
      setSheet("blocker");
    },
    [sheet],
  );

  const leaveBlocker = useCallback(() => {
    if (blockerSending) return;
    setBlockerError(null);
    setSheet("detail");
  }, [blockerSending]);

  const cancelBlocker = useCallback(() => {
    if (blockerSending) return;
    setBlockerDraft(null);
    leaveBlocker();
  }, [blockerSending, leaveBlocker]);

  const submitBlocker = useCallback(async () => {
    if (!sheetTask || !blockerDraft || blockerLock.current) return;
    if (validateBlockerDraft(blockerDraft.reason, blockerDraft.details) !== null || !blockerDraft.reason) return;
    if (!isOnline) {
      setBlockerError(t("tasks.hk.blocker.offline"));
      return;
    }
    blockerLock.current = true;
    setBlockerSending(true);
    setBlockerError(null);
    try {
      const result = await queue.reportProblem(sheetTask.id, {
        reason: blockerDraft.reason,
        details: blockerDraft.details,
        clientRequestId: blockerDraft.requestId,
      });
      if (result.ok) {
        // The server stored it: only now is it "reported". Back to the task, which shows the saved report.
        if (result.task) setSheetTask(result.task);
        setBlockerDraft(null);
        setSheet("detail");
        return;
      }
      if (result.code === "offline") {
        setBlockerError(t("tasks.hk.blocker.offline"));
        return;
      }
      if (result.current) setSheetTask(result.current);
      const fixed: Record<string, string> = {
        blocker_already_active: "alreadyReported",
        task_closed: "closed",
        task_changed: "changed",
        not_assignee: "reassigned",
      };
      const key = result.code === "conflict" && result.errorCode ? fixed[result.errorCode] : undefined;
      if (key || result.current === null) {
        // The form can not succeed as written: say why and return to the task as the server has it.
        setBlockerDraft(null);
        const text = t(`tasks.hk.blocker.error.${key ?? "unavailable"}`);
        if (result.current === null) {
          closeSheets();
          setMessage(text);
        } else {
          setNotice(text);
          setSheet("detail");
        }
        return;
      }
      // Network trouble or a server error: keep everything typed; resending is safe (same request id).
      setBlockerError(t(result.uncertain ? "tasks.hk.blocker.error.uncertain" : "tasks.hk.blocker.error.failed"));
    } finally {
      blockerLock.current = false;
      setBlockerSending(false);
    }
  }, [sheetTask, blockerDraft, isOnline, queue, t, closeSheets]);

  const openNotes = useCallback(
    (task: Task, from: Origin) => {
      if (sheet && sheet !== "detail") return;
      setSheetTask(task);
      setOrigin(from);
      setSheet("notes");
    },
    [sheet],
  );

  const closeNotes = useCallback(() => {
    if (origin === "detail") setSheet("detail");
    else closeSheets();
  }, [origin, closeSheets]);

  const canOpenRoom = !!sheetTask?.room_id && (myRooms ?? []).some((room) => room.id === sheetTask.room_id);
  const openRoom = useCallback(() => {
    const roomId = sheetTask?.room_id;
    if (!roomId) return;
    closeSheets();
    router.push(`/(app)/my-rooms/${roomId}` as never);
  }, [sheetTask?.room_id, closeSheets]);

  const list: ListState = segment === "mine" ? mine : available;
  const nothingElse = !buckets.nextUp && buckets.inProgress.length === 0 && buckets.upNext.length === 0;
  const laterVisible = laterOpen || nothingElse;

  const rows = useMemo<Row[]>(() => {
    if (segment === "available") {
      if (!isOnline) return [];
      const out: Row[] = [{ key: "intro", kind: "intro" }];
      if (available.tasks.length > 0) {
        out.push({ key: "h-available", kind: "header", section: "available", count: available.tasks.length });
        for (const task of available.tasks) out.push({ key: `a-${task.id}`, kind: "card", task, variant: "available" });
      }
      return out;
    }
    const out: Row[] = [];
    if (syncRows.length > 0) {
      // Saved on this device, not yet confirmed: always visible, never mixed in with confirmed work.
      out.push({ key: "h-sync", kind: "header", section: "pendingSync", count: syncRows.length });
      for (const row of syncRows) {
        const task = row.state === "pending" || row.state === "sending" ? (mine.tasks.find((c) => c.id === row.taskId) ?? row.entry.task) : row.entry.task;
        out.push({ key: `q-${task.id}`, kind: "card", task, variant: "inProgress" });
      }
    }
    if (buckets.needsAttention.length > 0) {
      // First, so unfinished work with a problem is never buried; each task is listed once, here.
      out.push({ key: "h-attn", kind: "header", section: "needsAttention", count: buckets.needsAttention.length });
      for (const task of buckets.needsAttention) out.push({ key: `b-${task.id}`, kind: "card", task, variant: "blocked" });
    }
    if (buckets.nextUp) {
      out.push({ key: "h-next", kind: "header", section: "nextUp" });
      out.push({ key: `n-${buckets.nextUp.id}`, kind: "card", task: buckets.nextUp, variant: "hero" });
    }
    if (buckets.inProgress.length > 0) {
      out.push({ key: "h-prog", kind: "header", section: "inProgress", count: buckets.inProgress.length });
      for (const task of buckets.inProgress) out.push({ key: `p-${task.id}`, kind: "card", task, variant: "inProgress" });
    }
    if (buckets.upNext.length > 0) {
      out.push({ key: "h-up", kind: "header", section: "upNext", count: buckets.upNext.length });
      for (const task of buckets.upNext) out.push({ key: `u-${task.id}`, kind: "card", task, variant: "queue" });
    }
    if (buckets.later.length > 0) {
      out.push({ key: "h-later", kind: "header", section: "later", count: buckets.later.length, toggle: !nothingElse, open: laterVisible });
      if (laterVisible) for (const task of buckets.later) out.push({ key: `l-${task.id}`, kind: "card", task, variant: "queue" });
    }
    return out;
  }, [segment, isOnline, available.tasks, buckets, laterVisible, nothingElse, syncRows, mine.tasks]);

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "intro") {
      return (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]}>
          {t("tasks.hk.availableIntro")}
        </Text>
      );
    }
    if (item.kind === "header") {
      const title = t(`tasks.hk.sections.${item.section}`) + (item.count !== undefined ? ` · ${item.count}` : "");
      const body = (
        <View style={styles.sectionHeader}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
            {title}
          </Text>
          {item.toggle ? <Ionicons name={item.open ? "chevron-up" : "chevron-down"} size={16} color={theme.textMuted} /> : null}
        </View>
      );
      return item.toggle ? (
        <Pressable
          onPress={() => setLaterOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={t(item.open ? "tasks.hk.sections.hideLater" : "tasks.hk.sections.showLater")}
          accessibilityState={{ expanded: !!item.open }}
          style={styles.headerPressable}
        >
          {body}
        </Pressable>
      ) : (
        body
      );
    }
    const { task, variant } = item;
    return (
      <TaskCard
        task={task}
        variant={variant}
        now={now}
        zone={zone}
        language={language}
        busy={queue.busyIds.has(task.id)}
        // Offline only "Complete" stays available (it can be saved for sync); start / claim need the server.
        actionsDisabled={!isOnline && variant !== "inProgress"}
        onOpenDetails={() => openDetails(task)}
        onPrimary={() => onPrimary(task, variant)}
        pending={queuedById.has(task.id) ? { state: queuedById.get(task.id)!.state, queuedAt: queuedById.get(task.id)!.entry.queuedAt } : null}
      />
    );
  };

  /* A task the server just confirmed: re-read the lists (their order and membership are the server's),
     show the list it actually landed in, and say honestly where it went. */
  const handleCreated = useCallback(
    ({ task, replayed, destination }: CreatedTask) => {
      void queue.refreshAll();
      if (destination === "mine") setSegment("mine");
      else if (destination === "pool") setSegment("available");
      const key = replayed ? "replayed" : destination;
      setSuccess({
        text: `${t("tasks.hk.add.success.created")}. ${t(`tasks.hk.add.success.${key}`, { title: task.title })}`,
        task,
      });
    },
    [queue, t],
  );

  const reload = segment === "mine" ? queue.reloadMine : queue.reloadAvailable;
  const retry = () => {
    void reload();
  };

  let empty: React.ReactNode = null;
  if (segment === "available" && !isOnline) {
    empty = <EmptyState icon="cloud-offline-outline" title={t("tasks.hk.offline.availableTitle")} body={t("tasks.hk.offline.availableBody")} />;
  } else if (list.status === "loading") {
    empty = <Skeleton />;
  } else if (list.status === "error") {
    empty = (
      <EmptyState
        icon="cloud-offline-outline"
        iconColor={theme.status.dirty}
        title={t("tasks.hk.error.loadTitle")}
        action={<Button label={t("common.retry")} onPress={retry} variant="secondary" icon="refresh" />}
      />
    );
  } else if (segment === "mine" && mine.tasks.length === 0) {
    empty = (
      <EmptyState
        icon="checkmark-circle-outline"
        title={t("tasks.hk.empty.myTitle")}
        body={t("tasks.hk.empty.myBody")}
        action={<Button label={t("tasks.hk.empty.viewAvailable")} onPress={() => setSegment("available")} variant="secondary" />}
      />
    );
  } else if (segment === "available" && available.tasks.length === 0) {
    empty = (
      <EmptyState
        icon="file-tray-outline"
        title={t("tasks.hk.empty.availableTitle")}
        body={t("tasks.hk.empty.availableBody")}
      />
    );
  }

  const savedAt = list.syncedAt ? formatHotelTime(list.syncedAt, zone, language) : null;
  const savedCopy =
    !isOnline && list.status === "ready" && segment === "mine" ? (
      <View style={[styles.banner, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} accessibilityRole="alert" testID="tasks-saved-copy">
        <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
          {savedAt ? t("tasks.hk.offline.cachedList", { time: savedAt }) : t("tasks.hk.offline.cachedListNoTime")}
        </Text>
      </View>
    ) : null;

  const banner = !isOnline ? null : list.stale ? (
    <View style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.pickup }]}>
        {t("tasks.hk.error.staleBanner")}
      </Text>
      <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel={t("common.retry")} style={styles.bannerRetry}>
        <Text style={[styles.bannerRetryText, { color: theme.status.pickup }]}>{t("common.retry")}</Text>
      </Pressable>
    </View>
  ) : list.truncated ? (
    <View style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.pickup }]}>
        {t("tasks.hk.error.incomplete")}
      </Text>
    </View>
  ) : null;

  const messageBanner = message ? (
    <View style={[styles.banner, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.dirty }]}>
        {message}
      </Text>
    </View>
  ) : null;

  const viewCreated = () => {
    const created = success?.task;
    if (!created) return;
    setSuccess(null);
    openDetails(created);
  };

  const successBanner = success ? (
    <View style={[styles.banner, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="tasks-success">
      <Ionicons name="checkmark-circle" size={16} color={theme.status.clean} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.status.clean }]}>
        {success.text}
      </Text>
      {success.task ? (
        <Pressable onPress={viewCreated} accessibilityRole="button" accessibilityLabel={t("tasks.hk.add.success.view")} style={styles.bannerRetry} testID="tasks-success-view">
          <Text style={[styles.bannerRetryText, { color: theme.status.clean }]}>{t("tasks.hk.add.success.view")}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  const detailBusy = !!sheetTask && queue.busyIds.has(sheetTask.id);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <TasksHeader
        dateLabel={dateLabel(now, zone, language)}
        sync={sync}
        summary={summary}
        segment={segment}
        counts={counts}
        onSegmentChange={(next) => setSegment(next)}
        onOpenHistory={() => router.push("/(app)/tasks/history" as never)}
        onOpenSync={() => setSyncOpen(true)}
        topInset={insets.top}
      />
      <FlatList
        data={empty ? [] : rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ListHeaderComponent={
          <View style={styles.banners}>
            {successBanner}
            {messageBanner}
            {savedCopy}
            {banner}
          </View>
        }
        ListEmptyComponent={empty}
        contentContainerStyle={[styles.content, { paddingBottom: 96 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={queue.refreshing} onRefresh={() => void queue.pullToRefresh()} tintColor={theme.primaryAction} />
        }
      />
      <Pressable
        onPress={() => setAddOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("tasks.hk.add.button")}
        style={[styles.addButton, { backgroundColor: theme.primaryAction, bottom: 16 + Math.max(insets.bottom - 8, 0) }]}
        testID="add-task-button"
      >
        <Ionicons name="add" size={22} color={theme.onPrimary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.addText, { color: theme.onPrimary }]}>
          {t("tasks.hk.add.button")}
        </Text>
      </Pressable>
      <TaskDetailSheet
        visible={sheet === "detail"}
        task={sheetTask}
        viewer={viewer}
        zone={zone}
        language={language}
        now={now}
        busy={detailBusy}
        offline={!isOnline}
        notice={notice}
        canOpenRoom={canOpenRoom}
        onClose={closeSheets}
        onTaskRefreshed={adoptRefreshed}
        onAction={(action) => sheetTask && void run(action, sheetTask, true)}
        onRequestComplete={() => sheetTask && openComplete(sheetTask, "detail")}
        onRequestBlocker={() => sheetTask && openBlocker(sheetTask)}
        onOpenNotes={() => sheetTask && openNotes(sheetTask, "detail")}
        onOpenRoom={openRoom}
        queued={queuedForSheet ? { entry: queuedForSheet.entry, state: queuedForSheet.state } : null}
        onRetryQueued={() => sheetTask && void useTaskOutbox.getState().retry(sheetTask.id)}
        onDismissQueued={() => {
          if (!sheetTask) return;
          void useTaskOutbox.getState().dismiss(sheetTask.id).then(() => {
            closeSheets();
            void queue.refreshAll();
          });
        }}
        savedCopySyncedAt={mine.syncedAt}
      />
      <CompleteTaskSheet
        visible={sheet === "complete"}
        task={sheetTask}
        phase={completePhase}
        note={completeNote}
        onNoteChange={setCompleteNote}
        busy={completing}
        offline={!isOnline}
        canSaveOffline={!isOnline && offlineRefusal === null}
        error={completeError ?? (offlineRefusal ? t(`tasks.hk.offline.complete.refusal.${offlineRefusal}`) : null)}
        onConfirm={() => void confirmComplete()}
        onBack={backFromComplete}
        onRetryNote={() => void retryCompletionNote()}
        onSkipNote={finishCompleted}
      />
      <ActivityNotesSheet
        visible={sheet === "notes"}
        task={sheetTask}
        viewer={viewer}
        zone={zone}
        language={language}
        now={now}
        offline={!isOnline}
        onClose={closeNotes}
        onTaskRefreshed={adoptRefreshed}
      />
      <UnableToCompleteSheet
        visible={sheet === "blocker"}
        task={sheetTask}
        reason={blockerDraft && sheetTask && blockerDraft.taskId === sheetTask.id ? blockerDraft.reason : null}
        details={blockerDraft && sheetTask && blockerDraft.taskId === sheetTask.id ? blockerDraft.details : ""}
        onReasonChange={(reason) => setBlockerDraft((draft) => (draft ? { ...draft, reason } : draft))}
        onDetailsChange={(details) => setBlockerDraft((draft) => (draft ? { ...draft, details } : draft))}
        busy={blockerSending}
        offline={!isOnline}
        error={blockerError}
        onSubmit={() => void submitBlocker()}
        onClose={leaveBlocker}
        onCancel={cancelBlocker}
      />
      <AddTaskSheet
        visible={addOpen}
        initialText={addInitialText}
        isOnline={isOnline}
        zone={zone}
        language={language}
        viewer={{ id: viewer.userId, tenantId: user?.tenant_id ?? null, role: viewer.role }}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
      />
      <TaskSyncSheet
        visible={syncOpen}
        isOnline={isOnline}
        rows={syncRows}
        lastSyncedAt={mine.syncedAt}
        syncing={syncBusy || queue.refreshing || Object.keys(outboxSending).length > 0}
        zone={zone}
        language={language}
        onRetry={() => {
          if (syncBusy) return;
          setSyncBusy(true);
          void flushTaskOutbox()
            .then(() => queue.refreshAll())
            .finally(() => setSyncBusy(false));
        }}
        onReview={(taskId) => {
          const row = queuedById.get(taskId);
          if (!row) return;
          setSyncOpen(false);
          const task = mine.tasks.find((candidate) => candidate.id === taskId) ?? row.entry.task;
          setSheetTask(task);
          setNotice(null);
          setOrigin("list");
          setSheet("detail");
        }}
        onClose={() => setSyncOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10, flexGrow: 1 },
  banners: { gap: 8 },
  banner: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  bannerRetry: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  bannerRetryText: { fontSize: 13.5, fontWeight: "800" },
  intro: { fontSize: 13.5, lineHeight: 19, paddingTop: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10 },
  headerPressable: { minHeight: 44, justifyContent: "center" },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9 },
  skeletonStack: { gap: 10, paddingTop: 4 },
  skeleton: { height: 112, borderRadius: 16, borderWidth: 1 },
  addButton: {
    position: "absolute",
    left: 16,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  addText: { fontSize: 15, fontWeight: "800" },
});
