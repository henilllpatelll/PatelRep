import { useCallback, useEffect, useRef, useState } from "react";
import { completeInspection, fetchInspectionSubmission, type CompletionBody, type CompletionPhoto, type SubmissionReadBack } from "@/lib/api/inspections";
import type { InspectionDraft } from "@/lib/inspections/draft";
import { resultFromDetail, resultFromReceipt, type InspectionResult } from "@/lib/inspections/outcome";
import type { QueueItem } from "@/lib/inspections/queue";
import {
  buildSubmission,
  classifySubmissionError,
  classifySubmissionResponse,
  resolveUncertain,
  submissionEligibility,
  type Ineligible,
  type RejectionReason,
  type UncertainReason,
} from "@/lib/inspections/submission";
import type { ChecklistTemplate } from "@/lib/inspections/types";
import { evaluateChecklist } from "@/lib/inspections/validation";
import type { WorkflowEvent, WorkflowState } from "@/lib/inspections/workflow";
import { NA_POLICY, recheckItemIds, unverifiedRecheck } from "@/lib/inspections/workspace";
import { itemsToRecheck } from "@/lib/inspections/corrections";

/* ─── Sending the inspection — and being honest about what happened ──────────
   The state machine (workflow.ts) says WHICH phase the screen is in; this says what to SHOW. Nothing here is optimistic:
   the room is described as approved or blocked only after the server's own reply (or a read-back of the stored
   inspection) says so. One submission id travels with the draft, so a retry — after a timeout, a restart or a lost
   reply — can only ever find or finish the same inspection. */

export type SubmissionView =
  | { kind: "idle" }
  | { kind: "submitting" }
  /** Sent, but the outcome is not known. The draft and its submission id are kept. */
  | { kind: "uncertain"; reason: UncertainReason; checking: boolean; lastCheck: "none" | "unknown" | "not_recorded" | "incomplete" }
  /** The server refused it (or the app could not send it): nothing was recorded. */
  | { kind: "problem"; reason: RejectionReason | Ineligible | "reinspection_unverified" | "photo_missing"; message: string | null; code: string | null }
  /** Recorded. `result` is the server's account of it. */
  | { kind: "done"; result: InspectionResult };

export type SubmitRefusal = Ineligible | "reinspection_unverified" | "incomplete" | "not_ready" | "no_session";

export interface SubmitDeps {
  complete: (body: CompletionBody, photos: readonly CompletionPhoto[]) => Promise<unknown>;
  readBack: (submissionId: string) => Promise<SubmissionReadBack>;
}

const DEFAULT_DEPS: SubmitDeps = { complete: completeInspection, readBack: fetchInspectionSubmission };

export interface SubmitContext {
  /** `hotel:user:room` - a result for any other scope is discarded, never shown. */
  scopeKey: string | null;
  hotelId: string | null;
  userId: string | null;
  isOnline: boolean;
  getDraft: () => InspectionDraft | null;
  getTemplate: () => ChecklistTemplate | null;
  getItem: () => QueueItem | null;
  /** Photos that are really usable on the phone. */
  getPhotos: () => Readonly<Record<string, string>>;
  getWorkflow: () => WorkflowState;
  dispatch: (event: WorkflowEvent) => void;
  /** Make sure the draft is on the phone before anything is sent. */
  flushDraft: () => Promise<boolean>;
  /** Remove the finished inspection's draft and its photos (only called once the server confirmed it). */
  forgetDraft: () => Promise<boolean>;
  /** Re-read the queue and everything that depends on it. */
  afterRecorded: () => void;
  /** The server did not accept this submission id: use a new one for the same content. */
  rekey: () => void;
  /** Re-read the room / checklists after a refusal that says they moved. */
  afterRefusal: (refresh: "queue" | "templates" | "none") => void;
  /** Whether the room / checklist the inspection began with are still the ones on screen. */
  templateSame: () => boolean;
  /** null = the queue has not been verified; only a verified queue that lacks the room blocks. */
  roomStillAwaiting: () => boolean | null;
}

