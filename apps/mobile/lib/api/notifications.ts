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

/** `is_read=false` is the unread list; `is_read=true` is every notification, read or not. */
export async function listNotifications(is_read = false, limit?: number): Promise<{ data: AppNotification[] }> {
  const query = limit ? `&limit=${Math.max(1, Math.min(100, Math.floor(limit)))}` : "";
  return api.get<{ data: AppNotification[] }>(`/notifications?is_read=${is_read}${query}`);
}

/**
 * The exact number of unread notifications. The list endpoint is capped, so counting its rows undercounts
 * once more than a page is unread. A server that predates the count endpoint (404) falls back to the list.
 */
export async function getUnreadCount(): Promise<number> {
  try {
    const res = await api.get<{ data: { count: number } }>("/notifications/unread-count");
    const count = res.data?.count;
    return typeof count === "number" && count >= 0 ? count : 0;
  } catch (error) {
    if ((error as { status?: number } | null)?.status === 404) {
      const res = await listNotifications(false);
      return res.data?.length ?? 0;
    }
    throw error;
  }
}

export async function markAllRead(): Promise<void> {
  await api.post<unknown>("/notifications/mark-all-read", {});
}

export async function markRead(id: string): Promise<void> {
  await api.patch<unknown>(`/notifications/${id}/read`, {});
}

/** One push category the signed-in person can switch, as the server sees it for their current role. */
export interface NotificationPreference {
  key: string;
  enabled: boolean;
  /** The category also carries an alert that is always delivered, whatever this switch says. */
  has_critical: boolean;
}

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  const res = await api.get<{ data: { categories: NotificationPreference[] } }>("/notifications/preferences");
  return res.data?.categories ?? [];
}

export async function setNotificationPreference(key: string, enabled: boolean): Promise<void> {
  await api.put<unknown>(`/notifications/preferences/${encodeURIComponent(key)}`, { enabled });
}
