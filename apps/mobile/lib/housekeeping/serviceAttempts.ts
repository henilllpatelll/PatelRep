import { api } from "@/lib/api/client";

/**
 * Client for the backend's pre-entry service-attempt log
 * (POST /rooms/{id}/service-attempts). The attempt count, last-attempt time and
 * retry time all live on the server; the app never increments them locally.
 *
 * Writes are online-only on purpose. A queued "attempt" would look recorded on
 * the device while the housekeeper, supervisor and front desk still see
 * nothing — so offline we say so and record nothing.
 */

export type AttemptResult = "dnd_no_response" | "return_later" | "guest_answered" | "dnd_cleared" | "other";

export interface RoomAttemptState {
  dnd_flag: boolean;
  dnd_attempt_count: number | null;
  dnd_last_attempt_at: string | null;
  dnd_retry_at: string | null;
}

export type AttemptOutcome =
  | { outcome: "recorded"; replayed: boolean; room: RoomAttemptState }
  | { outcome: "offline" }
  | { outcome: "failed"; message: string; status?: number };

export interface AttemptInput {
  roomId: string;
  result: AttemptResult;
  /** ISO instant to retry (required for return_later). */
  returnAt?: string | null;
  note?: string | null;
}

// A retry of the SAME attempt must carry the SAME attempted_at: the server
// treats (room, recorder, result, attempted_at) as one attempt and replays it
// instead of counting it twice. The stamp is kept until the server confirms.
const pendingStamps = new Map<string, string>();

function stampKey(input: AttemptInput): string {
  return `${input.roomId}|${input.result}|${input.returnAt ?? ""}|${input.note ?? ""}`;
}

export function pendingAttemptStamp(input: AttemptInput): string {
  const key = stampKey(input);
  let stamp = pendingStamps.get(key);
  if (!stamp) {
    stamp = new Date().toISOString();
    pendingStamps.set(key, stamp);
  }
  return stamp;
}

export function resetPendingAttempts(): void {
  pendingStamps.clear();
}

interface AttemptResponse {
  data: unknown;
  replayed?: boolean;
  room?: Partial<RoomAttemptState>;
}

export async function recordServiceAttempt(input: AttemptInput, isOnline: boolean): Promise<AttemptOutcome> {
  if (!isOnline) return { outcome: "offline" };
  const attemptedAt = pendingAttemptStamp(input);
  try {
    const response = await api.post<AttemptResponse>(`/rooms/${input.roomId}/service-attempts`, {
      result: input.result,
      attempted_at: attemptedAt,
      return_at: input.returnAt ?? undefined,
      note: input.note ?? undefined,
    });
    pendingStamps.delete(stampKey(input));
    const room = response.room ?? {};
    return {
      outcome: "recorded",
      replayed: Boolean(response.replayed),
      room: {
        dnd_flag: Boolean(room.dnd_flag),
        dnd_attempt_count: room.dnd_attempt_count ?? null,
        dnd_last_attempt_at: room.dnd_last_attempt_at ?? null,
        dnd_retry_at: room.dnd_retry_at ?? null,
      },
    };
  } catch (err: unknown) {
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
    // Keep the stamp on network/5xx failures so the user's retry is a replay; a
    // definitive client rejection (403/404/422) will never succeed as-is.
    if (status !== undefined && status >= 400 && status < 500) pendingStamps.delete(stampKey(input));
    return { outcome: "failed", message: err instanceof Error ? err.message : String(err), status };
  }
}

/** Explicit, user-initiated supervisor notification via the existing push route. */
export async function notifySupervisor(roomNumber: string, reason: string, isOnline: boolean): Promise<boolean> {
  if (!isOnline) return false;
  try {
    await api.post("/notifications/push", {
      message: `Room ${roomNumber}: ${reason}`,
      target_role: "housekeeping_supervisor",
    });
    return true;
  } catch {
    return false;
  }
}

/** Reason-bearing Service Declined (persists reason + timestamp server-side). */
export async function recordServiceDeclined(
  roomId: string,
  isOnline: boolean,
  reason: "guest_declined_housekeeping" | "guest_no_service_today" | "privacy_request" | "other" = "guest_declined_housekeeping",
  note?: string,
): Promise<{ outcome: "recorded" } | { outcome: "offline" } | { outcome: "failed"; message: string }> {
  if (!isOnline) return { outcome: "offline" };
  try {
    await api.post(`/rooms/${roomId}/service-declined`, { reason, note });
    return { outcome: "recorded" };
  } catch (err: unknown) {
    return { outcome: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}
