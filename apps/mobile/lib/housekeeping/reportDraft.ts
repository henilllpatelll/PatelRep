import type { SummaryRow } from "@/lib/ai/actionSummary";
import type { WorkOrderDraft } from "@/lib/ai/drafts";
import type { PhotoAnalysis } from "@/lib/ai/photoAnalysis";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_DETAILS_MAX,
  MAINTENANCE_TITLE_MAX,
  type MaintenanceCategory,
  type MaintenanceDraft,
  type MaintenancePriority,
} from "@/lib/housekeeping/maintenanceReport";

/* ─── One report draft, with honest provenance ──────────────────────────────
   The Report Issue form holds ONE MaintenanceDraft. Text, a voice transcript, a photo and AI suggestions all
   end up in it, and this module is the only place the rules for that live:

     - the person's own entries are never overwritten by "Use all"; replacing one takes a deliberate, per-field choice
     - an AI-suggested urgent priority is never applied in bulk (urgency is the person's decision)
     - a suggestion remembers exactly what it was made from (the description text, the photo), and is dropped
       the moment that changes, so a late answer can never overwrite newer edits
     - what came from a model is labelled as such, in the form and again in the confirmation

   Nothing here talks to the network and nothing creates a work order. */

export type ReportField = "title" | "category" | "priority" | "details";

export type FieldOrigin = "description" | "photo";

export interface ReportProvenance {
  /** Fields whose current value came from a suggestion and has not been edited since. */
  suggested: Partial<Record<ReportField, FieldOrigin>>;
  /** Fields the person has typed or chosen themselves. */
  touched: Partial<Record<ReportField, true>>;
}

export const EMPTY_PROVENANCE: ReportProvenance = { suggested: {}, touched: {} };

/** The person edited a field: it is theirs now, whatever put the earlier value there. */
export function touchField(provenance: ReportProvenance, field: ReportField): ReportProvenance {
  const suggested = { ...provenance.suggested };
  delete suggested[field];
  return { suggested, touched: { ...provenance.touched, [field]: true } };
}

export function hasSuggestedFields(provenance: ReportProvenance): boolean {
  return Object.keys(provenance.suggested).length > 0;
}

/* ─── suggestions ───────────────────────────────────────────────────────── */

export interface DescriptionSuggestion {
  /** The exact (trimmed) description the model read. */
  basis: string;
  title: string | null;
  category: MaintenanceCategory | null;
  priority: MaintenancePriority | null;
}

/** Reduce the assistant's work-order preview to what this form can take. */
export function descriptionSuggestionFrom(preview: WorkOrderDraft, basis: string): DescriptionSuggestion | null {
  const title = preview.title.trim().slice(0, MAINTENANCE_TITLE_MAX);
  const category = (MAINTENANCE_CATEGORIES as readonly string[]).includes(preview.category) ? (preview.category as MaintenanceCategory) : null;
  const priority: MaintenancePriority | null =
    preview.priority === "urgent" ? "urgent" : preview.priority === "low" ? "low" : preview.priority === "normal" ? "normal" : null;
  if (!title && !category) return null;
  return { basis, title: title || null, category, priority };
}

/** Still describes what is typed now. Anything else is out of date and must not be offered. */
export function descriptionSuggestionIsCurrent(suggestion: DescriptionSuggestion | null, details: string): suggestion is DescriptionSuggestion {
  return suggestion !== null && suggestion.basis === details.trim();
}

export type YesNo = "yes" | "no" | "unsure";

export interface PhotoSuggestion {
  /** The photo this was made from; a different or removed photo makes it void. */
  version: number;
  analysis: PhotoAnalysis;
  answer: YesNo | null;
}

export function photoSuggestionIsCurrent(suggestion: PhotoSuggestion | null, version: number, hasPhoto: boolean): suggestion is PhotoSuggestion {
  return suggestion !== null && hasPhoto && suggestion.version === version;
}

/* ─── applying a suggestion ─────────────────────────────────────────────── */

export interface ApplyResult {
  draft: MaintenanceDraft;
  provenance: ReportProvenance;
  applied: ReportField[];
  /** Wanted a value but the person had already set that field themselves. */
  kept: ReportField[];
}

function isPersonSet(draft: MaintenanceDraft, provenance: ReportProvenance, field: ReportField): boolean {
  if (!provenance.touched[field]) return false;
  switch (field) {
    case "title":
      return draft.title.trim() !== "";
    case "category":
      return draft.category !== "";
    case "priority":
      return true; // choosing a priority is a decision even when it equals the default
    case "details":
      return draft.details.trim() !== "";
  }
}

interface Candidate {
  field: ReportField;
  value: string;
}

function candidatesOf(suggestion: DescriptionSuggestion, includeUrgent: boolean): Candidate[] {
  const out: Candidate[] = [];
  if (suggestion.title) out.push({ field: "title", value: suggestion.title });
  if (suggestion.category) out.push({ field: "category", value: suggestion.category });
  if (suggestion.priority && (includeUrgent || suggestion.priority !== "urgent")) out.push({ field: "priority", value: suggestion.priority });
  return out;
}

