import type { ReadyRoom } from "@/lib/api/inspections";
import { resolveInspectionTarget } from "@/lib/housekeeping/inspectionTarget";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";
import { checklistProgress, groupSections, type ChecklistSection } from "@/lib/inspections/checklist";
import { answeredItemsOf, carryOverAnswers, judgeDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { queueRooms, type QueueItem } from "@/lib/inspections/queue";
import { checklistSignature, type TemplateSelection, type TemplateUnavailableReason } from "@/lib/inspections/templates";
import {
  DEFAULT_REQUIRED_NA_POLICY,
  type Answer,
  type AnswerMap,
  type ChecklistItem,
  type ChecklistTemplate,
  type ItemAnswer,
  type RequiredNaPolicy,
  type Severity,
} from "@/lib/inspections/types";
import { canAnswerNa, evaluateChecklist, naNeedsNote, type ChecklistEvaluation } from "@/lib/inspections/validation";

/* ─── The active inspection workspace — rules (pure, no I/O) ─────────────────
   Everything the workspace decides, kept apart from React so each rule can be tested on its own:

     resolveGate        which room and checklist the link names, or why none can be used
     answers            setting / clearing an answer or a note (never an implicit pass)
     sections           the configured sections as rows, with counts and where to go next
     reviewReadiness    what stands between the checklist and the read-only review
     reconcileTemplate  carrying answers over a checklist edit, only where the question is the same
     sessionIssue       whether an unfinished inspection may continue as the room and checklist are now

   Nothing here writes to the server. The inspection's outcome is the server's, in a later phase. */

/** The single property policy for N/A on a required item. There is no tenant setting yet, so this is the default. */
export const NA_POLICY: RequiredNaPolicy = DEFAULT_REQUIRED_NA_POLICY;

/* ─── Which room, which checklist ───────────────────────────────────────── */

export type UnavailableReason =
  | "signed_out"
  /** The link is not a plausible room id. */
  | "invalid_link"
  /** The queue could not be read: whether the room is inspectable is unknown. */
  | "queue_failed"
  /** Offline (or the answer is old) and nothing here has been started yet: eligibility cannot be verified. */
  | "needs_connection"
  /** The queue loaded and the room is not in it: inspected, being cleaned again, or not this hotel's. */
  | "not_awaiting"
  /** The checklists could not be read. */
  | "templates_failed"
  | TemplateUnavailableReason;

export type Gate =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: UnavailableReason }
  | { kind: "ready"; item: QueueItem; template: ChecklistTemplate };

export function resolveGate(input: {
  roomId: string | null;
  signedIn: boolean;
  isOnline: boolean;
  queue: SourceState<ReadyRoom[]>;
  items: readonly QueueItem[] | null;
  templates: SourceState<unknown>;
  selectionFor: (roomTypeId: string | null | undefined) => TemplateSelection | null;
}): Gate {
  if (!input.signedIn) return { kind: "unavailable", reason: "signed_out" };
  const rooms = queueRooms(input.queue);
  const target = resolveInspectionTarget(input.roomId, rooms ?? [], rooms !== null);
  switch (target.kind) {
    case "none":
    case "invalid":
      return { kind: "unavailable", reason: "invalid_link" };
    case "waiting":
      // Offline with nothing verified yet, nothing is going to load: say so rather than spin forever.
      if (input.queue.status === "failed") return { kind: "unavailable", reason: input.queue.failure.kind === "offline" ? "needs_connection" : "queue_failed" };
      return input.isOnline ? { kind: "loading" } : { kind: "unavailable", reason: "needs_connection" };
    case "not_awaiting":
      return { kind: "unavailable", reason: "not_awaiting" };
    case "ready":
      break;
  }
  const item = input.items?.find((candidate) => candidate.roomId === target.room.room_id);
  if (!item) return { kind: "loading" };

  const selection = input.selectionFor(item.roomTypeId);
  if (!selection) {
    if (input.templates.status === "failed") return { kind: "unavailable", reason: input.templates.failure.kind === "offline" ? "needs_connection" : "templates_failed" };
    return input.isOnline ? { kind: "loading" } : { kind: "unavailable", reason: "needs_connection" };
  }
  if (!selection.ok) return { kind: "unavailable", reason: selection.reason };
  return { kind: "ready", item, template: selection.template };
}

