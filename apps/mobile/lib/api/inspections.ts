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
}): Promise<void> {
  await api.post<{ data: unknown }>("/housekeeping/inspections", {
    ...payload,
    items: payload.items ?? [],
  });
}
