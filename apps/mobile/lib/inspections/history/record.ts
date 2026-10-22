import type { InspectionDetail, InspectionDetailItem, ItemSeverity } from "@/lib/api/inspections";
import { resultOf } from "@/lib/inspections/history/rows";
import type { DoneResult } from "@/lib/inspections/lists";

/* ─── One recorded inspection, as the detail screen reads it (pure) ──────────
   Everything here comes from the server's record. Nothing is inferred: an old inspection with no checklist rows does
   NOT get a checklist of passes just because its overall result says Passed, and a fact that was never stored reads
   "Not recorded". Wording is the wording that was recorded when the inspection happened. */

export type AnswerResult = "pass" | "fail" | "na" | "unknown";

export type EvidenceState =
  /** A link is ready to open. */
  | "available"
  /** The record says a photo exists but a link could not be made now (removed, or storage unreachable). */
  | "unavailable"
  | "none";

export interface AnswerView {
  /** The checklist item's stable id (the row key), not its wording. */
  id: string;
  description: string;
  result: AnswerResult;
  note: string | null;
  severity: ItemSeverity | null;
  evidence: EvidenceState;
  photoUrl: string | null;
}

export interface SectionView {
  /** Position-based key: two sections may share a title after a template edit. */
  key: string;
  /** null = the item had no section on file. */
  title: string | null;
  answers: AnswerView[];
  passed: number;
  failed: number;
  na: number;
  /** pass + fail: what the "4/4" is out of. N/A answers are not part of it. */
  answered: number;
}

function answerResult(value: string): AnswerResult {
  return value === "pass" || value === "fail" || value === "na" ? value : "unknown";
}