/** Starting or resuming needs an answer the server just gave. Carrying on an inspection already under way does not. */
export function isVerifiedFresh(queue: SourceState<unknown>): boolean {
  return queue.status === "available" || queue.status === "empty";
}

/** The facts a draft is judged against, from the queue row the screen is showing. */
export function draftContext(input: { hotelId: string; userId: string; businessDate: string; item: QueueItem; template: ChecklistTemplate }) {
  return {
    hotelId: input.hotelId,
    userId: input.userId,
    roomId: input.item.roomId,
    businessDate: input.businessDate,
    cleanCycleId: input.item.cleanCycleId,
    reinspectionOf: input.item.reinspection.failureInspectionId,
    template: input.template,
  };
}

/* ─── Answers ───────────────────────────────────────────────────────────── */

export type AnswerRefusal = "unknown_item" | "na_not_allowed";

export type AnswerResult =
  /** `released` = photo files the new draft no longer refers to; delete them once the draft is safely stored. */
  | { ok: true; draft: InspectionDraft; released: string[] }
  | { ok: false; refusal: AnswerRefusal };

function touch(draft: InspectionDraft, patch: Partial<InspectionDraft>, now: number): InspectionDraft {
  return { ...draft, ...patch, updatedAt: now };
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Record an explicit answer. Choosing the answer already selected clears it again (back to "not reviewed"), which is how
 * an accidental tap is undone; any other choice replaces it. A note stays with the item, except that an issue's
 * description, severity and photo belong to the failure alone: once the answer is no longer a failure they go too, so
 * stale issue text can never be sent against a passed item.
 */
export function chooseAnswer(
  draft: InspectionDraft,
  template: Pick<ChecklistTemplate, "items">,
  itemId: string,
  result: Answer,
  now: number,
  policy: RequiredNaPolicy = NA_POLICY,
): AnswerResult {
  const item = template.items.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: false, refusal: "unknown_item" };
  const current = draft.answers[itemId];
  if (current?.result === result) return clearAnswer(draft, itemId, now);
  if (result === "na" && !canAnswerNa(item, policy)) return { ok: false, refusal: "na_not_allowed" };
  const leavingFail = current?.result === "fail" && result !== "fail";
  const next: ItemAnswer = { result };
  if (current?.note && !leavingFail) next.note = current.note;
  if (result === "fail" && current?.severity) next.severity = current.severity;
  const photos = result === "fail" ? draft.photos : without(draft.photos, itemId);
  const released = result !== "fail" && draft.photos[itemId] ? [draft.photos[itemId]] : [];
  return {
    ok: true,
    released,
    draft: touch(
      draft,
      {
        answers: { ...draft.answers, [itemId]: next },
        questions: { ...draft.questions, [itemId]: { section: item.section, description: item.description } },
        photos,
      },
      now,
    ),
  };
}

export function clearAnswer(draft: InspectionDraft, itemId: string, now: number): AnswerResult {
  if (!draft.answers[itemId]) return { ok: true, draft, released: [] };
  return {
    ok: true,
    released: draft.photos[itemId] ? [draft.photos[itemId]] : [],
    draft: touch(draft, { answers: without(draft.answers, itemId), questions: without(draft.questions, itemId), photos: without(draft.photos, itemId) }, now),
  };
}

export const NOTE_MAX_LENGTH = 500;

/** A note belongs to an answered item. Whitespace-only is no note. Returns the draft unchanged when nothing differs. */
export function setItemNote(draft: InspectionDraft, itemId: string, note: string, now: number): InspectionDraft {
  const answer = draft.answers[itemId];
  if (!answer) return draft;
  const text = note.slice(0, NOTE_MAX_LENGTH);
  if ((answer.note ?? "") === text) return draft;
  const next: ItemAnswer = { ...answer };
  if (text.trim()) next.note = text;
  else delete next.note;
  return touch(draft, { answers: { ...draft.answers, [itemId]: next } }, now);
}

