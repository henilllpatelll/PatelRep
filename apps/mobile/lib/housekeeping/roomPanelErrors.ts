/* ─── Room panels — how a failed request is described ───────────────────────
   Pure. The API client throws an `ApiError` (with a numeric `status`) when the server answered no, and a plain
   Error when no answer arrived (offline, timeout). That difference is the one that matters for a write:
     - a 4xx answer means the write did NOT happen, so it is safe to say so and let the person fix and retry;
     - no answer, or a 5xx, MAY have happened, so it is never retried blindly and never reported as saved.
   Duck-typed on `status` so the module needs nothing from the API client. */

export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** Why a read could not be shown. Each has its own words; none of them is "empty". */
export type PanelLoadError = "network" | "unauthorized" | "not_found" | "server";

export function classifyLoadError(error: unknown): PanelLoadError {
  const status = statusOf(error);
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status !== null) return "server";
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return /session expired|not authenticated/i.test(message) ? "unauthorized" : "network";
}

/** Why a write did not go through. */
export type WriteFailure =
  /** 401 / 403: this person may not do it. Nothing was written. */
  | "forbidden"
  /** 404: the room (or record) is gone. Nothing was written. */
  | "not_found"
  /** 409: the record changed under the request. Nothing was written. */
  | "conflict"
  /** 400 / 422: the server refused the content. Nothing was written. */
  | "invalid"
  /** Any other 4xx: refused, nothing was written. */
  | "rejected"
  /** No answer, or a 5xx: the write MAY have happened. */
  | "uncertain";

export function classifyWriteFailure(error: unknown): WriteFailure {
  const status = statusOf(error);
  if (status === null) return "uncertain";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  return status < 500 ? "rejected" : "uncertain";
}