export interface UseInspectionSubmit {
  view: SubmissionView;
  submit: () => Promise<SubmitRefusal | null>;
  /** Ask the server whether the submission landed (uncertain state). */
  check: () => Promise<void>;
  /** A stored draft may belong to an inspection that already landed (the app died before the reply). */
  probeStored: (stored: InspectionDraft) => Promise<"recorded" | "none">;
  /** Back from a refusal to the review. */
  dismissProblem: () => void;
  reset: () => void;
}

export function useInspectionSubmit(context: SubmitContext, deps: SubmitDeps = DEFAULT_DEPS): UseInspectionSubmit {
  const [view, setViewState] = useState<SubmissionView>({ kind: "idle" });
  const ctx = useRef(context);
  ctx.current = context;
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const viewRef = useRef<SubmissionView>(view);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setView = useCallback((next: SubmissionView) => {
    viewRef.current = next;
    if (mounted.current) setViewState(next);
  }, []);

  // Another hotel, person or room: what was shown for the old one is gone (its draft stays on the phone, under its own key).
  useEffect(() => {
    viewRef.current = { kind: "idle" };
    inFlight.current = false;
    setViewState({ kind: "idle" });
  }, [context.scopeKey]);

  const stillHere = (scope: string | null) => mounted.current && ctx.current.scopeKey === scope;

  const conclude = useCallback(
    async (result: InspectionResult, scope: string | null) => {
      // The draft and its photos are only the means of sending. Once the server has the inspection (and, for a
      // failure, its correction) they go; until then they are the only copy of the supervisor's evidence.
      if (!result.followUpPending) await ctx.current.forgetDraft().catch(() => false);
      if (!stillHere(scope)) return;
      setView({ kind: "done", result });
      ctx.current.afterRecorded();
    },
    [setView],
  );

  const submit = useCallback(async (): Promise<SubmitRefusal | null> => {
    const c = ctx.current;
    if (inFlight.current) return "busy";
    const draft = c.getDraft();
    const template = c.getTemplate();
    const item = c.getItem();
    if (!draft || !template || !item || !c.hotelId || !c.userId) return "no_session";
    const workflow = c.getWorkflow();
    const resendable = workflow.phase === "reviewed" || workflow.phase === "uncertain" || (workflow.phase === "correction_required" && workflow.followUpPending);
    if (!resendable) return "not_ready";

    const photos = c.getPhotos();
    const evaluation = evaluateChecklist(template, draft.answers, photos, NA_POLICY);
    const recheck = recheckItemIds(template, itemsToRecheck(item.reinspection));
    if (unverifiedRecheck(template, draft.answers, recheck).length > 0) return "reinspection_unverified";
    // A failure with no severity cannot be classified (touch-up or full re-clean), so it is finished first.
    if (evaluation.failed.some((entry) => entry.severity === null)) return "incomplete";
    const eligibility = submissionEligibility({
      evaluation,
      submitting: false,
      online: c.isOnline,
      identityMatches: draft.hotelId === c.hotelId && draft.userId === c.userId,
      templateChange: c.templateSame() ? "same" : "changed",
      roomStillAwaiting: c.roomStillAwaiting(),
    });
    if (!eligibility.ok) return eligibility.reason;

    const built = buildSubmission({
      submissionId: draft.submissionId,
      hotelId: c.hotelId,
      room: item.room,
      template,
      answers: draft.answers,
      photos,
      notes: draft.notes,
    });
    if (!built.ok) return "incomplete";

    inFlight.current = true;
    const scope = c.scopeKey;
    const room = {
      roomId: item.roomId,
      roomNumber: item.roomNumber,
      isReinspection: item.reinspection.isReinspection,
      failedLabels: evaluation.failed.map((entry) => entry.item.description),
    };
    try {
      await c.flushDraft().catch(() => false);
      c.dispatch({ type: "submit" });
      setView({ kind: "submitting" });
      let outcome;
      try {
        outcome = classifySubmissionResponse(await depsRef.current.complete(built.plan.body, built.plan.photos), draft.submissionId);
      } catch (error) {
        outcome = classifySubmissionError(error, draft.submissionId);
      }
      if (!stillHere(scope)) return null; // the hotel or room changed meanwhile: the draft keeps the id, nothing here is shown for the new one
      c.dispatch({ type: "outcome", outcome });
      switch (outcome.kind) {
        case "committed":
        case "needs_follow_up":
          await conclude(resultFromReceipt(outcome.receipt, room), scope);
          break;
        case "uncertain":
          setView({ kind: "uncertain", reason: outcome.reason, checking: false, lastCheck: "none" });
          break;
        case "rejected":
          if (outcome.reason === "id_conflict") c.rekey();
          c.afterRefusal(outcome.refresh);
          setView({ kind: "problem", reason: outcome.reason, message: outcome.message, code: outcome.code });
          break;
      }
    } finally {
      inFlight.current = false;
    }
    return null;
  }, [conclude, setView]);

  const check = useCallback(async () => {
    const c = ctx.current;
    if (inFlight.current) return;
    const draft = c.getDraft();
    const template = c.getTemplate();
    const item = c.getItem();
    const current = viewRef.current;
    if (!draft || !template || !item || current.kind !== "uncertain") return;
    inFlight.current = true;
    const scope = c.scopeKey;
    setView({ ...current, checking: true });
    try {
      let readBack: SubmissionReadBack | "unknown";
      try {
        readBack = await depsRef.current.readBack(draft.submissionId);
      } catch {
        readBack = "unknown";
      }
      if (!stillHere(scope)) return;
      const intent = evaluateChecklist(template, draft.answers, c.getPhotos(), NA_POLICY).outcome ?? "passed";
      const resolution = resolveUncertain(readBack, intent);
      c.dispatch({ type: "resolved", resolution });
      switch (resolution.kind) {
        case "recorded":
          await conclude(resultFromDetail(resolution.detail, item.roomNumber), scope);
          break;
        case "incomplete":
          setView({ kind: "uncertain", reason: current.reason, checking: false, lastCheck: "incomplete" });
          break;
        case "not_recorded":
          setView({ kind: "uncertain", reason: current.reason, checking: false, lastCheck: "not_recorded" });
          break;
        case "still_uncertain":
          setView({ kind: "uncertain", reason: current.reason, checking: false, lastCheck: "unknown" });
          break;
      }
    } finally {
      inFlight.current = false;
    }
  }, [conclude, setView]);

  const probeStored = useCallback(
    async (stored: InspectionDraft): Promise<"recorded" | "none"> => {
      const c = ctx.current;
      if (!c.isOnline || stored.hotelId !== c.hotelId || stored.userId !== c.userId) return "none";
      const scope = c.scopeKey;
      try {
        const readBack = await depsRef.current.readBack(stored.submissionId);
        if (readBack.status !== "found" || readBack.detail.items.length === 0 || !stillHere(scope)) return "none";
        await conclude(resultFromDetail(readBack.detail, ""), scope);
        return "recorded";
      } catch {
        return "none"; // cannot tell: the supervisor sees the usual resume choice, and a send still can't duplicate
      }
    },
    [conclude],
  );

  const dismissProblem = useCallback(() => {
    if (viewRef.current.kind !== "problem") return;
    const c = ctx.current;
    setView({ kind: "idle" });
    c.dispatch({ type: "resume" });
    const draft = c.getDraft();
    const template = c.getTemplate();
    if (draft && template) c.dispatch({ type: "review", canSubmit: evaluateChecklist(template, draft.answers, c.getPhotos(), NA_POLICY).canSubmit });
  }, [setView]);

  const reset = useCallback(() => setView({ kind: "idle" }), [setView]);

  return { view, submit, check, probeStored, dismissProblem, reset };
}
