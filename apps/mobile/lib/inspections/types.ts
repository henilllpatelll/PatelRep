/* ─── Supervisor inspections — domain types (pure, no I/O) ──────────────────
   The redesigned inspection experience is organised around these pieces, each in its own module:

     templates.ts    queue → which checklist applies; normalising what the server sends; detecting edits
     checklist.ts    ordering, sections, progress for a chosen checklist
     validation.ts   answers → blockers, outcome, evidence rules (mirrors services/inspection_rules.py)
     submission.ts   payload, idempotent submit, outcome classification, "did it land?" recovery
     workflow.ts     the supervisor's workflow phase (separate from the persisted room status)
     corrections.ts  failed-inspection lifecycle and reinspection
     draft.ts        resumable draft identity and safety checks
     queue.ts        the inspection queue model, freshness
     useInspectionQueue.ts   the queue's data hook

   The SERVER is always the authority. Everything here gives instant, consistent feedback and decides what to
   try; the server re-checks every rule, and its answer wins. `apps/api/tests/fixtures/inspection_rules.json`
   is a conformance table both sides are tested against. */

export type Answer = "pass" | "fail" | "na";
export type Severity = "minor" | "major";
export type CorrectionKind = "touch_up" | "reclean";
/** What a NEW inspection can conclude. `conditional` exists only on historical rows. */
export type InspectionOutcome = "passed" | "failed";

/** A checklist item with every optional server field resolved to a definite value. */
export interface ChecklistItem {
  id: string;
  section: string;
  description: string;
  isRequired: boolean;
  requiresPhotoOnFail: boolean;
  allowsNa: boolean;
  /** Configured position; ties are broken by id so the order is always stable. */
  sortOrder: number;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  roomTypeId: string | null;
  isDefault: boolean;
  isActive: boolean;
  /** Server digest, or null from a server that does not send one yet. */
  fingerprint: string | null;
  items: ChecklistItem[];
}

export interface ItemAnswer {
  result: Answer;
  note?: string;
  severity?: Severity;
}

/** template item id → answer. A missing key means "not answered yet" — never an implicit pass. */
export type AnswerMap = Readonly<Record<string, ItemAnswer | undefined>>;

/** Property policy for N/A on a REQUIRED item (the per-item `allowsNa` flag always wins when false). */
export type RequiredNaPolicy = "allow" | "require_note" | "forbid";
export const DEFAULT_REQUIRED_NA_POLICY: RequiredNaPolicy = "allow";

/** A failure is a touch-up only when it is short and every failed item is explicitly minor. */
export const TOUCH_UP_MAX_ITEMS = 3;

/** The stable reasons the server (and the mirrored validation) give. Strings so unknown ones pass through. */
export type RuleCode =
  | "no_checklist"
  | "no_answers"
  | "item_missing_id"
  | "item_outside_checklist"
  | "duplicate_item_answer"
  | "invalid_answer"
  | "invalid_severity"
  | "severity_on_non_failed_item"
  | "required_items_unanswered"
  | "na_not_allowed"
  | "na_note_required"
  | "result_mismatch"
  | "photo_link_invalid"
  | "required_photos_missing"
  | "photo_on_non_failed_item";
