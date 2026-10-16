import type { ShiftRecap } from "@/lib/ai/shiftRecap";
import { formatShiftDate } from "@/lib/housekeeping/hotelTime";
import type { Translate } from "@/lib/housekeeping/myRoomsText";
import { describeReviewItem, type ReviewItem } from "@/lib/housekeeping/shiftReview";
import type { ShiftSummary } from "@/lib/housekeeping/shiftSummary";

/**
 * The handoff summary a housekeeper can send on to the next person or a supervisor. It is assembled only
 * from the open items the shift summary already derived from recorded data (rooms still to clean, rooms
 * held by a documented exception, rooms with an open work order). Items that were resolved are not in those
 * lists, so they are not here; nothing is invented, and no guest details are included (room numbers and
 * the kind of condition only). It is plain text for the phone's share sheet: nothing is posted, sent or
 * saved by the app, and the person picks who receives it.
 */

export interface HandoffInput {
  summary: ShiftSummary;
  language: string;
  t: Translate;
  /** The AI's note about open items, only when the person already asked for a recap. Always labelled. */
  recap?: ShiftRecap | null;
}

export interface HandoffSection {
  /** Locale key suffix: toClean | exceptions | maintenance */
  id: "toClean" | "exceptions" | "maintenance";
  lines: string[];
}

export function handoffSections(summary: ShiftSummary, t: Translate): HandoffSection[] {
  const lineOf = (item: ReviewItem) => describeReviewItem(item, t).title;
  const sections: HandoffSection[] = [
    { id: "toClean", lines: summary.leftOpen.map(lineOf) },
    { id: "exceptions", lines: summary.exceptions.map(lineOf) },
    { id: "maintenance", lines: summary.handoffs.map(lineOf) },
  ];
  return sections.filter((section) => section.lines.length > 0);
}

export function handoffItemCount(summary: ShiftSummary): number {
  return summary.leftOpen.length + summary.exceptions.length + summary.handoffs.length;
}

/** The text to share, or null when nothing is open (a handoff is never padded to look busy). */
export function buildHandoffText({ summary, language, t, recap }: HandoffInput): string | null {
  const sections = handoffSections(summary, t);
  if (sections.length === 0) return null;

  const date = formatShiftDate(summary.shiftDate, language);
  const out: string[] = [t("home.handoff.heading", { date: date ?? summary.shiftDate })];
  for (const section of sections) {
    out.push("", t(`home.handoff.sections.${section.id}`));
    for (const line of section.lines) out.push(`- ${line}`);
  }
  if (summary.sync.pending + summary.sync.failed + summary.sync.conflicts > 0 || !summary.sync.verified) {
    out.push("", t("home.handoff.unsynced"));
  }
  if (recap?.note) out.push("", `${t("home.handoff.aiNoteLabel")} ${recap.note}`);
  out.push("", t("home.handoff.footer"));
  return out.join("\n");
}
