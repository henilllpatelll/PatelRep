import { api } from "./client";

export interface InspectionTemplate {
  id: string;
  name: string;
  items: { id: string; section: string; description: string; is_required: boolean }[];
}

export async function listInspectionTemplates(): Promise<{ data: InspectionTemplate[] }> {
  return api.get<{ data: InspectionTemplate[] }>("/housekeeping/inspections/templates");
}

export interface InspectionItem {
  template_item_id: string;
  result: "pass" | "fail" | "na";
}

export async function submitInspection(payload: {
  room_id: string;
  template_id?: string;
  overall_result: "passed" | "failed" | "conditional";
  notes?: string;
  items?: InspectionItem[];
}): Promise<{ id: string }> {
  const res = await api.post<{ data: { id: string } }>("/housekeeping/inspections", {
    ...payload,
    items: payload.items ?? [],
  });
  return { id: res.data?.id ?? "" };
}

/** A room waiting for inspection, as GET /housekeeping/ready-for-inspection returns it (this hotel only). */
export interface ReadyRoom {
  room_id: string;
  room_number: string;
  floor: number | null;
  cleaned_by: string;
  cleaned_at: string | null;
  housekeeper_id: string | null;
  clean_type: string | null;
}

/** `date` is the hotel's business date; the server uses it to find who was assigned to each room. */
export async function fetchReadyForInspection(date: string): Promise<ReadyRoom[]> {
  const res = await api.get<{ data: ReadyRoom[] | null }>(`/housekeeping/ready-for-inspection?date=${encodeURIComponent(date)}`);
  return res.data ?? [];
}
