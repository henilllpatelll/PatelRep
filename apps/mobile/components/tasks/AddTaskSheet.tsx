import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DescribeBody, DescribeFooter } from "@/components/tasks/addTask/DescribeStep";
import { DueEditor } from "@/components/tasks/addTask/DueEditor";
import { LocationEditor } from "@/components/tasks/addTask/LocationEditor";
import { ReviewBody, ReviewFooter, type SubmitProblem } from "@/components/tasks/addTask/ReviewStep";
import type { Task } from "@/lib/api/tasks";
import { useTheme } from "@/lib/theme/useTheme";
import { clearDraft, loadDraft, ownerKey, saveDraft, type DraftStep } from "@/lib/tasks/addTask/draftMemory";
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
import { parseTaskRequest, type ParseFailure } from "@/lib/tasks/addTask/parseRequest";
import { useRoomDirectory } from "@/lib/tasks/addTask/rooms";
import { taskDestination, useCreateTask, type TaskDestination } from "@/lib/tasks/addTask/submit";
import { useVoiceInput } from "@/lib/tasks/addTask/useVoiceInput";

/* Add Task: Describe -> Review/Edit -> Create. One sheet, one draft.
   Nothing is saved until "Create task" is pressed and the server answers; AI only fills in the
   draft, and every value can be corrected first. The manual path is the same Review step with an
   empty draft, so both paths share validation and the request payload. */

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
  isOnline: boolean;
  zone: string | null | undefined;
  language: string;
  viewer: { id: string | null; tenantId: string | null; role: string | null };
  onClose: () => void;
  /** Called once, after the server confirmed the task, with what it stored. */
  onCreated: (created: CreatedTask) => void;
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

export function AddTaskSheet({ visible, initialText = null, isOnline, zone, language, viewer, onClose, onCreated }: Props) {
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
  const parseTicket = useRef(0);
  const create = useCreateTask();

  const rooms = useRoomDirectory(owner, visible && step === "review");

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
        setRestored(hasMeaningfulContent(held.draft));
      } else {
        const fresh = emptyDraft(viewer.role);
        setDraft(initialText?.trim() ? { ...fresh, requestText: initialText.trim().slice(0, ADD_TASK_LIMITS.request) } : fresh);
        setStep("describe");
        setParsedText(null);
        setRestored(false);
      }
      setView("main");
      setParsing(false);
      setFailure(null);
      setNoTask(false);
      setAttempted(false);
      setSubmitProblem(null);
      setVoiceAdded(false);
      setNow(new Date());
    }
    wasVisible.current = visible;
  }, [visible, owner, viewer.role, initialText]);

  /* Keep the draft while the sheet is open, so dismissing it by accident loses nothing. */
  useEffect(() => {
    if (visible && hasMeaningfulContent(draft)) saveDraft(owner, { draft, step, parsedText });
  }, [visible, owner, draft, step, parsedText]);

  const patch = useCallback((changes: Partial<TaskDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setSubmitProblem(null);
  }, []);

  const resetAndClose = useCallback(() => {
    parseTicket.current += 1;
    setView("main");
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (create.busy) return; // a request is in flight; wait for the server's answer
    if (view === "location" || view === "due" || view === "discard") {
      setView("main");
      return;
    }
    if (hasMeaningfulContent(draft)) setView("discard");
    else resetAndClose();
  }, [create.busy, view, draft, resetAndClose]);

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
    if (parsedText === trimmed && draft.aiSuggested) {
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
      goToReview({ ...result.draft, requestId: draft.requestId, requestText: text });
    } else if (result.status === "none") {
      setNoTask(true);
    } else {
      setFailure(result.reason);
    }
  }, [trimmed, parsing, isOnline, parsedText, draft.aiSuggested, draft.requestId, text, zone, viewer.role, goToReview]);

  const onManual = useCallback(() => {
    parseTicket.current += 1;
    setParsing(false);
    goToReview(draft.aiSuggested ? draft : prefillFromRequest(draft));
  }, [draft, goToReview]);

  /* ── Review ─────────────────────────────────────────────────────────── */

  const validation = useMemo(() => validateDraft(draft, zone, now), [draft, zone, now]);
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

  /* ── Discard prompt ─────────────────────────────────────────────────── */

  const keepForLater = useCallback(() => {
    saveDraft(owner, { draft, step, parsedText });
    resetAndClose();
  }, [owner, draft, step, parsedText, resetAndClose]);

  const discard = useCallback(() => {
    clearDraft();
    setDraft(emptyDraft(viewer.role));
    setStep("describe");
    setParsedText(null);
    setFailure(null);
    setNoTask(false);
    resetAndClose();
  }, [viewer.role, resetAndClose]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  let title = t("tasks.hk.add.sheetTitle");
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (view === "discard") {
    title = t("tasks.hk.add.discard.title");
    body = (
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.copy, { color: theme.textSecondary }]}>
        {t("tasks.hk.add.discard.body")}
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
        location={draft.location}
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
    body = <DueEditor due={draft.due} zone={zone} language={language} now={now} onChange={(due) => patch({ due })} onBack={() => setView("main")} />;
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