/** Has the supervisor done anything worth keeping? An untouched checklist is never stored or prompted about. */
export function hasProgress(draft: Pick<InspectionDraft, "answers" | "notes">): boolean {
  return Object.keys(draft.answers).length > 0 || draft.notes.trim().length > 0;
}

export function failedCount(answers: AnswerMap): number {
  return Object.values(answers).filter((answer) => answer?.result === "fail").length;
}

/* ─── Sections as rows ──────────────────────────────────────────────────── */

export interface SectionSummary {
  name: string;
  total: number;
  answered: number;
  /** Required items still waiting for an answer. */
  requiredMissing: number;
  failed: number;
}

export function summarizeSections(sections: readonly ChecklistSection[], answers: AnswerMap): SectionSummary[] {
  return sections.map((section) => {
    let answered = 0;
    let requiredMissing = 0;
    let failed = 0;
    for (const item of section.items) {
      const answer = answers[item.id];
      if (answer) {
        answered += 1;
        if (answer.result === "fail") failed += 1;
      } else if (item.isRequired) {
        requiredMissing += 1;
      }
    }
    return { name: section.name, total: section.items.length, answered, requiredMissing, failed };
  });
}

export type ExpandedState = Readonly<Record<string, boolean>>;

/** The first section that still needs an answer is open; the rest are closed. A finished checklist opens at the top. */
export function initialExpanded(summaries: readonly SectionSummary[]): ExpandedState {
  const open = summaries.find((s) => s.requiredMissing > 0) ?? summaries.find((s) => s.answered < s.total) ?? summaries[0];
  return Object.fromEntries(summaries.map((s) => [s.name, s === open]));
}

export type WorkspaceRow =
  | { kind: "section"; key: string; summary: SectionSummary; expanded: boolean }
  | { kind: "item"; key: string; item: ChecklistItem; answer: ItemAnswer | undefined };

/** A collapsed section contributes only its header, so a long checklist never mounts every item at once. */
export function buildRows(sections: readonly ChecklistSection[], summaries: readonly SectionSummary[], expanded: ExpandedState, answers: AnswerMap): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [];
  sections.forEach((section, index) => {
    const isOpen = expanded[section.name] === true;
    rows.push({ kind: "section", key: `section:${section.name}`, summary: summaries[index], expanded: isOpen });
    if (!isOpen) return;
    for (const item of section.items) rows.push({ kind: "item", key: `item:${item.id}`, item, answer: answers[item.id] });
  });
  return rows;
}

export function sectionOf(template: Pick<ChecklistTemplate, "items">, itemId: string): string | null {
  return template.items.find((item) => item.id === itemId)?.section ?? null;
}

/** Where "Next" goes: the next unanswered REQUIRED item after `fromItemId` (wrapping), else the next unanswered one. */
export function nextToReview(template: Pick<ChecklistTemplate, "items">, answers: AnswerMap, fromItemId: string | null): ChecklistItem | null {
  const items = template.items;
  const start = fromItemId ? items.findIndex((item) => item.id === fromItemId) + 1 : 0;
  const ordered = [...items.slice(start), ...items.slice(0, start)];
  const open = ordered.filter((item) => !answers[item.id]);
  return open.find((item) => item.isRequired) ?? open[0] ?? null;
}

/* ─── Guidance ──────────────────────────────────────────────────────────── */

/** A description this long is likely clipped in the row, so reading it in full is real information. */
export const LONG_DESCRIPTION = 60;

/**
 * Is there anything to read beyond what the row already shows? Only configured facts count: a long standard, a
 * photo requirement, or a no-N/A rule. A short, plain item gets no button — the row already says everything.
 */
export function hasGuidance(item: ChecklistItem): boolean {
  return item.description.length > LONG_DESCRIPTION || item.description.includes("\n") || item.requiresPhotoOnFail || !item.allowsNa;
}

/* ─── Review readiness ──────────────────────────────────────────────────── */

