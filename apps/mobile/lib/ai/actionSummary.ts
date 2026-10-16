import type { ActionPreview } from "@/lib/ai/drafts";
import { roomIsUnverified } from "@/lib/ai/drafts";

/* What the confirmation drawer and the preview card list for a proposed action: every field the
   person is about to commit, in the same order, so nothing important is hidden behind "Confirm". */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface SummaryRow {
  key: string;
  label: string;
  value: string;
  /** The room is shown but the server has not matched it to this hotel yet. */
  warn?: boolean;
}

export function summarizePreview(preview: ActionPreview, t: Translate): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const field = (name: string) => t(`copilot.action.fields.${name}`);
  const add = (key: string, label: string, value: string | null | undefined, warn = false) => {
    const clean = (value ?? "").trim();
    if (clean) rows.push({ key, label, value: clean, warn });
  };

  add("action", t("assistant.confirm.action"), t(`copilot.action.kind.${preview.kind}`));
  add("room", field("room"), preview.draft.roomNumber, roomIsUnverified(preview.draft));
  switch (preview.kind) {
    case "task":
      add("title", field("title"), preview.draft.title);
      add("priority", field("priority"), t(`copilot.action.priority.${preview.draft.priority}`));
      break;
    case "work_order":
      add("title", t("assistant.confirm.issue"), preview.draft.title);
      add("place", field("place"), preview.draft.locationText);
      add("category", field("category"), t(`copilot.action.workOrderCategory.${preview.draft.category}`));
      add("priority", field("priority"), t(`copilot.action.priority.${preview.draft.priority}`));
      break;
    case "guest_request":
      add("title", t("assistant.confirm.request"), preview.draft.title);
      add("guest", field("guestName"), preview.draft.guestName);
      add("category", field("category"), t(`copilot.action.guestCategory.${preview.draft.category}`));
      add("priority", field("priority"), t(`copilot.action.priority.${preview.draft.priority}`));
      break;
  }
  add("details", field("details"), preview.draft.description);
  return rows;
}
