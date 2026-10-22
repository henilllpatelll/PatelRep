import type { InspectionTimeline, TimelineEvent, TimelineInspection } from "@/lib/api/inspectionHistory";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { Translate } from "@/lib/inspections/viewText";

/* ─── The correction timeline (pure) ────────────────────────────────────────
   The server rebuilt the chain from stored links and sent only events the database timestamped. This only words
   them. It never adds a step that has no event (a task nobody started has no "Work started" line), never reorders
   what the server ordered, and never rewrites a failed inspection as passed. */

export type TimelineTone = "neutral" | "bad" | "good" | "warn";

export interface TimelineLine {
  key: string;
  title: string;
  /** Who/what, in one sentence. Null when the record has nothing more to say. */
  detail: string | null;
  /** "12:04 PM", plus the date when the cycle spans days. */
  time: string;
  /** The inspection this line is about, when the supervisor can open it. */
  inspectionId: string | null;
  /** This line IS the inspection the supervisor is already looking at. */
  current: boolean;
  tone: TimelineTone;
}

const KNOWN: ReadonlySet<string> = new Set([
  "inspection_failed",
  "inspection_passed",
  "correction_created",
  "reassigned",
  "escalated",
  "work_started",
  "work_submitted",
  "task_completed",
  "reinspection_failed",
  "reinspection_passed",
]);

const INSPECTION_EVENTS: ReadonlySet<string> = new Set(["inspection_failed", "inspection_passed", "reinspection_failed", "reinspection_passed"]);

const TONES: Record<string, TimelineTone> = {
  inspection_failed: "bad",
  reinspection_failed: "bad",
  inspection_passed: "good",
  reinspection_passed: "good",
  escalated: "warn",
};

function actorOf(event: TimelineEvent): string | null {
  return event.actor_name?.trim() || null;
}

/** "Towels and amenities, Mirrors and 2 more" - what failed, from the inspection's own recorded items. */
export function failedSummary(inspection: TimelineInspection | undefined, t: Translate, limit = 2): string | null {
  if (!inspection || inspection.failed_items.length === 0) return null;
  const labels = inspection.failed_items.map((item) => item.description?.trim()).filter((label): label is string => Boolean(label));
  if (labels.length === 0) return t("inspect.history.timeline.failedCount", { count: inspection.failed_items.length });
  const shown = labels.slice(0, limit).join(", ");
  const rest = inspection.failed_items.length - Math.min(labels.length, limit);
  return rest > 0 ? t("inspect.history.timeline.andMore", { items: shown, count: rest }) : shown;
}

function join(parts: (string | null)[]): string | null {
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

export function buildTimelineLines(
  timeline: InspectionTimeline,
  options: { currentId: string; timeZone: string | null | undefined; language: string; t: Translate },
): TimelineLine[] {
  const { currentId, timeZone, language, t } = options;
  const byId = new Map(timeline.inspections.map((inspection) => [inspection.id, inspection] as const));
  const days = new Set(timeline.events.map((event) => event.at.slice(0, 10)));
  const spansDays = days.size > 1;
  const firstId = timeline.inspections.find((inspection) => !inspection.is_reinspection)?.id ?? null;

  const lines: TimelineLine[] = [];
  for (const event of timeline.events) {
    const at = new Date(event.at);
    if (!Number.isFinite(at.getTime())) continue; // an event with no readable time is left out, not dated by guesswork
    const clock = formatHotelTime(at, timeZone, language) ?? "";
    const date = spansDays ? at.toLocaleDateString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: timeZone ?? undefined }) : null;
    const inspection = event.inspection_id ? byId.get(event.inspection_id) : undefined;
    const actor = actorOf(event);
    const type = KNOWN.has(event.type) ? event.type : "other";
    const original = type === "inspection_failed" && event.inspection_id === firstId;
    const by = actor ? t("inspect.history.timeline.by", { name: actor }) : null;
    let detail: string | null = null;
    switch (type) {
      case "inspection_failed":
      case "reinspection_failed": {
        const what = failedSummary(inspection, t);
        detail = join([what ? t("inspect.history.timeline.failedBecause", { items: what }) : null, by]);
        break;
      }
      case "inspection_passed":
      case "reinspection_passed":
        detail = actor ? t("inspect.history.timeline.verifiedBy", { name: actor }) : null;
        break;
      case "reassigned": {
        const assignee = event.assignee_name?.trim();
        detail = join([assignee ? t("inspect.history.timeline.assignedTo", { name: assignee }) : null, by]);
        break;
      }
      case "work_started":
        detail = actor ? t("inspect.history.timeline.began", { name: actor }) : null;
        break;
      case "work_submitted":
        detail = join([by, t("inspect.history.timeline.readyToVerify")]);
        break;
      case "correction_created":
      case "escalated":
      case "task_completed":
        detail = by;
        break;
      default:
        detail = null;
    }
    // Only an event that IS an inspection links to it; a correction step belongs to the cycle, not to one record.
    const target = INSPECTION_EVENTS.has(type) && event.inspection_id && byId.has(event.inspection_id) ? event.inspection_id : null;
    lines.push({
      key: event.key,
      title: t(`inspect.history.timeline.event.${original ? "original" : type}`),
      detail,
      time: date ? `${date} · ${clock}` : clock,
      inspectionId: target,
      current: target !== null && target === currentId,
      tone: TONES[type] ?? "neutral",
    });
  }
  return lines;
}

/** Every inspection of the cycle, oldest first, for the "Related inspections" list. */
export interface RelatedInspection {
  id: string;
  result: string;
  completedAtMs: number | null;
  role: "initial" | "reinspection";
  current: boolean;
  inspector: string | null;
}

export function relatedInspections(timeline: InspectionTimeline, currentId: string): RelatedInspection[] {
  return timeline.inspections.map((inspection) => {
    const ms = inspection.completed_at ? Date.parse(inspection.completed_at) : NaN;
    return {
      id: inspection.id,
      result: inspection.overall_result,
      completedAtMs: Number.isFinite(ms) ? ms : null,
      role: inspection.is_reinspection ? "reinspection" : "initial",
      current: inspection.id === currentId,
      inspector: inspection.inspector_name?.trim() || null,
    };
  });
}
