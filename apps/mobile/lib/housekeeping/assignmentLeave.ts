/* Leaving Assignments with work in flight.

   Two different situations, two different promises:
     "discard"  unpublished changes (a draft or an unfinished Smart Balance plan). Nothing has reached the server, so
                leaving means they are gone — and "Discard and leave" must really discard them, not just navigate.
     "pending"  a publication that is going out or whose outcome is not confirmed yet. Leaving cannot cancel it and
                must NEVER throw its operation away: the recovery path (and the stored operation id) stays intact.
   Nothing here promises a draft was saved; none is. */

export type LeavePrompt = "discard" | "pending";

export interface LeaveState {
  /** A publication is being sent or its result is unknown. */
  publishing: boolean;
  /** The unpublished draft holds changes. */
  draftChanges: boolean;
  /** A Smart Balance proposal exists that has not been added to the draft. */
  planOpen: boolean;
}

export function leavePrompt(state: LeaveState): LeavePrompt | null {
  if (state.publishing) return "pending";
  if (state.draftChanges || state.planOpen) return "discard";
  return null;
}
