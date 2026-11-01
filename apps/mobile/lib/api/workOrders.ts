import { API_BASE, api, toApiError } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import type {
  HoldReasonCode,
  WorkOrder,
  WorkOrderComment,
  WorkOrderPhoto,
  WorkOrderStatus,
} from "@/lib/engineering/workOrders";
import type { WorkOrderListParams } from "@/lib/engineering/workQueue";
import { parseWorkSummary, type WorkSummary } from "@/lib/engineering/workSummary";
import type {
  AuditEvent,
  CompleteWorkOrderBody,
  ConsumedPartRow,
  InventoryPart,
  LaborSession,
  PartStockLocation,
  PhotoType,
  RepairCode,
  TimingEvent,
} from "@/lib/engineering/repairWorkspace";

export interface CreateWorkOrderPayload {
  room_id?: string;
  /** Canonical equipment link; the API checks it belongs to the caller's hotel. */
  asset_id?: string;
  title: string;
  description?: string;
  category: string;
  priority: "urgent" | "normal" | "low" | "emergency";
  location_text?: string;
  source?: "guest" | "staff_patrol" | "pm" | "self";
  /** Client-generated UUID4: the server returns the first work order for a repeated key. */
  client_request_id?: string;
  /** Needs `asset_id`; the API refuses a non-"operating" impact without a linked asset. */
  asset_impact?: "operating" | "degraded" | "out_of_service";
  /** The creator's own id (self-assignment). Mobile never offers anyone else. */
  assigned_to?: string;
  /** A canonical earlier work order this one repeats (recorded as a repeat-failure relationship). */
  repeat_of_work_order_id?: string;
  /** Take the room down together with the report. The API creates both or neither. */
  room_unavailability?: {
    room_id: string;
    type: "OUT_OF_ORDER" | "OUT_OF_SERVICE";
    reason_code: string;
    reason_label: string;
    expected_return_at: string;
    details?: string;
    source?: "WEB" | "MOBILE";
  };
}

export async function createWorkOrder(payload: CreateWorkOrderPayload): Promise<string | null> {
  const res = await api.post<{ data: { id?: string } | null }>("/work-orders", payload);
  return res.data?.id ?? null;
}

export interface CreatedWorkOrder {
  id: string | null;
  workOrderNumber: string | null;
  status: string | null;
  title: string | null;
  priority: string | null;
  /** The server answered with the work order a repeated request id had already made. */
  replayed: boolean;
  roomMarkedOutOfOrder: boolean;
}

/** Same request as createWorkOrder, keeping what the confirmation screen shows (number, status) from the server's own answer. */
export async function createWorkOrderDetailed(payload: CreateWorkOrderPayload): Promise<CreatedWorkOrder> {
  const res = await api.post<{
    data: { id?: string; work_order_number?: string | number | null; status?: string; title?: string; priority?: string } | null;
    idempotent_replay?: boolean;
    room_marked_out_of_order?: boolean;
  }>("/work-orders", payload);
  const wo = res.data;
  return {
    id: wo?.id ?? null,
    workOrderNumber: wo?.work_order_number != null ? String(wo.work_order_number) : null,
    status: wo?.status ?? null,
    title: wo?.title ?? null,
    priority: wo?.priority ?? null,
    replayed: Boolean(res.idempotent_replay),
    roomMarkedOutOfOrder: Boolean(res.room_marked_out_of_order),
  };
}

export const WORK_ORDER_PAGE_SIZE = 100;
/** The Work tab's page: small enough to paint fast on a phone, paged as the list is scrolled. */
export const WORK_QUEUE_PAGE_SIZE = 25;

