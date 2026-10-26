import { checklistProgress, unansweredRequired, type ChecklistProgress } from "@/lib/inspections/checklist";
import {
  DEFAULT_REQUIRED_NA_POLICY,
  TOUCH_UP_MAX_ITEMS,
  type Answer,
  type AnswerMap,
  type ChecklistItem,
  type ChecklistTemplate,
  type CorrectionKind,
  type InspectionOutcome,
  type RequiredNaPolicy,
  type RuleCode,
  type Severity,
} from "@/lib/inspections/types";

/* ─── Inspection rules — the client's mirror of the server's (pure) ──────────
   `apps/api/services/inspection_rules.py` is the authority. This file reaches the same decisions so the screen can
   say what is missing BEFORE anything is sent; the conformance table in
   `apps/api/tests/fixtures/inspection_rules.json` is run against both. If the two ever disagree the server wins and
   the supervisor sees its message.

   The rules, in one place:
   • Every REQUIRED item needs a valid answer. An unanswered item is never a pass.
   • A failed item can never be quietly treated as a pass, and the outcome is DERIVED from the answers:
     any fail → failed, otherwise passed. A new inspection is never "conditional".
   • N/A is allowed only where the item allows it, and (for required items) where the property policy allows it.
   • A failed item that requires a photo cannot be completed without one; photos exist only for failed items.
   • An empty checklist, or one with nothing reviewed, approves nothing.
   • A short list of explicitly minor failures is a touch-up; anything else is a full re-clean. BOTH keep the room
     blocked until a passing reinspection — there is no pass-with-defects. */

export type Rule = { ok: true } | { ok: false; code: RuleCode; itemId?: string; missingItemIds?: string[] };

/** A checklist answer exactly as it would be sent. */
export interface AnswerRow {
  template_item_id: string | null | undefined;
  result: string;
  note?: string | null;
  severity?: string | null;
}

export type AnswerCheck =
  | { ok: true; outcome: InspectionOutcome; failedItemIds: string[]; correctionKind: CorrectionKind | null; answeredItemIds: string[] }
  | { ok: false; code: RuleCode; itemId?: string; missingItemIds?: string[] };

type ItemRules = Pick<ChecklistItem, "id" | "isRequired" | "allowsNa">;

const ANSWERS: readonly string[] = ["pass", "fail", "na"];
const SEVERITIES: readonly string[] = ["minor", "major"];

/** `null` when nothing failed; `touch_up` for a short all-minor list; otherwise `reclean` (unclassified counts as major). */
export function classifyFailure(severities: readonly (Severity | string | null | undefined)[]): CorrectionKind | null {
  if (severities.length === 0) return null;
  return severities.length <= TOUCH_UP_MAX_ITEMS && severities.every((severity) => severity === "minor") ? "touch_up" : "reclean";
}

/** Validate answer rows against a checklist and derive the outcome. Same checks, same order, same codes as the server. */
export function validateAnswers(
  items: readonly ItemRules[],
  rows: readonly AnswerRow[],
  options: { claimed: string; policy?: RequiredNaPolicy },
): AnswerCheck {
  const policy = options.policy ?? DEFAULT_REQUIRED_NA_POLICY;
  if (items.length === 0) return { ok: false, code: "no_checklist" };

  const byId = new Map(items.map((item) => [item.id, item]));
  const answers = new Map<string, { result: Answer; note: string | null; severity: string | null }>();
  for (const row of rows) {
    if (!row.template_item_id) return { ok: false, code: "item_missing_id" };
    if (!byId.has(row.template_item_id)) return { ok: false, code: "item_outside_checklist" };
    if (answers.has(row.template_item_id)) return { ok: false, code: "duplicate_item_answer" };
    if (!ANSWERS.includes(row.result)) return { ok: false, code: "invalid_answer" };
    const severity = row.severity ?? null;
    if (severity !== null && !SEVERITIES.includes(severity)) return { ok: false, code: "invalid_severity" };
    if (severity !== null && row.result !== "fail") return { ok: false, code: "severity_on_non_failed_item" };
    answers.set(row.template_item_id, { result: row.result as Answer, note: row.note?.trim() || null, severity });
  }

  const missing = items.filter((item) => item.isRequired && !answers.has(item.id)).map((item) => item.id);
  if (missing.length > 0) return { ok: false, code: "required_items_unanswered", missingItemIds: missing };
  if (answers.size === 0) return { ok: false, code: "no_answers" };

  for (const [itemId, answer] of answers) {
    if (answer.result !== "na") continue;
    const item = byId.get(itemId)!;
    if (!item.allowsNa) return { ok: false, code: "na_not_allowed", itemId };
    if (item.isRequired) {
      if (policy === "forbid") return { ok: false, code: "na_not_allowed", itemId };
      if (policy === "require_note" && !answer.note) return { ok: false, code: "na_note_required", itemId };
    }
  }

  const failed = [...answers].filter(([, answer]) => answer.result === "fail");
  const derived: InspectionOutcome = failed.length > 0 ? "failed" : "passed";
  if (options.claimed !== derived) return { ok: false, code: "result_mismatch" };

  return {
    ok: true,
    outcome: derived,
    failedItemIds: failed.map(([id]) => id),
    correctionKind: classifyFailure(failed.map(([, answer]) => answer.severity)),
    answeredItemIds: [...answers.keys()],
  };
}

