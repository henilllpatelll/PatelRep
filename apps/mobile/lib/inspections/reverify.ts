import type { ReadyRoom } from "@/lib/api/inspections";
import { judgeDraft, type DraftUnusable, type InspectionDraft } from "@/lib/inspections/draft";
import { buildQueue, type QueueItem } from "@/lib/inspections/queue";
import { normalizeTemplates, selectTemplate, type TemplateUnavailableReason } from "@/lib/inspections/templates";
import type { ChecklistTemplate } from "@/lib/inspections/types";
import { draftContext } from "@/lib/inspections/workspace";

/* ─── Is this stored draft still good for this room right now? ───────────────
   A draft can wait hours. Before it is offered back for resuming the room and its checklist are READ AGAIN from the
   server — not trusted from the list the screen opened with — and judged by the same rules as any draft. The server
   still re-checks everything on submission; this only keeps the supervisor from continuing work that cannot count. */

export interface ReverifyFetchers {
  queue: (date: string) => Promise<ReadyRoom[]>;
  templates: () => Promise<{ data: unknown }>;
}

export type Reverified =
  | { kind: "ok"; item: QueueItem; template: ChecklistTemplate }
  /** The room is no longer waiting for inspection. */
  | { kind: "not_awaiting" }
  /** Same room, but not the same inspection: another day, a new clean cycle, a different earlier failure. */
  | { kind: "unusable"; reason: DraftUnusable }
  /** Same inspection, but the checklist was edited; `template` is the one that applies now. */
  | { kind: "template_changed"; item: QueueItem; template: ChecklistTemplate }
  | { kind: "template_unavailable"; reason: TemplateUnavailableReason }
  /** The answers could not be read. Not knowing is not permission. */
  | { kind: "unavailable" };

export async function reverifyDraft(
  draft: InspectionDraft,
  who: { hotelId: string; userId: string; businessDate: string },
  fetchers: ReverifyFetchers,
): Promise<Reverified> {
  let rooms: ReadyRoom[];
  let rawTemplates: { data: unknown };
  try {
    [rooms, rawTemplates] = await Promise.all([fetchers.queue(who.businessDate), fetchers.templates()]);
  } catch {
    return { kind: "unavailable" };
  }
  const item = buildQueue(rooms).find((candidate) => candidate.roomId === draft.roomId);
  if (!item) return { kind: "not_awaiting" };

  const { templates, invalid } = normalizeTemplates(rawTemplates?.data);
  const selection = selectTemplate(templates, item.roomTypeId, { unreadable: invalid });
  if (!selection.ok) return { kind: "template_unavailable", reason: selection.reason };

  const verdict = judgeDraft(draft, draftContext({ ...who, item, template: selection.template }));
  if (verdict.usable) return { kind: "ok", item, template: selection.template };
  if (verdict.reason === "template_changed") return { kind: "template_changed", item, template: selection.template };
  return { kind: "unusable", reason: verdict.reason };
}
