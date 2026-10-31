import { assertPmCompletionAllowed, type PmCompletionPayload } from "@/lib/engineering/pmCompletion";
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

/** A row of GET /assets/pm-schedules: the `pm_schedules` columns plus the joined `assets(name, room_id)`. */
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
  assets?: { name?: string | null; room_id?: string | null } | null;
}

export async function listPmSchedules(): Promise<PmScheduleRow[]> {
  const res = await api.get<{ data: PmScheduleRow[] | null }>("/assets/pm-schedules");
  return res.data ?? [];
}

/** Completes a PM. Refuses (throws PmCompletionBlockedError) rather than send a body the API would reject. */
export async function completePmSchedule(scheduleId: string, payload: PmCompletionPayload): Promise<void> {
  assertPmCompletionAllowed(payload);
  await api.post(`/assets/pm-schedules/${scheduleId}/complete`, payload);
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
