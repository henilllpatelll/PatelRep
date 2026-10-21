import { checklistSignature } from "@/lib/inspections/templates";
import type { AnswerMap, ChecklistItem, ChecklistTemplate, ItemAnswer } from "@/lib/inspections/types";

/* ─── Resumable inspection drafts (pure) ────────────────────────────────────
   A half-finished inspection must survive the app being backgrounded or killed — and must never be applied to the
   wrong hotel, person, room cycle, day or checklist. This module defines what a draft IS and when it may be
   resumed; persisting it (storage, scoping, expiry sweeps) arrives with the inspection screen itself.

   The draft owns the `submissionId`: resuming keeps the same id, so finishing after a crash cannot record the
   inspection twice. */

export const DRAFT_VERSION = 1;

export interface InspectionDraft {
  version: typeof DRAFT_VERSION;
  hotelId: string;
  userId: string;
  roomId: string;
  /** The hotel's calendar day when the inspection started (hotel time zone, never the phone's). */
  businessDate: string;
  /** The queue row's cycle id when it was opened; null when the server could not provide one. */
  cleanCycleId: string | null;
  /** The failed inspection being re-checked, if this is a reinspection. */
  reinspectionOf: string | null;
  templateId: string;
  templateFingerprint: string | null;
  /** Used to detect edits when the server sends no fingerprint. */
  templateSignature: string;
  submissionId: string;
  answers: Record<string, ItemAnswer>;
  /** item id → local file uri */
  photos: Record<string, string>;
  notes: string;
  startedAt: number;
  updatedAt: number;
}

