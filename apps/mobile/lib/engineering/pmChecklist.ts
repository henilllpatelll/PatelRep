/* ─── PM inspection: template, draft, validation, payload ───────────────────
   The inspection is built from a real `pm_checklist_templates` row - there is no fallback or "general" checklist, so a
   property without templates gets a configuration message instead of an invented inspection. A pm_schedule has no link
   to a template, so the technician picks one (the web console works the same way); the template id and version go with
   the completion so history can show exactly what was inspected.

   Rules enforced before anything is sent (the server stays the authority):
     - every checklist item needs an explicit Pass / Fail / N/A (nothing is defaulted to Pass);
     - Pass or Fail on a controlled item needs evidence (N/A does not);
     - readings are numbers, optional, and never imply a Pass;
     - a draft is only ever submitted against the exact checklist it was started on. */

import { PmCompletionBlockedError, validatePmCompletion, type PmCompletionPayload, type PmItemResult } from "./pmCompletion";
import type { PmSubmission } from "./pmSubmission";
import { parseReading, type PmMeter } from "./pmReadings";

/* ── templates ── */

export interface PmTemplateRow {
  id: string;
  code?: string | null;
  name: string;
  name_es?: string | null;
  version?: number | null;
  is_active?: boolean | null;
  items?: { checklist?: Array<{ key?: string | null; label?: string | null; requires_evidence?: boolean | null }> | null } | null;
}

export interface PmTemplateItem {
  /** Stable within this template version (`i0`, `i1`, …): the key drafts and answers are filed under. */
  id: string;
  /** Server item key, sent back unchanged when present. */
  key: string | null;
  label: string;
  requiresEvidence: boolean;
}

export interface PmTemplate {
  id: string;
  code: string | null;
  name: string;
  nameEs: string | null;
  version: number | null;
  items: PmTemplateItem[];
}

/** Templates with no usable checklist are dropped: an empty checklist can never be a completed inspection. */
export function adaptPmTemplates(rows: readonly PmTemplateRow[] | null | undefined): PmTemplate[] {
  const templates: PmTemplate[] = [];
  for (const row of rows ?? []) {
    if (!row?.id || row.is_active === false) continue;
    const items: PmTemplateItem[] = [];
    for (const entry of row.items?.checklist ?? []) {
      const label = entry?.label?.trim();
      if (!label) continue;
      items.push({ id: `i${items.length}`, key: entry.key?.trim() || null, label, requiresEvidence: entry.requires_evidence === true });
    }
    if (items.length === 0) continue;
    templates.push({
      id: row.id,
      code: row.code ?? null,
      name: row.name,
      nameEs: row.name_es?.trim() || null,
      version: typeof row.version === "number" ? row.version : null,
      items,
    });
  }
  return templates;
}

/** Changes whenever the checklist content does, even if the server edited it in place without bumping `version`. */
export function templateSignature(template: PmTemplate): string {
  return template.items.map((i) => `${i.key ?? ""}|${i.label}|${i.requiresEvidence ? 1 : 0}`).join("\n");
}

/* ── draft ── */

export interface PmEvidenceRef {
  /** `evidence_records.id` returned by the upload - the only thing ever sent. */
  id: string;
  /** Local preview; may be gone after a restart. */
  uri?: string;
}

export interface PmDraftItem {
  result: PmItemResult | null;
  note: string;
  evidence: PmEvidenceRef[];
}

export interface PmDraftPart {
  id: string;
  name: string;
  qty: string;
}

export interface PmDraftDefect {
  id: string;
  description: string;
  severity: "low" | "medium" | "high" | null;
}

