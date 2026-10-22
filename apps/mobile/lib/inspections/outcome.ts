import type { CorrectionActivity, InspectionDetail } from "@/lib/api/inspections";
import { buildAvailability, DEFAULT_QUEUE_DRAFT, selectQueue, type QueueContext } from "@/lib/inspections/queueView";
import type { QueueItem } from "@/lib/inspections/queue";
import type { CompletionReceipt } from "@/lib/inspections/submission";
import type { CorrectionKind, InspectionOutcome } from "@/lib/inspections/types";

/* ─── What a recorded inspection means for the screen (pure) ─────────────────
   Everything here is built from the SERVER's reply or read-back, never from the draft: the success screens may only
   say what the server confirmed. Nothing claims a room is released in an outside system, that an owner has seen the
   work, or that a message arrived. */

export interface InspectionResult {
  submissionId: string;
  outcome: InspectionOutcome;
  roomId: string;
  /** The room number as the server recorded it when known, else the one the supervisor was looking at. */
  roomNumber: string;
  /** The server's time for the inspection (epoch ms), or null when the reply did not say. */
  completedAtMs: number | null;
  isReinspection: boolean;
  correctionKind: CorrectionKind | null;
  /** What failed, in the checklist's own words. */
  failedLabels: string[];
  /** A failed inspection whose correction task is not confirmed yet: recorded, room blocked, repair pending. */
  followUpPending: boolean;
  correction: ResultCorrection | null;
}

export interface ResultCorrection {
  /** "failed" = the server could not create it (yet). */
  status: "created" | "existing" | "failed";
  taskId: string | null;
  taskStatus: string | null;
  priority: string | null;
  /** The real name, or null. */
  ownerName: string | null;
  /** True when a person is responsible but the server has no name for them. */
  ownerUnnamed: boolean;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function resultFromReceipt(
  receipt: CompletionReceipt,
  room: { roomId: string; roomNumber: string; failedLabels: string[]; isReinspection: boolean },
): InspectionResult {
  const correction = receipt.correction;
  return {
    submissionId: receipt.id,
    outcome: receipt.outcome,
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    completedAtMs: parseMs(receipt.completedAt),
    isReinspection: receipt.reinspectionOf !== null || room.isReinspection,
    correctionKind: receipt.correctionKind,
    failedLabels: room.failedLabels,
    followUpPending: receipt.outcome === "failed" && !receipt.followUpComplete,
    correction: correction
      ? {
          status: correction.status,
          taskId: correction.taskId,
          taskStatus: correction.taskStatus,
          priority: correction.priority,
          ownerName: correction.assignedName,
          ownerUnnamed: correction.assignedTo !== null && correction.assignedName === null,
        }
      : null,
  };
}

/** The same result, rebuilt from a read-back (after a lost reply or an app restart). */
export function resultFromDetail(detail: InspectionDetail, fallbackRoomNumber: string): InspectionResult {
  const outcome: InspectionOutcome = detail.overall_result === "passed" ? "passed" : "failed";
  const task = detail.correction?.task ?? null;
  const missing = outcome === "failed" && (detail.correction === null || detail.correction.status === "correction_missing");
  return {
    submissionId: detail.id,
    outcome,
    roomId: detail.room_id,
    roomNumber: detail.room_number?.trim() || fallbackRoomNumber,
    completedAtMs: parseMs(detail.completed_at),
    isReinspection: Boolean(detail.reinspection_of),
    correctionKind: detail.correction_kind,
    failedLabels: detail.items.filter((item) => item.result === "fail" && item.description).map((item) => item.description as string),
    followUpPending: missing,
    correction:
      outcome === "failed"
        ? {
            status: missing ? "failed" : "existing",
            taskId: task?.id ?? null,
            taskStatus: task?.status ?? null,
            priority: task?.priority ?? null,
            ownerName: task?.assigned_name?.trim() || null,
            ownerUnnamed: Boolean(task?.assigned_to) && !task?.assigned_name?.trim(),
          }
        : null,
  };
}

/* ─── How the owner and status of a new correction are worded ───────────── */

export type OwnerState = { kind: "named"; name: string } | { kind: "unnamed" } | { kind: "unassigned" } | { kind: "unknown" };

/** Who owns the work, from the server's record. A correction that was not created has no owner to report. */
export function ownerState(correction: ResultCorrection | null): OwnerState {
  if (!correction || correction.status === "failed") return { kind: "unknown" };
  if (correction.ownerName) return { kind: "named", name: correction.ownerName };
  return correction.ownerUnnamed ? { kind: "unnamed" } : { kind: "unassigned" };
}

/**
 * The status line for a newly requested correction. "Assigned" is responsibility, never receipt: only a started task
 * is reported as started, and an owner is never described as having seen or acknowledged it.
 */
export type NewCorrectionStatus = "awaiting_owner" | "unassigned" | "in_progress" | "escalated" | "pending_repair" | "recorded";

export function newCorrectionStatus(result: Pick<InspectionResult, "followUpPending" | "correction">): NewCorrectionStatus {
  const correction = result.correction;
  if (result.followUpPending || !correction || correction.status === "failed") return "pending_repair";
  if (correction.taskStatus === "escalated") return "escalated";
  if (correction.taskStatus === "in_progress") return "in_progress";
  if (correction.taskStatus === "open") return correction.ownerName || correction.ownerUnnamed ? "awaiting_owner" : "unassigned";
  return "recorded";
}

/* ─── The next room ─────────────────────────────────────────────────────── */

/**
 * The next room to inspect from the verified queue, in the supervisor's default order, never the one just finished
 * (the queue may not have caught up yet) and never one whose checklist cannot be used. null = nothing else is waiting.
 */
export function nextRoomToInspect(items: readonly QueueItem[] | null, currentRoomId: string, ctx: QueueContext, usable: (item: QueueItem) => boolean = () => true): QueueItem | null {
  if (!items) return null;
  const others = items.filter((item) => item.roomId !== currentRoomId);
  if (others.length === 0) return null;
  const selection = selectQueue({
    items: others,
    availability: buildAvailability(others),
    filters: DEFAULT_QUEUE_DRAFT.filters,
    sort: DEFAULT_QUEUE_DRAFT.sort,
    search: "",
    ctx,
  });
  return selection.shown.find(usable) ?? null;
}

/* ─── Activity ──────────────────────────────────────────────────────────── */

/** Recorded events only, oldest first; an event with an unreadable time is left out rather than dated by guesswork. */
export function readableActivity(activity: readonly CorrectionActivity[] | undefined): (CorrectionActivity & { atMs: number })[] {
  return (activity ?? [])
    .flatMap((event) => {
      const atMs = parseMs(event.at);
      return atMs === null ? [] : [{ ...event, atMs }];
    })
    .sort((a, b) => a.atMs - b.atMs);
}
