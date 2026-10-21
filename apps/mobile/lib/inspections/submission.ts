import type {
  CompletionBody,
  CompletionItem,
  CompletionPhoto,
  InspectionDetail,
  ReadyRoom,
  SubmissionReadBack,
} from "@/lib/api/inspections";
import type { ChecklistEvaluation } from "@/lib/inspections/validation";
import { evaluateChecklist, type AnswerCheck } from "@/lib/inspections/validation";
import type { TemplateChange } from "@/lib/inspections/templates";
import type {
  AnswerMap,
  ChecklistTemplate,
  CorrectionKind,
  InspectionOutcome,
  RequiredNaPolicy,
  RuleCode,
} from "@/lib/inspections/types";
import { classifyWriteFailure, statusOf } from "@/lib/housekeeping/roomPanelErrors";

/* ─── Submitting an inspection safely (pure) ────────────────────────────────
   One inspection = one `submissionId`, minted when the supervisor starts and kept until the inspection is recorded
   or its content changes. The server stores that id AS the inspection's id, so:

     • tapping twice, retrying after a timeout, or resubmitting after a lost reply returns the stored inspection —
       never a second one, and never a second correction task;
     • a reply that never arrived is settled by READING BACK that id (`resolveUncertain`), not by guessing;
     • a 200 whose body is not what was promised is NOT a success (`parseCompletionResponse` returns null).

   Nothing here performs I/O; the caller sends `plan` with `completeInspection` and feeds the result back in. */

export function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ─── Building the request ──────────────────────────────────────────────── */

export interface SubmissionPlan {
  body: CompletionBody;
  photos: CompletionPhoto[];
  outcome: InspectionOutcome;
  correctionKind: CorrectionKind | null;
}

export type PlanResult =
  | { ok: true; plan: SubmissionPlan }
  | { ok: false; blocker: NonNullable<ChecklistEvaluation["blocker"]> };

/**
 * Turn a reviewed checklist into the request. Refuses (with the named rule) when the checklist cannot be
 * submitted; sends only answers that belong to this checklist and photos only for failed items.
 */
export function buildSubmission(input: {
  submissionId: string;
  hotelId: string;
  room: Pick<ReadyRoom, "room_id" | "clean_cycle_id" | "previous_failure">;
  template: ChecklistTemplate;
  answers: AnswerMap;
  /** item id → local file uri */
  photos?: Readonly<Record<string, string | undefined>>;
  notes?: string;
  policy?: RequiredNaPolicy;
}): PlanResult {
  const { template, answers, room } = input;
  const evaluation = evaluateChecklist(template, answers, input.photos ?? {}, input.policy);
  if (evaluation.blocker || !evaluation.outcome) {
    return { ok: false, blocker: evaluation.blocker ?? { ok: false, code: "no_answers" } };
  }

  const items: CompletionItem[] = template.items.flatMap((item) => {
    const answer = answers[item.id];
    if (!answer) return [];
    const entry: CompletionItem = { template_item_id: item.id, result: answer.result };
    const note = answer.note?.trim();
    if (note) entry.note = note;
    if (answer.result === "fail" && answer.severity) entry.severity = answer.severity;
    return [entry];
  });

  const failedIds = new Set(evaluation.failed.map((entry) => entry.item.id));
  const photos: CompletionPhoto[] = template.items.flatMap((item) => {
    const uri = input.photos?.[item.id];
    return uri && failedIds.has(item.id) ? [{ itemId: item.id, uri }] : [];
  });

  const body: CompletionBody = {
    room_id: room.room_id,
    template_id: template.id,
    overall_result: evaluation.outcome,
    items,
    client_submission_id: input.submissionId,
    expected_hotel_id: input.hotelId,
  };
  const notes = input.notes?.trim();
  if (notes) body.notes = notes;
  if (template.fingerprint) body.template_fingerprint = template.fingerprint;
  if (room.clean_cycle_id) body.expected_clean_cycle_id = room.clean_cycle_id;
  if (room.previous_failure?.inspection_id) body.reinspection_of = room.previous_failure.inspection_id;

  return { ok: true, plan: { body, photos, outcome: evaluation.outcome, correctionKind: evaluation.correctionKind } };
}

/* ─── Reading the reply ─────────────────────────────────────────────────── */

