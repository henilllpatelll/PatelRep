import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fetchReadyForInspectionVerified, listInspectionTemplates } from "@/lib/api/inspections";
import { checklistProgress, groupSections } from "@/lib/inspections/checklist";
import { createDraft, judgeDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { readDraft, removeDraft, sweepStaleDrafts, writeDraft, type DraftRead } from "@/lib/inspections/draftStore";
import type { QueueItem } from "@/lib/inspections/queue";
import { reverifyDraft, type ReverifyFetchers } from "@/lib/inspections/reverify";
import { newSubmissionId } from "@/lib/inspections/submission";
import type { ChecklistTemplate, Answer } from "@/lib/inspections/types";
import { useDraftWriter, type SaveState } from "@/lib/inspections/useDraftWriter";
import { useInspectionQueue, type UseInspectionQueue } from "@/lib/inspections/useInspectionQueue";
import { evaluateChecklist, type ChecklistEvaluation } from "@/lib/inspections/validation";
import { INITIAL_WORKFLOW, transition, type WorkflowEvent, type WorkflowState } from "@/lib/inspections/workflow";
import {
  NA_POLICY,
  buildRows,
  chooseAnswer,
  draftContext,
  hasProgress,
  initialExpanded,
  isVerifiedFresh,
  nextToReview,
  reconcileTemplate,
  resolveGate,
  reviewReadiness,
  sectionOf,
  sessionIssue,
  setItemNote,
  summarizeSections,
  type AnswerRefusal,
  type CarryOverPlan,
  type ExpandedState,
  type Gate,
  type ReviewReadiness,
  type SectionSummary,
  type SessionIssue,
  type UnavailableReason,
  type WorkspaceRow,
} from "@/lib/inspections/workspace";
import { useAppStore } from "@/stores/appStore";

/* ─── The active inspection — one hook behind the workspace screen ───────────
   Resolves the room by its stable id against the verified queue, chooses its checklist, finds or creates the draft,
   and keeps the supervisor's answers durable. It writes NOTHING to the server and never changes a room status.

   Everything is scoped to hotel + person + room. A different hotel or person throws the previous inspection away
   (their draft stays on the phone under THEIR key), and an answer that lands after the scope changed is ignored. */

export type WorkspacePhase =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: UnavailableReason | "read_failed" }
  /** A valid unfinished draft exists: ask before using it. */
  | { kind: "resume"; stored: InspectionDraft }
  /** The checklist was edited: review which answers still apply before going on. */
  | { kind: "template_changed"; plan: CarryOverPlan }
  /** The room or day moved on under an unfinished inspection. The draft is kept. */
  | { kind: "blocked"; issue: Exclude<SessionIssue, "template_changed"> | "template_changed" }
  | { kind: "active" };

export type WorkspaceNotice = "stale_draft_cleared" | "draft_corrupt";
export type WorkspaceMode = "checklist" | "review";
export type LeaveVerdict = "leave" | "prompt";

type Pending =
  | { kind: "resume"; stored: InspectionDraft }
  | { kind: "template"; stored: InspectionDraft; template: ChecklistTemplate };

export interface ActiveInspection {
  phase: WorkspacePhase;
  /** The room and checklist on screen (the last verified ones if the room has since moved on). */
  item: QueueItem | null;
  template: ChecklistTemplate | null;
  draft: InspectionDraft | null;
  workflow: WorkflowState;
  businessDate: string;
  isOnline: boolean;
  queue: UseInspectionQueue;
  save: SaveState;
  busy: boolean;
  notice: WorkspaceNotice | null;
  dismissNotice: () => void;
  /** The same on-screen facts the checklist needs, derived once per answer. */
  evaluation: ChecklistEvaluation | null;
  progress: ReturnType<typeof checklistProgress> | null;
  summaries: SectionSummary[];
  rows: WorkspaceRow[];
  expanded: ExpandedState;
  toggleSection: (name: string) => void;
  /** Ask the list to scroll to an item (its section is opened). */
  focus: { itemId: string; nonce: number } | null;
  goTo: (itemId: string) => void;
  goToNext: () => void;
  mode: WorkspaceMode;
  answer: (itemId: string, result: Answer) => AnswerRefusal | "blocked" | null;
  setNote: (itemId: string, note: string) => void;
  openReview: () => ReviewReadiness | null;
  closeReview: () => void;
  requestLeave: () => Promise<LeaveVerdict>;
  keepInspecting: () => void;
  saveAndExit: () => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  discard: () => Promise<boolean>;
  resume: () => Promise<"resumed" | "unavailable" | "changed">;
  startOver: () => Promise<boolean>;
  applyCarryOver: () => Promise<void>;
  retryRead: () => void;
  continueWithoutDraft: () => void;
  retry: () => void;
}

