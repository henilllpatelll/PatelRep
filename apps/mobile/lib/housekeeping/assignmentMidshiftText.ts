import { minutesLine } from "@/lib/housekeeping/assignmentBulkView";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import {
  recoveryAction,
  type LeftOutReason,
  type MidshiftReason,
  type MidshiftRoom,
  type MidshiftSource,
  type RecoveryAttention,
  type RoomChange,
  type SeenChanges,
} from "@/lib/housekeeping/assignmentMidshift";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { Attendance } from "@/lib/housekeeping/assignmentStaff";
import type { MidshiftController, MidshiftNote, MidshiftPause } from "@/lib/housekeeping/useMidshiftRecovery";

/* ─── Midshift recovery — the words ──────────────────────────────────────────
   Pure text and small view models for the staff drawer, the redistribution sheet and the draft-review banner. Every
   sentence states a verified fact or a plain next step; a person without a usable name is "this housekeeper", never a
   guessed name, and nothing here uses a gendered pronoun. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = "assignments.v2.midshift";

export const nameOrFallback = (name: string | null, t: Translate): string => name ?? t("assignments.v2.assign.unnamed");

export function reasonLabel(reason: MidshiftReason, t: Translate): string {
  return t(`${K}.reason.${reason}`);
}

export function blockLabel(block: SoftBlock, t: Translate): string {
  return t(`${K}.block.${block}`);
}

/** Why a room stays where it is. The in-progress sentence is the operational one: verify before transferring responsibility. */
export function protectedWhy(room: MidshiftRoom, name: string, t: Translate): string {
  switch (room.class.kind) {
    case "in_progress":
      return t(`${K}.protected.in_progress`);
    case "completed":
      return t(`${K}.protected.${room.class.stage}`);
    case "held":
      return t(`${K}.protected.held`, { blocks: room.class.blocks.map((block) => blockLabel(block, t)).join(", ") });
    case "unavailable":
      return t(`${K}.protected.unavailable`);
    case "unknown":
      return t(`${K}.protected.unknown`);
    case "eligible":
      return t(`${K}.eligibleTag`, { name });
  }
}

/** True when the explanation should offer the Room Board (a started room: verify its real status there). */
export const offersRoomBoard = (room: MidshiftRoom): boolean => room.class.kind === "in_progress";

export function attentionText(attention: RecoveryAttention, name: string, t: Translate): string | null {
  return attention ? t(`${K}.attention.${attention}`, { name }) : null;
}

const CHANGE_KEY: Record<RoomChange, string> = {
  reassigned: "reassigned",
  started: "started",
  completed: "completed",
  held: "held",
  gone: "gone",
  other: "other",
};

export function changeText(change: SeenChanges["rooms"][number], t: Translate): string {
  return t(`${K}.changed.room.${CHANGE_KEY[change.change]}`, { room: change.roomNumber });
}

export function destinationChangeText(change: SeenChanges["destinations"][number], name: string, t: Translate): string {
  return t(`${K}.changed.destination`, { name, from: t(`assignments.v2.assign.attendance.${change.from}`), to: t(`assignments.v2.assign.attendance.${change.to}`) });
}

export function leftOutText(reason: LeftOutReason, t: Translate): string {
  if (reason === "insufficient_capacity" || reason === "no_eligible_staff") return t(`${K}.leftOut.${reason}`);
  return t(`assignments.v2.bulk.review.exclusionReason.${reason}`);
}

export function blockedText(blocked: NonNullable<MidshiftController["blocked"]>, paused: MidshiftPause, t: Translate): string {
  if (blocked === "paused") return t(`${K}.paused.${paused ?? "offline"}`);
  return t(`${K}.blocked.${blocked}`);
}

/** The line the draft review shows above its changes: where they came from, and the supervisor's reason if they gave one. */
export function noteText(note: MidshiftNote, t: Translate): { title: string; reason: string | null } {
  const names = note.sourceNames.map((name) => nameOrFallback(name, t)).join(", ");
  return { title: t(`${K}.note.title`, { count: note.count, names }), reason: note.reason ? t(`${K}.note.reason`, { reason: reasonLabel(note.reason, t) }) : null };
}

/* ─── The staff drawer ────────────────────────────────────────────────────── */

export interface RecoveryPanel {
  /** The button can be pressed. */
  enabled: boolean;
  /** Draw the button as the main action (the shift ended, or the person is not clocked in). */
  prominent: boolean;
  /** The verified reason this person may need help, or null. */
  attention: string | null;
  /** "6 rooms can move · 170 min estimated" */
  movable: string | null;
  /** "3 stay with Ana: 2 completed · 1 in progress" */
  staying: string | null;
  /** Held-back rooms, when there are any. */
  held: string | null;
  /** Why the action cannot be used right now (nothing to move, or changes paused). */
  disabledReason: string | null;
}

function stayingLine(source: MidshiftSource, name: string, t: Translate): string | null {
  const { counts } = source;
  const parts = [
    counts.completed > 0 ? t(`${K}.counts.completed`, { count: counts.completed }) : null,
    counts.inProgress > 0 ? t(`${K}.counts.inProgress`, { count: counts.inProgress }) : null,
  ].filter((part): part is string => part !== null);
  return counts.protectedRooms > 0 ? t(`${K}.drawer.staying`, { count: counts.protectedRooms, name, detail: parts.join(" · ") }) : null;
}

/** What the staff drawer shows about recovery for one person. Never null while the person is on the board. */
export function buildRecoveryPanel(model: AssignmentsModel, userId: string, paused: MidshiftPause, t: Translate): RecoveryPanel | null {
  const action = recoveryAction(model, userId);
  const source = action.source;
  if (!source) return { enabled: false, prominent: false, attention: null, movable: null, staying: null, held: null, disabledReason: t(`${K}.unavailable.board_unavailable`) };
  const name = nameOrFallback(source.name, t);
  const attention = attentionText(source.attention, name, t);
  const prominent = source.attention === "shift_ended" || source.attention === "not_clocked_in";
  const movable = source.counts.eligible > 0 ? t(`${K}.drawer.movable`, { count: source.counts.eligible, value: minutesLine(source.eligibleMinutes, t) }) : null;
  const held = source.counts.held > 0 ? t(`${K}.drawer.held`, { count: source.counts.held }) : null;
  const staying = stayingLine(source, name, t);
  if (action.kind === "unavailable") {
    return { enabled: false, prominent: false, attention, movable, staying, held, disabledReason: t(`${K}.unavailable.${action.reason}`, { name }) };
  }
  return { enabled: paused === null, prominent, attention, movable, staying, held, disabledReason: paused ? t(`${K}.paused.${paused}`) : null };
}

/** "Maria Perez, Ben Ortiz" — the planned receivers of the available team, by name. */
export function receiversLine(names: (string | null)[], t: Translate): string {
  return names.map((name) => nameOrFallback(name, t)).join(", ");
}

export function attendanceOf(label: Attendance, t: Translate): string {
  return t(`assignments.v2.assign.attendance.${label}`);
}
