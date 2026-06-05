import { api } from "./client";

export interface BoardRoom {
  id: string;
  room_number: string;
  floor: number;
  status: string;
  clean_type: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
}

export interface HousekeepingStaff {
  id: string;
  full_name: string;
  role: string;
}

export async function getBoard(date: string): Promise<{ data: BoardRoom[] }> {
  return api.get<{ data: BoardRoom[] }>(`/housekeeping/board?date=${date}`);
}

export async function createAssignment(data: {
  room_id: string;
  assigned_to: string;
  assignment_date: string;
}): Promise<void> {
  await api.post<{ data: unknown }>("/housekeeping/assignments", data);
}

export async function getStaff(): Promise<{ data: HousekeepingStaff[] }> {
  return api.get<{ data: HousekeepingStaff[] }>("/staff?role=housekeeper");
}