export interface PmDraft {
  v: 1;
  scheduleId: string;
  templateId: string;
  templateVersion: number | null;
  templateSignature: string;
  /** Identity of each item (`k:key` or `l:label`), in id order, so answers can follow an item to a newer checklist. */
  identities: string[];
  startedAt: string;
  updatedAt: string;
  items: Record<string, PmDraftItem>;
  readings: Record<string, { value: string; note: string }>;
  photos: PmEvidenceRef[];
  laborMinutes: string;
  parts: PmDraftPart[];
  defects: PmDraftDefect[];
  notes: string;
  /** The submission id of the last completion attempt made from this draft, so a retry (even after a restart) reuses it. */
  submission?: PmSubmission;
}

const itemIdentity = (item: PmTemplateItem): string => (item.key ? `k:${item.key}` : `l:${item.label}`);

const emptyItem = (): PmDraftItem => ({ result: null, note: "", evidence: [] });

export function newDraft(scheduleId: string, template: PmTemplate, now: Date = new Date()): PmDraft {
  const stamp = now.toISOString();
  return {
    v: 1,
    scheduleId,
    templateId: template.id,
    templateVersion: template.version,
    templateSignature: templateSignature(template),
    identities: template.items.map(itemIdentity),
    startedAt: stamp,
    updatedAt: stamp,
    items: Object.fromEntries(template.items.map((i) => [i.id, emptyItem()])),
    readings: {},
    photos: [],
    laborMinutes: "",
    parts: [],
    defects: [],
    notes: "",
  };
}

export type DraftCompatibility = "ok" | "template_missing" | "template_changed";

export function draftCompatibility(draft: PmDraft, template: PmTemplate | undefined): DraftCompatibility {
  if (!template) return "template_missing";
  if (draft.templateId !== template.id || draft.templateVersion !== template.version || draft.templateSignature !== templateSignature(template)) {
    return "template_changed";
  }
  return "ok";
}

/**
 * Moves a draft onto the current checklist. An answer is carried over only when the same item (same key, else same
 * label) still exists; everything else starts unanswered, and the technician reviews it before submitting.
 */
export function rebaseDraft(draft: PmDraft, template: PmTemplate, now: Date = new Date()): PmDraft {
  const fresh = newDraft(draft.scheduleId, template, now);
  const previousByIdentity = new Map<string, PmDraftItem>();
  draft.identities.forEach((identity, index) => {
    const item = draft.items[`i${index}`];
    if (item) previousByIdentity.set(identity, item);
  });
  for (const item of template.items) {
    const carried = previousByIdentity.get(itemIdentity(item));
    if (carried) fresh.items[item.id] = { ...carried, evidence: [...carried.evidence] };
  }
  return {
    ...fresh,
    startedAt: draft.startedAt,
    readings: draft.readings,
    photos: draft.photos,
    laborMinutes: draft.laborMinutes,
    parts: draft.parts,
    defects: draft.defects,
    notes: draft.notes,
  };
}

/** Whether the draft holds anything worth keeping (an untouched draft is not saved). */
export function draftHasContent(draft: PmDraft): boolean {
  return (
    Object.values(draft.items).some((i) => i.result || i.note.trim() || i.evidence.length > 0) ||
    Object.values(draft.readings).some((r) => r.value.trim() || r.note.trim()) ||
    draft.photos.length > 0 ||
    !!draft.laborMinutes.trim() ||
    draft.parts.length > 0 ||
    draft.defects.length > 0 ||
    !!draft.notes.trim()
  );
}

/* ── progress & validation ── */

export interface PmProgress {
  total: number;
  answered: number;
  passed: number;
  failed: number;
  notApplicable: number;
  unansweredIds: string[];
  /** Items that need evidence before they can be submitted. */
  evidenceMissingIds: string[];
  /** Failed items that still have no written finding. */
  findingMissingIds: string[];
  percent: number;
}