export interface WorkOrderPage {
  orders: WorkOrder[];
  /** The server says another page exists. Never inferred from a short page. */
  hasMore: boolean;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== false && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

/** One page of the queue for a view's request. `has_more` comes from the API; an older API that omits it falls back to a full-page check. */
export async function listWorkOrderPage(
  params: WorkOrderListParams,
  page = 1,
  perPage = WORK_QUEUE_PAGE_SIZE
): Promise<WorkOrderPage> {
  const { statuses, priorities, ...rest } = params;
  const res = await api.get<{ data: WorkOrder[]; meta?: { has_more?: boolean } }>(
    `/work-orders?${queryString({
      ...rest,
      statuses: statuses?.join(","),
      priorities: priorities?.join(","),
      page: page > 1 ? page : undefined,
      per_page: perPage,
    })}`
  );
  const orders = res.data ?? [];
  return { orders, hasMore: res.meta?.has_more ?? orders.length >= perPage };
}

/** Exact counts of the caller's own active work (the My Work tiles); null when the server's answer is malformed. */
export async function getWorkOrderSummary(signal?: AbortSignal): Promise<WorkSummary | null> {
  const res = await api.get<{ data: unknown }>("/work-orders/summary", { signal });
  return parseWorkSummary(res.data);
}

export const ASSET_WORK_ORDER_PAGE_SIZE = 10;

/**
 * Work orders linked to one asset, newest first. The API scopes an engineer to their own and unclaimed orders, so
 * for that role this is "your repairs on this equipment", not the equipment's whole history (the screen says so).
 */
export async function listAssetWorkOrderPage(
  assetId: string,
  kind: "active" | "completed",
  page = 1,
  signal?: AbortSignal
): Promise<WorkOrderPage> {
  const statuses = kind === "active" ? "open,escalated,in_progress,on_hold" : "completed";
  const res = await api.get<{ data: WorkOrder[]; meta?: { has_more?: boolean } }>(
    `/work-orders?${queryString({
      asset_id: assetId,
      statuses,
      sort_by: kind === "active" ? "created_at" : "updated_at",
      sort_dir: "desc",
      page: page > 1 ? page : undefined,
      per_page: ASSET_WORK_ORDER_PAGE_SIZE,
    })}`,
    { signal }
  );
  const orders = res.data ?? [];
  return { orders, hasMore: res.meta?.has_more ?? orders.length >= ASSET_WORK_ORDER_PAGE_SIZE };
}

export async function listWorkOrders(status: WorkOrderStatus, page = 1): Promise<WorkOrder[]> {
  const res = await api.get<{ data: WorkOrder[] }>(
    `/work-orders?status=${status}&per_page=${WORK_ORDER_PAGE_SIZE}${page > 1 ? `&page=${page}` : ""}`
  );
  return res.data ?? [];
}

/**
 * Every work order in a status, page by page, so a count is never silently cut off at one page.
 * Stops at `maxPages`; `truncated` then says there may be more, and callers show "N+" instead of a false total.
 */
export async function listAllWorkOrders(
  status: WorkOrderStatus,
  maxPages = 5
): Promise<{ orders: WorkOrder[]; truncated: boolean }> {
  const orders: WorkOrder[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await listWorkOrders(status, page);
    orders.push(...rows);
    if (rows.length < WORK_ORDER_PAGE_SIZE) return { orders, truncated: false };
  }
  return { orders, truncated: true };
}

export async function getWorkOrder(woId: string): Promise<WorkOrder> {
  const res = await api.get<{ data: WorkOrder }>(`/work-orders/${woId}`);
  return res.data;
}

export async function claimWorkOrder(woId: string): Promise<WorkOrder | null> {
  const res = await api.post<{ data: WorkOrder | null }>(`/work-orders/${woId}/claim`, {});
  return res.data;
}

/** The body POST /work-orders/{id}/complete takes (see buildCompletionBody). */
export type CompleteWorkOrderPayload = CompleteWorkOrderBody;

export interface CompleteWorkOrderResult {
  /** Present when the completion asked for the asset to be restored. */
  asset_downtime?: unknown;
}

export async function completeWorkOrder(
  woId: string,
  payload: CompleteWorkOrderPayload
): Promise<CompleteWorkOrderResult> {
  const res = await api.post<CompleteWorkOrderResult>(`/work-orders/${woId}/complete`, payload);
  return res ?? {};
}

export interface WorkOrderTransition {
  status: WorkOrderStatus;
  /** Required by the API when moving to on_hold (see HOLD_REASON_CODES); escalation and resume take none. */
  reason_code?: HoldReasonCode;
  reason_note?: string;
}

/**
 * The only way to change a work order's status. PATCH /work-orders/{id} rejects `status`
 * with 422, and the transition endpoint validates the move against the allowed graph.
 */
export async function transitionWorkOrder(woId: string, transition: WorkOrderTransition): Promise<void> {
  await api.post(`/work-orders/${woId}/transition`, { ...transition, source: "mobile" });
}

export async function addWorkOrderComment(
  woId: string,
  comment: string
): Promise<WorkOrderComment | null> {
  const res = await api.post<{ data: WorkOrderComment | null }>(`/work-orders/${woId}/comments`, {
    comment,
  });
  return res.data;
}

export const WORK_ORDER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Multipart upload — bypasses the JSON client. Returns the stored photo with its public URL. */
export async function uploadWorkOrderPhoto(
  woId: string,
  uri: string,
  options: { photoType?: PhotoType; caption?: string; signal?: AbortSignal } = {}
): Promise<(WorkOrderPhoto & { photo_url?: string }) | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("file", {
    uri,
    type: "image/jpeg",
    name: `wo_${Date.now()}.jpg`,
  } as unknown as Blob);
  formData.append("photo_type", options.photoType ?? "progress");
  if (options.caption?.trim()) formData.append("caption", options.caption.trim());

