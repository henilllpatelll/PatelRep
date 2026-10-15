import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { getProgress } from "@/lib/housekeeping/cleanSession";
import { findRoomEntry } from "@/lib/housekeeping/homeSheets";

/**
 * Can this room be submitted as Clean from Home right now? Answered from the
 * live model and this phone's clean session, every time it is asked: a
 * reassignment, a new restriction or a checklist change while the sheet is open
 * changes the answer. Only the server finishes a room (the session store's
 * `completeSession` re-checks the required items and makes the single
 * IN_PROGRESS -> CLEAN move); this only decides whether to offer it.
 */

export type MarkCleanBlock =
  /** The room is no longer on this person's list. */
  | "not_assigned"
  /** DND, declined service, guest inside... entering is not the housekeeper's call. */
  | "restricted"
  /** The room is not IN_PROGRESS (already submitted, inspected, reset...). */
  | "not_in_progress"
  /** Departures need their linen counts, which are entered on the room screen. */
  | "departure"
  /** This phone holds no cleaning session for the room. */
  | "no_session"
  /** The server refused something earlier; resolved on the room screen. */
  | "conflict"
  /** Already submitted; waiting for the server to confirm. */
  | "already_pending"
  | "already_done"
  | "checklist_incomplete";

export type MarkCleanAction = "finish_checklist" | "open_room" | "none";

export type MarkCleanReadiness =
  | {
      state: "ready";
      roomNumber: string;
      done: number;
      total: number;
      /** Offline: the completion would be saved on this phone and sent later, not confirmed. */
      willQueue: boolean;
    }
  | {
      state: "blocked";
      reason: MarkCleanBlock;
      roomNumber: string | null;
      done: number;
      total: number;
      /** Required items still open (labels), strongest first. */
      missing: string[];
      action: MarkCleanAction;
    };

export function resolveMarkCleanReadiness(input: {
  model: HomeModel;
  roomId: string | null;
  session: LocalCleanSession | undefined;
  isOnline: boolean;
}): MarkCleanReadiness {
  const { model, roomId, session, isOnline } = input;
  const entry = findRoomEntry(model, roomId);

  const progress = getProgress(session?.checklist ?? []);
  const total = progress.requiredTotal > 0 ? progress.requiredTotal : progress.total;
  const done = progress.requiredTotal > 0 ? progress.requiredDone : progress.done;
  const base = { done, total, missing: progress.requiredRemaining.map((item) => item.label) };

  const blocked = (reason: MarkCleanBlock, action: MarkCleanAction): MarkCleanReadiness => ({
    state: "blocked",
    reason,
    roomNumber: entry?.room.room_number ?? null,
    action,
    ...base,
  });

  if (!entry) return blocked("not_assigned", "none");
  if (entry.classification.restricted) return blocked("restricted", "open_room");
  if (session?.completionConfirmed || entry.category === "submitted" || entry.category === "inspected") {
    return blocked("already_done", "none");
  }
  if (entry.room.status !== "IN_PROGRESS" && !session?.completeRequestedAt) return blocked("not_in_progress", "none");
  if (entry.room.clean_type === "DEP") return blocked("departure", "open_room");
  if (!session) return blocked("no_session", "open_room");
  if (session.conflict) return blocked("conflict", "open_room");
  if (session.completeRequestedAt) return blocked("already_pending", "none");
  if (progress.requiredRemaining.length > 0 || (session.checklist.length === 0 && !session.startConfirmed)) {
    return blocked("checklist_incomplete", "finish_checklist");
  }

  return { state: "ready", roomNumber: entry.room.room_number, done, total, willQueue: !isOnline };
}

/** Wording key for a blocked reason (the sheet adds the room and the missing items). */
export function blockMessageKey(reason: MarkCleanBlock): string {
  return `home.markClean.blocked.${reason}`;
}

/** Session-store rejection codes that mean "go fix it on the room screen". */
export function rejectionNeedsRoom(code: string): boolean {
  return code === "REQUIRED_ITEMS_INCOMPLETE" || code.startsWith("SESSION_") || code === "ROOM_STATE_CHANGED" || code === "NO_SESSION";
}
