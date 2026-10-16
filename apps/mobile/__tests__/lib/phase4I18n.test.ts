import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/**
 * Phase 4 (tasks, maintenance and photo assistance) must read in English AND Spanish: the same keys under every
 * namespace it added to, the same {{placeholders}} in both, real Spanish rather than copied English, and every key
 * the new screens ask for (including the families built at run time) present in both files.
 */

type Tree = { [key: string]: string | Tree };
const root = (tree: unknown, path: string): Tree => path.split(".").reduce<unknown>((node, part) => (node as Tree)[part], tree) as Tree;

function leaves(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out[`${prefix}${key}`] = value;
    else Object.assign(out, leaves(value, `${prefix}${key}.`));
  }
  return out;
}
const has = (tree: unknown, path: string): boolean => {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
};
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

const NAMESPACES = [
  "tasks.hk.add.batch",
  "tasks.hk.add.error.submit",
  "tasks.hk.add.describe",
  "tasks.hk.quick",
  "tasks.hk.help",
  "reportIssue",
  "rooms.work.sheets.photo",
];

/** Words that are genuinely the same in both languages. */
const SAME_IN_BOTH = new Set(["photoAi.answer.no"]);

describe.each(NAMESPACES)("%s", (namespace) => {
  const english = leaves(root(en, namespace));
  const spanish = leaves(root(es, namespace));

  it("has identical keys in English and Spanish", () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
  });

  it("keeps the same {{placeholders}} in both languages", () => {
    const mismatched = Object.keys(english).filter((key) => JSON.stringify(placeholders(english[key])) !== JSON.stringify(placeholders(spanish[key] ?? "")));
    expect(mismatched).toEqual([]);
  });

  it("is really translated, not copied English", () => {
    // Only what Phase 4 added: older keys in the same namespaces may legitimately repeat a word or a brand name.
    const added = namespace === "reportIssue" ? /^(ai|photoAi|review|voice)\.|^(whatHappened|roomVerifiedTag)$/ : /^/;
    const isNew = ["tasks.hk.add.batch", "tasks.hk.quick", "tasks.hk.help", "reportIssue"].includes(namespace);
    const copied = isNew ? Object.keys(english).filter((key) => added.test(key) && english[key] === spanish[key] && !SAME_IN_BOTH.has(key)) : [];
    expect(copied).toEqual([]);
  });
});

const FILES = [
  "components/tasks/AddTaskSheet.tsx",
  "components/tasks/QuickTaskCard.tsx",
  "components/tasks/TaskHelpCard.tsx",
  "components/tasks/addTask/BatchReview.tsx",
  "components/housekeeping/ReportIssueModal.tsx",
  "components/housekeeping/roomDetail/ReportAssist.tsx",
  "components/housekeeping/roomDetail/PhotoAttachment.tsx",
  "components/ai/ConfirmRows.tsx",
];

describe("every key the Phase 4 screens ask for exists in both languages", () => {
  const ROOT = resolve(__dirname, "../..");
  it("literal keys", () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      const keys = new Set<string>();
      for (const match of source.matchAll(/\bt\(\s*(?:[^"'`()]*\?\s*)?["']([a-zA-Z0-9_.]+)["']/g)) keys.add(match[1]);
      for (const match of source.matchAll(/:\s*["']((?:tasks|reportIssue|rooms|assistant|copilot|common)\.[a-zA-Z0-9_.]+)["']/g)) keys.add(match[1]);
      for (const key of keys) {
        const ok = (tree: unknown) => has(tree, key) || has(tree, `${key}_plural`);
        if (!ok(en) || !ok(es)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the explanation sentence for every explain id", () => {
    const all = [
      "what", "whereRoom", "wherePlace", "whereNone", "whenSet", "whenOverdue", "whenNone", "priorityUrgent", "priorityNormal", "priorityLow",
      "statusAvailable", "statusMineOpen", "statusMineStarted", "statusOther", "statusTeammate", "statusUnassigned", "statusCompleted", "statusCancelled",
      "blocked", "details", "detailsNone",
    ];
    const missing = all.filter((id) => !has(en, `tasks.hk.help.explain_${id}`) || !has(es, `tasks.hk.help.explain_${id}`));
    expect(missing).toEqual([]);
    // ...and nothing orphaned: every explain_ key is a known id.
    const keys = Object.keys(root(en, "tasks.hk.help")).filter((key) => key.startsWith("explain_")).map((key) => key.slice("explain_".length));
    expect(keys.sort()).toEqual([...all].sort());
  });

  it("every batch problem, halt and submit-problem kind", () => {
    for (const kind of ["invalid", "rejected", "forbidden", "signedOut", "unconfirmed", "offline"]) {
      expect(has(en, `tasks.hk.add.batch.problem.${kind}`) && has(es, `tasks.hk.add.batch.problem.${kind}`)).toBe(true);
    }
    for (const halt of ["signedOut", "offline", "unconfirmed"]) {
      expect(has(en, `tasks.hk.add.batch.halted.${halt}`) && has(es, `tasks.hk.add.batch.halted.${halt}`)).toBe(true);
    }
    for (const kind of ["rejected", "forbidden", "signedOut", "unconfirmed", "offline"]) {
      expect(has(en, `tasks.hk.add.error.submit.${kind}`) && has(es, `tasks.hk.add.error.submit.${kind}`)).toBe(true);
    }
  });

  it("every AI failure message the Report Issue form can show", () => {
    for (const scope of ["ai", "photoAi"]) {
      for (const kind of ["offline", "credit_limit", "rate_limited", "invalid_request", "unauthenticated", "unavailable"]) {
        expect(has(en, `reportIssue.${scope}.failed.${kind}`) && has(es, `reportIssue.${scope}.failed.${kind}`)).toBe(true);
      }
    }
    for (const field of ["title", "category", "priority", "details"]) {
      expect(has(en, `reportIssue.ai.field.${field}`) && has(es, `reportIssue.ai.field.${field}`)).toBe(true);
    }
    for (const status of ["pending", "uploaded", "failed"]) {
      expect(has(en, `rooms.work.sheets.photo.status.${status}`) && has(es, `rooms.work.sheets.photo.status.${status}`)).toBe(true);
    }
  });

  it("a plural form exists wherever the batch UI counts tasks", () => {
    for (const key of ["found", "create", "retry", "successCount"]) {
      for (const tree of [en, es]) {
        expect(has(tree, `tasks.hk.add.batch.${key}`) && has(tree, `tasks.hk.add.batch.${key}_plural`)).toBe(true);
      }
    }
  });
});
