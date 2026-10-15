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

/** What GET /shifts/current knows: the open shift, or (when none) the last one that ended. */
export interface ShiftState {
  current: ShiftSession | null;
  /** The caller's most recently ended shift; only sent when nothing is open. */
  lastEnded: ShiftSession | null;
}

export function newShiftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Read-only. Never starts a shift. */
export async function getShiftState(): Promise<ShiftState> {
  const result = await api.get<{ data: ShiftSession | null; meta?: { last_ended?: ShiftSession | null } }>(
    "/shifts/current",
  );
  return { current: result.data ?? null, lastEnded: result.data ? null : (result.meta?.last_ended ?? null) };
}

export async function getCurrentShift(): Promise<ShiftSession | null> {
  return (await getShiftState()).current;
}

export interface StartShiftOptions {
  /** Client-generated idempotency key; reuse it when retrying the same tap. */
  id?: string;
  startedAt?: Date;
}

/**
 * Idempotent per id. If the person already has an open shift (another device)
 * the server returns that shift instead of creating a second one. Call this only
 * from an explicit "Start shift" action — never from a screen mounting.
 */
export async function startShift({ id, startedAt = new Date() }: StartShiftOptions = {}): Promise<ShiftSession | null> {
  const result = await api.post<{ data: ShiftSession | null }>("/shifts/start", {
    id: id ?? newShiftId(),
    started_at: startedAt.toISOString(),
  });
  return result.data;
}

/**
 * Idempotent — returns null (no-op) when there is nothing to end. Pass `shiftId` (the shift the
 * person is looking at) so the server never ends a different, newer shift started on another device.
 */
export async function endShift(endedAt: Date = new Date(), shiftId?: string | null): Promise<ShiftSession | null> {
  const result = await api.post<{ data: ShiftSession | null }>("/shifts/end", {
    ended_at: endedAt.toISOString(),
    ...(shiftId ? { shift_id: shiftId } : {}),
  });
  return result.data;
}

/** Idempotent on the server: starting a break while on one, or resuming while not, changes nothing. */
export async function setShiftBreak(action: "start" | "end"): Promise<ShiftSession | null> {
  const result = await api.post<{ data: ShiftSession | null }>("/shifts/break", { action });
  return result.data;
}
