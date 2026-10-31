import { ApiError, api } from "./client";
import { completePmSchedule } from "./assets";
import { assertPmCompletionAllowed, type PmCompletionPayload, type PmCompletionResult } from "@/lib/engineering/pmCompletion";

export type { PmCompletionResult };
import type { PmMeterRow } from "@/lib/engineering/pmReadings";
import type { PmTemplateRow } from "@/lib/engineering/pmChecklist";

/* ── templates, meters, asset ── */

export async function listPmTemplates(): Promise<PmTemplateRow[]> {
  const res = await api.get<{ data: PmTemplateRow[] | null }>("/programs/pm-templates");
  return res.data ?? [];
}

export async function listAssetMeters(assetId: string): Promise<PmMeterRow[]> {
  const res = await api.get<{ data: PmMeterRow[] | null }>(`/assets/${assetId}/meters`);
  return res.data ?? [];
}

export interface PmAssetDetail {
  id: string;
  name: string;
  asset_tag?: string | null;
  location_text?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  asset_categories?: { name?: string | null } | null;
  rooms?: { room_number?: string | null } | null;
}

export async function getPmAsset(assetId: string): Promise<PmAssetDetail | null> {
  const res = await api.get<{ data: PmAssetDetail | null }>(`/assets/${assetId}`);
  return res.data ?? null;
}

/* ── history ── */

export interface PmCompletionSummary {
  id: string;
  pm_schedule_id: string;
  asset_id: string | null;
  schedule_name: string | null;
  asset_name: string | null;
  technician_id: string | null;
  technician_name: string | null;
  completed_at: string;
  checklist_template_id: string | null;
  checklist_version: number | null;
  labor_minutes: number | null;
  defects: Array<{ description?: string; severity?: string }> | null;
  passed_count: number;
  failed_count: number;
  not_applicable_count: number;
}

export interface PmCompletionPage {
  rows: PmCompletionSummary[];
  hasMore: boolean;
}

export async function listPmCompletions(opts: { offset?: number; limit?: number; assetId?: string } = {}): Promise<PmCompletionPage> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 20), offset: String(opts.offset ?? 0) });
  if (opts.assetId) params.set("asset_id", opts.assetId);
  const res = await api.get<{ data: PmCompletionSummary[] | null; meta?: { has_more?: boolean } }>(`/assets/pm-completions?${params}`);
  return { rows: res.data ?? [], hasMore: res.meta?.has_more === true };
}

export interface PmCompletionEvidence {
  evidence_id: string;
  url: string;
  file_name?: string | null;
}

export interface PmCompletionItemRecord {
  id?: string;
  item_key?: string | null;
  label: string;
  result: "passed" | "failed" | "not_applicable";
  requires_evidence?: boolean;
  note?: string | null;
  /** Resolved to short-lived signed URLs by the API - never a storage path. */
  evidence?: PmCompletionEvidence[];
}

export interface PmCompletionDetail {
  id: string;
  pm_schedule_id: string;
  asset_id: string | null;
  technician_id: string | null;
  verifier_id?: string | null;
  completed_at: string;
  checklist_template_id: string | null;
  checklist_version: number | null;
  labor_minutes: number | null;
  parts_used: Array<{ name?: string; qty?: number }> | null;
  defects: Array<{ description?: string; severity?: string }> | null;
  notes: string | null;
  photos: PmCompletionEvidence[];
  items: PmCompletionItemRecord[];
}

export async function getPmCompletion(scheduleId: string, completionId: string): Promise<PmCompletionDetail> {
  const res = await api.get<{ data: PmCompletionDetail }>(`/assets/pm-schedules/${scheduleId}/completions/${completionId}`);
  return res.data;
}

/** Latest completions of one schedule (the API returns up to 12), with their checklist items. */
export async function listScheduleCompletions(scheduleId: string): Promise<Array<{ id: string; technician_id: string | null; completed_at: string }>> {
  const res = await api.get<{ data: Array<{ id: string; technician_id: string | null; completed_at: string }> | null }>(
    `/assets/pm-schedules/${scheduleId}/completions`,
  );
  return res.data ?? [];
}

/* ── evidence ── */

/**
 * Photo -> `evidence_records.id`. Creates the record, then uploads the file to the private evidence bucket. If the
 * upload fails the empty record is removed again so a failed attempt leaves nothing behind to be mistaken for proof.
 */
export async function uploadPmEvidence(input: { assetId: string; uri: string; label: string; signal?: AbortSignal }): Promise<string> {
  const created = await api.post<{ data: { id: string } }>(
    "/evidence/records",
    { label: input.label, evidence_type: "photo", related_entity_type: "asset", related_entity_id: input.assetId },
    { signal: input.signal },
  );
  const id = created.data.id;
  try {
    const form = new FormData();
    form.append("file", { uri: input.uri, type: "image/jpeg", name: `pm_${Date.now()}.jpg` } as unknown as Blob);
    await api.postForm(`/evidence/records/${id}/file`, form, { signal: input.signal });
  } catch (err) {
    await deletePmEvidence(id);
    throw err;
  }
  return id;
}

/** Best effort: removing evidence the technician took out, or a failed upload's empty record. */
export async function deletePmEvidence(evidenceId: string): Promise<void> {
  try {
    await api.delete(`/evidence/records/${evidenceId}`);
  } catch {
    // A 204 has no JSON body, which the client reports as a parse error; a real failure only leaves an unreferenced record.
  }
}

/* ── completion ── */

/** Statuses meaning the server answered and did NOT record the completion. */
function isDefinitiveRefusal(err: unknown): boolean {
  const status = err instanceof ApiError ? err.status : null;
  return status != null && status >= 400 && status < 500;
}

/**
 * Re-reads the schedule's recent completions for one by this person made since `since` (ms). Throws if the read itself
 * fails, because then nothing is known either way.
 */
export async function findLandedCompletion(scheduleId: string, userId: string, since: number): Promise<PmCompletionResult | null> {
  const recent = await listScheduleCompletions(scheduleId);
  const landed = recent.find((c) => c.technician_id === userId && Date.parse(c.completed_at) >= since - 5000);
  return landed ? { id: landed.id, pm_schedule_id: scheduleId, completed_at: landed.completed_at, reconciled: true } : null;
}

/**
 * Completes a PM. Refuses (throws PmCompletionBlockedError) rather than send a body the API would reject.
 *
 * The API has no idempotency key, and a completion also opens corrective work orders and moves the due date, so a blind
 * retry after a timeout could record the inspection twice. When the outcome is unknown (network failure, timeout, 5xx)
 * the schedule's completions are re-read: if one by this person appeared since the attempt began, that is the answer.
 * `since` carries an earlier unknown attempt across presses, so a retry checks before it posts again.
 */
export async function submitPmCompletion(
  scheduleId: string,
  payload: PmCompletionPayload,
  context: { userId: string; attemptStartedAt: number; unknownSince?: number | null },
): Promise<PmCompletionResult> {
  assertPmCompletionAllowed(payload);
  if (context.unknownSince != null) {
    const earlier = await findLandedCompletion(scheduleId, context.userId, context.unknownSince);
    if (earlier) return earlier;
  }
  try {
    return await completePmSchedule(scheduleId, payload);
  } catch (err) {
    if (isDefinitiveRefusal(err)) throw err;
    try {
      const landed = await findLandedCompletion(scheduleId, context.userId, context.unknownSince ?? context.attemptStartedAt);
      if (landed) return landed;
    } catch {
      // The re-read failed too: still unknown, so the original error is what the caller must report.
    }
    throw err;
  }
}
