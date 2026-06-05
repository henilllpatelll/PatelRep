import { api } from "./client";

export interface LogbookEntry {
  id: string;
  title: string;
  body: string;
  department_name: string | null;
  author_name: string;
  is_urgent: boolean;
  created_at: string;
}

export interface ShiftSummary {
  date: string;
  summary: string;
}

export async function getLogbookEntries(perPage = 50): Promise<{ data: LogbookEntry[] }> {
  return api.get<{ data: LogbookEntry[] }>(`/logbook/entries?per_page=${perPage}`);
}

export async function getShiftSummary(): Promise<{ data: ShiftSummary }> {
  return api.get<{ data: ShiftSummary }>("/logbook/shift-summary");
}

export async function createLogbookEntry(data: {
  title: string;
  body: string;
  is_urgent: boolean;
  department_id: string | null;
}): Promise<void> {
  await api.post<{ data: unknown }>("/logbook/entries", data);
}
