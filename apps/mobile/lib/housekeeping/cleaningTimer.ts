/**
 * Cleaning-timer math for Room Detail.
 *
 * Elapsed time is always derived from the session's start timestamp (the server's
 * once it has the session) — never from a counter held in a component or in
 * storage — so it survives backgrounding, restarts and navigation. The server
 * calculates the real duration on completion; nothing here is ever written back.
 */

/** A clean longer than this is a forgotten session, not a duration worth showing. */
export const MAX_PLAUSIBLE_ELAPSED_SECONDS = 24 * 60 * 60;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole seconds since the clean started, or null when the timestamp is missing or
 * the result is not believable. A start slightly "in the future" (device clock
 * behind the server's) reads as 0 instead of going negative.
 */
export function elapsedSeconds(startedAt: string | null | undefined, nowMs: number): number | null {
  const start = parseMs(startedAt);
  if (start === null || !Number.isFinite(nowMs)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - start) / 1000));
  return seconds > MAX_PLAUSIBLE_ELAPSED_SECONDS ? null : seconds;
}

/** 18:24, or 1:02:03 past an hour. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The estimate to show next to the timer; null when none is configured. */
export function standardMinutes(base: number | null | undefined): number | null {
  return typeof base === "number" && Number.isFinite(base) && base > 0 ? Math.round(base) : null;
}

/**
 * Whole minutes of a finished clean from the SERVER's duration. Never falls back
 * to a client-side measurement.
 */
export function confirmedDurationMinutes(durationSeconds: number | null | undefined): number | null {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  return Math.max(1, Math.round(durationSeconds / 60));
}
