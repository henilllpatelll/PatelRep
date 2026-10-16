import { api } from "@/lib/api/client";
import { CopilotFailure, toCopilotFailure } from "@/lib/ai/contract";

/**
 * The optional AI wording for a finished shift. The phone no longer sends rooms:
 * the server reads the person's own assignments, room statuses and completed
 * clean sessions, writes the recap from that aggregate, and returns the
 * aggregate with the sentence. So the numbers shown next to the AI text are the
 * numbers the AI was given, and "assigned" can never be mistaken for "done".
 */

export interface ShiftFacts {
  shiftDate: string;
  window: { basis: "shift" | "day"; shiftEnded: boolean };
  rooms: {
    assigned: number;
    unavailable: number;
    submitted: number;
    inspected: number;
    /** submitted + inspected: the attendant finished and (for inspected) a supervisor passed it. */
    completed: number;
    inProgress: number;
    notStarted: number;
    unfinished: number;
    restricted: number;
    statusUnknown: number;
  };
  sessions: { completedByYou: number; completedOffList: number; stopped: number; stoppedBlocked: number };
  /** Minutes actually recorded, on `timedRooms` rooms only; never an estimate. */
  timing: { timedRooms: number; recordedMinutes: number | null };
  handoffs: { unfinished: string[]; restricted: string[]; openWorkOrders: string[] };
  fingerprint: string;
}

export interface ShiftRecap {
  headline: string;
  /** Short note about open handoff items, or null. */
  note: string | null;
  source: "ai";
  facts: ShiftFacts;
  /** The server returned a recap it already had for these exact facts (no new charge). */
  cached: boolean;
}

const REQUEST_TIMEOUT_MS = 15_000;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 20) : [];
}

/** Read the server's facts defensively; a missing block is zeros, never an invented value. */
export function parseShiftFacts(raw: unknown): ShiftFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, any>;
  if (typeof f.fingerprint !== "string" || !f.rooms || typeof f.rooms !== "object") return null;
  const rooms = f.rooms as Record<string, unknown>;
  const sessions = (f.sessions ?? {}) as Record<string, unknown>;
  const timing = (f.timing ?? {}) as Record<string, unknown>;
  const handoffs = (f.handoffs ?? {}) as Record<string, unknown>;
  const window = (f.window ?? {}) as Record<string, unknown>;
  return {
    shiftDate: typeof f.shift_date === "string" ? f.shift_date : "",
    window: { basis: window.basis === "shift" ? "shift" : "day", shiftEnded: window.shift_ended === true },
    rooms: {
      assigned: num(rooms.assigned),
      unavailable: num(rooms.unavailable),
      submitted: num(rooms.submitted),
      inspected: num(rooms.inspected),
      completed: num(rooms.completed),
      inProgress: num(rooms.in_progress),
      notStarted: num(rooms.not_started),
      unfinished: num(rooms.unfinished),
      restricted: num(rooms.restricted),
      statusUnknown: num(rooms.status_unknown),
    },
    sessions: {
      completedByYou: num(sessions.completed_by_you),
      completedOffList: num(sessions.completed_off_list),
      stopped: num(sessions.stopped),
      stoppedBlocked: num(sessions.stopped_blocked),
    },
    timing: {
      timedRooms: num(timing.timed_rooms),
      recordedMinutes: typeof timing.recorded_minutes === "number" && timing.recorded_minutes > 0 ? Math.round(timing.recorded_minutes) : null,
    },
    handoffs: {
      unfinished: list(handoffs.unfinished),
      restricted: list(handoffs.restricted),
      openWorkOrders: list(handoffs.open_work_orders),
    },
    fingerprint: f.fingerprint,
  };
}

/**
 * A short key for what the finished shift looked like on this phone. A cached
 * recap is only reused while this is unchanged, so new inspections, a late
 * submission or a reopened room ask for a fresh one instead of showing old text.
 */
export function summaryFingerprint(summary: {
  clockedOutAt: string | null;
  boardUsable: boolean;
  rooms: { assigned: number; submitted: number; inspected: number; unavailable: number };
  leftOpen: unknown[];
  exceptions: unknown[];
  handoffs: unknown[];
}): string {
  const { rooms } = summary;
  return [
    summary.clockedOutAt ?? "open",
    summary.boardUsable ? 1 : 0,
    rooms.assigned,
    rooms.submitted,
    rooms.inspected,
    rooms.unavailable,
    summary.leftOpen.length,
    summary.exceptions.length,
    summary.handoffs.length,
  ].join(".");
}

/**
 * Ask the server for the AI wording. Throws a CopilotFailure: `credit_limit`,
 * `rate_limited`, `unavailable`, `offline`, or `invalid_request` with status 409
 * when the server has no completed work on record to write about. It never
 * falls back to a made-up recap; the verified summary on the phone is the fallback.
 */
export async function fetchShiftRecap(input: { shiftDate: string; language: "en" | "es" }): Promise<ShiftRecap> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CopilotFailure("unavailable", "shift recap timeout")), REQUEST_TIMEOUT_MS);
    });
    const response = await Promise.race([
      api.post<{ data: Record<string, unknown> }>("/ai/housekeeping/shift-summary", {
        language: input.language,
        shift_date: input.shiftDate,
      }),
      timeout,
    ]);
    const data = response.data ?? {};
    const facts = parseShiftFacts(data.facts);
    const headline = typeof data.headline === "string" ? data.headline.trim() : "";
    if (!headline || !facts) throw new CopilotFailure("invalid_response", "incomplete recap");
    const note = typeof data.note === "string" && data.note.trim().length > 0 ? data.note.trim() : null;
    return { headline, note, source: "ai", facts, cached: data.cached === true };
  } catch (error) {
    throw toCopilotFailure(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
