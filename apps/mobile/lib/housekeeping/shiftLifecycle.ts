import type { ShiftSession } from "@/lib/api/shifts";
import { shiftDateKeyOf } from "@/lib/housekeeping/hotelTime";

/**
 * The housekeeper's shift lifecycle, derived — never guessed.
 *
 * Inputs are only what the server has confirmed (`current`, `lastEnded`) plus
 * what this device is doing right now (`pendingOp`). A failed or missing
 * response is "unknown", never "ended" or "not started": clock-out is claimed
 * only after the server said so, and a new shift only ever starts from an
 * explicit action.
 */

export type ShiftLifecycleState =
  /** No authoritative answer yet (first load failed or offline). */
  | "unknown"
  | "not_started"
  | "active"
  | "on_break"
  /** A clock-out request is in flight; not ended until the server confirms. */
  | "ending"
  | "ended";

export type ShiftPendingOp = "start" | "end" | "break" | null;

export interface ShiftLifecycleInput {
  /** Last server-confirmed open shift. */
  current: ShiftSession | null;
  /** Last server-confirmed ended shift (only meaningful while nothing is open). */
  lastEnded: ShiftSession | null;
  /** At least one successful /shifts/current response for this user. */
  serverConfirmed: boolean;
  /** The most recent refresh failed; the fields above are the last known truth. */
  lastFetchFailed: boolean;
  pendingOp: ShiftPendingOp;
  /** The hotel's current shift date (YYYY-MM-DD). */
  shiftDate: string;
  timeZone: string | null;
  isOnline: boolean;
}

export interface ShiftLifecycle {
  state: ShiftLifecycleState;
  shift: ShiftSession | null;
  /** The shift that closed today, when state is "ended". */
  endedShift: ShiftSession | null;
  startedAt: string | null;
  endedAt: string | null;
  onBreakSince: string | null;
  breakSeconds: number;
  /** An open shift that began before today's shift date (never clocked out). */
  carriedOver: boolean;
  /** Showing last-known state because the latest refresh failed. */
  stale: boolean;
  /** Start Shift is available (explicit action; also starts a new shift after one ended). */
  canStart: boolean;
  canEnd: boolean;
  canStartBreak: boolean;
  canEndBreak: boolean;
  busy: boolean;
}

export function resolveShiftLifecycle(input: ShiftLifecycleInput): ShiftLifecycle {
  const { current, lastEnded, serverConfirmed, lastFetchFailed, pendingOp, shiftDate, timeZone, isOnline } = input;
  const busy = pendingOp !== null;

  let state: ShiftLifecycleState;
  let endedShift: ShiftSession | null = null;

  if (current && current.status !== "ended") {
    state = pendingOp === "end" ? "ending" : current.status === "on_break" ? "on_break" : "active";
  } else if (!serverConfirmed) {
    state = "unknown";
  } else if (lastEnded && lastEnded.ended_at && shiftDateKeyOf(lastEnded.ended_at, timeZone) === shiftDate) {
    state = "ended";
    endedShift = lastEnded;
  } else {
    state = "not_started";
  }

  const open = state === "active" || state === "on_break";
  const carriedOver = Boolean(current && shiftDateKeyOf(current.started_at, timeZone) !== shiftDate);

  return {
    state,
    shift: current && current.status !== "ended" ? current : null,
    endedShift,
    startedAt: current?.started_at ?? endedShift?.started_at ?? null,
    endedAt: endedShift?.ended_at ?? null,
    onBreakSince: state === "on_break" ? (current?.on_break_since ?? null) : null,
    breakSeconds: current?.break_seconds ?? endedShift?.break_seconds ?? 0,
    carriedOver,
    stale: lastFetchFailed && serverConfirmed,
    canStart: isOnline && !busy && (state === "not_started" || state === "ended"),
    canEnd: isOnline && !busy && open,
    canStartBreak: isOnline && !busy && state === "active",
    canEndBreak: isOnline && !busy && state === "on_break",
    busy,
  };
}

/** Seconds actually worked: wall time minus completed breaks and any break in progress. */
export function workedSeconds(
  lifecycle: Pick<ShiftLifecycle, "shift" | "endedShift">,
  now: Date,
): number | null {
  const shift = lifecycle.shift ?? lifecycle.endedShift;
  if (!shift) return null;
  const start = new Date(shift.started_at).getTime();
  const end = shift.ended_at ? new Date(shift.ended_at).getTime() : now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  let breakSeconds = shift.break_seconds || 0;
  if (shift.status === "on_break" && shift.on_break_since) {
    const since = new Date(shift.on_break_since).getTime();
    if (!Number.isNaN(since)) breakSeconds += Math.max(0, Math.floor((end - since) / 1000));
  }
  return Math.max(0, Math.floor((end - start) / 1000) - breakSeconds);
}
