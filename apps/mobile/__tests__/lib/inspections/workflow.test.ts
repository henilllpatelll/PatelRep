import type { SubmissionOutcome } from "@/lib/inspections/submission";
import { INITIAL_WORKFLOW, expectedRoomStatus, isConcluded, transition, type WorkflowEvent, type WorkflowState } from "@/lib/inspections/workflow";

const receipt = (outcome: "passed" | "failed") => ({
  id: "x", outcome, replayed: false, correctionKind: null, reinspectionOf: null, followUpComplete: true, completedAt: null, correction: null,
});
const committed = (outcome: "passed" | "failed"): SubmissionOutcome => ({ kind: "committed", receipt: receipt(outcome) });

function run(events: WorkflowEvent[], from: WorkflowState = INITIAL_WORKFLOW): WorkflowState {
  return events.reduce((state, event) => transition(state, event).state, from);
}

describe("the supervisor workflow", () => {
  it("walks READY → IN PROGRESS → REVIEWED → PASSED", () => {
    expect(
      run([{ type: "start" }, { type: "answer" }, { type: "review", canSubmit: true }, { type: "submit" }, { type: "outcome", outcome: committed("passed") }]),
    ).toEqual({ phase: "passed" });
  });

  it("a failure lands in CORRECTION REQUIRED", () => {
    expect(
      run([{ type: "start" }, { type: "review", canSubmit: true }, { type: "submit" }, { type: "outcome", outcome: committed("failed") }]),
    ).toEqual({ phase: "correction_required", followUpPending: false });
  });

  it("review is refused until the checklist can legitimately conclude", () => {
    const t = transition({ phase: "in_progress" }, { type: "review", canSubmit: false });
    expect(t).toEqual({ state: { phase: "in_progress" }, accepted: false });
  });

  it("changing an answer after review reopens the checklist", () => {
    expect(run([{ type: "answer" }], { phase: "reviewed" })).toEqual({ phase: "in_progress" });
  });

  it("events that do not apply leave the state unchanged and say so", () => {
    expect(transition({ phase: "queued" }, { type: "submit" })).toEqual({ state: { phase: "queued" }, accepted: false });
    expect(transition({ phase: "passed" }, { type: "answer" }).accepted).toBe(false);
    expect(transition({ phase: "in_progress" }, { type: "submit" }).accepted).toBe(false);
    expect(transition({ phase: "reviewed" }, { type: "outcome", outcome: committed("passed") }).accepted).toBe(false);
  });

  it("a recorded result can never be discarded or reopened; a write in flight cannot be abandoned", () => {
    for (const state of [{ phase: "passed" }, { phase: "correction_required", followUpPending: false }, { phase: "submitting" }, { phase: "uncertain", reason: "no_response" }] as WorkflowState[]) {
      expect(transition(state, { type: "discard" }).accepted).toBe(false);
    }
    expect(isConcluded({ phase: "passed" })).toBe(true);
    expect(isConcluded({ phase: "correction_required", followUpPending: false })).toBe(true);
    expect(isConcluded({ phase: "correction_required", followUpPending: true })).toBe(false);
  });

  it("a committed failure whose correction task is missing can be finished by resubmitting", () => {
    const pending = run([{ type: "start" }, { type: "review", canSubmit: true }, { type: "submit" }, { type: "outcome", outcome: { kind: "needs_follow_up", receipt: { ...receipt("failed"), followUpComplete: false } } }]);
    expect(pending).toEqual({ phase: "correction_required", followUpPending: true });
    expect(transition(pending, { type: "submit" }).state).toEqual({ phase: "submitting" });
  });

  describe("when the submission is rejected", () => {
    const toSubmitting = (): WorkflowState => run([{ type: "start" }, { type: "review", canSubmit: true }, { type: "submit" }]);

    it("a stale room blocks the screen until it is refreshed; the draft is kept", () => {
      const blocked = transition(toSubmitting(), {
        type: "outcome",
        outcome: { kind: "rejected", reason: "room_changed", code: "room_not_awaiting_inspection", message: null, sameSubmissionOk: false, refresh: "queue" },
      }).state;
      expect(blocked).toEqual({ phase: "blocked", reason: "room_changed" });
      expect(transition(blocked, { type: "resume" }).state).toEqual({ phase: "in_progress" });
      expect(transition(blocked, { type: "submit" }).accepted).toBe(false);
    });

    it("a photo upload failure returns to review so the same submission can be resent", () => {
      const state = transition(toSubmitting(), {
        type: "outcome",
        outcome: { kind: "rejected", reason: "evidence_upload_failed", code: "photo_upload_failed", message: null, sameSubmissionOk: true, refresh: "none" },
      }).state;
      expect(state).toEqual({ phase: "reviewed" });
    });
  });

  describe("when the outcome is uncertain", () => {
    const uncertain = (): WorkflowState =>
      run([{ type: "start" }, { type: "review", canSubmit: true }, { type: "submit" }, { type: "outcome", outcome: { kind: "uncertain", reason: "no_response", submissionId: "x" } }]);

    it("retrying is allowed and uses the same submission", () => {
      expect(uncertain()).toEqual({ phase: "uncertain", reason: "no_response" });
      expect(transition(uncertain(), { type: "submit" }).state).toEqual({ phase: "submitting" });
    });

    it("reading it back settles it without resending", () => {
      const detail = { overall_result: "failed", correction: { status: "assigned" } } as never;
      expect(transition(uncertain(), { type: "resolved", resolution: { kind: "recorded", detail, matchesIntent: true } }).state).toEqual({
        phase: "correction_required",
        followUpPending: false,
      });
      const missing = { overall_result: "failed", correction: { status: "correction_missing" } } as never;
      expect(transition(uncertain(), { type: "resolved", resolution: { kind: "recorded", detail: missing, matchesIntent: true } }).state).toEqual({
        phase: "correction_required",
        followUpPending: true,
      });
      expect(transition(uncertain(), { type: "resolved", resolution: { kind: "not_recorded" } }).state).toEqual({ phase: "reviewed" });
      expect(transition(uncertain(), { type: "resolved", resolution: { kind: "still_uncertain" } }).state).toEqual(uncertain());
    });
  });
});