export function pmProgress(template: PmTemplate, draft: PmDraft): PmProgress {
  const out: PmProgress = {
    total: template.items.length,
    answered: 0,
    passed: 0,
    failed: 0,
    notApplicable: 0,
    unansweredIds: [],
    evidenceMissingIds: [],
    findingMissingIds: [],
    percent: 0,
  };
  for (const item of template.items) {
    const answer = draft.items[item.id] ?? emptyItem();
    if (!answer.result) {
      out.unansweredIds.push(item.id);
      continue;
    }
    out.answered += 1;
    if (answer.result === "passed") out.passed += 1;
    else if (answer.result === "failed") {
      out.failed += 1;
      if (!answer.note.trim()) out.findingMissingIds.push(item.id);
    } else out.notApplicable += 1;
    if (item.requiresEvidence && answer.result !== "not_applicable" && answer.evidence.length === 0) out.evidenceMissingIds.push(item.id);
  }
  out.percent = out.total === 0 ? 0 : Math.round((out.answered / out.total) * 100);
  return out;
}

export type PmInspectionIssue =
  | { code: "unanswered"; itemId: string }
  | { code: "evidence_required"; itemId: string }
  | { code: "finding_required"; itemId: string }
  | { code: "reading_invalid"; meterId: string }
  | { code: "labor_invalid" }
  | { code: "part_invalid"; partId: string }
  | { code: "defect_invalid"; defectId: string };

export function validateInspection(template: PmTemplate, draft: PmDraft, meters: readonly PmMeter[]): PmInspectionIssue[] {
  const issues: PmInspectionIssue[] = [];
  const progress = pmProgress(template, draft);
  for (const itemId of progress.unansweredIds) issues.push({ code: "unanswered", itemId });
  for (const itemId of progress.evidenceMissingIds) issues.push({ code: "evidence_required", itemId });
  for (const itemId of progress.findingMissingIds) issues.push({ code: "finding_required", itemId });
  for (const meter of meters) {
    if (parseReading(draft.readings[meter.id]?.value).kind === "invalid") issues.push({ code: "reading_invalid", meterId: meter.id });
  }
  const labor = draft.laborMinutes.trim();
  if (labor && !(/^\d+$/.test(labor) && Number(labor) <= 1440)) issues.push({ code: "labor_invalid" });
  for (const part of draft.parts) {
    const qty = part.qty.trim();
    if (!part.name.trim() || (qty && !(Number(qty) > 0 && Number.isFinite(Number(qty))))) issues.push({ code: "part_invalid", partId: part.id });
  }
  for (const defect of draft.defects) {
    if (!defect.description.trim()) issues.push({ code: "defect_invalid", defectId: defect.id });
  }
  return issues;
}

/* ── sections ── */

/** The four parts of a guided inspection, in the order a technician works through them. */
export const PM_SECTIONS = ["checklist", "measurements", "findings", "review"] as const;
export type PmSection = (typeof PM_SECTIONS)[number];

/** Where the person fixes an issue, so "Fix this" lands on the exact field instead of the top of a long form. */
export function issueSection(issue: PmInspectionIssue): Exclude<PmSection, "review"> {
  switch (issue.code) {
    case "unanswered":
    case "evidence_required":
    case "finding_required":
      return "checklist";
    case "reading_invalid":
      return "measurements";
    default:
      return "findings";
  }
}

export type PmSectionStatus = "todo" | "complete" | "attention";

/**
 * What each part of the inspection shows in the stepper. A part is only marked as needing attention once the person has
 * tried to review (`attempted`), except an unreadable reading, which is wrong the moment it is typed. Readings and the
 * findings/labor/parts part are optional, so they are never "required to be complete" - they only show what was done.
 */