export function createDraft(input: {
  hotelId: string;
  userId: string;
  roomId: string;
  businessDate: string;
  cleanCycleId: string | null;
  reinspectionOf: string | null;
  template: ChecklistTemplate;
  submissionId: string;
  now: number;
}): InspectionDraft {
  return {
    version: DRAFT_VERSION,
    hotelId: input.hotelId,
    userId: input.userId,
    roomId: input.roomId,
    businessDate: input.businessDate,
    cleanCycleId: input.cleanCycleId,
    reinspectionOf: input.reinspectionOf,
    templateId: input.template.id,
    templateFingerprint: input.template.fingerprint,
    templateSignature: checklistSignature(input.template),
    submissionId: input.submissionId,
    answers: {},
    photos: {},
    notes: "",
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export type DraftUnusable =
  | "unsupported_version"
  | "other_hotel"
  | "other_user"
  | "other_room"
  | "other_day"
  /** The room was cleaned again, or its open correction changed, since the draft began. */
  | "room_changed"
  | "template_changed";

export type DraftVerdict = { usable: true } | { usable: false; reason: DraftUnusable };

/** Identity checks run first, so a draft from another hotel or person is never even compared to a checklist. */
export function judgeDraft(
  draft: InspectionDraft,
  current: {
    hotelId: string;
    userId: string;
    roomId: string;
    businessDate: string;
    cleanCycleId: string | null;
    reinspectionOf: string | null;
    /** The checklist that applies now, or null when none can be chosen. */
    template: ChecklistTemplate | null;
  },
): DraftVerdict {
  if (draft.version !== DRAFT_VERSION) return { usable: false, reason: "unsupported_version" };
  if (draft.hotelId !== current.hotelId) return { usable: false, reason: "other_hotel" };
  if (draft.userId !== current.userId) return { usable: false, reason: "other_user" };
  if (draft.roomId !== current.roomId) return { usable: false, reason: "other_room" };
  if (draft.businessDate !== current.businessDate) return { usable: false, reason: "other_day" };
  // An unknown cycle on either side cannot disprove the draft; two different known cycles do.
  if (draft.cleanCycleId && current.cleanCycleId && draft.cleanCycleId !== current.cleanCycleId) {
    return { usable: false, reason: "room_changed" };
  }
  if (draft.reinspectionOf !== current.reinspectionOf) return { usable: false, reason: "room_changed" };
  const template = current.template;
  if (!template || template.id !== draft.templateId) return { usable: false, reason: "template_changed" };
  const same = draft.templateFingerprint && template.fingerprint
    ? draft.templateFingerprint === template.fingerprint
    : draft.templateSignature === checklistSignature(template);
  return same ? { usable: true } : { usable: false, reason: "template_changed" };
}

/* ─── Surviving a checklist edit ────────────────────────────────────────── */

function questionKey(item: Pick<ChecklistItem, "section" | "description">): string {
  return `${item.section.trim().toLowerCase()}\u0000${item.description.trim().toLowerCase()}`;
}

export interface CarriedOver {
  answers: Record<string, ItemAnswer>;
  photos: Record<string, string>;
  /** Items from the old checklist whose answer could not be carried over (the question is gone or reworded). */
  dropped: string[];
}

/**
 * After the checklist changed, keep the answers whose QUESTION still exists. Settings replaces item ids on every edit,
 * so ids alone would discard everything; a question is the same only if its section and wording are unchanged. An item
 * that is reworded is deliberately not carried — the supervisor answered a different question.
 */
export function carryOverAnswers(
  oldItems: readonly ChecklistItem[],
  newItems: readonly ChecklistItem[],
  answers: AnswerMap,
  photos: Readonly<Record<string, string | undefined>> = {},
): CarriedOver {
  const byId = new Map(newItems.map((item) => [item.id, item]));
  const byQuestion = new Map<string, ChecklistItem>();
  const ambiguous = new Set<string>();
  for (const item of newItems) {
    const key = questionKey(item);
    if (byQuestion.has(key)) ambiguous.add(key);
    byQuestion.set(key, item);
  }

  const carried: CarriedOver = { answers: {}, photos: {}, dropped: [] };
  const claimed = new Set<string>();
  for (const old of oldItems) {
    const answer = answers[old.id];
    if (!answer) continue;
    const sameId = byId.get(old.id);
    const key = questionKey(old);
    const target =
      sameId && questionKey(sameId) === key
        ? sameId
        : !ambiguous.has(key)
          ? byQuestion.get(key)
          : undefined;
    if (!target || claimed.has(target.id)) {
      carried.dropped.push(old.id);
      continue;
    }
    claimed.add(target.id);
    carried.answers[target.id] = answer;
    const photo = photos[old.id];
    // A photo is evidence for a failed item only.
    if (photo && answer.result === "fail") carried.photos[target.id] = photo;
  }
  return carried;
}

/* ─── Reading a stored draft ────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict: anything that is not a version-1 draft with the right shapes is discarded rather than half-trusted. */
export function parseDraft(raw: unknown): InspectionDraft | null {
  if (!isRecord(raw) || raw.version !== DRAFT_VERSION) return null;
  const strings = ["hotelId", "userId", "roomId", "businessDate", "templateId", "templateSignature", "submissionId", "notes"] as const;
  if (strings.some((key) => typeof raw[key] !== "string")) return null;
  if (typeof raw.startedAt !== "number" || typeof raw.updatedAt !== "number") return null;
  if (!isRecord(raw.answers) || !isRecord(raw.photos)) return null;
  for (const answer of Object.values(raw.answers)) {
    if (!isRecord(answer) || !["pass", "fail", "na"].includes(String(answer.result))) return null;
  }
  for (const uri of Object.values(raw.photos)) if (typeof uri !== "string") return null;
  return {
    version: DRAFT_VERSION,
    hotelId: raw.hotelId as string,
    userId: raw.userId as string,
    roomId: raw.roomId as string,
    businessDate: raw.businessDate as string,
    cleanCycleId: typeof raw.cleanCycleId === "string" ? raw.cleanCycleId : null,
    reinspectionOf: typeof raw.reinspectionOf === "string" ? raw.reinspectionOf : null,
    templateId: raw.templateId as string,
    templateFingerprint: typeof raw.templateFingerprint === "string" ? raw.templateFingerprint : null,
    templateSignature: raw.templateSignature as string,
    submissionId: raw.submissionId as string,
    answers: raw.answers as Record<string, ItemAnswer>,
    photos: raw.photos as Record<string, string>,
    notes: raw.notes as string,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
  };
}
