import type { Attendance } from "@/lib/housekeeping/assignmentStaff";
import type { AssignAck, AssignCandidate, LoadView, MinutesView } from "@/lib/housekeeping/assignmentPicker";
import type { WorkloadWarning } from "@/lib/housekeeping/assignmentWorkload";

/* ─── Assignment flow — words for numbers ───────────────────────────────────
   Pure text builders shared by the picker card, the review and the removal confirmation, so the same figure is
   worded the same way everywhere and the wording rules live in one tested place:
   an unknown figure is never "0", a lower bound always says "at least", and a percentage appears only when the
   model produced one. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = "assignments.v2.assign";

/** "95 min", "At least 130 min", or the honest reason there is no figure. */
export function minutesText(view: MinutesView, t: Translate): string {
  if (view.minutes === null) return t(`${K}.load.noEstimate`);
  return t(view.partial ? `${K}.load.atLeast` : `${K}.load.minutes`, { minutes: view.minutes });
}

/** "2 estimates missing", or null when none are. */
export function missingText(view: MinutesView, t: Translate): string | null {
  return view.missing > 0 ? t(`${K}.load.estimatesMissing`, { count: view.missing }) : null;
}

/** "Capacity 62% → 81%", "Capacity 62%", or null when no reliable percentage exists. */
export function capacityText(before: LoadView, after: LoadView | null, t: Translate): string | null {
  if (after && before.percent !== null && after.percent !== null) return t(`${K}.load.capacityChange`, { from: before.percent, to: after.percent });
  const only = after ? after.percent : before.percent;
  return only === null ? null : t(`${K}.load.capacity`, { percent: only });
}

const WARNING_KEY: Record<WorkloadWarning, string | null> = {
  over_credit_target: "overCapacity",
  exceeds_shift_time: "overShift",
  exceeds_full_day: "fullDay",
  // Incomplete data is stated by the figures themselves ("at least", "N estimates missing").
  estimates_missing: null,
  credits_missing: null,
};

/** The sentence for a warning that is worth a line of its own; null for the data-incomplete ones. */
export function warningText(warning: WorkloadWarning, t: Translate): string | null {
  const key = WARNING_KEY[warning];
  return key ? t(`${K}.warning.${key}`) : null;
}

export function attendanceLabel(attendance: Attendance, t: Translate): string {
  return t(`${K}.attendance.${attendance}`);
}

/** The condition-specific sentence a supervisor ticks to accept `ack`. */
export function ackText(ack: AssignAck, name: string, t: Translate): string {
  return t(`${K}.ack.${ack}`, { name });
}

/** Whether the candidate deserves a "High load" tag: a real overload warning, before or after the room. */
export function isHighLoad(candidate: Pick<AssignCandidate, "current" | "after">): boolean {
  const warnings = [...candidate.current.warnings, ...(candidate.after?.warnings ?? [])];
  return warnings.includes("over_credit_target") || warnings.includes("exceeds_shift_time") || warnings.includes("exceeds_full_day");
}

/** One spoken sentence for a candidate, so a screen reader hears the same facts the card shows. */
export function candidateLabel(candidate: AssignCandidate, t: Translate): string {
  const name = candidate.name ?? t(`${K}.unnamed`);
  const parts: (string | null)[] = [
    name,
    candidate.suggested ? t(`${K}.candidate.suggested`) : null,
    candidate.isCurrentOwner ? t(`${K}.candidate.currentOwner`) : attendanceLabel(candidate.attendance, t),
    t(`${K}.candidate.currentRemaining`, { value: minutesText(candidate.current.minutes, t) }),
    candidate.after ? t(`${K}.candidate.afterAssignment`, { value: minutesText(candidate.after.minutes, t) }) : null,
    candidate.after ? missingText(candidate.after.minutes, t) : missingText(candidate.current.minutes, t),
    isHighLoad(candidate) ? t(`${K}.candidate.highLoad`) : null,
  ];
  return parts.filter(Boolean).join(". ");
}
