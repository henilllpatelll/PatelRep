import { assertPmCompletionAllowed, type PmCompletionPayload, type PmCompletionResult } from "@/lib/engineering/pmCompletion";
import { ASSET_PAGE_SIZE, assetBrowseParams, type AssetFilters, type AssetPage, type AssetRow, type AssetServiceStatus } from "@/lib/engineering/assetModel";
import type { AssetMeter, MeterReading } from "@/lib/engineering/assetReadings";
import type { PmChecklistBindingWire } from "@/lib/engineering/engineeringContracts";
import { api } from "./client";

export interface Asset {
  id: string;
  name: string;
  asset_tag?: string;
  category_id: string;
  location_text?: string;
  manufacturer?: string;
  failure_risk_score: number;
  is_active: boolean;
  created_at: string;
  asset_categories?: { name: string; code: string };
  rooms?: { room_number: string };
}

export interface FailurePrediction {
  id: string;
  asset_id: string;
  risk_score: number;
  recommendation: string;
  failure_indicators?: string[];
  generated_at: string;
  is_acknowledged: boolean;
  assets?: Asset & { asset_categories?: { name: string } };
}

/** A row of GET /assets/pm-schedules: the `pm_schedules` columns plus the joined `assets(name, room_id, asset_tag, location_text, manufacturer, asset_categories, rooms)`. */
export interface PmScheduleRow {
  id: string;
  asset_id: string;
  name: string;
  description?: string | null;
  interval_type: "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "custom";
  interval_days?: number | null;
  estimated_minutes?: number | null;
  assigned_to_role?: string | null;
  recurrence_basis?: "scheduled_date" | "completion_date" | null;
  last_completed_at?: string | null;
  next_due_at?: string | null;
  is_active?: boolean | null;
  /** The procedure this schedule is bound to. Absent from an older server: read as "unassigned". */
  checklist?: PmChecklistBindingWire | null;
  assets?: {
    name?: string | null;
    room_id?: string | null;
    asset_tag?: string | null;
    location_text?: string | null;
    manufacturer?: string | null;
    asset_categories?: { name?: string | null; code?: string | null } | null;
    rooms?: { room_number?: string | null } | null;
  } | null;
}

export async function listPmSchedules(): Promise<PmScheduleRow[]> {
  const res = await api.get<{ data: PmScheduleRow[] | null }>("/assets/pm-schedules");
  return res.data ?? [];
}

/** Completes a PM. Refuses (throws PmCompletionBlockedError) rather than send a body the API would reject. */
export async function completePmSchedule(scheduleId: string, payload: PmCompletionPayload): Promise<PmCompletionResult> {
  assertPmCompletionAllowed(payload);
  const res: { data: PmCompletionResult } = await api.post(`/assets/pm-schedules/${scheduleId}/complete`, payload);
  return res.data;
}

export async function listAssets(): Promise<{ data: Asset[] }> {
  return api.get<{ data: Asset[] }>("/assets");
}

export async function getFailurePredictions(): Promise<{ data: FailurePrediction[] }> {
  return api.get<{ data: FailurePrediction[] }>("/assets/failure-predictions");
}

export async function acknowledgePrediction(predictionId: string): Promise<void> {
  await api.post<{ data: unknown }>(`/assets/failure-predictions/${predictionId}/acknowledge`, {});
}

export async function createWorkOrderFromPrediction(predictionId: string): Promise<void> {
  await api.post<{ data: unknown }>(`/assets/failure-predictions/${predictionId}/create-work-order`, {});
}

/* ── Inventory (Phase 6) ──────────────────────────────────────────────────── */

function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== false && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

interface BrowseBody {
  data: AssetRow[] | null;
  meta?: { has_more?: boolean; total?: number; per_page?: number };
}

/** One page of the property inventory. Search, filters and sort run on the server over every asset. */
export async function browseAssets(filters: AssetFilters, query: string, page: number, signal?: AbortSignal): Promise<AssetPage> {
  const res = await api.get<BrowseBody>(`/assets/browse?${queryString(assetBrowseParams(filters, query, page))}`, { signal });
  const rows = res.data ?? [];
  return { rows, hasMore: res.meta?.has_more ?? rows.length >= ASSET_PAGE_SIZE, total: res.meta?.total ?? rows.length };
}

