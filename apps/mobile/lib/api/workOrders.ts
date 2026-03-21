import { api } from "@/lib/api/client";

export interface CreateWorkOrderPayload {
  room_id: string;
  title: string;
  description: string;
  category: "general";
  priority: "normal";
}

export async function createWorkOrder(payload: CreateWorkOrderPayload): Promise<void> {
  await api.post<{ data: unknown }>("/work-orders", payload);
}
