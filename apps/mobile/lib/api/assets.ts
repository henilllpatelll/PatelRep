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
