import { sendCopilotMessage } from "@/lib/ai/copilotChat";
import { descriptionSuggestionFrom, type DescriptionSuggestion } from "@/lib/housekeeping/reportDraft";

/* Ask the assistant to read what the person wrote and propose a title, category and priority for the room's
   issue. It goes through the same /ai/copilot/chat the assistant uses (the server re-checks the role, the room
   and the AI credit cap) and returns a SUGGESTION: nothing is created, and the room is never taken from the
   model -- the form already has the verified one. Resolves `null` when the assistant had nothing usable to
   propose; rejects with the assistant's own CopilotFailure (offline, credit_limit, rate_limited, ...) otherwise. */
export async function suggestReportFromDescription(details: string, roomId: string, signal?: AbortSignal): Promise<DescriptionSuggestion | null> {
  const basis = details.trim();
  const outcome = await sendCopilotMessage(basis, { intentHint: "work_order_creation", context: { roomId }, signal });
  if (outcome.kind !== "actions") return null;
  const first = outcome.actions.find((action) => action.kind === "work_order");
  return first && first.kind === "work_order" ? descriptionSuggestionFrom(first.draft, basis) : null;
}
