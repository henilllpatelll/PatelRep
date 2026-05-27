import { api } from "./client";

export interface CreateLostFoundPayload {
  description: string;
  room_id: string;
  photo_url?: string;
  location_found?: string;
}

export async function createLostFoundItem(payload: CreateLostFoundPayload): Promise<void> {
  await api.post<{ data: unknown }>("/lost-found", payload);
}
