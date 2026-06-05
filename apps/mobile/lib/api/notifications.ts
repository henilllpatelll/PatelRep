import { api } from "./client";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export async function listNotifications(is_read = false): Promise<{ data: AppNotification[] }> {
  return api.get<{ data: AppNotification[] }>(`/notifications?is_read=${is_read}`);
}

export async function markAllRead(): Promise<void> {
  await api.post<unknown>("/notifications/mark-all-read", {});
}

export async function markRead(id: string): Promise<void> {
  await api.patch<unknown>(`/notifications/${id}/read`, {});
}