export type ReviewReadiness =
  /** Nothing has been answered, and no item is required: there is nothing to review. */
  | { kind: "no_answers" }
  /** Required items are missing; go to the first. */
  | { kind: "unanswered"; itemId: string; remaining: number }
  /** An N/A that the item or the property does not allow, or that needs the note it lacks. */
  | { kind: "invalid"; code: "na_not_allowed" | "na_note_required"; itemId: string }
  | { kind: "ready"; evaluation: ChecklistEvaluation };

/**
 * May the supervisor open the read-only review? Every required item must be answered and every answer must be valid.
 * Anything only a later step can supply — an issue's details, a photo — does not block REVIEWING; it is listed in the
 * review as outstanding and keeps the inspection from being finished.
 */
export function reviewReadiness(template: ChecklistTemplate, draft: Pick<InspectionDraft, "answers" | "photos">, policy: RequiredNaPolicy = NA_POLICY): ReviewReadiness {
  const evaluation = evaluateChecklist(template, draft.answers, draft.photos, policy);
  const missing = evaluation.unanswered;
  if (missing.length > 0) return { kind: "unanswered", itemId: missing[0].id, remaining: missing.length };
  const blocker = evaluation.blocker;
  if (blocker && (blocker.code === "na_not_allowed" || blocker.code === "na_note_required") && blocker.itemId) {
    return { kind: "invalid", code: blocker.code, itemId: blocker.itemId };
  }
  if (blocker?.code === "no_answers") return { kind: "no_answers" };
  return { kind: "ready", evaluation };
}

export interface ReviewFailure {
  item: ChecklistItem;
  note: string | null;
  /** null = the supervisor has not chosen one; the server would treat that conservatively as major. */
  severity: Severity | null;
  needsSeverity: boolean;
  /** A photo is attached AND its file is still on the phone. */
  hasPhoto: boolean;
  /** An attached photo's file has disappeared; it counts as no photo. */
  photoFileLost: boolean;
  photoRequired: boolean;
  /** The standard needs a photo and there is none usable. */
  photoMissing: boolean;
  /** A failed item is not finished until its severity is chosen and any required photo is present. */
  needsDetails: boolean;
}

export interface ReviewModel {
  /** Items with an answer / items on the checklist. */
  reviewed: number;
  total: number;
  passed: number;
  failed: number;
  na: number;
  /** Optional items nobody reviewed. */
  optionalUnreviewed: number;
  failures: ReviewFailure[];
  naItems: { item: ChecklistItem; note: string | null }[];
  /** Failed items still missing something (severity or a required photo). */
  outstanding: number;
}

/** `lost` = item ids whose photo file is gone from the phone: those count as having no photo. */
export function buildReview(template: ChecklistTemplate, draft: Pick<InspectionDraft, "answers" | "photos">, lost: ReadonlySet<string> = new Set()): ReviewModel {
  let passed = 0;
  let na = 0;
  let reviewed = 0;
  let optionalUnreviewed = 0;
  const failures: ReviewFailure[] = [];
  const naItems: ReviewModel["naItems"] = [];
  for (const item of template.items) {
    const answer = draft.answers[item.id];
    if (!answer) {
      if (!item.isRequired) optionalUnreviewed += 1;
      continue;
    }
    reviewed += 1;
    if (answer.result === "pass") passed += 1;
    else if (answer.result === "na") {
      na += 1;
      naItems.push({ item, note: answer.note?.trim() || null });
    } else {
      const attached = Boolean(draft.photos[item.id]);
      const photoFileLost = attached && lost.has(item.id);
      const hasPhoto = attached && !photoFileLost;
      const photoMissing = item.requiresPhotoOnFail && !hasPhoto;
      const needsSeverity = answer.severity === undefined;
      failures.push({
        item,
        note: answer.note?.trim() || null,
        severity: answer.severity ?? null,
        needsSeverity,
        hasPhoto,
        photoFileLost,
        photoRequired: item.requiresPhotoOnFail,
        photoMissing,
        needsDetails: needsSeverity || photoMissing,
      });
    }
  }
  return { reviewed, total: template.items.length, passed, failed: failures.length, na, optionalUnreviewed, failures, naItems, outstanding: failures.filter((f) => f.needsDetails).length };
}

