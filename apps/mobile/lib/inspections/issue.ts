import type { InspectionDraft } from "@/lib/inspections/draft";
import type { ChecklistItem, ChecklistTemplate, ItemAnswer, Severity } from "@/lib/inspections/types";
import { NOTE_MAX_LENGTH } from "@/lib/inspections/workspace";

/* ─── Reporting an issue on one checklist item (pure) ───────────────────────
   An issue is a failed answer plus what the supervisor says about it: what is wrong (the item's note), how serious
   (Minor / Major — chosen by a person, never inferred), and at most ONE photo (the server stores one `photo_url` per
   result, so there is no gallery). All of it lives in the draft under the item's id; nothing here is sent anywhere.

   The drawer edits a COPY (`IssueForm`) and commits it in one step, so closing it can be cancelled without
   leaving half an issue behind. */

export interface IssueForm {
  /** Free text as typed; trimmed when saved. */
  note: string;
  /** null = not chosen yet. There is no default: an unchosen severity is never treated as Minor. */
  severity: Severity | null;
  /** The photo file kept for this issue, or null for none. */
  photoUri: string | null;
}

export type IssueProblem = "severity_required" | "note_too_long";

export interface IssueErrors {
  severity?: Extract<IssueProblem, "severity_required">;
  note?: Extract<IssueProblem, "note_too_long">;
}

/** What the drawer starts from. A photo whose file is gone is not offered as evidence. */
export function issueFormOf(answer: ItemAnswer | undefined, photoUri: string | null | undefined, photoMissing = false): IssueForm {
  return {
    note: answer?.note ?? "",
    severity: answer?.severity ?? null,
    photoUri: photoUri && !photoMissing ? photoUri : null,
  };
}

function same(a: IssueForm, b: IssueForm): boolean {
  return a.note.trim() === b.note.trim() && a.severity === b.severity && a.photoUri === b.photoUri;
}

/** Has anything the supervisor would lose changed since the drawer opened? Whitespace-only edits do not count. */
export function isIssueFormDirty(initial: IssueForm, current: IssueForm): boolean {
  return !same(initial, current);
}

export function validateIssue(form: IssueForm): IssueErrors {
  const errors: IssueErrors = {};
  if (form.severity === null) errors.severity = "severity_required";
  if (form.note.trim().length > NOTE_MAX_LENGTH) errors.note = "note_too_long";
  return errors;
}

export function hasIssueErrors(errors: IssueErrors): boolean {
  return Boolean(errors.severity || errors.note);
}

/* ─── Photo evidence state ──────────────────────────────────────────────── */

export type PhotoStatus =
  /** The standard needs a photo and none is attached (or its file is gone). Blocks FINISHING, never saving a draft. */
  | "required_missing"
  | "required_attached"
  | "optional_empty"
  | "optional_attached";

export function photoStatus(item: Pick<ChecklistItem, "requiresPhotoOnFail">, hasPhoto: boolean): PhotoStatus {
  if (item.requiresPhotoOnFail) return hasPhoto ? "required_attached" : "required_missing";
  return hasPhoto ? "optional_attached" : "optional_empty";
}

/* ─── Committing and leaving ───────────────────────────────────────────── */

export type ApplyIssueResult =
  | {
      ok: true;
      draft: InspectionDraft;
      /** The photo this save stopped using. The caller deletes its file once the new draft is durably stored. */
      releasedPhoto: string | null;
    }
  | { ok: false; reason: "unknown_item" | "not_failed" | "invalid"; errors: IssueErrors };

/**
 * Write the form into the draft for ONE item. Refuses unless that item is currently a failure (a photo or severity can
 * never ride on a pass), refuses an unchosen severity or an over-long note rather than quietly fixing it, and never
 * touches another item's answer or photo.
 */
export function applyIssue(
  draft: InspectionDraft,
  template: Pick<ChecklistTemplate, "items">,
  itemId: string,
  form: IssueForm,
  now: number,
): ApplyIssueResult {
  const item = template.items.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: false, reason: "unknown_item", errors: {} };
  const current = draft.answers[itemId];
  if (current?.result !== "fail") return { ok: false, reason: "not_failed", errors: {} };
  const errors = validateIssue(form);
  if (hasIssueErrors(errors) || form.severity === null) return { ok: false, reason: "invalid", errors };

  const note = form.note.trim();
  const next: ItemAnswer = { result: "fail", severity: form.severity };
  if (note) next.note = note;

  const previous = draft.photos[itemId] ?? null;
  const photos = { ...draft.photos };
  if (form.photoUri) photos[itemId] = form.photoUri;
  else delete photos[itemId];

  return {
    ok: true,
    draft: { ...draft, answers: { ...draft.answers, [itemId]: next }, photos, updatedAt: now },
    releasedPhoto: previous && previous !== form.photoUri ? previous : null,
  };
}

/** Would changing this item away from "Issue" throw away something the supervisor wrote or captured? */
export function issueDetailsAtStake(draft: Pick<InspectionDraft, "answers" | "photos">, itemId: string): boolean {
  const answer = draft.answers[itemId];
  if (answer?.result !== "fail") return false;
  return Boolean(answer.note?.trim() || answer.severity || draft.photos[itemId]);
}

/** Every photo file a draft still refers to. Anything else in its evidence folder is an orphan. */
export function referencedPhotos(draft: Pick<InspectionDraft, "photos">): string[] {
  return Object.values(draft.photos).filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
}
