import { supabase } from "@/lib/supabase";
import { API_BASE, api } from "./client";

export interface LostFoundItem {
  id: string;
  description: string;
  location_found?: string;
  notes?: string;
  photo_url?: string;
  room_id?: string;
  status: "unclaimed" | "claimed" | "donated" | "discarded";
  found_by: string;
  claimed_by_name?: string;
  claimed_at?: string;
  created_at: string;
  rooms?: { room_number: string };
}

export async function listItems(status?: string): Promise<{ data: LostFoundItem[] }> {
  const params = status ? `?status=${status}` : "";
  return api.get<{ data: LostFoundItem[] }>(`/lost-found${params}`);
}

export interface CreateLostFoundPayload {
  description: string;
  room_id?: string;
  photo_url?: string;
  location_found?: string;
}

export interface SimpleRoom {
  id: string;
  room_number: string;
  floor: number | null;
}

export async function listRooms(): Promise<{ data: SimpleRoom[] }> {
  return api.get<{ data: SimpleRoom[] }>("/rooms?per_page=200");
}

export async function createLostFoundItem(payload: CreateLostFoundPayload): Promise<void> {
  await api.post<{ data: unknown }>("/lost-found", payload);
}

/**
 * Upload one photo and return its stored URL. Throws when it did not go through:
 * callers must not carry on as if the photo were attached.
 */
export async function uploadLostFoundPhoto(uri: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("file", {
    uri,
    type: "image/jpeg",
    name: `photo_${Date.now()}.jpg`,
  } as unknown as Blob);

  const response = await fetch(`${API_BASE}/lost-found/upload-photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });
  if (!response.ok) throw new Error(`Photo upload failed (HTTP ${response.status})`);
  const json = (await response.json()) as { data?: { url?: string } };
  const url = json?.data?.url;
  if (!url) throw new Error("Photo upload failed");
  return url;
}
