import { API_BASE, api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import type {
  HoldReasonCode,
  WorkOrder,
  WorkOrderComment,
  WorkOrderPhoto,
  WorkOrderStatus,
} from "@/lib/engineering/workOrders";

export interface CreateWorkOrderPayload {
  room_id?: string;
  title: string;
  description?: string;
  category: string;
  priority: "urgent" | "normal" | "low" | "emergency";
  location_text?: string;
  source?: "guest" | "staff_patrol" | "pm" | "self";
  /** Client-generated UUID4: the server returns the first work order for a repeated key. */
  client_request_id?: string;
}

export async function createWorkOrder(payload: CreateWorkOrderPayload): Promise<string | null> {
  const res = await api.post<{ data: { id?: string } | null }>("/work-orders", payload);
  return res.data?.id ?? null;
}

export async function listWorkOrders(status: WorkOrderStatus): Promise<WorkOrder[]> {
  const res = await api.get<{ data: WorkOrder[] }>(`/work-orders?status=${status}&per_page=100`);
  return res.data ?? [];
}

export async function getWorkOrder(woId: string): Promise<WorkOrder> {
  const res = await api.get<{ data: WorkOrder }>(`/work-orders/${woId}`);
  return res.data;
}

export async function claimWorkOrder(woId: string): Promise<WorkOrder | null> {
  const res = await api.post<{ data: WorkOrder | null }>(`/work-orders/${woId}/claim`, {});
  return res.data;
}

export interface CompleteWorkOrderPayload {
  notes?: string;
  parts_used?: string;
}

export async function completeWorkOrder(
  woId: string,
  payload: CompleteWorkOrderPayload
): Promise<void> {
  await api.post(`/work-orders/${woId}/complete`, payload);
}

export interface WorkOrderTransition {
  status: WorkOrderStatus;
  /** Required by the API when moving to on_hold (see HOLD_REASON_CODES). */
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

/** Multipart upload — bypasses the JSON client. Returns the stored photo with its public URL. */
export async function uploadWorkOrderPhoto(
  woId: string,
  uri: string
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
  formData.append("photo_type", "progress");

  const response = await fetch(`${API_BASE}/work-orders/${woId}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail ?? `HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data: (WorkOrderPhoto & { photo_url?: string }) | null };
  return json.data;
}

export function workOrderPhotoUrl(photo: WorkOrderPhoto & { photo_url?: string }): string | null {
  if (photo.photo_url) return photo.photo_url;
  if (!photo.storage_path) return null;
  const { data } = supabase.storage.from("work-order-photos").getPublicUrl(photo.storage_path);
  return data.publicUrl || null;
}
