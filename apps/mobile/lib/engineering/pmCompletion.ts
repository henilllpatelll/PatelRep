/* ─── PM completion guard ───────────────────────────────────────────────────
   POST /assets/pm-schedules/{id}/complete requires a structured body
   (CompletePMProgramRequest): at least one checklist item, each with a
   passed / failed / not_applicable result, and evidence ids for any item that
   requires it. The old one-tap "Log Complete" sent `{}` and could never
   succeed. Nothing may send a completion without passing this check; the
   guided inspection that builds a real payload ships in Phase 5. */

export type PmItemResult = "passed" | "failed" | "not_applicable";

export interface PmChecklistResultItem {
  key?: string;
  label: string;
  result: PmItemResult;
  requires_evidence?: boolean;
  /** `evidence_records.id` values uploaded beforehand — never URLs. */
  evidence?: string[];
  note?: string;
}

export interface PmCompletionPayload {
  checklist_template_id?: string;
  checklist_version?: number;
  verifier_id?: string;
  labor_minutes?: number;
  notes?: string;
  photos?: string[];
  items: PmChecklistResultItem[];
}

export type PmCompletionIssue =
  | { code: "no_items" }
  | { code: "bad_result"; label: string }
  | { code: "evidence_required"; label: string };

const RESULTS: readonly string[] = ["passed", "failed", "not_applicable"];

/** Mirrors `validate_completion_items` and the request model; the server stays the authority. */
export function validatePmCompletion(payload: { items?: readonly PmChecklistResultItem[] | null } | null | undefined): PmCompletionIssue | null {
  const items = payload?.items;
  if (!items || items.length === 0) return { code: "no_items" };
  for (const item of items) {
    if (!item?.label?.trim() || !RESULTS.includes(item.result)) return { code: "bad_result", label: item?.label ?? "" };
    if (item.requires_evidence && item.result !== "not_applicable" && !(item.evidence && item.evidence.length > 0)) {
      return { code: "evidence_required", label: item.label };
    }
  }
  return null;
}

export class PmCompletionBlockedError extends Error {
  readonly issue: PmCompletionIssue;
  constructor(issue: PmCompletionIssue) {
    super(`PM completion blocked: ${issue.code}`);
    this.name = "PmCompletionBlockedError";
    this.issue = issue;
  }
}

/** Throws before any request is made when the payload could not be a valid completion. */
export function assertPmCompletionAllowed(payload: PmCompletionPayload): void {
  const issue = validatePmCompletion(payload);
  if (issue) throw new PmCompletionBlockedError(issue);
}
