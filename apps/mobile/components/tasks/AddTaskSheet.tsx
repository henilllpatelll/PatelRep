import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { BatchBody, BatchFooter } from "@/components/tasks/addTask/BatchReview";
import { DescribeBody, DescribeFooter } from "@/components/tasks/addTask/DescribeStep";
import { DueEditor } from "@/components/tasks/addTask/DueEditor";
import { LocationEditor } from "@/components/tasks/addTask/LocationEditor";
import { ReviewBody, ReviewFooter, type SubmitProblem } from "@/components/tasks/addTask/ReviewStep";
import type { Task } from "@/lib/api/tasks";
import { useTheme } from "@/lib/theme/useTheme";
import { clearDraft, loadDraft, markAnnounced, ownerKey, saveDraft, wasAnnounced, type DraftStep } from "@/lib/tasks/addTask/draftMemory";
import {
  ADD_TASK_LIMITS,
  emptyDraft,
  hasMeaningfulContent,
  newRequestId,
  toCreateInput,
  validateDraft,
  type DraftErrors,
  type TaskDraft,
} from "@/lib/tasks/addTask/draft";
import {
  batchFromDrafts,
  batchReadiness,
  createdTasks,
  pendingItems,
  reverifyRooms,
  summarizeBatch,
  useBatchCreate,
  withEditedDraft,
  withIncluded,
  type BatchHalt,
  type BatchItem,
} from "@/lib/tasks/addTask/batch";
import { parseTaskRequest, type ParseFailure } from "@/lib/tasks/addTask/parseRequest";
import { useRoomDirectory } from "@/lib/tasks/addTask/rooms";
import { taskDestination, useCreateTask, type TaskDestination } from "@/lib/tasks/addTask/submit";
import { useVoiceInput } from "@/lib/tasks/addTask/useVoiceInput";

/* Add Task: Describe -> Review/Edit -> Create. One sheet, one draft.
   Nothing is saved until "Create task" is pressed and the server answers; AI only fills in the
   draft, and every value can be corrected first. The manual path is the same Review step with an
   empty draft, so both paths share validation and the request payload.

   When the description holds several tasks the Review step lists them as separate cards (include / leave out /
   edit each), creates the included ones one by one through the same request, and reports what the server
   actually stored for each. A retry sends only the ones that are not created yet. */

export interface CreatedTask {
  task: Task;
  /** The server already had this task (a retry of an attempt we never heard back from). */
  replayed: boolean;
  destination: TaskDestination;
}

interface Props {
  visible: boolean;
  /** Starting text for the description when no earlier draft is being continued (e.g. handed over by the assistant). */
  initialText?: string | null;
  /** Start listening as soon as the sheet opens (the person tapped a microphone to get here). */
  autoStartVoice?: boolean;
  isOnline: boolean;
  zone: string | null | undefined;
  language: string;
  viewer: { id: string | null; tenantId: string | null; role: string | null };
  onClose: () => void;
  /** Called once, after the server confirmed the task, with what it stored. */
  onCreated: (created: CreatedTask) => void;
  /** Several tasks: called with the ones the server confirmed, once each, when the person leaves the batch. */
  onBatchCreated?: (created: CreatedTask[]) => void;
  /** The person tapped "View task" on a created task: the sheet closes and the screen opens it. */
  onOpenTask?: (task: Task) => void;
}

type SheetView = "main" | "location" | "due" | "discard";

/** Errors that describe what the AI/person already set are always shown; "required" ones wait for a Create attempt. */
function revealedErrors(errors: DraftErrors, attempted: boolean): DraftErrors {
  if (attempted) return errors;
  const shown: DraftErrors = {};
  if (errors.location === "unverified") shown.location = "unverified";
  if (errors.due) shown.due = errors.due;
  if (errors.priority) shown.priority = errors.priority;
  if (errors.type) shown.type = errors.type;
  return shown;
}

/** Manual entry starts from what was typed: a short line becomes the title, longer text the description. */
function prefillFromRequest(draft: TaskDraft): TaskDraft {
  const text = draft.requestText.trim();
  if (!text) return draft;
  const next = { ...draft };
  if (!next.title.trim() && text.length <= ADD_TASK_LIMITS.title && !text.includes("\n")) next.title = text;
  else if (!next.description.trim()) next.description = text.slice(0, ADD_TASK_LIMITS.description);
  return next;
}