/* ─── Surviving a checklist edit ────────────────────────────────────────── */

export interface CarryOverPlan {
  /** The draft re-based on the current checklist: same room and cycle, kept answers, and a NEW submission id. */
  draft: InspectionDraft;
  carried: number;
  /** Answered questions that are gone, reworded, or whose answer the current rules no longer allow. */
  dropped: number;
  /** Required questions on the current checklist that still need an answer. */
  stillToAnswer: number;
}

/**
 * Re-base a draft on the checklist as it is now. Only a question whose section and wording are unchanged keeps its
 * answer (never "the same position"), an N/A the current rules refuse is dropped, and anything new is simply
 * unanswered. The submission id is new: it names content, and the content changed.
 */
export function reconcileTemplate(draft: InspectionDraft, current: ChecklistTemplate, input: { now: number; submissionId: string; policy?: RequiredNaPolicy }): CarryOverPlan {
  const policy = input.policy ?? NA_POLICY;
  const old = answeredItemsOf(draft);
  const result = carryOverAnswers(old, current.items, draft.answers, draft.photos);
  const answers: Record<string, ItemAnswer> = {};
  const questions: InspectionDraft["questions"] = {};
  const photos: Record<string, string> = {};
  let dropped = Object.keys(draft.answers).length - old.length + result.dropped.length; // unrecognisable answers count as dropped
  for (const [id, answer] of Object.entries(result.answers)) {
    const item = current.items.find((candidate) => candidate.id === id);
    if (!item) continue;
    if (answer.result === "na" && !canAnswerNa(item, policy)) {
      dropped += 1;
      continue;
    }
    answers[id] = answer.result === "fail" ? answer : { result: answer.result, ...(answer.note ? { note: answer.note } : {}) };
    questions[id] = { section: item.section, description: item.description };
    if (result.photos[id]) photos[id] = result.photos[id];
  }
  const rebased: InspectionDraft = {
    ...draft,
    templateId: current.id,
    templateFingerprint: current.fingerprint,
    templateSignature: checklistSignature(current),
    submissionId: input.submissionId,
    answers,
    questions,
    photos,
    updatedAt: input.now,
  };
  return {
    draft: rebased,
    carried: Object.keys(answers).length,
    dropped,
    stillToAnswer: current.items.filter((item) => item.isRequired && !answers[item.id]).length,
  };
}

/* ─── May an unfinished inspection continue? ───────────────────────────── */

export type SessionIssue =
  /** Another supervisor approved it, the housekeeper reopened it, or it left CLEAN. */
  | "not_awaiting"
  /** A new clean cycle began, or the earlier failure being re-checked changed. */
  | "room_changed"
  | "template_changed"
  /** The hotel's calendar day rolled over. */
  | "other_day";

/**
 * Compare the inspection in hand with the room and checklist as the queue now reports them. `null` means carry on —
 * including when the answer is simply unknown (offline, still loading): not knowing is not a reason to interrupt, and
 * nothing is sent from here anyway.
 */
export function sessionIssue(input: {
  draft: InspectionDraft;
  gate: Gate;
  hotelId: string;
  userId: string;
  businessDate: string;
}): SessionIssue | null {
  const { gate, draft } = input;
  if (gate.kind === "unavailable") {
    if (gate.reason === "not_awaiting") return "not_awaiting";
    if (gate.reason === "no_templates" || gate.reason === "no_usable_template" || gate.reason === "no_default" || gate.reason === "room_type_unknown") {
      return "template_changed";
    }
    return null;
  }
  if (gate.kind !== "ready") return null;
  const verdict = judgeDraft(draft, draftContext({ hotelId: input.hotelId, userId: input.userId, businessDate: input.businessDate, item: gate.item, template: gate.template }));
  if (verdict.usable) return null;
  switch (verdict.reason) {
    case "other_day":
      return "other_day";
    case "template_changed":
      return "template_changed";
    default:
      return "room_changed";
  }
}
