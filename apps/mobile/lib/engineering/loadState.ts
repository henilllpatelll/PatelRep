/* ─── Engineering screen states ─────────────────────────────────────────────
   One vocabulary for "what should this list show right now", so a failed
   request can never render as an empty, healthy queue. Pure — screens feed it
   what they know and render the answer with EngineeringState. Refreshing is a
   pull-to-refresh spinner on top of `ready`; a confirmed/queued action is a
   toast (see actionOutcome). */

export type EngineeringLoadStatus =
  | "loading" // first load, nothing to show yet
  | "ready" // there is data (possibly stale — see `stale`)
  | "empty" // loaded fine, genuinely nothing there
  | "error" // the request failed and there is no data to fall back on
  | "forbidden" // the server refused this role (401/403)
  | "offline"; // no connection and nothing cached

export type LoadFailure = "forbidden" | "offline" | "failed";

/** Network failures and timeouts are plain Errors (no status); the API client throws ApiError with a status otherwise. */
export function classifyLoadFailure(error: unknown): LoadFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return "forbidden";
  if (typeof status === "number") return "failed";
  const message = error instanceof Error ? error.message : "";
  if (/network request failed|failed to fetch|timed out|timeout|offline/i.test(message)) return "offline";
  return "failed";
}

export interface LoadStateInput {
  /** True until the first attempt settles. */
  loading: boolean;
  /** The failure from the latest attempt, if it failed. */
  failure: LoadFailure | null;
  /** Rows currently available to show (including stale ones). */
  count: number;
  /** Device has no connection and no attempt was made. */
  offline?: boolean;
}

export interface LoadState {
  status: EngineeringLoadStatus;
  /** True when `ready` is showing data from before a failed refresh — show a "couldn't refresh" banner. */
  stale: boolean;
}

export function resolveLoadState({ loading, failure, count, offline = false }: LoadStateInput): LoadState {
  if (count > 0) return { status: "ready", stale: failure != null };
  if (loading) return { status: "loading", stale: false };
  if (failure === "forbidden") return { status: "forbidden", stale: false };
  if (failure === "offline" || (offline && failure == null)) return { status: "offline", stale: false };
  if (failure) return { status: "error", stale: false };
  return { status: "empty", stale: false };
}

/** Folds several parallel requests into one: any settled-rejected one is a failure (forbidden wins, then offline). */
export function combineFailures(results: ReadonlyArray<PromiseSettledResult<unknown>>): LoadFailure | null {
  let worst: LoadFailure | null = null;
  for (const result of results) {
    if (result.status !== "rejected") continue;
    const failure = classifyLoadFailure(result.reason);
    if (failure === "forbidden") return "forbidden";
    if (failure === "offline" || worst == null) worst = failure;
  }
  return worst;
}

export type ActionOutcome = "confirmed" | "queued" | "failed";

/** Online → the server confirmed it; offline → it is saved on this phone and will sync. Never "done" for a failure. */
export function actionOutcome(isOnline: boolean, error?: unknown): ActionOutcome {
  if (error != null) return "failed";
  return isOnline ? "confirmed" : "queued";
}
