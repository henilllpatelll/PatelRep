import { API_BASE, ApiError, api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";

export interface OwnProfile {
  id: string;
  full_name: string;
  preferred_name: string | null;
  email: string | null;
  role: string;
  hotel_id: string;
  hotel_name: string | null;
  /** Short-lived signed URL for an uploaded photo (or the hotel-set URL); null when there is none. */
  avatar_url: string | null;
  has_uploaded_avatar: boolean;
}

type Envelope = { data: OwnProfile };

export async function getOwnProfile(): Promise<OwnProfile> {
  return (await api.get<Envelope>("/staff/me/profile")).data;
}

export async function updatePreferredName(preferredName: string): Promise<OwnProfile> {
  return (await api.patch<Envelope>("/staff/me/profile", { preferred_name: preferredName })).data;
}

export async function removeAvatar(): Promise<OwnProfile> {
  return (await api.delete<Envelope>("/staff/me/avatar")).data;
}

/** Uploads a JPEG already resized on-device. Throws ApiError (with status) unless the server confirms. */
export async function uploadAvatar(uri: string): Promise<OwnProfile> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const form = new FormData();
  form.append("file", { uri, type: "image/jpeg", name: `avatar_${Date.now()}.jpg` } as unknown as Blob);

  const response = await fetch(`${API_BASE}/staff/me/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`,
      response.status,
    );
  }
  return ((await response.json()) as Envelope).data;
}

export type ProfileFailure = "offline" | "session" | "denied" | "validation" | "tooLarge" | "badImage" | "server";

/** Maps any failure to a staff-safe category; raw backend text never reaches the UI. */
export function classifyProfileError(err: unknown): ProfileFailure {
  if (err instanceof ApiError) {
    if (err.status === 401) return "session";
    if (err.status === 403) return "denied";
    if (err.status === 413) return "tooLarge";
    if (err.status === 422) return "validation";
    if (err.status === 400) return "badImage";
    return "server";
  }
  const message = err instanceof Error ? err.message : "";
  if (/session expired|not authenticated/i.test(message)) return "session";
  if (/network|timed out|failed to fetch|offline/i.test(message)) return "offline";
  return "server";
}
