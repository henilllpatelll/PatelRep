import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import type { RoomExclusion, SmartUnavailable, StaffExclusion } from "@/lib/housekeeping/smartBalancePool";
import type { LeftOutReason, SmartPlan, StaleReason } from "@/lib/housekeeping/smartBalancePlan";
import type { EditRefusal } from "@/lib/housekeeping/smartBalancePlan";
import type { ExplainLine, SmartPreview } from "@/lib/housekeeping/smartBalancePreview";
import type { GenerationFailure } from "@/lib/housekeeping/useSmartBalance";

/* ─── Smart Balance — words for the facts ───────────────────────────────────
   Pure text builders. Every sentence is chosen from a STRUCTURED fact (a code the planner or the app returned), never
   composed from a guess: an exclusion says the real block, a capacity statement exists only when the capacity source
   is known, an explanation exists only when the planner returned the fact behind it. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = "assignments.v2.smart";

export function blockedText(reason: SmartUnavailable, t: Translate): string {
  return t(`${K}.setup.blocked.${reason}`);
}

export function failureText(failure: GenerationFailure, t: Translate): string {
  return t(`${K}.setup.failed.${failure}`);
}

/** The title of an excluded room's row, and a second line when the exclusion is something the supervisor can act on. */
export function roomExclusionText(exclusion: RoomExclusion, t: Translate): { title: string; body: string | null } {
  switch (exclusion.kind) {
    case "soft_blocked": {
      const blocks: readonly SoftBlock[] = exclusion.blocks;
      return { title: blocks.map((block) => t(`${K}.exceptions.room.soft.${block}`)).join(" · "), body: t(`${K}.exceptions.softBody`) };
    }
    case "now_assigned":
      return { title: exclusion.ownerName ? t(`${K}.exceptions.room.now_assigned`, { name: exclusion.ownerName }) : t(`${K}.exceptions.room.now_assigned_unknown`), body: null };
    case "no_longer_plannable":
      return { title: t(`${K}.exceptions.room.no_longer_plannable`), body: null };
    case "server": {
      const blocks = (exclusion.blocks ?? []).filter((block): block is SoftBlock => ["service_declined", "return_later", "dnd", "occupancy_discrepancy"].includes(block));
      return {
        title: exclusion.reason === "room_blocked" && blocks.length > 0 ? blocks.map((block) => t(`${K}.exceptions.room.soft.${block}`)).join(" · ") : t(`${K}.exceptions.room.server.${exclusion.reason}`),
        body: exclusion.reason === "room_blocked" ? t(`${K}.exceptions.softBody`) : null,
      };
    }
  }
}

export function staffExclusionText(reason: StaffExclusion, t: Translate): string {
  return t(`${K}.exceptions.staff.${reason}`);
}

export function leftOutText(reason: LeftOutReason, t: Translate): string {
  return t(`${K}.exceptions.leftOut.${reason}`);
}

export function refusalText(refusal: EditRefusal, t: Translate): string {
  return t(`${K}.detail.refusal.${refusal}`);
}

export function staleText(reason: StaleReason, nameOf: (userId: string) => string, t: Translate): string {
  switch (reason.kind) {
    case "rooms_changed":
      return t(`${K}.preview.stale.reasons.rooms_changed`, { rooms: reason.roomNumbers.slice(0, 6).join(", ") + (reason.roomNumbers.length > 6 ? "…" : "") });
    case "staff_changed":
      return t(`${K}.preview.stale.reasons.staff_changed`, { names: reason.userIds.slice(0, 4).map(nameOf).join(", ") });
    default:
      return t(`${K}.preview.stale.reasons.${reason.kind}`);
  }
}

export function explainText(lines: readonly ExplainLine[], t: Translate): string[] {
  return lines.map((line) => t(`${K}.why.${line.key}`, line.params));
}

/** The "worth knowing" lines under the preview, in order of importance. Each exists only when its count is real. */
export function noteLines(preview: SmartPreview, plan: SmartPlan, t: Translate): string[] {
  const { counts } = preview;
  const lines: string[] = [];
  const add = (key: string, options: Record<string, unknown>, show: boolean) => {
    if (show) lines.push(t(`${K}.preview.notes.${key}`, options));
  };
  add("urgentUnallocated", { count: counts.urgentUnallocated }, counts.urgentUnallocated > 0);
  add("unallocated", { count: counts.unallocated }, counts.unallocated > 0);
  add("moved", { count: counts.moved }, counts.moved > 0);
  add("capacityWarning", { count: counts.capacityWarnings }, counts.capacityWarnings > 0);
  add("missingEstimates", { count: counts.missingEstimates }, counts.missingEstimates > 0);
  add("unplaceable", { count: preview.unplaceable.length }, preview.unplaceable.length > 0);
  add("takenOut", { count: counts.takenOut }, counts.takenOut > 0);
  add("edited", { count: counts.edited }, counts.edited > 0);
  add("preserved", { count: counts.preserved }, counts.preserved > 0);
  add("protected", { count: counts.protectedInProgress }, counts.protectedInProgress > 0);
  add("truncated", { count: plan.poolRoomIds.length }, plan.truncated > 0);
  for (const assumption of plan.assumptions) {
    if (assumption.code === "unknown_estimate_surrogate") lines.push(t(`${K}.preview.assumptions.unknown_estimate_surrogate`, { rooms: assumption.rooms, minutes: assumption.minutes }));
    else lines.push(t(`${K}.preview.assumptions.${assumption.code}`));
  }
  return lines;
}

/** "6 of 8 eligible rooms could be allocated", only when something eligible was left out. */
export function partialLine(preview: SmartPreview, t: Translate): string | null {
  const { counts } = preview;
  if (counts.unallocated === 0 || counts.eligible === 0) return null;
  return t(`${K}.preview.notes.partial`, { planned: counts.eligible - counts.unallocated, eligible: counts.eligible });
}

export function statusLine(plan: SmartPlan, preview: SmartPreview, t: Translate): { title: string; body: string | null } | null {
  switch (plan.status) {
    case "no_safe_plan":
      return { title: t(`${K}.preview.status.no_safe_plan`), body: t(`${K}.preview.status.no_safe_planBody`) };
    case "nothing_to_plan":
      return { title: t(`${K}.preview.status.nothing_to_plan`), body: null };
    case "no_staff":
      return { title: t(`${K}.preview.status.no_staff`), body: null };
    case "fallback":
      return { title: t(`${K}.preview.status.fallback`), body: null };
    default:
      return preview.counts.planned === 0 && preview.counts.preserved === 0 ? { title: t(`${K}.preview.status.empty`), body: null } : null;
  }
}