export function AddTaskSheet({
  visible,
  initialText = null,
  autoStartVoice = false,
  isOnline,
  zone,
  language,
  viewer,
  onClose,
  onCreated,
  onBatchCreated,
  onOpenTask,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const owner = ownerKey(viewer.tenantId, viewer.id);
  const isHousekeeper = viewer.role === "housekeeper";

  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(viewer.role));
  const [step, setStep] = useState<DraftStep>("describe");
  const [parsedText, setParsedText] = useState<string | null>(null);
  const [view, setView] = useState<SheetView>("main");
  const [parsing, setParsing] = useState(false);
  const [failure, setFailure] = useState<ParseFailure | null>(null);
  const [noTask, setNoTask] = useState(false);
  const [restored, setRestored] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<SubmitProblem | null>(null);
  const [voiceAdded, setVoiceAdded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  /** Several suggested tasks under review, or null for the ordinary single-task form. */
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [halted, setHalted] = useState<BatchHalt | null>(null);
  const [batchAttempted, setBatchAttempted] = useState(false);
  /** The suggestion being edited, in the same form the single task uses. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TaskDraft | null>(null);
  const parseTicket = useRef(0);
  const batchRef = useRef<BatchItem[] | null>(null);
  batchRef.current = batch;
  const create = useCreateTask();
  const creating = useBatchCreate();

  const editing = editingKey !== null && editDraft !== null;
  const active = editing ? (editDraft as TaskDraft) : draft;

  const rooms = useRoomDirectory(owner, visible && step === "review");

  // Every suggested room is checked against the hotel's own room directory once it has loaded.
  useEffect(() => {
    if (rooms.status !== "ready") return;
    setBatch((current) => (current ? reverifyRooms(current, rooms.rooms) : current));
  }, [rooms.status, rooms.rooms]);

  const voice = useVoiceInput({
    language,
    onTranscript: (text) => {
      setVoiceAdded(true);
      setDraft((current) => {
        const joined = current.requestText.trim() ? `${current.requestText.trim()} ${text}` : text;
        return { ...current, requestText: joined.slice(0, ADD_TASK_LIMITS.request) };
      });
      setFailure(null);
      setNoTask(false);
    },
  });

  /* Open: continue the in-memory draft of THIS hotel+user, otherwise start fresh. */
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      const held = loadDraft(owner);
      if (held) {
        setDraft(held.draft);
        setStep(held.step);
        setParsedText(held.parsedText);
        // A request that was in flight when the sheet was kept never got an answer: it is simply unsent again.
        setBatch(held.batch ? held.batch.map((item) => (item.status === "creating" ? { ...item, status: "ready" as const } : item)) : null);
        setRestored(hasMeaningfulContent(held.draft));
      } else {
        const fresh = emptyDraft(viewer.role);
        setDraft(initialText?.trim() ? { ...fresh, requestText: initialText.trim().slice(0, ADD_TASK_LIMITS.request) } : fresh);
        setStep("describe");
        setParsedText(null);
        setBatch(null);
        setRestored(false);
      }
      setView("main");
      setParsing(false);
      setFailure(null);
      setNoTask(false);
      setAttempted(false);
      setSubmitProblem(null);
      setVoiceAdded(false);
      setHalted(null);
      setBatchAttempted(false);
      setEditingKey(null);
      setEditDraft(null);
      setNow(new Date());
    }
    wasVisible.current = visible;
  }, [visible, owner, viewer.role, initialText]);

  /* Listening starts only because the person tapped a microphone to open the sheet, and only once per opening. */
  const voiceStarted = useRef(false);
  useEffect(() => {
    if (!visible) {
      voiceStarted.current = false;
      return;
    }
    if (autoStartVoice && !voiceStarted.current && voice.supported && step === "describe" && voice.state === "idle") {
      voiceStarted.current = true;
      voice.toggle();
    }
  }, [visible, autoStartVoice, voice, step]);

  /* Keep the draft while the sheet is open, so dismissing it by accident loses nothing. */
  useEffect(() => {
    if (visible && hasMeaningfulContent(draft)) saveDraft(owner, { draft, step, parsedText, batch });
  }, [visible, owner, draft, step, parsedText, batch]);

  const patch = useCallback((changes: Partial<TaskDraft>) => {
    if (editing) setEditDraft((current) => (current ? { ...current, ...changes } : current));
    else setDraft((current) => ({ ...current, ...changes }));
    setSubmitProblem(null);
  }, [editing]);

  /** Tell the Tasks screen about tasks the server created, once each (also for a draft kept for later). */
  const announceCreated = useCallback(() => {
    const fresh = createdTasks(batchRef.current ?? []).filter((created) => !wasAnnounced(created.task.id));
    if (fresh.length === 0) return;
    fresh.forEach((created) => markAnnounced(created.task.id));
    onBatchCreated?.(fresh);
  }, [onBatchCreated]);

  const resetAndClose = useCallback(() => {
    parseTicket.current += 1;
    announceCreated();
    setView("main");
    setEditingKey(null);
    setEditDraft(null);
    onClose();
  }, [onClose, announceCreated]);

  const batchSummary = batch ? summarizeBatch(batch) : null;
  const batchPending = batch ? pendingItems(batch).length : 0;

  const requestClose = useCallback(() => {
    if (create.busy || creating.busy) return; // a request is in flight; wait for the server's answer
    if (view === "location" || view === "due" || view === "discard") {
      setView("main");
      return;
    }
    if (editing) {
      setEditingKey(null);
      setEditDraft(null);
      return;
    }
    if (batch && batchSummary) {
      // Everything the person kept is already created: nothing to lose, nothing to ask.
      if (batchSummary.created > 0 && batchPending === 0) {
        clearDraft();
        resetAndClose();
        return;
      }
      if (batchSummary.created > 0 || hasMeaningfulContent(draft)) {
        setView("discard");
        return;
      }
    }
    if (hasMeaningfulContent(draft)) setView("discard");
    else resetAndClose();
  }, [create.busy, creating.busy, view, editing, batch, batchSummary, batchPending, draft, resetAndClose]);

  /* ── Describe ───────────────────────────────────────────────────────── */

  const text = draft.requestText;
  const trimmed = text.trim();

  const goToReview = useCallback((next: TaskDraft) => {
    setDraft(next);
    setStep("review");
    setAttempted(false);
    setSubmitProblem(null);
    setNow(new Date());
  }, []);

  const onContinue = useCallback(async () => {
    if (!trimmed || parsing || !isOnline) return;
    setFailure(null);
    setNoTask(false);
    // Same description as the suggestions were made from: go back to the review with the edits intact.
    if (parsedText === trimmed && (draft.aiSuggested || batch)) {
      setStep("review");
      return;
    }
    const ticket = ++parseTicket.current;
    setParsing(true);
    const result = await parseTaskRequest(trimmed, { isOnline, zone, role: viewer.role });
    if (ticket !== parseTicket.current) return; // closed or restarted meanwhile
    setParsing(false);
    if (result.status === "ok") {
      setParsedText(trimmed);
      if (result.drafts.length >= 2) {
        // Several tasks: review them together. The original description stays in `draft` for recovery.
        setBatch(batchFromDrafts(result.drafts));
        setHalted(null);
        setBatchAttempted(false);
        goToReview({ ...draft, requestText: text, aiSuggested: true });
      } else {
        setBatch(null);
        goToReview({ ...result.draft, requestId: draft.requestId, requestText: text });
      }
    } else if (result.status === "none") {
      setNoTask(true);
    } else {
      setFailure(result.reason);
    }
  }, [trimmed, parsing, isOnline, parsedText, draft, batch, text, zone, viewer.role, goToReview]);

  const onManual = useCallback(() => {
    parseTicket.current += 1;
    setParsing(false);
    // Entering the task by hand leaves any unsent suggestions behind (tasks already created are never in the way:
    // once one exists the person can no longer go back to the description).
    setBatch(null);
    goToReview(draft.aiSuggested && !batch ? draft : prefillFromRequest({ ...draft, aiSuggested: false }));
  }, [draft, batch, goToReview]);

  /* ── Review: one task ───────────────────────────────────────────────── */

  const validation = useMemo(() => validateDraft(active, zone, now), [active, zone, now]);
  const shownErrors = revealedErrors(validation.errors, attempted);

  const onCreate = useCallback(async () => {
    setAttempted(true);
    const fresh = new Date();
    setNow(fresh);
    const checked = validateDraft(draft, zone, fresh);
    const input = toCreateInput(draft, checked, viewer.id);
    if (!input) return;
    setSubmitProblem(null);
    const outcome = await create.submit(input, isOnline);
    if (!outcome) return; // a second tap while the first request was running
    if (outcome.kind === "created") {
      clearDraft();
      onCreated({ task: outcome.task, replayed: outcome.replayed, destination: taskDestination(outcome.task, viewer) });
      setDraft(emptyDraft(viewer.role));
      setStep("describe");
      setParsedText(null);
      resetAndClose();
      return;
    }
    if (outcome.kind === "rejected" || outcome.kind === "forbidden") {
      // The server refused, so nothing was created: a corrected retry gets a fresh key.
      setDraft((current) => ({ ...current, requestId: newRequestId() }));
    }
    setSubmitProblem(outcome.kind);
  }, [draft, zone, viewer, isOnline, create, onCreated, resetAndClose]);

  /* ── Review: several tasks ──────────────────────────────────────────── */

  const startEdit = useCallback(
    (key: string) => {
      const item = batch?.find((candidate) => candidate.key === key);
      if (!item || item.status === "created") return;
      setEditingKey(key);
      setEditDraft(item.draft);
      setAttempted(false);
      setView("main");
      setNow(new Date());
    },
    [batch],
  );

  const saveEdit = useCallback(() => {
    if (editingKey && editDraft) setBatch((current) => (current ? withEditedDraft(current, editingKey, editDraft) : current));
    setEditingKey(null);
    setEditDraft(null);
  }, [editingKey, editDraft]);

  const cancelEdit = useCallback(() => {
    setEditingKey(null);
    setEditDraft(null);
    setView("main");
  }, []);

  const onCreateBatch = useCallback(async () => {
    if (!batch) return;
    setBatchAttempted(true);
    const fresh = new Date();
    setNow(fresh);
    if (!batchReadiness(batch, zone, fresh).ready) return; // the cards show what to fix
    setHalted(null);
    const result = await creating.run(batch, {
      zone,
      viewer: { id: viewer.id, role: viewer.role },
      isOnline,
      onUpdate: (items) => setBatch(items),
    });
    if (!result) return; // a second tap while the first batch was running
    setBatch(result.items);
    setHalted(result.halted);
  }, [batch, zone, viewer.id, viewer.role, isOnline, creating]);

  const finishBatch = useCallback(() => {
    clearDraft();
    setDraft(emptyDraft(viewer.role));
    setStep("describe");
    setParsedText(null);
    setBatch(null);
    resetAndClose();
  }, [viewer.role, resetAndClose]);

  const viewCreated = useCallback(
    (task: Task) => {
      resetAndClose();
      onOpenTask?.(task);
    },
    [resetAndClose, onOpenTask],
  );

  /* ── Discard prompt ─────────────────────────────────────────────────── */

  const keepForLater = useCallback(() => {
    saveDraft(owner, { draft, step, parsedText, batch });
    resetAndClose();
  }, [owner, draft, step, parsedText, batch, resetAndClose]);

  const discard = useCallback(() => {
    // Tasks already created stay created; announce them before the rest is dropped.
    announceCreated();
    clearDraft();
    setDraft(emptyDraft(viewer.role));
    setStep("describe");
    setParsedText(null);
    setBatch(null);
    setFailure(null);
    setNoTask(false);
    resetAndClose();
  }, [viewer.role, resetAndClose, announceCreated]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  let title = t("tasks.hk.add.sheetTitle");
  let body: React.ReactNode;
  let footer: React.ReactNode;
  const editLabel = editing && batch ? batch.findIndex((item) => item.key === editingKey) + 1 : 0;

  if (view === "discard") {
    const inBatch = batch !== null;
    title = t(inBatch ? "tasks.hk.add.batch.discard.title" : "tasks.hk.add.discard.title");
    body = (
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.copy, { color: theme.textSecondary }]}>
        {inBatch && (batchSummary?.created ?? 0) > 0 ? t("tasks.hk.add.batch.discard.bodyCreated", { count: batchSummary?.created ?? 0 }) : t(inBatch ? "tasks.hk.add.batch.discard.body" : "tasks.hk.add.discard.body")}
      </Text>
    );
    footer = (
      <>
        <Button label={t("tasks.hk.add.discard.keep")} onPress={() => setView("main")} size="lg" testID="discard-keep" />
        <Button label={t("tasks.hk.add.discard.save")} onPress={keepForLater} variant="secondary" testID="discard-save" />
        <Button label={t("tasks.hk.add.discard.discard")} onPress={discard} variant="destructive" testID="discard-confirm" />
      </>
    );
  } else if (view === "location") {
    title = t("tasks.hk.add.room.title");
    body = (
      <LocationEditor
        location={active.location}
        rooms={rooms.rooms}
        roomsStatus={rooms.status}
        onReloadRooms={() => void rooms.reload()}
        onChoose={(location) => {
          patch({ location });
          setView("main");
        }}
        onBack={() => setView("main")}
      />
    );
  } else if (view === "due") {
    title = t("tasks.hk.add.due.title");
    body = <DueEditor due={active.due} zone={zone} language={language} now={now} onChange={(due) => patch({ due })} onBack={() => setView("main")} />;
  } else if (step === "review" && editing) {
    title = t("tasks.hk.add.batch.editTitle", { n: editLabel });
    body = (
      <ReviewBody
        draft={active}
        errors={shownErrors}
        fromDescription
        submitProblem={null}
        zone={zone}
        language={language}
        isHousekeeper={isHousekeeper}
        busy={false}
        onChange={patch}
        onEditLocation={() => setView("location")}
        onEditDue={() => setView("due")}
      />
    );
    footer = (
      <>
        <Button label={t("tasks.hk.add.batch.saveEdit")} onPress={saveEdit} size="lg" icon="checkmark" testID="batch-edit-save" />
        <Button label={t("tasks.hk.add.batch.cancelEdit")} onPress={cancelEdit} variant="secondary" testID="batch-edit-cancel" />
      </>
    );
  } else if (step === "review" && batch) {
    const readiness = batchReadiness(batch, zone, now);
    // The button retries (rather than creates) once anything failed or some tasks already exist.
    const retrying = (batchSummary?.failed ?? 0) > 0 || ((batchSummary?.created ?? 0) > 0 && readiness.count > 0);
    title = t("tasks.hk.add.batch.title");
    body = (
      <BatchBody
        items={batch}
        originalText={draft.requestText}
        zone={zone}
        language={language}
        now={now}
        busy={creating.busy}
        revealProblems={batchAttempted}
        halted={halted}
        onToggle={(key, include) => setBatch((current) => (current ? withIncluded(current, key, include) : current))}
        onEdit={startEdit}
        onView={viewCreated}
      />
    );
    footer = (
      <BatchFooter
        busy={creating.busy}
        count={readiness.count}
        needsFix={batchAttempted && readiness.invalidKeys.length > 0}
        anyCreated={(batchSummary?.created ?? 0) > 0}
        retrying={retrying}
        onCreate={() => void onCreateBatch()}
        onBack={() => setStep("describe")}
        onDone={finishBatch}
      />
    );
  } else if (step === "review") {
    title = t(draft.aiSuggested ? "tasks.hk.add.review.titleAi" : "tasks.hk.add.review.titleManual");
    body = (
      <ReviewBody
        draft={draft}
        errors={shownErrors}
        fromDescription={draft.aiSuggested}
        submitProblem={submitProblem}
        zone={zone}
        language={language}
        isHousekeeper={isHousekeeper}
        busy={create.busy}
        onChange={patch}
        onEditLocation={() => setView("location")}
        onEditDue={() => setView("due")}
      />
    );
    footer = (
      <ReviewFooter
        busy={create.busy}
        showSummary={attempted && !validation.valid}
        onCreate={() => void onCreate()}
        onBack={() => setStep("describe")}
      />
    );
  } else {
    body = (
      <DescribeBody
        text={text}
        onChangeText={(value) => {
          setDraft((current) => ({ ...current, requestText: value }));
          setFailure(null);
          setNoTask(false);
          setVoiceAdded(false);
        }}
        isOnline={isOnline}
        parsing={parsing}
        failure={failure}
        noTask={noTask}
        restored={restored}
        voice={{ supported: voice.supported, state: voice.state, interim: voice.interim, justAdded: voiceAdded, onToggle: voice.toggle }}
      />
    );
    footer = (
      <DescribeFooter
        canContinue={!!trimmed && isOnline && !parsing}
        parsing={parsing}
        failed={failure !== null || noTask}
        onContinue={() => void onContinue()}
        onManual={onManual}
      />
    );
  }

  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={requestClose}
      grabber
      tall={step === "review" || view === "location" || view === "due"}
      scrollKey={submitProblem}
      testID="add-task-sheet"
      footer={footer}
    >
      {body}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 14.5, lineHeight: 20 },
});
