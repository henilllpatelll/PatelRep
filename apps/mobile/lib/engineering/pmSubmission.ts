/* ─── PM completion submission identity ─────────────────────────────────────
   One logical completion attempt = one `submission_id`. The server records a completion once per id, so a lost response, a
   double tap or a retry after a restart can never record the inspection twice. The id is tied to WHAT is being submitted:
   resubmitting the same content reuses the id (the server hands back the original), but once the technician has changed
   anything it is a different attempt and gets a fresh id - the server refuses to reuse an id for different content. */

import { newClientRequestId } from "./requestId";
import type { PmCompletionPayload } from "./pmCompletion";

export interface PmSubmission {
  id: string;
  fingerprint: string;
}

/** Stable text for the content of a completion, ignoring the id itself. */
export function completionFingerprint(payload: Omit<PmCompletionPayload, "submission_id">): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sorted(v)]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(payload));
}

/** Reuse the stored submission while the content is unchanged; otherwise start a new one. */
export function resolveSubmission(
  existing: PmSubmission | null | undefined,
  payload: Omit<PmCompletionPayload, "submission_id">,
  newId: () => string = newClientRequestId,
): PmSubmission {
  const fingerprint = completionFingerprint(payload);
  return existing && existing.fingerprint === fingerprint ? existing : { id: newId(), fingerprint };
}