export function sectionStatuses(
  template: PmTemplate,
  draft: PmDraft,
  meters: readonly PmMeter[],
  issues: readonly PmInspectionIssue[],
  attempted: boolean,
): Record<PmSection, PmSectionStatus> {
  const progress = pmProgress(template, draft);
  const inSection = (section: Exclude<PmSection, "review">) => issues.some((issue) => issueSection(issue) === section);
  const enteredReadings = meters.filter((m) => parseReading(draft.readings[m.id]?.value).kind === "ok").length;
  const extrasEntered = !!draft.laborMinutes.trim() || draft.parts.length > 0 || draft.defects.length > 0 || draft.photos.length > 0 || !!draft.notes.trim();

  const checklist: PmSectionStatus = attempted && inSection("checklist") ? "attention" : progress.unansweredIds.length === 0 && !inSection("checklist") ? "complete" : "todo";
  const measurements: PmSectionStatus = inSection("measurements") ? "attention" : enteredReadings > 0 || meters.length === 0 ? "complete" : "todo";
  const findings: PmSectionStatus = attempted && inSection("findings") ? "attention" : extrasEntered && !inSection("findings") ? "complete" : "todo";
  return { checklist, measurements, findings, review: attempted && issues.length > 0 ? "attention" : "todo" };
}

export interface PmEvidenceSummary {
  /** Photos attached anywhere (steps and general). */
  photos: number;
  /** Steps that need a photo for the answer given (N/A needs none). */
  required: number;
  /** Of those, how many have at least one. */
  satisfied: number;
  missingIds: string[];
}

/** Evidence counted per step: a photo on one step never counts toward another. */
export function evidenceSummary(template: PmTemplate, draft: PmDraft): PmEvidenceSummary {
  const summary: PmEvidenceSummary = { photos: draft.photos.length, required: 0, satisfied: 0, missingIds: [] };
  for (const item of template.items) {
    const answer = draft.items[item.id] ?? emptyItem();
    summary.photos += answer.evidence.length;
    if (!item.requiresEvidence || answer.result === "not_applicable") continue;
    summary.required += 1;
    if (answer.result && answer.evidence.length > 0) summary.satisfied += 1;
    else if (answer.result) summary.missingIds.push(item.id);
  }
  return summary;
}

/**
 * The exact body for POST /assets/pm-schedules/{id}/complete. Throws PmCompletionBlockedError rather than build a body
 * that skips an unanswered item - there is no path from here to an empty or defaulted completion.
 */
export function buildCompletionPayload(template: PmTemplate, draft: PmDraft, meters: readonly PmMeter[]): PmCompletionPayload {
  const issues = validateInspection(template, draft, meters);
  if (issues.length > 0) throw new PmCompletionBlockedError({ code: "bad_result", label: issues[0].code });

  const payload: PmCompletionPayload = {
    checklist_template_id: template.id,
    items: template.items.map((item) => {
      const answer = draft.items[item.id];
      return {
        ...(item.key ? { key: item.key } : {}),
        label: item.label,
        result: answer.result as PmItemResult,
        requires_evidence: item.requiresEvidence,
        evidence: answer.evidence.map((e) => e.id),
        ...(answer.note.trim() ? { note: answer.note.trim() } : {}),
      };
    }),
  };
  if (template.version != null) payload.checklist_version = template.version;

  const readings = meters.flatMap((meter) => {
    const entered = draft.readings[meter.id];
    const parsed = parseReading(entered?.value);
    return parsed.kind === "ok" ? [{ meter_id: meter.id, value: parsed.value, ...(entered.note.trim() ? { notes: entered.note.trim() } : {}) }] : [];
  });
  if (readings.length) payload.condition_readings = readings;
  if (draft.photos.length) payload.photos = draft.photos.map((p) => p.id);
  if (draft.laborMinutes.trim()) payload.labor_minutes = Number(draft.laborMinutes);
  if (draft.parts.length) payload.parts_used = draft.parts.map((p) => ({ name: p.name.trim(), ...(p.qty.trim() ? { qty: Number(p.qty) } : {}) }));
  if (draft.defects.length) payload.defects = draft.defects.map((d) => ({ description: d.description.trim(), ...(d.severity ? { severity: d.severity } : {}) }));
  if (draft.notes.trim()) payload.notes = draft.notes.trim();

  const blocked = validatePmCompletion(payload);
  if (blocked) throw new PmCompletionBlockedError(blocked);
  return payload;
}
