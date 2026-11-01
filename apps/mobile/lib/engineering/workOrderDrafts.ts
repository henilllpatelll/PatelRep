/* ─── Work-order drafts ─────────────────────────────────────────────────────
   Unsent form content, kept on this phone per person + hotel + work order. A draft is NOT a queued action and NOT a
   server record: nothing here is ever sent by itself. It is removed only when the server confirmed the thing it was
   for (a completion that reached the server, a note the server stored) or when the person discards it. A completion
   that is merely queued offline keeps its draft until the sync confirms it. */

import { listScoped, pruneScoped, readScoped, removeScoped, writeScoped } from "@/lib/engineering/offlineStore";
import { emptyCompletionDraft, type CompletionDraft, type StagedPart, type VerificationResult } from "@/lib/engineering/repairWorkspace";
import type { WorkOrder, WorkOrderStatus } from "@/lib/engineering/workOrders";

export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_DRAFTS = 30;
/** A single text field never persists more than this, so a paste cannot fill the disk. */
export const MAX_DRAFT_TEXT = 4000;

export type TextDraftKind = "note" | "hold" | "escalate";

const completionName = (woId: string) => `draft/completion/${woId}`;
const textName = (woId: string, kind: TextDraftKind) => `draft/${kind}/${woId}`;

const VERIFICATION: readonly VerificationResult[] = ["passed", "failed", "follow_up_required"];

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value.slice(0, MAX_DRAFT_TEXT) : fallback);
const idOrNull = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= 80 ? value : null);

function sanitizePart(raw: unknown): StagedPart | null {
  const p = raw as Partial<StagedPart> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.partId !== "string" || typeof p.locationId !== "string" || typeof p.name !== "string") return null;
  if (typeof p.quantity !== "number" || !Number.isFinite(p.quantity)) return null;
  return {
    partId: p.partId,
    name: p.name.slice(0, 200),
    unit: typeof p.unit === "string" ? p.unit : null,
    locationId: p.locationId,
    locationName: typeof p.locationName === "string" ? p.locationName : null,
    quantity: p.quantity,
    available: typeof p.available === "number" && Number.isFinite(p.available) ? p.available : null,
  };
}

interface StoredCompletion {
  draft: CompletionDraft;
  /** The work-order status when the draft was last saved, so a later change can be flagged on restore. */
  statusAtSave: WorkOrderStatus | null;
  /** "WO-1042 � AC not cooling", so the Sync Center can name the draft without loading the order. */
  label: string | null;
}

/** Rebuilds a draft field by field; anything of the wrong type falls back to empty rather than breaking the form. */
export function sanitizeCompletionDraft(raw: unknown): CompletionDraft | null {
  const d = raw as Partial<Record<keyof CompletionDraft, unknown>> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const verification = VERIFICATION.includes(d.verification as VerificationResult) ? (d.verification as VerificationResult) : null;
  const restoration = d.assetRestoration === "restore" || d.assetRestoration === "keep_unavailable" ? d.assetRestoration : null;
  const parts = Array.isArray(d.parts) ? d.parts.map(sanitizePart).filter((p): p is StagedPart => p != null).slice(0, 50) : [];
  return {
    problemCodeId: idOrNull(d.problemCodeId),
    causeCodeId: idOrNull(d.causeCodeId),
    resolutionCodeId: idOrNull(d.resolutionCodeId),
    problemOtherText: str(d.problemOtherText),
    causeOtherText: str(d.causeOtherText),
    resolutionOtherText: str(d.resolutionOtherText),
    notes: str(d.notes),
    verification,
    verificationNotes: str(d.verificationNotes),
    assetRestoration: restoration,
    parts,
    freeTextParts: str(d.freeTextParts),
  };
}

/** True when the person actually changed something compared with what the order itself already provides. */
export function isMeaningfulCompletionDraft(draft: CompletionDraft, wo?: Partial<WorkOrder>): boolean {
  const base = emptyCompletionDraft(wo);
  const keys = Object.keys(base) as (keyof CompletionDraft)[];
  return keys.some((key) => JSON.stringify(draft[key]) !== JSON.stringify(base[key]));
}

