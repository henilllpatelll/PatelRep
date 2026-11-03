/* ─── Engineering offline-state model ───────────────────────────────────────
   One vocabulary for what PM and Assets show about work that has not (yet) been confirmed by the server. Pure: it reads
   facts the real stores report and never stores or invents anything. The rule it encodes: only `current` and `synced`
   are statements about the server; every other state is about this phone. */

export type EngineeringSyncState =
  /** The latest request for this data succeeded. */
  | "current"
  /** Earlier server data is on screen; the server has not been asked just now. */
  | "cached"
  /** Unfinished work saved on this device only. */
  | "local_draft"
  /** Saved for a later attempt; the server has not seen it. */
  | "queued"
  /** An attempt is in progress right now. */
  | "syncing"
  /** The server confirmed it. */
  | "synced"
  /** It cannot be replayed safely until the person looks at it (changed checklist, someone else finished it, ...). */
  | "needs_review"
  /** The server refused it for good. */
  | "rejected"
  /** A request may have landed but the reply never arrived; nothing is known. */
  | "unknown_outcome";

const SERVER_CONFIRMED: ReadonlySet<EngineeringSyncState> = new Set(["current", "synced"]);

/** Whether the server has confirmed this (never true for anything held only on the phone). */
export const isServerConfirmed = (state: EngineeringSyncState): boolean => SERVER_CONFIRMED.has(state);

/** Whether the person has to do something before the work can move on. */
export const needsPerson = (state: EngineeringSyncState): boolean => state === "needs_review" || state === "rejected" || state === "unknown_outcome";

/** i18n key for the visible label; every state has words, never a colour alone. */
export const stateLabelKey = (state: EngineeringSyncState): string => `engSync.state.${state}`;

/** Where a queued completion got to. Persisted with the queue row so a restart resumes at the right step. */
export type QueuedPhase = "queued" | "uploading" | "submitting" | "unknown";

/** Why a queued completion stopped, as a short code (never typed content). */
export type QueuedStop =
  | "conflict_completed"
  | "checklist_changed"
  | "checklist_unavailable"
  | "schedule_gone"
  | "conflict_changed"
  | "evidence_missing"
  | "evidence_rejected"
  | "forbidden"
  | "invalid"
  | "owner_changed"
  /** The stored record cannot be read on this phone, so nothing about it is known. */
  | "unreadable";

const REVIEW_STOPS: ReadonlySet<string> = new Set(["conflict_completed", "checklist_changed", "checklist_unavailable", "schedule_gone", "conflict_changed", "evidence_missing", "owner_changed", "unreadable"]);

export function queuedState(input: { phase: QueuedPhase; stop?: string | null; attempts: number; active: boolean }): EngineeringSyncState {
  if (input.stop) return REVIEW_STOPS.has(input.stop) ? "needs_review" : "rejected";
  if (input.active) return "syncing";
  if (input.phase === "unknown") return "unknown_outcome";
  return "queued";
}

/**
 * Last-verified wording helper: `null` when never verified. Callers show "Not verified yet" rather than a made-up time,
 * and never turn an unknown value into zero.
 */
export function verifiedAgeMinutes(verifiedAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!verifiedAt) return null;
  const ms = Date.parse(verifiedAt);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((now - ms) / 60_000));
}

/** Server data is `current` only when it was verified a moment ago in this session; otherwise it is `cached`. */
export function dataState(input: { online: boolean; verifiedAt: string | null; now?: number; freshMs?: number }): EngineeringSyncState {
  if (!input.verifiedAt) return "cached";
  const age = (input.now ?? Date.now()) - Date.parse(input.verifiedAt);
  if (!input.online) return "cached";
  return Number.isNaN(age) || age > (input.freshMs ?? 5 * 60_000) ? "cached" : "current";
}
