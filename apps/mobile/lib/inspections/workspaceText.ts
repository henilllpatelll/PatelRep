import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { ChecklistProgress } from "@/lib/inspections/checklist";
import type { QueueItem } from "@/lib/inspections/queue";
import { cleanKindOf } from "@/lib/inspections/queueView";
import type { ChecklistTemplate } from "@/lib/inspections/types";
import type { SaveState } from "@/lib/inspections/useDraftWriter";
import type { Translate } from "@/lib/inspections/viewText";

/* ─── Words for the active inspection (pure) ────────────────────────────────
   Built from facts the queue and the checklist actually carry. A fact that is not recorded is left out — never
   replaced by a stand-in name, room type, time or estimate. */

export interface RoomFacts {
  room: string;
  reinspection: boolean;
  /** "Standard King · Departure · Floor 2" — only the parts that are recorded. */
  details: string | null;
  /** "Cleaned by Maria S. · 11:42 AM" — only the parts that are recorded. */
  cleaned: string | null;
  checklist: string | null;
  /** How many items failed the inspection being re-checked. */
  recheckCount: number;
}

export function roomFacts(item: QueueItem, template: Pick<ChecklistTemplate, "name">, ctx: { timeZone: string | null | undefined; language: string }, t: Translate): RoomFacts {
  const kind = cleanKindOf(item.cleanType);
  const parts = [
    item.roomTypeName,
    kind ? t(`inspect.card.clean.${kind}`) : null,
    item.floor !== null ? t("inspect.workspace.floor", { floor: item.floor }) : null,
    item.building ? t("inspect.workspace.building", { building: item.building }) : null,
  ].filter((part): part is string => Boolean(part));

  const time = item.cleanedAtMs !== null ? formatHotelTime(new Date(item.cleanedAtMs), ctx.timeZone, ctx.language) : null;
  const who = item.cleanedBy.trim() || null;
  const cleaned = who && time ? t("inspect.workspace.cleanedByAt", { name: who, time }) : who ? t("inspect.workspace.cleanedBy", { name: who }) : time ? t("inspect.workspace.cleanedAt", { time }) : null;

  return {
    room: item.roomNumber,
    reinspection: item.reinspection.isReinspection,
    details: parts.length > 0 ? parts.join(" · ") : null,
    cleaned,
    checklist: template.name ? t("inspect.workspace.checklist", { name: template.name }) : null,
    recheckCount: item.reinspection.failedItems.length,
  };
}

export interface ProgressText {
  /** "7 of 12" */
  fraction: string;
  /** "5 required items left" / "All required items reviewed" */
  remaining: string;
  /** "1 issue found" / "No issues so far" */
  issues: string;
  /** Whole percent of ALL items reviewed — completion only, never a result. */
  percent: number;
  a11y: string;
}

export function progressText(progress: ChecklistProgress, failed: number, t: Translate): ProgressText {
  const requiredLeft = progress.requiredTotal - progress.requiredAnswered;
  const fraction = t("inspect.workspace.progress.fraction", { answered: progress.answered, total: progress.total });
  const remaining = requiredLeft > 0 ? t("inspect.workspace.progress.requiredLeft", { count: requiredLeft }) : t("inspect.workspace.progress.requiredDone");
  const issues = failed > 0 ? t("inspect.workspace.progress.issues", { count: failed }) : t("inspect.workspace.progress.noIssues");
  return {
    fraction,
    remaining,
    issues,
    percent: progress.total === 0 ? 0 : Math.round((progress.answered / progress.total) * 100),
    a11y: t("inspect.workspace.progress.a11y", { fraction, remaining, issues }),
  };
}

export type SaveTone = "ok" | "busy" | "warn" | "muted";

/** What the footer says about the draft. "Saved" only ever follows a completed write. */
export function saveText(
  save: SaveState,
  /** When the draft on the phone was last written, if one was loaded from it and nothing has changed since. */
  storedAt: number | null,
  ctx: { timeZone: string | null | undefined; language: string },
  t: Translate,
): { text: string; tone: SaveTone } {
  switch (save.status) {
    case "saved": {
      const time = formatHotelTime(new Date(save.at), ctx.timeZone, ctx.language);
      return { text: time ? t("inspect.workspace.save.saved", { time }) : t("inspect.workspace.save.savedNoTime"), tone: "ok" };
    }
    case "saving":
    case "pending":
      return { text: t("inspect.workspace.save.saving"), tone: "busy" };
    case "failed":
      return { text: t("inspect.workspace.save.failed"), tone: "warn" };
    case "idle": {
      if (storedAt === null) return { text: t("inspect.workspace.save.none"), tone: "muted" };
      const time = formatHotelTime(new Date(storedAt), ctx.timeZone, ctx.language);
      return { text: time ? t("inspect.workspace.save.saved", { time }) : t("inspect.workspace.save.savedNoTime"), tone: "ok" };
    }
  }
}

/** The single line that names what a leave prompt or resume sheet is about. */
export function reviewedLine(answered: number, total: number, t: Translate): string {
  return t("inspect.workspace.progress.reviewedOf", { answered, total });
}
