import { api } from "@/lib/api/client";

export interface ShiftSession {
  id: string;
  tenant_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  status: "active" | "on_break" | "ended";
  on_break_since: string | null;
  break_seconds: number;
}

function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getCurrentShift(): Promise<ShiftSession | null> {
  const result = await api.get<{ data: ShiftSession | null }>("/shifts/current");
  return result.data;
}

/** Idempotent — safe to call whenever no open shift session was found. */
export async function startShift(startedAt: Date = new Date()): Promise<ShiftSession | null> {
  const result = await api.post<{ data: ShiftSession | null }>("/shifts/start", {
    id: uuidv4(),
    started_at: startedAt.toISOString(),
  });
  return result.data;
}

/** Idempotent — returns null (no-op) if there's no open shift to end. */
export async function endShift(endedAt: Date = new Date()): Promise<ShiftSession | null> {
  const result = await api.post<{ data: ShiftSession | null }>("/shifts/end", {
    ended_at: endedAt.toISOString(),
  });
  return result.data;
}