export interface CompletionReceipt {
  id: string;
  outcome: InspectionOutcome;
  /** The server returned the stored inspection of an earlier attempt rather than writing a new one. */
  replayed: boolean;
  correctionKind: CorrectionKind | null;
  reinspectionOf: string | null;
  /** False = recorded, but the correction task is still missing; resubmitting the same id finishes it. */
  followUpComplete: boolean;
  correction: { status: "created" | "existing" | "failed"; taskId: string | null } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The receipt, or `null` when the body is not unmistakably the inspection that was submitted. A 200 that does not
 * carry this submission's id and a definite result is ambiguous — treat it as uncertain, not as success.
 */
export function parseCompletionResponse(body: unknown, submissionId: string): CompletionReceipt | null {
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (!data || data.id !== submissionId) return null;
  const outcome = data.overall_result;
  if (outcome !== "passed" && outcome !== "failed") return null;
  const correction = isRecord(data.correction) ? data.correction : null;
  const status = correction?.status;
  const task = correction && isRecord(correction.task) ? correction.task : null;
  return {
    id: data.id,
    outcome,
    replayed: data.replayed === true,
    correctionKind: data.correction_kind === "touch_up" || data.correction_kind === "reclean" ? data.correction_kind : null,
    reinspectionOf: typeof data.reinspection_of === "string" ? data.reinspection_of : null,
    // An older body without the flag is a pass or a failure whose task state we cannot see: only trust an explicit true.
    followUpComplete: outcome === "passed" ? true : data.followup_complete === true,
    correction:
      status === "created" || status === "existing" || status === "failed"
        ? { status, taskId: task && typeof task.id === "string" ? task.id : null }
        : null,
  };
}

/* ─── What happened, and what to do next ───────────────────────────────── */

export type RejectionReason =
  /** The room was inspected, re-cleaned or otherwise moved on since it was opened. */
  | "room_changed"
  /** The checklist was edited, replaced or no longer fits this room. */
  | "template_changed"
  /** The signed-in hotel is not the one this inspection was started for. */
  | "account_changed"
  /** The server refused the content (a rule). */
  | "invalid"
  | "forbidden"
  /** Photos did not upload; nothing was recorded. */
  | "evidence_upload_failed"
  /** The submission id belongs to something else. */
  | "id_conflict"
  | "not_found"
  | "rejected";

export type UncertainReason =
  /** No reply at all (offline, timeout). */
  | "no_response"
  /** A 5xx: the server may or may not have recorded it. */
  | "server_error"
  /** A 200 that is not the promised receipt. */
  | "ambiguous_response"
  /** The same submission is still being written by an earlier request. */
  | "in_progress"
  /** Recorded without its answers; resubmitting the same id completes it. */
  | "partial_commit";

export type SubmissionOutcome =
  | { kind: "committed"; receipt: CompletionReceipt }
  /** Recorded and the room is blocked, but the correction task is missing — finish by resubmitting the same id. */
  | { kind: "needs_follow_up"; receipt: CompletionReceipt }
  | {
      kind: "rejected";
      reason: RejectionReason;
      code: string | null;
      message: string | null;
      /** Nothing was recorded and the content is unchanged, so the SAME id may be resent. Otherwise mint a new one. */
      sameSubmissionOk: boolean;
      refresh: "queue" | "templates" | "none";
    }
  | { kind: "uncertain"; reason: UncertainReason; submissionId: string };

const REJECTIONS: Record<string, { reason: RejectionReason; sameSubmissionOk: boolean; refresh: "queue" | "templates" | "none" }> = {
  room_not_awaiting_inspection: { reason: "room_changed", sameSubmissionOk: false, refresh: "queue" },
  room_changed_since_review: { reason: "room_changed", sameSubmissionOk: false, refresh: "queue" },
  correction_changed: { reason: "room_changed", sameSubmissionOk: false, refresh: "queue" },
  template_changed: { reason: "template_changed", sameSubmissionOk: false, refresh: "templates" },
  template_not_applicable: { reason: "template_changed", sameSubmissionOk: false, refresh: "templates" },
  no_checklist: { reason: "template_changed", sameSubmissionOk: false, refresh: "templates" },
  hotel_mismatch: { reason: "account_changed", sameSubmissionOk: false, refresh: "none" },
  submission_conflict: { reason: "id_conflict", sameSubmissionOk: false, refresh: "none" },
  photo_upload_failed: { reason: "evidence_upload_failed", sameSubmissionOk: true, refresh: "none" },
};

function messageOf(error: unknown): string | null {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : null;
}

/** Sort a failed request into "nothing was recorded" (rejected) or "it may have been" (uncertain). */
export function classifySubmissionError(error: unknown, submissionId: string): SubmissionOutcome {
  const status = statusOf(error);
  const code = typeof (error as { code?: unknown } | null)?.code === "string" ? ((error as { code: string }).code) : null;

  if (code === "submission_in_progress") return { kind: "uncertain", reason: "in_progress", submissionId };
  if (code === "inspection_incomplete") return { kind: "uncertain", reason: "partial_commit", submissionId };
  if (status === null) return { kind: "uncertain", reason: "no_response", submissionId };

  const known = code ? REJECTIONS[code] : undefined;
  if (known) return { kind: "rejected", ...known, code, message: messageOf(error) };

  switch (classifyWriteFailure(error)) {
    case "uncertain":
      return { kind: "uncertain", reason: "server_error", submissionId };
    case "forbidden":
      return { kind: "rejected", reason: "forbidden", code, message: messageOf(error), sameSubmissionOk: false, refresh: "none" };
    case "not_found":
      return { kind: "rejected", reason: "not_found", code, message: messageOf(error), sameSubmissionOk: false, refresh: "queue" };
    case "conflict":
      // A 409 we do not recognise still means the world moved: re-read before trying again.
      return { kind: "rejected", reason: "room_changed", code, message: messageOf(error), sameSubmissionOk: false, refresh: "queue" };
    case "invalid":
      return { kind: "rejected", reason: "invalid", code, message: messageOf(error), sameSubmissionOk: false, refresh: "none" };
    default:
      return { kind: "rejected", reason: "rejected", code, message: messageOf(error), sameSubmissionOk: false, refresh: "none" };
  }
}

/** Fold a reply into an outcome. `body` is whatever `completeInspection` resolved with. */
export function classifySubmissionResponse(body: unknown, submissionId: string): SubmissionOutcome {
  const receipt = parseCompletionResponse(body, submissionId);
  if (!receipt) return { kind: "uncertain", reason: "ambiguous_response", submissionId };
  return receipt.followUpComplete ? { kind: "committed", receipt } : { kind: "needs_follow_up", receipt };
}

/* ─── Settling an uncertain submission ──────────────────────────────────── */

export type UncertainResolution =
  /** It landed. `matchesIntent` is false only if the stored result differs from what this screen meant to send. */
  | { kind: "recorded"; detail: InspectionDetail; matchesIntent: boolean }
  /** It landed without its answers: resubmit the same id to complete it. */
  | { kind: "incomplete"; detail: InspectionDetail }
  /** Nothing is recorded under this id: safe to resend the SAME id (it cannot duplicate). */
  | { kind: "not_recorded" }
  /** The read-back itself failed; still do not know. */
  | { kind: "still_uncertain" };

export function resolveUncertain(readBack: SubmissionReadBack | "unknown", intent: InspectionOutcome): UncertainResolution {
  if (readBack === "unknown") return { kind: "still_uncertain" };
  if (readBack.status === "not_found") return { kind: "not_recorded" };
  const { detail } = readBack;
  if (detail.items.length === 0) return { kind: "incomplete", detail };
  return { kind: "recorded", detail, matchesIntent: detail.overall_result === intent };
}

/* ─── May the Submit button act? ────────────────────────────────────────── */

export type Ineligible =
  | "busy"
  | "offline"
  | "checklist_incomplete"
  | "account_changed"
  | "template_changed"
  | "room_not_awaiting";

/**
 * Local gate for the Submit action. It narrows the window and gives a clear reason; it does not replace the server,
 * which re-checks every one of these on write. `roomStillAwaiting: null` = the queue has not been verified, which is
 * NOT treated as "no" (the server decides), only a verified queue that lacks the room blocks.
 */
export function submissionEligibility(input: {
  evaluation: Pick<ChecklistEvaluation, "canSubmit">;
  submitting: boolean;
  online: boolean;
  identityMatches: boolean;
  templateChange: TemplateChange;
  roomStillAwaiting: boolean | null;
}): { ok: true } | { ok: false; reason: Ineligible } {
  if (input.submitting) return { ok: false, reason: "busy" };
  if (!input.identityMatches) return { ok: false, reason: "account_changed" };
  if (input.templateChange !== "same") return { ok: false, reason: "template_changed" };
  if (input.roomStillAwaiting === false) return { ok: false, reason: "room_not_awaiting" };
  if (!input.evaluation.canSubmit) return { ok: false, reason: "checklist_incomplete" };
  if (!input.online) return { ok: false, reason: "offline" };
  return { ok: true };
}

export type { AnswerCheck, RuleCode };