export interface AssetLookupResult {
  id: string;
  name: string;
  asset_tag?: string | null;
  /** False for retired equipment: the label still resolves, so the scanner can say it is retired. Absent = active. */
  is_active?: boolean;
}

/** Resolves a scanned/typed code to one asset in the caller's own property. 404 = not found here (never "elsewhere"). */
export async function lookupAsset(code: { kind: "id" | "tag"; value: string }, signal?: AbortSignal): Promise<AssetLookupResult> {
  const query = code.kind === "id" ? { asset_id: code.value } : { tag: code.value };
  const res = await api.get<{ data: AssetLookupResult }>(`/assets/lookup?${queryString(query)}`, { signal });
  return res.data;
}

export interface AssetCategory {
  id: string;
  name: string;
  code?: string | null;
}

export async function listAssetCategories(signal?: AbortSignal): Promise<AssetCategory[]> {
  const res = await api.get<{ data: AssetCategory[] | null }>("/assets/categories", { signal });
  return res.data ?? [];
}

export interface AssetDowntime {
  id: string;
  started_at: string;
  restored_at?: string | null;
  downtime_type?: "planned" | "unplanned" | string;
  impact_level?: "degraded" | "out_of_service" | string;
  work_order_id?: string | null;
  reason_code?: string | null;
  notes?: string | null;
  elapsed_minutes?: number | null;
}

export interface AssetDetail {
  id: string;
  name: string;
  asset_tag?: string | null;
  category_id?: string | null;
  room_id?: string | null;
  location_text?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  installation_date?: string | null;
  purchase_date?: string | null;
  warranty_expires?: string | null;
  notes?: string | null;
  expected_lifespan_years?: number | null;
  failure_risk_score?: number | null;
  failure_risk_updated_at?: string | null;
  is_active?: boolean;
  /** "active" | "inactive": the record's administrative state, separate from `service_status` and predicted risk. */
  administrative_status?: "active" | "inactive";
  updated_at?: string | null;
  /** Optimistic-concurrency token: sent back with an edit, which the server refuses (409) if the record has moved on. */
  row_version?: number | null;
  criticality?: "low" | "medium" | "high" | "life_safety" | null;
  /** Short-lived signed URL of the equipment identity photograph (never a storage path). Absent = no photo. */
  photo_url?: string | null;
  photo_evidence_id?: string | null;
  asset_categories?: { name?: string | null; code?: string | null } | null;
  rooms?: { room_number?: string | null; floor?: number | null; building?: string | null } | null;
  active_downtime?: AssetDowntime | null;
  /** Derived by the API with the same rule as the inventory list. */
  service_status?: AssetServiceStatus;
  /** Property-wide count of open/escalated/in-progress/on-hold orders linked to this asset (counts only, no content). */
  active_work_order_count?: number;
  /** Completed repairs on this asset in the last 90 days, property-wide. */
  repeat_repairs_90d?: number;
  pm_schedules?: Array<{
    id: string;
    name: string;
    interval_type?: string;
    next_due_at?: string | null;
    last_completed_at?: string | null;
    is_active?: boolean | null;
  }> | null;
}

export async function getAsset(assetId: string, signal?: AbortSignal): Promise<AssetDetail> {
  const res = await api.get<{ data: AssetDetail }>(`/assets/${assetId}`, { signal });
  return res.data;
}

export async function listAssetDowntime(assetId: string, signal?: AbortSignal): Promise<AssetDowntime[]> {
  const res = await api.get<{ data: AssetDowntime[] | null }>(`/assets/${assetId}/downtime?limit=25`, { signal });
  return res.data ?? [];
}

export interface AssetReliability {
  tracking_started_at?: string | null;
  downtime_12mo_minutes?: number | null;
  unplanned_downtime_12mo_minutes?: number | null;
  failure_count_12mo?: number | null;
  mttr_minutes?: number | null;
  mtbf_minutes?: number | null;
  repeat_failure_count?: number | null;
  reopen_count?: number | null;
}

export async function getAssetReliability(assetId: string, signal?: AbortSignal): Promise<AssetReliability> {
  const res = await api.get<{ data: AssetReliability }>(`/assets/${assetId}/reliability`, { signal });
  return res.data;
}

