import { supabase } from "@/lib/supabase";
import { api } from "./client";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.patelrep.com/v1";

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

export async function uploadLostFoundPhoto(uri: string): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

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

    if (!response.ok) return null;
    const json = await response.json();
    return (json as { data?: { url?: string } })?.data?.url ?? null;
  } catch {
    return null;
  }
}