/** Photos map one-to-one onto failed items; every failed item that requires a photo has one. */
export function validatePhotoLinks(
  items: readonly Pick<ChecklistItem, "id" | "requiresPhotoOnFail">[],
  failedItemIds: readonly string[],
  photoItemIds: readonly string[],
  photoCount: number,
): Rule {
  if (photoItemIds.length !== photoCount || new Set(photoItemIds).size !== photoItemIds.length) {
    return { ok: false, code: "photo_link_invalid" };
  }
  const failed = new Set(failedItemIds);
  const attached = new Set(photoItemIds);
  const required = items.filter((item) => item.requiresPhotoOnFail && failed.has(item.id)).map((item) => item.id);
  const missing = required.filter((id) => !attached.has(id));
  if (missing.length > 0) return { ok: false, code: "required_photos_missing", missingItemIds: missing };
  if ([...attached].some((id) => !failed.has(id))) return { ok: false, code: "photo_on_non_failed_item" };
  return { ok: true };
}

/* ─── What the screen needs ─────────────────────────────────────────────── */

/** Is the N/A choice offered for this item? */
export function canAnswerNa(item: ChecklistItem, policy: RequiredNaPolicy = DEFAULT_REQUIRED_NA_POLICY): boolean {
  if (!item.allowsNa) return false;
  return !(item.isRequired && policy === "forbid");
}

/** Does an N/A on this item need an explanation? */
export function naNeedsNote(item: ChecklistItem, policy: RequiredNaPolicy = DEFAULT_REQUIRED_NA_POLICY): boolean {
  return item.isRequired && policy === "require_note";
}

export interface FailedItem {
  item: ChecklistItem;
  note: string | null;
  severity: Severity | null;
}

/** The items marked fail, in configured order, with what the inspector wrote. */
export function failedItems(template: Pick<ChecklistTemplate, "items">, answers: AnswerMap): FailedItem[] {
  return template.items.flatMap((item) => {
    const answer = answers[item.id];
    if (answer?.result !== "fail") return [];
    return [{ item, note: answer.note?.trim() || null, severity: answer.severity ?? null }];
  });
}

export interface PhotoRequirements {
  /** Failed items that must have a photo. */
  required: ChecklistItem[];
  /** …of which none is attached yet. */
  missing: ChecklistItem[];
  /** Attached photos whose item is no longer failed; they must not be sent. */
  orphaned: string[];
}

/** `photos` maps item id → local file uri. */
export function photoRequirements(
  template: Pick<ChecklistTemplate, "items">,
  answers: AnswerMap,
  photos: Readonly<Record<string, string | undefined>>,
): PhotoRequirements {
  const failedIds = new Set(failedItems(template, answers).map((entry) => entry.item.id));
  const required = template.items.filter((item) => item.requiresPhotoOnFail && failedIds.has(item.id));
  return {
    required,
    missing: required.filter((item) => !photos[item.id]),
    orphaned: Object.keys(photos).filter((id) => photos[id] && !failedIds.has(id)),
  };
}

export interface ChecklistEvaluation {
  progress: ChecklistProgress;
  /** Required items still unanswered. */
  unanswered: ChecklistItem[];
  failed: FailedItem[];
  photos: PhotoRequirements;
  /** null until the checklist can legitimately conclude. */
  outcome: InspectionOutcome | null;
  correctionKind: CorrectionKind | null;
  /** The first rule standing in the way; null when the inspection can be submitted. */
  blocker: Extract<AnswerCheck, { ok: false }> | { ok: false; code: "required_photos_missing"; missingItemIds: string[] } | null;
  canSubmit: boolean;
}

/** Everything the review step needs, from the checklist and the answers on hand. */
export function evaluateChecklist(
  template: ChecklistTemplate,
  answers: AnswerMap,
  photos: Readonly<Record<string, string | undefined>> = {},
  policy: RequiredNaPolicy = DEFAULT_REQUIRED_NA_POLICY,
): ChecklistEvaluation {
  const failed = failedItems(template, answers);
  const rows: AnswerRow[] = template.items.flatMap((item) => {
    const answer = answers[item.id];
    return answer ? [{ template_item_id: item.id, result: answer.result, note: answer.note, severity: answer.severity }] : [];
  });
  const claimed: InspectionOutcome = failed.length > 0 ? "failed" : "passed";
  const check = validateAnswers(template.items, rows, { claimed, policy });
  const photoState = photoRequirements(template, answers, photos);

  let blocker: ChecklistEvaluation["blocker"] = check.ok ? null : check;
  if (!blocker && photoState.missing.length > 0) {
    blocker = { ok: false, code: "required_photos_missing", missingItemIds: photoState.missing.map((item) => item.id) };
  }
  return {
    progress: checklistProgress(template, answers),
    unanswered: unansweredRequired(template, answers),
    failed,
    photos: photoState,
    outcome: check.ok ? check.outcome : null,
    correctionKind: check.ok ? check.correctionKind : null,
    blocker,
    canSubmit: blocker === null,
  };
}