export async function getAssetMeters(assetId: string, signal?: AbortSignal): Promise<AssetMeter[]> {
  const res = await api.get<{ data: AssetMeter[] | null }>(`/assets/${assetId}/meters`, { signal });
  return (res.data ?? []).filter((meter) => meter.is_active !== false);
}

export async function listMeterReadings(meterId: string, limit = 12, signal?: AbortSignal): Promise<MeterReading[]> {
  const res = await api.get<{ data: MeterReading[] | null }>(`/assets/meters/${meterId}/readings?limit=${limit}`, { signal });
  return res.data ?? [];
}

export interface RecordedReading extends MeterReading {
  /** Present when this critical reading opened (or joined) the meter's corrective work order. */
  work_order?: { id: string; work_order_number?: string | number | null } | null;
}

/** Appends one reading. The API has no idempotency key, so callers must re-read before any retry of an unconfirmed attempt. */
export async function recordMeterReading(meterId: string, input: { value: number; notes?: string }): Promise<RecordedReading> {
  const res = await api.post<{ data: RecordedReading }>(`/assets/meters/${meterId}/readings`, {
    value: input.value,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  });
  return res.data;
}

export interface AssetDocument {
  id: string;
  label: string;
  evidence_type: string;
  file_name?: string | null;
  file_content_type?: string | null;
  collected_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  storage_path?: string | null;
}

/** Evidence records linked to this asset. `storage_path` is never rendered; a file opens through a short-lived signed URL. */
export async function listAssetDocuments(assetId: string, signal?: AbortSignal): Promise<AssetDocument[]> {
  const res = await api.get<{ data: AssetDocument[] | null }>(
    `/evidence/records?${queryString({ related_entity_type: "asset", related_entity_id: assetId })}`,
    { signal },
  );
  return (res.data ?? []).filter((doc) => !!doc.storage_path);
}

export async function getAssetDocumentUrl(recordId: string): Promise<string> {
  const res = await api.get<{ data: { url: string } }>(`/evidence/records/${recordId}/file-url`);
  return res.data.url;
}

/** Open predictions for one asset (the global list is capped at ten, so a specific asset can be missing from it). */
export async function getAssetPredictions(assetId: string, signal?: AbortSignal): Promise<FailurePrediction[]> {
  const res = await api.get<{ data: FailurePrediction[] | null }>(`/assets/failure-predictions?${queryString({ asset_id: assetId })}`, { signal });
  return res.data ?? [];
}

/* ── Register / edit / retire (Phase 3) ──────────────────────────────────── */

/**
 * Registers equipment. The body carries a client-generated `id`, so repeating the SAME call after a timeout returns the
 * record that was already created instead of making a second asset.
 */
export async function createAsset(body: Record<string, unknown>, signal?: AbortSignal): Promise<AssetDetail> {
  const res = await api.post<{ data: AssetDetail }>("/assets", body, { signal });
  return res.data;
}

/** Saves an edit. A body with `expected_row_version` is refused with 409 (`asset_conflict`) if someone else saved first. */
export async function updateAsset(assetId: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<AssetDetail> {
  const res = await api.patch<{ data: AssetDetail }>(`/assets/${assetId}`, body, { signal });
  return res.data;
}

/** Makes an uploaded evidence photo this equipment's identity photograph (replacing, and removing, the previous one). */
export async function setAssetPhoto(assetId: string, evidenceId: string, expectedRowVersion?: number | null): Promise<AssetDetail> {
  const res = await api.put<{ data: AssetDetail }>(`/assets/${assetId}/photo`, {
    evidence_id: evidenceId,
    ...(expectedRowVersion != null ? { expected_row_version: expectedRowVersion } : {}),
  });
  return res.data;
}

export async function removeAssetPhoto(assetId: string): Promise<AssetDetail> {
  const res = await api.delete<{ data: AssetDetail }>(`/assets/${assetId}/photo`);
  return res.data;
}

/** Takes equipment out of service records (never deletes). The server refuses while repairs or downtime are still open. */
export async function retireAsset(assetId: string, reason: string, expectedRowVersion?: number | null): Promise<AssetDetail> {
  const res = await api.post<{ data: AssetDetail }>(`/assets/${assetId}/retire`, {
    reason,
    ...(expectedRowVersion != null ? { expected_row_version: expectedRowVersion } : {}),
  });
  return res.data;
}
