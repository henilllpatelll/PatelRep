import { api } from "./client";

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  rooms_today?: number;
  orders_today?: number;
}

export async function getStaff(): Promise<{ data: { staff: StaffMember[]; total: number } }> {
  return api.get<{ data: { staff: StaffMember[]; total: number } }>("/staff");
}