describe("workflow phases are not room statuses", () => {
  it("only the two outcomes imply a different persisted status; in-progress work never does", () => {
    expect(expectedRoomStatus({ phase: "queued" })).toBe("CLEAN");
    expect(expectedRoomStatus({ phase: "in_progress" })).toBe("CLEAN");
    expect(expectedRoomStatus({ phase: "reviewed" })).toBe("CLEAN");
    expect(expectedRoomStatus({ phase: "submitting" })).toBe("CLEAN");
    expect(expectedRoomStatus({ phase: "passed" })).toBe("INSPECTED");
    expect(expectedRoomStatus({ phase: "correction_required", followUpPending: false })).toBe("DIRTY");
    expect(expectedRoomStatus({ phase: "blocked", reason: "room_changed" })).toBeNull();
  });
});

describe("what the active inspection workspace added", () => {
  it("going back from the read-only review reopens the checklist and sends nothing", () => {
    expect(run([{ type: "reopen" }], { phase: "reviewed" })).toEqual({ phase: "in_progress" });
    expect(transition({ phase: "in_progress" }, { type: "reopen" }).accepted).toBe(false);
    expect(transition({ phase: "queued" }, { type: "reopen" }).accepted).toBe(false);
  });

  it("unfinished work is blocked when the room, checklist or day moved on, and may resume", () => {
    for (const from of [{ phase: "queued" }, { phase: "in_progress" }, { phase: "reviewed" }] as WorkflowState[]) {
      expect(transition(from, { type: "invalidate", reason: "room_changed" })).toEqual({ state: { phase: "blocked", reason: "room_changed" }, accepted: true });
    }
    expect(run([{ type: "resume" }], { phase: "blocked", reason: "template_changed" })).toEqual({ phase: "in_progress" });
  });

  it("a recorded result, a write in flight and an unresolved write can never be invalidated by the screen", () => {
    const states: WorkflowState[] = [
      { phase: "submitting" },
      { phase: "uncertain", reason: "no_response" } as WorkflowState,
      { phase: "passed" },
      { phase: "correction_required", followUpPending: false },
      { phase: "blocked", reason: "room_changed" },
    ];
    for (const state of states) {
      const result = transition(state, { type: "invalidate", reason: "room_changed" });
      if (state.phase === "blocked") expect(result.accepted).toBe(false);
      else expect(result).toEqual({ state, accepted: false });
    }
  });

  it("a blocked inspection can still be discarded", () => {
    expect(run([{ type: "discard" }], { phase: "blocked", reason: "room_changed" })).toEqual({ phase: "queued" });
  });
});
