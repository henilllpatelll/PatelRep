import type { SOPDocument } from "@/lib/api/sop";
import { fold } from "@/lib/sop/library";

/* ─── Which of the hotel's own procedures belong next to a task or a room ───
   A plain keyword match between what the task says and the titles/categories of
   procedures the hotel really has (the list the server already filtered to
   current, readable documents). No model, no network, nothing invented: when the
   hotel has no matching procedure, nothing is offered. */

interface Topic {
  id: string;
  /** Words in the task / room text that point at this topic. */
  when: RegExp;
  /** Words in a procedure's title or category that answer it. */
  doc: RegExp;
}

const TOPICS: Topic[] = [
  {
    id: "lostFound",
    when: /\b(lost|found|left behind|forgot|forgotten|property|belongings|wallet|phone|jewelry|perdid\w*|olvid\w*|objeto\w*|encontrad\w*)\b/,
    doc: /\b(lost|found|property|belongings|perdid\w*|objeto\w*)\b/,
  },
  {
    id: "maintenance",
    when: /\b(leak\w*|broken|repair\w*|maintenance|not working|hvac|plumb\w*|electric\w*|damage\w*|clog\w*|flood\w*|roto|fuga\w*|repar\w*|mantenimiento|dano\w*)\b/,
    doc: /\b(maintenance|repair\w*|report\w*|issue\w*|damage\w*|mantenimiento|reporte\w*|dano\w*)\b/,
  },
  {
    id: "cleaning",
    when: /\b(clean\w*|vacuum\w*|dirty|turndown|linen\w*|sheets?|trash|bathroom|departure|stayover|limp\w*|sabana\w*|basura|bano|salida)\b/,
    // Titles that are about cleaning itself; the broad "Housekeeping" category would match every procedure.
    doc: /\b(clean\w*|departure|stayover|turndown|limp\w*)\b/,
  },
  {
    id: "dnd",
    when: /\b(dnd|do not disturb|no molestar)\b/,
    doc: /\b(dnd|disturb\w*|molestar|entry|access)\b/,
  },
  {
    id: "supplies",
    when: /\b(towels?|amenit\w*|supplies|restock\w*|toallas?|suministros?)\b/,
    doc: /\b(supply|supplies|amenit\w*|inventory|restock\w*|suministros?|inventario)\b/,
  },
];

/** At most `limit` of the hotel's procedures that match the text, best-matching topic first. */
export function relatedProcedures(texts: Array<string | null | undefined>, docs: SOPDocument[], limit = 2): SOPDocument[] {
  const text = fold(texts.filter(Boolean).join(" "));
  if (!text || docs.length === 0) return [];
  const picked: SOPDocument[] = [];
  for (const topic of TOPICS) {
    if (!topic.when.test(text)) continue;
    for (const doc of docs) {
      if (picked.some((p) => p.id === doc.id)) continue;
      if (topic.doc.test(fold(`${doc.title} ${doc.category ?? ""}`))) picked.push(doc);
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
}