function evidenceOf(item: InspectionDetailItem): EvidenceState {
  if (item.photo_url) return "available";
  return item.has_evidence ? "unavailable" : "none";
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export function buildAnswers(items: readonly InspectionDetailItem[]): AnswerView[] {
  return items.map((item, index) => ({
    id: item.template_item_id ?? `row-${index}`,
    // A checklist item deleted after the inspection leaves no wording to show; the screen says so instead of inventing one.
    description: trimmed(item.description) ?? "",
    result: answerResult(item.result),
    note: trimmed(item.note),
    severity: item.severity,
    evidence: evidenceOf(item),
    photoUrl: item.photo_url,
  }));
}

/** Group answers by section, keeping the server's order and each section's first appearance. */
export function buildSections(items: readonly InspectionDetailItem[]): SectionView[] {
  const sections: SectionView[] = [];
  let lastTitle: string | null | undefined;
  const answers = buildAnswers(items);
  items.forEach((item, index) => {
    const title = trimmed(item.section);
    if (!sections.length || lastTitle !== title) {
      sections.push({ key: `section-${sections.length}`, title, answers: [], passed: 0, failed: 0, na: 0, answered: 0 });
      lastTitle = title;
    }
    const section = sections[sections.length - 1];
    const answer = answers[index];
    section.answers.push(answer);
    if (answer.result === "pass") section.passed += 1;
    else if (answer.result === "fail") section.failed += 1;
    else if (answer.result === "na") section.na += 1;
    section.answered = section.passed + section.failed;
  });
  return sections;
}

export interface IssueView extends AnswerView {
  section: string | null;
}

/** Every failed standard that was recorded, in checklist order, with the wording and note exactly as recorded. */
export function failedIssues(items: readonly InspectionDetailItem[]): IssueView[] {
  const answers = buildAnswers(items);
  return answers
    .map((answer, index): IssueView => ({ ...answer, section: trimmed(items[index].section) }))
    .filter((issue) => issue.result === "fail");
}

export type InfoKey = "inspector" | "housekeeper" | "template" | "service" | "type";

export interface InfoRow {
  key: InfoKey;
  /** null = not recorded. The screen says so; it never fills a gap. */
  value: string | null;
  /** A translation key for values that are one of a fixed set. */
  valueKey?: string;
}

const SERVICE_KEYS: Record<string, string> = { STAY: "inspect.history.record.service.STAY", DEP: "inspect.history.record.service.DEP" };

export function infoRows(detail: InspectionDetail): InfoRow[] {
  const service = detail.service_type ? SERVICE_KEYS[detail.service_type] : undefined;
  return [
    { key: "inspector", value: trimmed(detail.inspector_name) },
    { key: "housekeeper", value: trimmed(detail.housekeeper_name) },
    { key: "template", value: trimmed(detail.template_name) },
    { key: "service", value: service ? null : trimmed(detail.service_type), ...(service ? { valueKey: service } : {}) },
    { key: "type", value: null, valueKey: detail.reinspection_of ? "inspect.history.record.type.reinspection" : "inspect.history.record.type.initial" },
  ];
}

export type CorrectionOutcome =
  | "none"
  /** A later passing inspection names this failure. */
  | "verified"
  /** A later failing inspection names it: the correction did not hold. */
  | "failed_again"
  /** The correction exists and is not settled. */
  | "open"
  | "cancelled"
  /** A correction was expected but is not on record. */
  | "missing";

export interface CorrectionSummary {
  outcome: CorrectionOutcome;
  /** The inspection that verified or repeated this failure, when there is one. */
  followUpId: string | null;
  /** A translation key under inspect.correction.detail.* . */
  statusKey: string | null;
}

/**
 * Where the failure's correction stands. A correction TASK existing is not evidence of a fix: only a passing
 * reinspection that names this inspection counts as verified, and a failure is never rewritten to Passed.
 */
export function correctionSummary(detail: InspectionDetail): CorrectionSummary {
  const correction = detail.correction;
  if (!correction) return { outcome: "none", followUpId: null, statusKey: null };
  const statusKey = `inspect.correction.detail.${correction.status}`;
  switch (correction.status) {
    case "verified":
      return { outcome: "verified", followUpId: correction.reinspection_id, statusKey };
    case "superseded":
      return { outcome: "failed_again", followUpId: correction.reinspection_id, statusKey };
    case "cancelled":
      return { outcome: "cancelled", followUpId: null, statusKey };
    case "correction_missing":
      return { outcome: "missing", followUpId: null, statusKey };
    default:
      return { outcome: "open", followUpId: null, statusKey };
  }
}

export interface RecordView {
  result: DoneResult;
  /** The server stored no checklist answers for this inspection. */
  checklistMissing: boolean;
  sections: SectionView[];
  issues: IssueView[];
  info: InfoRow[];
  notes: string | null;
  completedAtMs: number | null;
  /** The earlier failed inspection this one re-checks. */
  reinspectionOf: string | null;
  correction: CorrectionSummary;
  tally: { passed: number; failed: number; na: number };
}

export function buildRecord(detail: InspectionDetail): RecordView {
  const sections = buildSections(detail.items);
  const completed = detail.completed_at ? Date.parse(detail.completed_at) : NaN;
  return {
    result: resultOf(detail.overall_result),
    checklistMissing: detail.items.length === 0,
    sections,
    issues: failedIssues(detail.items),
    info: infoRows(detail),
    notes: trimmed(detail.notes),
    completedAtMs: Number.isFinite(completed) ? completed : null,
    reinspectionOf: detail.reinspection_of,
    correction: correctionSummary(detail),
    tally: sections.reduce(
      (sum, section) => ({ passed: sum.passed + section.passed, failed: sum.failed + section.failed, na: sum.na + section.na }),
      { passed: 0, failed: 0, na: 0 },
    ),
  };
}

/** "Oct 21" in the hotel's zone (the date half of "Oct 21 · 12:04 PM"). */
export function recordDateLabel(ms: number | null, timeZone: string | null | undefined, language: string): string | null {
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: timeZone ?? undefined });
}
