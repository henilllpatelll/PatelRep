import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";

/* ─── Supervisor Today — source states ──────────────────────────────────────
   Every resource the Today dashboard reads is tracked on its own, so one
   failing endpoint never blanks unrelated data and a failed request is never
   mistaken for an authoritative zero.

     loading    nothing has answered yet
     available  a fresh answer with content
     empty      a fresh, verified answer that contains nothing (a TRUE zero)
     stale      the last good answer, kept on screen but NOT verified now —
                the device is offline, the answer is old, or a refresh failed
     failed     no answer and nothing earlier to show (unknown, never zero)    */

export type SourceFailureKind = "offline" | "forbidden" | "error";

export interface SourceFailure {
  kind: SourceFailureKind;
  status: number | null;
}

export type StaleReason = "offline" | "age" | "refresh_failed";

export type SourceState<T> =
  | { status: "loading" }
  | { status: "available"; data: T; fetchedAt: number }
  | { status: "empty"; fetchedAt: number }
  /** `data: null` means the last verified answer was empty. */
  | { status: "stale"; data: T | null; fetchedAt: number; reason: StaleReason; failure: SourceFailure | null }
  | { status: "failed"; failure: SourceFailure };

export type SourceStatus = SourceState<unknown>["status"];

export function loadingSource<T>(): SourceState<T> {
  return { status: "loading" };
}

export function classifyFailure(error: unknown): SourceFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return { kind: "forbidden", status };
  return { kind: "error", status: typeof status === "number" ? status : null };
}

function isEmptyValue(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}

/** A successful answer: `empty` when the payload is verifiably nothing, otherwise `available`. */
export function availableSource<T>(
  data: T,
  fetchedAt: number,
  isEmpty: (value: T) => boolean = isEmptyValue,
): SourceState<T> {
  return isEmpty(data) ? { status: "empty", fetchedAt } : { status: "available", data, fetchedAt };
}

/**
 * A failed refresh. If something verified was on screen it stays, relabelled `stale`
 * (with its ORIGINAL fetch time — a failed refresh never renews freshness); otherwise `failed`.
 */
export function failedSource<T>(error: unknown, previous: SourceState<T>): SourceState<T> {
  const failure = classifyFailure(error);
  switch (previous.status) {
    case "available":
      return { status: "stale", data: previous.data, fetchedAt: previous.fetchedAt, reason: "refresh_failed", failure };
    case "empty":
      return { status: "stale", data: null, fetchedAt: previous.fetchedAt, reason: "refresh_failed", failure };
    case "stale":
      return { ...previous, reason: "refresh_failed", failure };
    default:
      return { status: "failed", failure };
  }
}

/** Fold a settled request into the source's state. */
export function settleSource<T>(
  result: PromiseSettledResult<T>,
  previous: SourceState<T>,
  now: number,
  isEmpty?: (value: T) => boolean,
): SourceState<T> {
  return result.status === "fulfilled"
    ? availableSource(result.value, now, isEmpty)
    : failedSource(result.reason, previous);
}

/** The device cannot reach the server: keep what we have, but no longer call it verified. */
export function offlineSource<T>(previous: SourceState<T>): SourceState<T> {
  switch (previous.status) {
    case "available":
      return { status: "stale", data: previous.data, fetchedAt: previous.fetchedAt, reason: "offline", failure: null };
    case "empty":
      return { status: "stale", data: null, fetchedAt: previous.fetchedAt, reason: "offline", failure: null };
    case "stale":
      return previous.reason === "offline" ? previous : { ...previous, reason: "offline" };
    case "loading":
      return { status: "failed", failure: { kind: "offline", status: null } };
    default:
      return previous;
  }
}

/** A fresh answer that has sat past the freshness window is demoted to `stale`. */
export function ageSource<T>(state: SourceState<T>, now: number, staleAfterMs: number = STALE_AFTER_MS): SourceState<T> {
  if (state.status === "available" && now - state.fetchedAt > staleAfterMs) {
    return { status: "stale", data: state.data, fetchedAt: state.fetchedAt, reason: "age", failure: null };
  }
  if (state.status === "empty" && now - state.fetchedAt > staleAfterMs) {
    return { status: "stale", data: null, fetchedAt: state.fetchedAt, reason: "age", failure: null };
  }
  return state;
}

/**
 * What the source knows, for computing from it. `emptyValue` stands in for a verified-empty answer.
 * Returns `null` when nothing is known (loading / failed) — callers must treat that as "unknown", never zero.
 */
export function knownValue<T>(state: SourceState<T>, emptyValue: T): T | null {
  switch (state.status) {
    case "available":
      return state.data;
    case "empty":
      return emptyValue;
    case "stale":
      return state.data ?? emptyValue;
    default:
      return null;
  }
}

/** Fresh and verified right now (not stale, loading or failed). */
export function isVerified(state: SourceState<unknown>): boolean {
  return state.status === "available" || state.status === "empty";
}

/** Epoch ms of the last verified answer behind this state, or null when there never was one. */
export function fetchedAtOf(state: SourceState<unknown>): number | null {
  return state.status === "available" || state.status === "empty" || state.status === "stale" ? state.fetchedAt : null;
}

/** A source's state reduced to what a derived value needs to carry. */
export interface Derived<T> {
  status: SourceStatus;
  /** `null` = unknown. A verified zero is a real value, never `null`. */
  value: T | null;
  fetchedAt: number | null;
  failure: SourceFailure | null;
}

export function derive<S, T>(state: SourceState<S>, emptyValue: S, project: (value: S) => T): Derived<T> {
  const value = knownValue(state, emptyValue);
  return {
    status: state.status,
    value: value === null ? null : project(value),
    fetchedAt: fetchedAtOf(state),
    failure: state.status === "failed" ? state.failure : state.status === "stale" ? state.failure : null,
  };
}
