import type { QueueItem } from "@/lib/inspections/queue";
import type { AnswerMap, ChecklistTemplate, CorrectionKind, Severity } from "@/lib/inspections/types";
import { classifyFailure, failedItems } from "@/lib/inspections/validation";

/* ─── What a failed inspection will set in motion (pure, read-only) ─────────
   Submitting a failed inspection (a later phase) makes the SERVER create exactly one housekeeping correction task:
   priority urgent, owned by the housekeeper responsible for the room, worded from the failed standards. The app
   cannot choose the owner, the priority or the wording, and there is no engineering route from an inspection.

   So this is a PREVIEW of those facts, not a form: nothing here can be edited, saved or sent, and nothing is claimed
   to have happened. The owner is shown as "expected" because the server decides when it records the inspection. */

export interface CorrectionStep {
  itemId: string;
  section: string;
  label: string;
  /** What the supervisor wrote about the issue, if anything. */
  instruction: string | null;
  severity: Severity | null;
}

export interface CorrectionPlan {
  /** The only route an inspection supports. */
  track: "housekeeping";
  /** Touch-up or full re-clean; "undecided" until every issue has a severity (an unchosen one counts as major). */
  kind: CorrectionKind | "undecided";
  /** Fixed by the server for inspection corrections. */
  priority: "urgent";
  owner: { housekeeperId: string | null; name: string | null };
  steps: CorrectionStep[];
  /** Never "created": creation happens on the server at submission. */
  state: "pending_submission";
}

export function planCorrection(
  template: Pick<ChecklistTemplate, "items">,
  answers: AnswerMap,
  room: Pick<QueueItem, "housekeeperId" | "cleanedBy">,
): CorrectionPlan | null {
  const failures = failedItems(template, answers);
  if (failures.length === 0) return null;
  const everyClassified = failures.every((failure) => failure.severity !== null);
  const kind = everyClassified ? classifyFailure(failures.map((failure) => failure.severity)) : null;
  const name = room.cleanedBy.trim();
  return {
    track: "housekeeping",
    kind: kind ?? "undecided",
    priority: "urgent",
    owner: { housekeeperId: room.housekeeperId, name: name || null },
    steps: failures.map((failure) => ({
      itemId: failure.item.id,
      section: failure.item.section,
      label: failure.item.description,
      instruction: failure.note,
      severity: failure.severity,
    })),
    state: "pending_submission",
  };
}
