/* ─── AI repair assist - pure rules ──────────────────────────────────────────
   What the sheet may offer and how a failure reads. The assistant only ever suggests: nothing here (or on the
   server) completes a repair, changes a checklist, consumes stock, or edits priority or assignment. */

import { classifyLoadFailure } from "@/lib/engineering/loadState";
import type { AssistTurn } from "@/lib/api/repairAssist";

export type AssistFailure = "off" | "cap" | "busy" | "unavailable" | "not_found" | "offline" | "failed";

/** Maps the API's answer to a message. 503 (provider off or down) is never shown as an empty answer. */
export function classifyAssistError(error: unknown): AssistFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 402) return "cap";
  if (status === 403) return "off";
  if (status === 404) return "not_found";
  if (status === 429) return "busy";
  if (status === 503) return "unavailable";
  return classifyLoadFailure(error) === "offline" ? "offline" : "failed";
}

export const MAX_QUESTION_CHARS = 500;
export const MAX_NOTES_CHARS = 1500;
const MAX_TURN_CHARS = 600;
const MAX_TURNS = 4;

/** The last few turns, shortened: enough context for a follow-up, nothing stored anywhere. */
export function trimHistory(turns: readonly AssistTurn[]): AssistTurn[] {
  return turns.slice(-MAX_TURNS).map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_CHARS) }));
}

/** An active order the signed-in person can read (the server re-checks; this only hides a button that cannot work). */
export function canOfferAssist(input: { capability: boolean; status: string | null | undefined; role: string | null | undefined }): boolean {
  if (!input.capability) return false;
  if (input.role !== "engineer" && input.role !== "chief_engineer" && input.role !== "gm") return false;
  return input.status !== "completed" && input.status !== "cancelled";
}

export function isUsableQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_QUESTION_CHARS;
}
