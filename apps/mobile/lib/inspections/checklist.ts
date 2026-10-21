import type { AnswerMap, ChecklistItem, ChecklistTemplate } from "@/lib/inspections/types";

/* ─── Checklist structure and progress (pure) ───────────────────────────────
   Sections appear in the order the hotel configured them: a section is positioned by its first item in configured
   order, and items keep their configured order inside it. Nothing is alphabetised or regrouped. */

export interface ChecklistSection {
  name: string;
  items: ChecklistItem[];
}

export function groupSections(template: Pick<ChecklistTemplate, "items">): ChecklistSection[] {
  const sections: ChecklistSection[] = [];
  const byName = new Map<string, ChecklistSection>();
  for (const item of template.items) {
    let section = byName.get(item.section);
    if (!section) {
      section = { name: item.section, items: [] };
      byName.set(item.section, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

export interface ChecklistProgress {
  total: number;
  answered: number;
  requiredTotal: number;
  requiredAnswered: number;
  /** Whole percent of REQUIRED items answered; 100 for a checklist with no required items. */
  requiredPercent: number;
  /** Every required item has an answer. This alone does not make the inspection submittable. */
  requiredComplete: boolean;
}

/** Progress counts only answers that belong to this checklist, so a stale answer can never inflate it. */
export function checklistProgress(template: Pick<ChecklistTemplate, "items">, answers: AnswerMap): ChecklistProgress {
  let answered = 0;
  let requiredTotal = 0;
  let requiredAnswered = 0;
  for (const item of template.items) {
    const has = answers[item.id] !== undefined;
    if (has) answered += 1;
    if (item.isRequired) {
      requiredTotal += 1;
      if (has) requiredAnswered += 1;
    }
  }
  return {
    total: template.items.length,
    answered,
    requiredTotal,
    requiredAnswered,
    requiredPercent: requiredTotal === 0 ? 100 : Math.floor((requiredAnswered / requiredTotal) * 100),
    requiredComplete: requiredAnswered === requiredTotal,
  };
}

/** Required items still waiting for an answer, in configured order. */
export function unansweredRequired(template: Pick<ChecklistTemplate, "items">, answers: AnswerMap): ChecklistItem[] {
  return template.items.filter((item) => item.isRequired && answers[item.id] === undefined);
}

/** The first required item still unanswered — where "Continue" should take the supervisor. */
export function firstUnansweredRequired(template: Pick<ChecklistTemplate, "items">, answers: AnswerMap): ChecklistItem | null {
  return unansweredRequired(template, answers)[0] ?? null;
}

/** Answers that no longer belong to the checklist (an item was removed) are dropped before anything is sent. */
export function pruneAnswers(template: Pick<ChecklistTemplate, "items">, answers: AnswerMap): AnswerMap {
  const known = new Set(template.items.map((item) => item.id));
  return Object.fromEntries(Object.entries(answers).filter(([id, answer]) => known.has(id) && answer !== undefined));
}
