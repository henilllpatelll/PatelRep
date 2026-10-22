import { bulkEligibility } from "@/lib/housekeeping/assignmentBulk";
import type { AssignmentRoom } from "@/lib/housekeeping/assignmentModel";
import type { CardChip, RoomCardModel, Translate } from "@/lib/housekeeping/assignmentRoomsView";
import type { SelectionMinutes, ScopeGroup } from "@/lib/housekeeping/assignmentBulk";
import { minutesText } from "@/lib/housekeeping/assignmentFlowText";
import type { LoadView } from "@/lib/housekeeping/assignmentPicker";

/* ─── Supervisor Assignments — how selection mode reads ──────────────────────
   Pure. The strings and flags the selection list, bar and footer draw, so the rules ("a blocked room says why",
   "an unknown estimate is never zero") live in one tested place and the components only paint. */

export interface SelectionRowModel {
  roomId: string;
  roomNumber: string;
  selectable: boolean;
  selected: boolean;
  /** "Departure · 35 min" — only what is recorded. */
  detail: string | null;
  chips: CardChip[];
  location: string;
  /** Why the room cannot be selected, in words; null when it can. */
  reason: string | null;
  /** "In draft · Maria" when a proposed change already covers the room. */
  inDraft: string | null;
  a11yLabel: string;
  /** Everything the row draws, so a memoised row re-renders only when something visible changed. */
  signature: string;
}

export function buildSelectionRow(
  entry: AssignmentRoom,
  card: RoomCardModel,
  state: { selected: boolean; draftOwnerName: string | null | undefined },
  t: Translate,
): SelectionRowModel {
  const { selectable, exclusion } = bulkEligibility(entry);
  const reason = exclusion === null ? null : exclusion.kind === "assigned" ? (exclusion.ownerName ? t("assignments.v2.bulk.row.assignedTo", { name: exclusion.ownerName }) : t("assignments.v2.bulk.row.assigned")) : (card.blocker ?? t("assignments.v2.bulk.row.cannotSelect"));
  const inDraft = state.draftOwnerName === undefined ? null : t("assignments.v2.bulk.row.inDraft", { name: state.draftOwnerName ?? t("assignments.v2.assign.unnamed") });
  const stateText = !selectable ? t("assignments.v2.bulk.row.unavailable") : state.selected ? t("assignments.v2.bulk.row.selected") : t("assignments.v2.bulk.row.notSelected");
  const spoken = [t("assignments.v2.card.roomLabel", { room: entry.room.roomNumber }), card.statusLabel, card.location, card.detail, card.chips.map((chip) => chip.label).join(", "), reason, inDraft, stateText]
    .filter((part): part is string => Boolean(part))
    .join(". ");
  return {
    roomId: entry.room.roomId,
    roomNumber: entry.room.roomNumber,
    selectable,
    selected: state.selected && selectable,
    detail: card.detail,
    chips: card.chips,
    location: card.location,
    reason,
    inDraft,
    a11yLabel: spoken,
    signature: [card.signature, selectable, state.selected, reason, inDraft].join("|"),
  };
}

/* ─── Bar and footer ──────────────────────────────────────────────────────── */

/** "120 min estimated" / "At least 120 min estimated" / "No estimate". */
export function minutesLine(minutes: SelectionMinutes, t: Translate): string {
  if (minutes.minutes === null) return t("assignments.v2.bulk.footer.noEstimate");
  return t(minutes.partial ? "assignments.v2.bulk.footer.minutesAtLeast" : "assignments.v2.bulk.footer.minutes", { minutes: minutes.minutes });
}

/** The label of a floor or building chip. */
export function scopeLabel(group: ScopeGroup, t: Translate): string {
  if (group.scope.kind === "building") return group.building ? t("assignments.v2.bulk.scope.building", { building: group.building }) : t("assignments.v2.bulk.scope.noBuilding");
  if (group.floor === null) return group.building ? t("assignments.v2.bulk.scope.buildingNoFloor", { building: group.building }) : t("assignments.v2.bulk.scope.noFloor");
  return group.building ? t("assignments.v2.bulk.scope.floorBuilding", { building: group.building, floor: group.floor }) : t("assignments.v2.bulk.scope.floor", { floor: group.floor });
}

/** Room numbers for the allocation drawer's "Selected work": the first few, then "+N more". */
export function roomNumbersLine(numbers: readonly string[], t: Translate, max = 12): string {
  if (numbers.length <= max) return numbers.join(", ");
  return `${numbers.slice(0, max).join(", ")} ${t("assignments.v2.bulk.allocate.more", { count: numbers.length - max })}`;
}

/** The Team card's line for a person the unpublished draft would change; the live figures are never replaced. */
export function proposedLoadLine(proposed: LoadView, t: Translate): string {
  return t("assignments.v2.bulk.team.proposed", { value: minutesText(proposed.minutes, t) });
}
