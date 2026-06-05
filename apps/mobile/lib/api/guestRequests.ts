import { api } from "./client";

export interface GuestRequest {
  id: string;
  room_number: string;
  guest_name: string | null;
  description: string;
  status: "open" | "in_progress" | "resolved" | "escalated";
  priority: "low" | "normal" | "urgent" | "emergency";
  assigned_to_name: string | null;
  created_at: string;
}

export async function getGuestRequests(): Promise<{ data: GuestRequest[] }> {
  return api.get<{ data: GuestRequest[] }>("/guest-requests?per_page=100");
}

export async function getGuestRequest(id: string): Promise<{ data: GuestRequest }> {
  return api.get<{ data: GuestRequest }>(`/guest-requests/${id}`);
}

export async function updateGuestRequest(
  id: string,
  data: { status?: string; resolution_notes?: string; assigned_to?: string }
): Promise<void> {
  await api.patch<{ data: unknown }>(`/guest-requests/${id}`, data);
}