export type DraftReview = "none" | "statusChanged" | "closed";

/**
 * What the person should be told about a restored draft. A completed or cancelled order can no longer take a
 * completion at all ("closed"); any other status change since the save means the repair moved on ("statusChanged").
 */
export function reviewRestoredDraft(statusAtSave: WorkOrderStatus | null, current: WorkOrderStatus): DraftReview {
  if (current === "completed" || current === "cancelled") return "closed";
  if (statusAtSave && statusAtSave !== current) return "statusChanged";
  return "none";
}

export interface RestoredCompletionDraft {
  draft: CompletionDraft;
  savedAt: string;
  statusAtSave: WorkOrderStatus | null;
  label: string | null;
}

export async function loadCompletionDraft(woId: string): Promise<RestoredCompletionDraft | null> {
  const stored = await readScoped<StoredCompletion>(
    completionName(woId),
    (raw) => {
      const r = raw as { draft?: unknown; statusAtSave?: unknown } | null;
      const draft = sanitizeCompletionDraft(r?.draft);
      if (!draft) return null;
      const label = (raw as { label?: unknown } | null)?.label;
      return { draft, statusAtSave: typeof r?.statusAtSave === "string" ? (r.statusAtSave as WorkOrderStatus) : null, label: typeof label === "string" ? label.slice(0, 120) : null };
    },
    { maxAgeMs: DRAFT_MAX_AGE_MS }
  );
  return stored ? { draft: stored.data.draft, savedAt: stored.savedAt, statusAtSave: stored.data.statusAtSave, label: stored.data.label } : null;
}

export async function saveCompletionDraft(woId: string, draft: CompletionDraft, statusAtSave: WorkOrderStatus | null, label: string | null = null): Promise<boolean> {
  const name = completionName(woId);
  const isNew = (await listScoped(name)).length === 0;
  const ok = await writeScoped<StoredCompletion>(name, { draft, statusAtSave, label });
  if (ok && isNew) await pruneScoped("draft/", MAX_DRAFTS);
  return ok;
}

export const clearCompletionDraft = (woId: string) => removeScoped(completionName(woId));

export async function loadTextDraft(woId: string, kind: TextDraftKind): Promise<string | null> {
  const stored = await readScoped<string>(textName(woId, kind), (raw) => (typeof raw === "string" && raw.trim() ? raw.slice(0, MAX_DRAFT_TEXT) : null), { maxAgeMs: DRAFT_MAX_AGE_MS });
  return stored?.data ?? null;
}

/** Empty text removes the draft instead of saving a blank one. */
export async function saveTextDraft(woId: string, kind: TextDraftKind, text: string): Promise<void> {
  if (!text.trim()) {
    await removeScoped(textName(woId, kind));
    return;
  }
  const name = textName(woId, kind);
  const isNew = (await listScoped(name)).length === 0;
  const ok = await writeScoped(name, text.slice(0, MAX_DRAFT_TEXT));
  if (ok && isNew) await pruneScoped("draft/", MAX_DRAFTS);
}

export const clearTextDraft = (woId: string, kind: TextDraftKind) => removeScoped(textName(woId, kind));

export interface SavedCompletionDraftRow {
  woId: string;
  label: string | null;
  savedAt: string;
}

/** Saved completion drafts for the Sync Center, newest first. Reads each record so corrupt or expired ones drop out. */
export async function listCompletionDrafts(): Promise<SavedCompletionDraftRow[]> {
  const names = await listScoped("draft/completion/");
  const rows: SavedCompletionDraftRow[] = [];
  for (const name of names) {
    const woId = name.slice("draft/completion/".length);
    const saved = await loadCompletionDraft(woId);
    if (saved) rows.push({ woId, label: saved.label, savedAt: saved.savedAt });
  }
  return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Work-order ids that have any saved draft for this person (for "Saved draft" markers). */
export async function listDraftWorkOrderIds(): Promise<string[]> {
  const names = await listScoped("draft/");
  return Array.from(new Set(names.map((n) => n.split("/")[2]).filter((id): id is string => Boolean(id))));
}
