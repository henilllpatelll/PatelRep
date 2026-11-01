/* ─── PM completion guard ───────────────────────────────────────────────────
   POST /assets/pm-schedules/{id}/complete requires a structured body
   (CompletePMProgramRequest): at least one checklist item, each with a
   passed / failed / not_applicable result, and evidence ids for any item that
   requires it. The old one-tap "Log Complete" sent `{}` and could never
   succeed. Nothing may send a completion without passing this check; the
   guided inspection (pmChecklist.ts) builds the real payload. */

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

export interface PmConditionReading {
  meter_id: string;
  value: number;
  notes?: string;
}

/** Mirrors CompletePMProgramRequest. Parts and defects are recorded as written; the API does not deduct stock. */
export interface PmCompletionPayload {
  checklist_template_id?: string;
  checklist_version?: number;
  verifier_id?: string;
  labor_minutes?: number;
  notes?: string;
  /** `evidence_records.id` values - never URLs. */
  photos?: string[];
  condition_readings?: PmConditionReading[];
  parts_used?: Array<{ name: string; qty?: number }>;
  defects?: Array<{ description: string; severity?: string }>;
  items: PmChecklistResultItem[];
}

export interface PmCompletionResult {
  id: string;
  pm_schedule_id: string;
  completed_at: string;
  /** Work orders the server opened for failed steps - only present on a direct response, not a re-read. */
  corrective_work_orders?: Array<{ id: string; title: string }>;
  /** True when the first request's outcome was unknown and a re-read found the completion already recorded. */
  reconciled?: boolean;
}

export type PmCompletionIssue =
  | { code: "no_items" }
  | { code: "bad_result"; label: string }
  | { code: "evidence_required"; label: string }
  | { code: "bad_evidence"; label: string };

/** An evidence record id is a bare identifier; anything with a slash, colon or dot is a URL or path and never valid. */
const EVIDENCE_ID = /^[A-Za-z0-9_-]{1,100}$/;

const RESULTS: readonly string[] = ["passed", "failed", "not_applicable"];

/** Mirrors `validate_completion_items` and the request model; the server stays the authority. */
export function validatePmCompletion(
  payload: { items?: readonly PmChecklistResultItem[] | null; photos?: readonly string[] | null } | null | undefined,
): PmCompletionIssue | null {
  const items = payload?.items;
  const badPhoto = payload?.photos?.find((id) => !EVIDENCE_ID.test(id));
  if (badPhoto !== undefined) return { code: "bad_evidence", label: badPhoto };
  if (!items || items.length === 0) return { code: "no_items" };
  for (const item of items) {
    if (!item?.label?.trim() || !RESULTS.includes(item.result)) return { code: "bad_result", label: item?.label ?? "" };
    if (item.requires_evidence && item.result !== "not_applicable" && !(item.evidence && item.evidence.length > 0)) {
      return { code: "evidence_required", label: item.label };
    }
    const badId = item.evidence?.find((id) => !EVIDENCE_ID.test(id));
    if (badId !== undefined) return { code: "bad_evidence", label: item.label };
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