function applyCandidates(
  draft: MaintenanceDraft,
  provenance: ReportProvenance,
  candidates: Candidate[],
  origin: FieldOrigin,
  force: boolean,
): ApplyResult {
  let next = draft;
  let suggested = provenance.suggested;
  const applied: ReportField[] = [];
  const kept: ReportField[] = [];
  for (const { field, value } of candidates) {
    // Already exactly this (e.g. the default "normal" priority): nothing changed, so nothing is labelled as AI-made.
    if (next[field] === value) continue;
    if (!force && isPersonSet(next, provenance, field)) {
      kept.push(field);
      continue;
    }
    next = { ...next, [field]: value } as MaintenanceDraft;
    suggested = { ...suggested, [field]: origin };
    applied.push(field);
  }
  return { draft: next, provenance: { suggested, touched: provenance.touched }, applied, kept };
}

/**
 * "Use these details": fills what the person has not set themselves. A suggested urgent priority is left out
 * (it takes its own deliberate "Use"), and a field the person already filled is kept as they wrote it.
 */
export function applyDescriptionSuggestion(draft: MaintenanceDraft, provenance: ReportProvenance, suggestion: DescriptionSuggestion): ApplyResult {
  return applyCandidates(draft, provenance, candidatesOf(suggestion, false), "description", false);
}

/** One field, chosen on purpose: this replaces whatever is there, including the person's own value. */
export function applyDescriptionField(draft: MaintenanceDraft, provenance: ReportProvenance, suggestion: DescriptionSuggestion, field: ReportField): ApplyResult {
  const candidate = candidatesOf(suggestion, true).filter((item) => item.field === field);
  return applyCandidates(draft, provenance, candidate, "description", true);
}

/* ─── photo notes ───────────────────────────────────────────────────────── */

export interface PhotoNoteText {
  /** Localised "Photo note (AI, unverified): {{text}}" and "{{question}} {{answer}} (your answer)". */
  observation: string;
  answer: string | null;
}

/** Add the model's observation (and the person's answer to its question) to the details as clearly labelled lines. */
export function appendPhotoNote(details: string, note: PhotoNoteText): { details: string; appended: boolean } {
  const lines = [note.observation, note.answer].filter((line): line is string => Boolean(line && line.trim()));
  const addition = lines.join("\n");
  if (!addition) return { details, appended: false };
  if (details.includes(note.observation)) return { details, appended: false }; // already added
  const joined = details.trim() ? `${details.trimEnd()}\n${addition}` : addition;
  if (joined.length > MAINTENANCE_DETAILS_MAX) return { details, appended: false };
  return { details: joined, appended: true };
}

/**
 * "Use these details" on a photo analysis: the suggested category (unless the person chose one) and the
 * labelled note. The model's words go into the details only here, only after this explicit choice.
 */
export function applyPhotoSuggestion(
  draft: MaintenanceDraft,
  provenance: ReportProvenance,
  suggestion: PhotoSuggestion,
  note: PhotoNoteText,
): ApplyResult & { noteAdded: boolean; noteTooLong: boolean } {
  const candidates: Candidate[] = suggestion.analysis.category ? [{ field: "category", value: suggestion.analysis.category }] : [];
  const result = applyCandidates(draft, provenance, candidates, "photo", false);
  const appended = suggestion.analysis.observation ? appendPhotoNote(result.draft.details, note) : { details: result.draft.details, appended: false };
  const applied = appended.appended ? [...result.applied, "details" as const] : result.applied;
  return {
    ...result,
    draft: { ...result.draft, details: appended.details },
    provenance: appended.appended ? { ...result.provenance, suggested: { ...result.provenance.suggested, details: "photo" } } : result.provenance,
    applied,
    noteAdded: appended.appended,
    noteTooLong: Boolean(suggestion.analysis.observation) && !appended.appended && !appended.details.includes(note.observation),
  };
}

/* ─── confirmation summary ──────────────────────────────────────────────── */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ReportSummaryInput {
  roomNumber: string;
  draft: MaintenanceDraft;
  provenance: ReportProvenance;
  /** 0 when no photo; the photo's state when there is one. */
  photo: "none" | "pending" | "uploaded";
}

/** Everything the work order will contain, in the order the assistant's confirmation lists it. */
export function reportSummaryRows(input: ReportSummaryInput, t: Translate): SummaryRow[] {
  const { draft, provenance } = input;
  // Details are mostly the employee's own words: when a photo note was added, say that, not that all of it is AI-made.
  const tag = (field: ReportField, value: string) => {
    const origin = provenance.suggested[field];
    if (!origin) return value;
    return `${value} · ${t(field === "details" ? "reportIssue.ai.photoNoteTag" : "reportIssue.ai.suggestedTag")}`;
  };
  const rows: SummaryRow[] = [
    { key: "action", label: t("assistant.confirm.action"), value: t("reportIssue.review.action") },
    { key: "room", label: t("copilot.action.fields.room"), value: t("reportIssue.review.roomVerified", { room: input.roomNumber }) },
    { key: "title", label: t("assistant.confirm.issue"), value: tag("title", draft.title.trim()) },
  ];
  if (draft.category) rows.push({ key: "category", label: t("copilot.action.fields.category"), value: tag("category", t(`reportIssue.categories.${draft.category}`)) });
  rows.push({ key: "priority", label: t("copilot.action.fields.priority"), value: tag("priority", t(`reportIssue.priorities.${draft.priority}`)) });
  if (draft.details.trim()) rows.push({ key: "details", label: t("copilot.action.fields.details"), value: tag("details", draft.details.trim()) });
  rows.push({
    key: "photo",
    label: t("reportIssue.review.photoLabel"),
    value: t(input.photo === "none" ? "reportIssue.review.photoNone" : input.photo === "uploaded" ? "reportIssue.review.photoUploaded" : "reportIssue.review.photoPending"),
  });
  return rows;
}
