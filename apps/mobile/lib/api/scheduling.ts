import { api } from "./client";

export interface ShiftAssignment {
  id: string;
  work_date: string;
  is_on_shift: boolean;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
  shifts?: { name: string; start_time: string; end_time: string };
}

export async function mySchedule(date_from: string, date_to: string): Promise<{ data: ShiftAssignment[] }> {
  return api.get<{ data: ShiftAssignment[] }>(
    `/schedules/assignments/my-schedule?date_from=${date_from}&date_to=${date_to}`
  );
}
