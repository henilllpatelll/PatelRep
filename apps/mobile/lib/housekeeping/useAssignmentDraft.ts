import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  moveChange,
  rebaseDraft,
  removeFromDraft,
  stageAllocation,
  type DraftExclusion,
  type RebaseResult,
  type StageResult,
} from "@/lib/housekeeping/assignmentDraft";
import { buildDraftReview, type DraftReview } from "@/lib/housekeeping/assignmentDraftReview";
import { draftChanges, draftIsCurrent, emptyDraft, type AssignmentDraft, type PlanSource } from "@/lib/housekeeping/assignmentPlan";

/* The ONE unpublished draft.

   It holds proposed changes only — nothing here is live, and nothing here reaches the server except through the
   reviewed, atomic publication. Manual bulk distribution fills it today; Smart Balance and the AI editor will
   fill this same draft through `stage`, and publish through the same path.

   It is bound to the hotel, the person and the hotel DAY it was prepared for, and held in memory only (task
   text and room numbers are not written to disk): a different hotel, person or day discards it, because a plan
   for one place or day must never be published into another. While it lives it is re-checked against every newer
   board (`review.health`), so a change that no longer holds is marked, never silently published. */

export type DiscardCause = "scope" | "day";

export interface UseAssignmentDraftInput {
  model: AssignmentsModel;
  scopeKey: string | null;
  /** The draft belonged to another hotel/person/day and was thrown away. */
  onDiscarded?: (cause: DiscardCause) => void;
}

export interface AssignmentDraftController {
  draft: AssignmentDraft | null;
  changeCount: number;
  exclusions: DraftExclusion[];
  /** The review of the draft against the live board; null with no draft or while the board is unknown. */
  review: DraftReview | null;
  acks: ReadonlySet<string>;
  toggleAck: (key: string) => void;
  /** What the last "Refresh and review" did, for the review to say. */
  rebaseNote: RebaseResult | null;
  clearRebaseNote: () => void;
  stage: (assignments: Readonly<Record<string, string>>, source: PlanSource, excluded?: DraftExclusion[]) => StageResult;
  move: (roomId: string, toUserId: string) => StageResult;
  remove: (roomId: string) => void;
  /** Brings the draft up to date with the newest board; changes that moved are re-planned and must be reviewed again. */
  rebase: () => RebaseResult;
  /** Throws the draft away (the supervisor's choice, or after a confirmed publication). */
  discard: () => void;
}

function verifiedAtOf(model: AssignmentsModel): number {
  const availability = model.availability;
  return "verifiedAt" in availability && typeof availability.verifiedAt === "number" ? availability.verifiedAt : model.generatedAt;
}

export function useAssignmentDraft({ model, scopeKey, onDiscarded }: UseAssignmentDraftInput): AssignmentDraftController {
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const [exclusions, setExclusions] = useState<DraftExclusion[]>([]);
  const [acks, setAcks] = useState<ReadonlySet<string>>(() => new Set());
  const [rebaseNote, setRebaseNote] = useState<RebaseResult | null>(null);
  const latest = useRef({ model, scopeKey, draft });
  latest.current = { model, scopeKey, draft };
  const discardedRef = useRef(onDiscarded);
  discardedRef.current = onDiscarded;

  const discard = useCallback(() => {
    latest.current.draft = null;
    setDraft(null);
    setExclusions([]);
    setAcks(new Set());
    setRebaseNote(null);
  }, []);

  // A plan for another hotel, person or day is thrown away, never carried over.
  useEffect(() => {
    if (!draft) return;
    if (draftIsCurrent(draft, scopeKey, model.hotelDate)) return;
    discard();
    discardedRef.current?.(draft.scopeKey !== scopeKey ? "scope" : "day");
  }, [draft, scopeKey, model.hotelDate, discard]);

  const commit = useCallback((next: AssignmentDraft): AssignmentDraft | null => {
    const kept = Object.keys(next.changes).length > 0 ? next : null;
    latest.current.draft = kept;
    setDraft(kept);
    if (!kept) {
      setExclusions([]);
      setAcks(new Set());
    }
    return kept;
  }, []);

  const base = useCallback((): AssignmentDraft | null => {
    const { draft: held, model: current, scopeKey: scope } = latest.current;
    if (held) return held;
    return scope ? emptyDraft(scope, current.hotelDate, verifiedAtOf(current)) : null;
  }, []);

  const stage = useCallback<AssignmentDraftController["stage"]>(
    (assignments, source, excluded = []) => {
      const start = base();
      if (!start) return { draft: emptyDraft("", "", 0), staged: [], rejected: Object.keys(assignments).map((roomId) => ({ roomId, roomNumber: "", rejection: { reason: "board_unavailable" } as const })), overLimit: [] };
      const result = stageAllocation(latest.current.model, start, assignments, source);
      commit(result.draft);
      setExclusions((current) => {
        const stagedNow = new Set(result.staged);
        const kept = current.filter((entry) => !stagedNow.has(entry.roomId));
        const added: DraftExclusion[] = [
          ...excluded,
          ...result.rejected.map((entry) => ({ roomId: entry.roomId, roomNumber: entry.roomNumber, reason: entry.rejection.reason })),
          ...result.overLimit.map((roomId) => ({ roomId, roomNumber: (latest.current.model.rooms ?? []).find((room) => room.room.roomId === roomId)?.room.roomNumber ?? "", reason: "over_limit" as const })),
        ];
        const known = new Set(kept.map((entry) => entry.roomId));
        return [...kept, ...added.filter((entry) => !known.has(entry.roomId) && !stagedNow.has(entry.roomId))];
      });
      return result;
    },
    [base, commit],
  );

  const move = useCallback<AssignmentDraftController["move"]>(
    (roomId, toUserId) => {
      const start = latest.current.draft;
      if (!start) return { draft: emptyDraft("", "", 0), staged: [], rejected: [], overLimit: [] };
      const result = moveChange(latest.current.model, start, roomId, toUserId);
      commit(result.draft);
      return result;
    },
    [commit],
  );

  const remove = useCallback((roomId: string) => {
    const start = latest.current.draft;
    if (start) commit(removeFromDraft(start, roomId));
  }, [commit]);

  const rebase = useCallback((): RebaseResult => {
    const start = latest.current.draft;
    if (!start) return { draft: emptyDraft("", "", 0), rebased: [], dropped: [] };
    const result = rebaseDraft(start, latest.current.model, latest.current.scopeKey);
    commit(result.draft);
    // Acknowledgements were given for a plan that has changed: every one is asked for again.
    setAcks(new Set());
    setRebaseNote(result);
    return result;
  }, [commit]);

  const toggleAck = useCallback((key: string) => {
    setAcks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const review = useMemo(() => (draft ? buildDraftReview(model, draft, scopeKey, acks) : null), [model, draft, scopeKey, acks]);

  // An acknowledgement belongs to a requirement that exists NOW: one that stopped applying (and may apply again
  // later, for a different reason) is forgotten rather than silently reused.
  const requiredKey = review ? review.requiredAckKeys.join("|") : "";
  useEffect(() => {
    const required = new Set(requiredKey ? requiredKey.split("|") : []);
    setAcks((current) => {
      const kept = [...current].filter((key) => required.has(key));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [requiredKey]);

  return {
    draft,
    changeCount: draft ? draftChanges(draft).length : 0,
    exclusions,
    review,
    acks,
    toggleAck,
    rebaseNote,
    clearRebaseNote: () => setRebaseNote(null),
    stage,
    move,
    remove,
    rebase,
    discard,
  };
}
