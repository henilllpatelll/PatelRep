import type { HomeModel } from "@/lib/housekeeping/homeModel";
import { buildShiftReview, type ReviewItem } from "@/lib/housekeeping/shiftReview";
import { workedSeconds } from "@/lib/housekeeping/shiftLifecycle";

/**
 * The completed-shift summary: recorded facts only. Times are the shift's own
 * clock-in / clock-out; room numbers come from the same progress model as the
 * rest of Home. "Inspected" is never turned into "cleaned by you": only rooms
 * this phone holds server-confirmed completions for are counted as yours.
 * There are no scores, paces or comparisons.
 */

export interface ShiftSummary {
  shiftDate: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  breakSeconds: number;
  /** Clock-in to clock-out, minus breaks; null when either time is unknown. */
  workedSeconds: number | null;
  /** Room outcomes are only stated when today's room list is trustworthy. */
  boardUsable: boolean;
  rooms: {
    assigned: number;
    submitted: number;
    inspected: number;
    unavailable: number;
    /** Completed rooms with a server-confirmed completion from this phone's own sessions. */
    confirmedByYou: number;
  };
  exceptions: ReviewItem[];
  handoffs: ReviewItem[];
  /** Rooms that were still to clean, or held by something other than a documented exception, at last look. */
  leftOpen: ReviewItem[];
  sync: { pending: number; failed: number; conflicts: number; verified: boolean };
  /** When the room list was last confirmed, so a stale summary can say so. */
  asOf: string | null;
}

export function buildShiftSummary(model: HomeModel, now: Date): ShiftSummary {
  const review = buildShiftReview(model);
  const { lifecycle, progress } = model;
  return {
    shiftDate: model.shiftDate,
    clockedInAt: lifecycle.startedAt,
    clockedOutAt: lifecycle.endedAt,
    breakSeconds: lifecycle.breakSeconds,
    workedSeconds: lifecycle.endedAt ? workedSeconds(lifecycle, now) : null,
    boardUsable: review.boardUsable,
    rooms: {
      assigned: progress.assigned,
      submitted: progress.submitted,
      inspected: progress.inspected,
      unavailable: progress.unavailable,
      confirmedByYou: progress.confirmedByYou,
    },
    exceptions: review.items.filter((item) => item.kind === "exception"),
    handoffs: review.items.filter((item) => item.kind === "maintenance"),
    leftOpen: review.items.filter((item) => item.kind === "unfinished" || item.kind === "attention"),
    sync: review.sync,
    asOf: model.board.lastRefreshAt,
  };
}