const DEFAULT_FETCHERS: ReverifyFetchers = { queue: fetchReadyForInspectionVerified, templates: listInspectionTemplates };

function reduceFlow(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  return transition(state, event).state;
}

export function useActiveInspection(
  roomId: string | null,
  { reverifyFetchers = DEFAULT_FETCHERS, write = writeDraft }: { reverifyFetchers?: ReverifyFetchers; write?: (draft: InspectionDraft) => Promise<boolean> } = {},
): ActiveInspection {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const hotelId = user?.tenant_id ?? null;
  const userId = user?.id ?? null;
  const key = hotelId && userId && roomId ? `${hotelId}:${userId}:${roomId}` : null;

  const queue = useInspectionQueue();
  const businessDate = queue.businessDate;
  const writer = useDraftWriter({ write });

  const gate: Gate = useMemo(
    () =>
      resolveGate({
        roomId,
        signedIn: hotelId !== null && userId !== null,
        isOnline,
        queue: queue.queue,
        items: queue.items,
        templates: queue.templates,
        selectionFor: queue.selectionFor,
      }),
    [roomId, hotelId, userId, isOnline, queue.queue, queue.items, queue.templates, queue.selectionFor],
  );

  /* ─── State ─── */
  const [session, setSession] = useState<InspectionDraft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [readState, setReadState] = useState<{ key: string; read: DraftRead } | null>(null);
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>("checklist");
  const [expanded, setExpanded] = useState<ExpandedState | null>(null);
  const [focus, setFocus] = useState<{ itemId: string; nonce: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [workflow, dispatchFlow] = useReducer(reduceFlow, INITIAL_WORKFLOW);
  const [skipRead, setSkipRead] = useState<string | null>(null);

  const busyRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;
  const businessDateRef = useRef(businessDate);
  businessDateRef.current = businessDate;
  const lastReady = useRef<{ key: string; item: QueueItem; template: ChecklistTemplate } | null>(null);
  const changeRev = useRef(0);
  const ackRev = useRef(0);
  const lastTouched = useRef<string | null>(null);
  const nonce = useRef(0);

  // Only an inspection that belongs to THIS hotel, person and room is ever shown.
  const active = session && session.hotelId === hotelId && session.userId === userId && session.roomId === roomId ? session : null;
  const sessionRef = useRef(active);
  sessionRef.current = active;
  const readForKey = readState && readState.key === key ? readState.read : null;

  if (gate.kind === "ready" && key) lastReady.current = { key, item: gate.item, template: gate.template };
  const shown = lastReady.current && lastReady.current.key === key ? lastReady.current : null;
  const template = shown?.template ?? null;
  const templateRef = useRef(template);
  templateRef.current = template;

  /* ─── Another hotel, person or room: start clean (the old draft is already on the phone under its own key) ─── */
  useEffect(() => {
    void writer.flush();
    setSession(null);
    setPending(null);
    setNotice(null);
    setMode("checklist");
    setExpanded(null);
    setFocus(null);
    setSkipRead(null);
    dispatchFlow({ type: "discard" });
    changeRev.current = 0;
    ackRev.current = 0;
    lastTouched.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /* ─── Find any saved draft for this room (and tidy earlier days) ─── */
  const readTick = useRef(0);
  const [readNonce, setReadNonce] = useState(0);
  useEffect(() => {
    if (!hotelId || !userId || !roomId || !key) return undefined;
    let live = true;
    const mine = (readTick.current += 1);
    setReadState(null);
    void readDraft(hotelId, userId, roomId).then((read) => {
      if (live && mine === readTick.current) setReadState({ key, read });
    });
    return () => {
      live = false;
    };
    // `readNonce` re-reads on demand (retry); the key is the scope.
  }, [key, readNonce, hotelId, userId, roomId]);
  useEffect(() => {
    if (hotelId && userId) void sweepStaleDrafts(hotelId, userId, businessDateRef.current);
  }, [hotelId, userId]);

  const fresh = isVerifiedFresh(queue.queue);

  const begin = useCallback(
    (draft: InspectionDraft) => {
      sessionRef.current = draft;
      setSession(draft);
      changeRev.current = 0;
      ackRev.current = 0;
      if (hasProgress(draft)) dispatchFlow({ type: "start" });
    },
    [],
  );

  /* ─── Decide what to do with what was found ─── */
  useEffect(() => {
    if (active || pending || !key || !hotelId || !userId) return;
    if (gate.kind !== "ready" || !readForKey || !fresh) return;
    if (readForKey.status === "error" && skipRead !== key) return;
    const ctx = draftContext({ hotelId, userId, businessDate, item: gate.item, template: gate.template });
    let cleared = false;
    if (readForKey.status === "found") {
      const stored = readForKey.draft;
      const verdict = judgeDraft(stored, ctx);
      if (verdict.usable) {
        if (hasProgress(stored)) setPending({ kind: "resume", stored });
        else begin(stored);
        return;
      }
      if (verdict.reason === "template_changed" && hasProgress(stored)) {
        setPending({ kind: "template", stored, template: gate.template });
        return;
      }
      // Another day, a new clean cycle, a different earlier failure: those answers were about something else.
      // Removed by THIS account's key, never by identity written inside the draft (which is exactly what cannot be trusted).
      void removeDraft(hotelId, userId, gate.item.roomId);
      cleared = hasProgress(stored);
    }
    if (cleared) setNotice("stale_draft_cleared");
    else if (readForKey.status === "corrupt") setNotice("draft_corrupt");
    begin(
      createDraft({
        hotelId,
        userId,
        roomId: gate.item.roomId,
        businessDate,
        cleanCycleId: gate.item.cleanCycleId,
        reinspectionOf: gate.item.reinspection.failureInspectionId,
        template: gate.template,
        submissionId: newSubmissionId(),
        now: Date.now(),
      }),
    );
  }, [active, pending, key, hotelId, userId, gate, readForKey, fresh, businessDate, skipRead, begin]);

  /* ─── What the screen is in ─── */
  const issue = active && hotelId && userId ? sessionIssue({ draft: active, gate, hotelId, userId, businessDate }) : null;

  const phase: WorkspacePhase = useMemo(() => {
    if (active) {
      if (issue === "template_changed" && gate.kind === "ready") {
        const plan = reconcileTemplate(active, gate.template, { now: 0, submissionId: "preview" });
        return { kind: "template_changed", plan };
      }
      return issue ? { kind: "blocked", issue } : { kind: "active" };
    }
    if (gate.kind === "loading") return { kind: "loading" };
    if (gate.kind === "unavailable") return { kind: "unavailable", reason: gate.reason };
    if (!fresh) return { kind: "unavailable", reason: "needs_connection" };
    if (!readForKey) return { kind: "loading" };
    if (readForKey.status === "error" && skipRead !== key) return { kind: "unavailable", reason: "read_failed" };
    if (pending?.kind === "resume") return { kind: "resume", stored: pending.stored };
    if (pending?.kind === "template") {
      return { kind: "template_changed", plan: reconcileTemplate(pending.stored, pending.template, { now: 0, submissionId: "preview" }) };
    }
    return { kind: "loading" };
  }, [active, issue, gate, fresh, readForKey, pending, skipRead, key]);

  // The state machine follows what the screen found.
  useEffect(() => {
    if (phase.kind === "blocked" || phase.kind === "template_changed") {
      dispatchFlow({ type: "invalidate", reason: phase.kind === "template_changed" ? "template_changed" : "room_changed" });
      void writer.flush();
    } else if (phase.kind === "active") {
      dispatchFlow({ type: "resume" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  /* ─── Derived checklist facts ─── */
  const answers = active?.answers;
  const evaluation = useMemo(
    () => (active && template ? evaluateChecklist(template, active.answers, active.photos, NA_POLICY) : null),
    [active, template],
  );
  const sections = useMemo(() => (template ? groupSections(template) : []), [template]);
  const summaries = useMemo(() => (answers ? summarizeSections(sections, answers) : []), [sections, answers]);
  const progress = useMemo(() => (template && answers ? checklistProgress(template, answers) : null), [template, answers]);

  // Opened once per inspection: the first section still needing answers. It never jumps as answers are given.
  useEffect(() => {
    if (phase.kind === "active" && expanded === null && summaries.length > 0) setExpanded(initialExpanded(summaries));
  }, [phase.kind, expanded, summaries]);
  const expandedNow = expanded ?? {};
  const rows = useMemo(() => (answers ? buildRows(sections, summaries, expandedNow, answers) : []), [sections, summaries, expandedNow, answers]);

  /* ─── Editing ─── */
  const commit = useCallback(
    (next: InspectionDraft) => {
      sessionRef.current = next;
      setSession(next);
      changeRev.current += 1;
      writer.track(next);
      // First edit starts the inspection; later ones keep it going (and reopen a reviewed one).
      dispatchFlow({ type: "start" });
      dispatchFlow({ type: "answer" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const phaseKindRef = useRef(phase.kind);
  phaseKindRef.current = phase.kind;

  const answer = useCallback(
    (itemId: string, result: Answer) => {
      const current = sessionRef.current;
      const tpl = templateRef.current;
      if (!current || !tpl || phaseKindRef.current !== "active") return "blocked" as const;
      const outcome = chooseAnswer(current, tpl, itemId, result, Date.now());
      if (!outcome.ok) return outcome.refusal;
      lastTouched.current = itemId;
      if (outcome.draft !== current) commit(outcome.draft);
      return null;
    },
    [commit],
  );

  const setNote = useCallback(
    (itemId: string, note: string) => {
      const current = sessionRef.current;
      if (!current || phaseKindRef.current !== "active") return;
      const next = setItemNote(current, itemId, note, Date.now());
      if (next !== current) commit(next);
    },
    [commit],
  );

  /* ─── Moving around the checklist ─── */
  const toggleSection = useCallback(
    (name: string) => setExpanded((previous) => ({ ...(previous ?? {}), [name]: !(previous ?? {})[name] })),
    [],
  );
  const goTo = useCallback((itemId: string) => {
    const tpl = templateRef.current;
    const section = tpl ? sectionOf(tpl, itemId) : null;
    if (section) setExpanded((previous) => ({ ...(previous ?? {}), [section]: true }));
    nonce.current += 1;
    setFocus({ itemId, nonce: nonce.current });
  }, []);
  const goToNext = useCallback(() => {
    const tpl = templateRef.current;
    const current = sessionRef.current;
    if (!tpl || !current) return;
    const target = nextToReview(tpl, current.answers, lastTouched.current);
    if (target) goTo(target.id);
  }, [goTo]);

  const openReview = useCallback((): ReviewReadiness | null => {
    const tpl = templateRef.current;
    const current = sessionRef.current;
    if (!tpl || !current || phaseKindRef.current !== "active") return null;
    const readiness = reviewReadiness(tpl, current, NA_POLICY);
    if (readiness.kind === "ready") {
      dispatchFlow({ type: "review", canSubmit: readiness.evaluation.canSubmit });
      setMode("review");
    } else if (readiness.kind === "unanswered" || readiness.kind === "invalid") {
      goTo(readiness.itemId);
    }
    return readiness;
  }, [goTo]);
  const closeReview = useCallback(() => {
    setMode("checklist");
    dispatchFlow({ type: "reopen" });
  }, []);

  /* ─── Leaving ─── */
  const requestLeave = useCallback(async (): Promise<LeaveVerdict> => {
    const current = sessionRef.current;
    if (!current || !hasProgress(current)) return "leave";
    if (changeRev.current > ackRev.current) return "prompt";
    // Nothing changed since the supervisor last decided: only a draft that is really on the phone may be left silently.
    return (await writer.flush()) ? "leave" : "prompt";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const keepInspecting = useCallback(() => {
    ackRev.current = changeRev.current;
  }, []);

  const guarded = useCallback(async <T,>(run: () => Promise<T>, whenBusy: T): Promise<T> => {
    if (busyRef.current) return whenBusy;
    busyRef.current = true;
    setBusy(true);
    try {
      return await run();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const saveAndExit = useCallback(
    () =>
      guarded(async () => {
        const ok = await writer.flush();
        if (ok) ackRev.current = changeRev.current;
        return ok;
      }, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guarded],
  );
  const retrySave = useCallback(() => writer.flush(), [writer]);

  const forget = useCallback(async (): Promise<boolean> => {
    if (!hotelId || !userId || !roomId) return false;
    const removed = await removeDraft(hotelId, userId, roomId);
    if (removed) writer.reset();
    return removed;
  }, [writer, hotelId, userId, roomId]);

  const discard = useCallback(
    () =>
      guarded(async () => {
        const current = sessionRef.current ?? (pending ? pending.stored : null);
        if (!current) return true;
        const removed = await forget();
        if (removed) {
          sessionRef.current = null;
          setSession(null);
          setPending(null);
          dispatchFlow({ type: "discard" });
        }
        return removed;
      }, false),
    [guarded, forget, pending],
  );

  /* ─── Resuming and starting over ─── */
  const resume = useCallback(
    () =>
      guarded<"resumed" | "unavailable" | "changed">(async () => {
        if (pending?.kind !== "resume" || !hotelId || !userId) return "changed";
        const stored = pending.stored;
        const startedFor = keyRef.current;
        const result = await reverifyDraft(stored, { hotelId, userId, businessDate: businessDateRef.current }, reverifyFetchers);
        if (keyRef.current !== startedFor) return "changed";
        switch (result.kind) {
          case "ok":
            setPending(null);
            begin(stored);
            void queue.refresh();
            return "resumed";
          case "unavailable":
            return "unavailable";
          case "template_changed":
            setPending({ kind: "template", stored, template: result.template });
            void queue.refresh();
            return "changed";
          case "unusable":
            if (roomId) await removeDraft(hotelId, userId, roomId);
            setNotice("stale_draft_cleared");
            setPending(null);
            if (key) setReadState({ key, read: { status: "none" } });
            void queue.refresh();
            return "changed";
          case "not_awaiting":
          case "template_unavailable":
            // The draft stays on the phone; the screen now says why the room cannot be inspected.
            setPending(null);
            void queue.refresh();
            return "changed";
        }
      }, "unavailable"),
    [guarded, pending, hotelId, userId, reverifyFetchers, begin, queue, key],
  );

  const startOver = useCallback(
    () =>
      guarded(async () => {
        const stored = pending?.stored ?? sessionRef.current;
        if (stored) {
          const removed = await forget();
          if (!removed) return false;
        }
        setPending(null);
        sessionRef.current = null;
        setSession(null);
        setMode("checklist");
        setExpanded(null);
        dispatchFlow({ type: "discard" });
        if (key) setReadState({ key, read: { status: "none" } });
        return true;
      }, false),
    [guarded, pending, forget, key],
  );

  const applyCarryOver = useCallback(async () => {
    const source = sessionRef.current ?? (pending?.kind === "template" ? pending.stored : null);
    const tpl = pending?.kind === "template" ? pending.template : gate.kind === "ready" ? gate.template : null;
    if (!source || !tpl) return;
    const plan = reconcileTemplate(source, tpl, { now: Date.now(), submissionId: newSubmissionId() });
    setPending(null);
    sessionRef.current = plan.draft;
    setSession(plan.draft);
    changeRev.current += 1;
    writer.track(plan.draft);
    void writer.flush();
    setExpanded(null);
    setMode("checklist");
    dispatchFlow({ type: "resume" });
    dispatchFlow({ type: "start" });
  }, [pending, gate, writer]);

  const retryRead = useCallback(() => setReadNonce((n) => n + 1), []);
  const continueWithoutDraft = useCallback(() => setSkipRead(key), [key]);
  const retry = useCallback(() => void queue.refresh(), [queue]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    phase,
    item: shown?.item ?? null,
    template,
    draft: active,
    workflow,
    businessDate,
    isOnline,
    queue,
    save: writer.state,
    busy,
    notice,
    dismissNotice,
    evaluation,
    progress,
    summaries,
    rows,
    expanded: expandedNow,
    toggleSection,
    focus,
    goTo,
    goToNext,
    mode,
    answer,
    setNote,
    openReview,
    closeReview,
    requestLeave,
    keepInspecting,
    saveAndExit,
    retrySave,
    discard,
    resume,
    startOver,
    applyCarryOver,
    retryRead,
    continueWithoutDraft,
    retry,
  };
}
