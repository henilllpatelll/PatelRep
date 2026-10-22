import type { RejectionReason, SubmissionOutcome, UncertainReason, UncertainResolution } from "@/lib/inspections/submission";

/* ─── The supervisor's inspection workflow (pure state machine) ──────────────
   READY FOR INSPECTION → INSPECTION IN PROGRESS → CHECKLIST REVIEWED → PASSED or CORRECTION REQUIRED

   This is the SCREEN's workflow phase. It is deliberately NOT a room status and is never written anywhere:
   only the server changes `room_status`, and it knows nothing of "in progress" or "reviewed" — the room stays CLEAN
   throughout. The only persisted facts are the two outcomes, and they are the server's:

       phase                  room status while in this phase     who sets it
       queued                 CLEAN                               housekeeper finished cleaning
       in_progress/reviewed   CLEAN (unchanged)                   —
       submitting/uncertain   CLEAN until the server commits      the server, on commit
       blocked                whatever it now is (re-read it)     —
       passed                 INSPECTED                           server (inspection INSERT trigger)
       correction_required    DIRTY, correction task, flagged     server (same trigger + correction task)

   Inventing room statuses for in-progress work would let a half-finished screen release or block a room. */

export type WorkflowState =
  | { phase: "queued" }
  | { phase: "in_progress" }
  | { phase: "reviewed" }
  | { phase: "submitting" }
  /** Sent, but we do not know whether it landed. Resolve by reading it back; never by guessing. */
  | { phase: "uncertain"; reason: UncertainReason }
  /** Cannot continue as-is (room moved on, checklist edited, account changed). The draft is kept; refresh, then resume. */
  | { phase: "blocked"; reason: RejectionReason }
  | { phase: "passed" }
  | { phase: "correction_required"; followUpPending: boolean };

export type WorkflowPhase = WorkflowState["phase"];

export type WorkflowEvent =
  | { type: "start" }
  | { type: "answer" }
  | { type: "review"; canSubmit: boolean }
  /** Back from the read-only review to the checklist (nothing was sent). */
  | { type: "reopen" }
  /** The room, checklist, day or account moved on under an unfinished inspection. Nothing is sent from here on. */
  | { type: "invalidate"; reason: RejectionReason }
  | { type: "submit" }
  | { type: "outcome"; outcome: SubmissionOutcome }
  | { type: "resolved"; resolution: UncertainResolution }
  /** Back from `blocked` after the room/checklist was re-read and the answers carried over. */
  | { type: "resume" }
  | { type: "discard" };

export const INITIAL_WORKFLOW: WorkflowState = { phase: "queued" };

/** The phases from which a result can no longer be changed. */
export function isConcluded(state: WorkflowState): boolean {
  return state.phase === "passed" || (state.phase === "correction_required" && !state.followUpPending);
}

/** What the room's persisted status is expected to be while the screen is in a phase; `null` = do not assume. */
export function expectedRoomStatus(state: WorkflowState): "CLEAN" | "INSPECTED" | "DIRTY" | null {
  switch (state.phase) {
    case "queued":
    case "in_progress":
    case "reviewed":
    case "submitting":
    case "uncertain":
      return "CLEAN";
    case "passed":
      return "INSPECTED";
    case "correction_required":
      return "DIRTY";
    case "blocked":
      return null;
  }
}

export interface Transition {
  state: WorkflowState;
  /** False when the event does not apply in this phase; the state is returned unchanged. */
  accepted: boolean;
}

const keep = (state: WorkflowState): Transition => ({ state, accepted: false });
const to = (state: WorkflowState): Transition => ({ state, accepted: true });

function concluded(result: "passed" | "failed", followUpPending: boolean): WorkflowState {
  return result === "passed" ? { phase: "passed" } : { phase: "correction_required", followUpPending };
}

function fromOutcome(outcome: SubmissionOutcome): WorkflowState {
  switch (outcome.kind) {
    case "committed":
      return concluded(outcome.receipt.outcome, false);
    case "needs_follow_up":
      return concluded(outcome.receipt.outcome, true);
    case "uncertain":
      return { phase: "uncertain", reason: outcome.reason };
    case "rejected":
      // Nothing was recorded. If the content is unchanged the same submission can be resent; otherwise the screen must
      // refresh first.
      return outcome.sameSubmissionOk ? { phase: "reviewed" } : { phase: "blocked", reason: outcome.reason };
  }
}

function fromResolution(resolution: UncertainResolution, previous: Extract<WorkflowState, { phase: "uncertain" }>): WorkflowState {
  switch (resolution.kind) {
    case "recorded": {
      const result = resolution.detail.overall_result === "passed" ? "passed" : "failed";
      // A recorded failure whose correction task is still missing needs finishing.
      const pending = result === "failed" && resolution.detail.correction?.status === "correction_missing";
      return concluded(result, pending);
    }
    case "incomplete":
    case "not_recorded":
      return { phase: "reviewed" };
    case "still_uncertain":
      return previous;
  }
}

export function transition(state: WorkflowState, event: WorkflowEvent): Transition {
  switch (event.type) {
    case "start":
      return state.phase === "queued" ? to({ phase: "in_progress" }) : keep(state);

    case "answer":
      return state.phase === "in_progress" || state.phase === "reviewed" ? to({ phase: "in_progress" }) : keep(state);

    case "review":
      // Only a checklist that can legitimately conclude may be reviewed.
      return state.phase === "in_progress" && event.canSubmit ? to({ phase: "reviewed" }) : keep(state);

    case "reopen":
      return state.phase === "reviewed" ? to({ phase: "in_progress" }) : keep(state);

    case "invalidate":
      // Only unfinished work can be invalidated. A recorded result, a write in flight and an unresolved write are
      // settled by the server's answer, never by this screen's opinion of the room.
      return state.phase === "queued" || state.phase === "in_progress" || state.phase === "reviewed"
        ? to({ phase: "blocked", reason: event.reason })
        : keep(state);

    case "submit":
      if (state.phase === "reviewed" || state.phase === "uncertain") return to({ phase: "submitting" });
      if (state.phase === "correction_required" && state.followUpPending) return to({ phase: "submitting" });
      return keep(state);

    case "outcome":
      return state.phase === "submitting" ? to(fromOutcome(event.outcome)) : keep(state);

    case "resolved":
      return state.phase === "uncertain" ? to(fromResolution(event.resolution, state)) : keep(state);

    case "resume":
      return state.phase === "blocked" ? to({ phase: "in_progress" }) : keep(state);

    case "discard":
      // Leaving is never allowed while a write is in flight or unresolved, and never undoes a recorded result.
      return state.phase === "in_progress" || state.phase === "reviewed" || state.phase === "blocked"
        ? to({ phase: "queued" })
        : keep(state);
  }
}
