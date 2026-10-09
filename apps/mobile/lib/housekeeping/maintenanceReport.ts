import { api } from "@/lib/api/client";
import { enqueueAction } from "@/lib/offline/db";
import { createWorkOrder, uploadWorkOrderPhoto, type CreateWorkOrderPayload } from "@/lib/api/workOrders";
import { isAmbiguousFailure } from "@/lib/housekeeping/supplyRequest";
import { prepareForUpload } from "@/lib/housekeeping/photo";

/**
 * Maintenance / damage reports go through the existing work-order endpoint (and
 * the existing offline work-order queue). A housekeeper can set title, category,
 * priority up to "urgent" and details — never "emergency", never out-of-order.
 *
 * Each report carries one `client_request_id` for its whole life (online try,
 * ambiguous retry, offline queue replay), so the server can answer a repeat with
 * the work order the first attempt already made.
 */

export const MAINTENANCE_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "furniture",
  "appliance",
  "structural",
  "safety",
  "doors_locks",
  "painting",
  "general",
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const MAINTENANCE_PRIORITIES = ["low", "normal", "urgent"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

/** API: title <= 120, description <= 2000. */
export const MAINTENANCE_TITLE_MAX = 120;
export const MAINTENANCE_DETAILS_MAX = 2000;

export interface MaintenanceDraft {
  title: string;
  category: MaintenanceCategory | "";
  priority: MaintenancePriority;
  details: string;
}

export const EMPTY_MAINTENANCE_DRAFT: MaintenanceDraft = { title: "", category: "", priority: "normal", details: "" };

export function isMaintenanceDirty(draft: MaintenanceDraft, photoUri: string | null): boolean {
  return Boolean(draft.title.trim() || draft.category || draft.details.trim() || draft.priority !== "normal" || photoUri);
}

export interface MaintenanceErrors {
  title?: "required" | "tooLong";
  category?: "required";
  details?: "tooLong";
}

export function validateMaintenance(draft: MaintenanceDraft): MaintenanceErrors {
  const errors: MaintenanceErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "required";
  else if (title.length > MAINTENANCE_TITLE_MAX) errors.title = "tooLong";
  if (!draft.category) errors.category = "required";
  if (draft.details.trim().length > MAINTENANCE_DETAILS_MAX) errors.details = "tooLong";
  return errors;
}

export function buildMaintenancePayload(roomId: string, draft: MaintenanceDraft, requestId?: string): CreateWorkOrderPayload {
  return {
    ...(requestId ? { client_request_id: requestId } : {}),
    room_id: roomId,
    title: draft.title.trim(),
    description: draft.details.trim() || undefined,
    category: draft.category,
    priority: draft.priority,
  };
}

export type CreateOutcome =
  | { kind: "created"; workOrderId: string | null }
  | { kind: "queued" }
  | { kind: "failed"; message: string; ambiguous: boolean };

/** A work order of mine on this room with the same title that already exists. */
async function findOwnWorkOrder(roomId: string, title: string, userId: string | undefined): Promise<string | null> {
  const res = await api.get<{ data: Array<{ id?: string; title?: string | null; created_by?: string | null }> }>(
    `/work-orders?room_id=${encodeURIComponent(roomId)}&per_page=20`,
  );
  const match = (res.data ?? []).find((wo) => wo.title === title && (!userId || wo.created_by === userId));
  return match?.id ?? null;
}

/**
 * Create the work order, or queue it when offline (the existing queue replays it).
 * After an answer-less failure the next try looks for the one it may have created
 * first, so retrying never makes a second work order.
 */
export async function createMaintenanceWorkOrder(
  payload: CreateWorkOrderPayload,
  options: { isOnline: boolean; userId?: string; mayHaveBeenSent: boolean },
): Promise<CreateOutcome> {
  try {
    if (!options.isOnline) {
      await enqueueAction("work_order", "create", payload);
      return { kind: "queued" };
    }
    if (options.mayHaveBeenSent) {
      const existing = await findOwnWorkOrder(payload.room_id ?? "", payload.title, options.userId);
      if (existing) return { kind: "created", workOrderId: existing };
    }
    return { kind: "created", workOrderId: await createWorkOrder(payload) };
  } catch (err: unknown) {
    return { kind: "failed", message: err instanceof Error ? err.message : String(err), ambiguous: isAmbiguousFailure(err) };
  }
}

/** Resize and upload to an EXISTING work order; never creates one. */
export async function attachMaintenancePhoto(workOrderId: string, uri: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await uploadWorkOrderPhoto(workOrderId, await prepareForUpload(uri));
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