  const response = await fetch(`${API_BASE}/work-orders/${woId}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
    signal: options.signal,
  });
  if (!response.ok) throw await toApiError(response);
  const json = (await response.json()) as { data: (WorkOrderPhoto & { photo_url?: string }) | null };
  return json.data;
}

export function workOrderPhotoUrl(photo: WorkOrderPhoto & { photo_url?: string }): string | null {
  if (photo.photo_url) return photo.photo_url;
  if (!photo.storage_path) return null;
  const { data } = supabase.storage.from("work-order-photos").getPublicUrl(photo.storage_path);
  return data.publicUrl || null;
}

/* ── Repair workspace endpoints (apps/api/routers/work_orders.py) ───────────── */

/** Structured arrival (not a comment): stamps `arrived_at` once, on the server. */
export async function arriveAtWorkOrder(woId: string): Promise<void> {
  await api.post(`/work-orders/${woId}/arrive`, {});
}

export async function acknowledgeWorkOrder(woId: string): Promise<void> {
  await api.post(`/work-orders/${woId}/acknowledge`, {});
}

/** Starts (or resumes) the caller's labor timer. On an open order the server also claims and starts it. */
export async function startWorkOrderLabor(woId: string): Promise<void> {
  await api.post(`/work-orders/${woId}/labor/start`, {});
}

export async function pauseWorkOrderLabor(woId: string): Promise<void> {
  await api.post(`/work-orders/${woId}/labor/pause`, {});
}

export async function getWorkOrderLabor(woId: string, signal?: AbortSignal): Promise<LaborSession[]> {
  const res = await api.get<{ data: LaborSession[] }>(`/work-orders/${woId}/labor`, { signal });
  return res.data ?? [];
}

export async function getWorkOrderEvents(woId: string, signal?: AbortSignal): Promise<TimingEvent[]> {
  const res = await api.get<{ data: TimingEvent[] }>(`/work-orders/${woId}/events`, { signal });
  return res.data ?? [];
}

export async function getWorkOrderAudit(woId: string, signal?: AbortSignal): Promise<AuditEvent[]> {
  const res = await api.get<{ data: AuditEvent[] }>(`/work-orders/${woId}/audit`, { signal });
  return res.data ?? [];
}

/** Parts the server has already consumed against this order (recorded at completion). */
export async function getWorkOrderParts(woId: string, signal?: AbortSignal): Promise<ConsumedPartRow[]> {
  const res = await api.get<{ data: ConsumedPartRow[] }>(`/work-orders/${woId}/parts`, { signal });
  return res.data ?? [];
}

/** Active problem / cause / resolution codes for a trade — the API is the only source of codes. */
export async function listRepairCodes(category?: string, signal?: AbortSignal): Promise<RepairCode[]> {
  const res = await api.get<{ data: RepairCode[] }>(
    `/work-orders/repair-codes${category ? `?category=${encodeURIComponent(category)}` : ""}`,
    { signal }
  );
  return res.data ?? [];
}

export interface DiagnosisPayload {
  problem_code_id?: string;
  cause_code_id?: string;
  problem_other_text?: string;
  cause_other_text?: string;
}

export async function saveDiagnosis(woId: string, payload: DiagnosisPayload): Promise<WorkOrder | null> {
  const res = await api.patch<{ data: WorkOrder | null }>(`/work-orders/${woId}/diagnosis`, payload);
  return res.data;
}

export async function listInventoryParts(signal?: AbortSignal): Promise<InventoryPart[]> {
  const res = await api.get<{ data: InventoryPart[] }>("/inventory/parts", { signal });
  return res.data ?? [];
}

/** On-hand stock for one part, per location. */
export async function getPartStock(partId: string, signal?: AbortSignal): Promise<PartStockLocation[]> {
  const res = await api.get<{ data: { stock_by_location?: PartStockLocation[] } }>(`/inventory/parts/${partId}`, { signal });
  return res.data?.stock_by_location ?? [];
}

/** Earlier completed repairs on the same asset (the only relationship the API exposes for read). */
export async function listAssetRepairs(assetId: string, signal?: AbortSignal): Promise<WorkOrder[]> {
  const res = await api.get<{ data: WorkOrder[] }>(
    `/work-orders?${queryString({ asset_id: assetId, statuses: "completed", per_page: 5 })}`,
    { signal }
  );
  return res.data ?? [];
}
