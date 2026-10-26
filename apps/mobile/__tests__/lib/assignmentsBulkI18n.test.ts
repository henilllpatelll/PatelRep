import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { makeTranslator } from "../helpers/i18n";

type Tree = { [key: string]: string | Tree };

const flatten = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
const bulk = (lang: unknown) => (lang as { assignments: { v2: { bulk: Tree } } }).assignments.v2.bulk;
const dig = (tree: Tree, path: string): string | undefined => path.split(".").reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree) as string | undefined;

const enKeys = new Set(flatten(bulk(en)));
const esKeys = new Set(flatten(bulk(es)));

const root = resolve(__dirname, "../..");
const sources = [
  "app/(app)/assignments/index.tsx",
  "lib/housekeeping/assignmentBulkView.ts",
  "lib/housekeeping/useBulkAssignment.ts",
  ...readdirSync(resolve(root, "components/supervisor/assignments"))
    .filter((file) => /^(Bulk|Selectable|Draft)/.test(file) || file === "TeamStaffCard.tsx")
    .map((file) => `components/supervisor/assignments/${file}`),
];

describe("bulk assignment strings", () => {
  it("English and Spanish carry exactly the same keys", () => {
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it("every literal assignments.v2.bulk key the code asks for exists in both languages", () => {
    const missing: string[] = [];
    for (const file of sources) {
      const code = readFileSync(resolve(root, file), "utf8");
      for (const match of code.matchAll(/["'`](assignments\.v2\.bulk\.[A-Za-z0-9_.]+)["'`]/g)) {
        const key = match[1].replace(/^assignments\.v2\.bulk\./, "");
        for (const [name, keys] of [["en", enKeys], ["es", esKeys]] as const) {
          if (!keys.has(key) && !keys.has(`${key}_plural`)) missing.push(`${file}: ${match[1]} (${name})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each([
    ["review.problem", ["scope_changed", "board_unavailable", "room_missing", "not_assignable", "assignee_changed", "already_assigned", "employee_unknown", "soft_blocked"]],
    ["review.blocked", ["empty", "scope", "board", "problems", "acknowledgements", "too_many", "unsendable"]],
    ["review.exclusionReason", ["board_unavailable", "room_missing", "room_blocked", "nothing_to_remove", "needs_acknowledgement", "employee_unknown", "employee_unverifiable", "already_assigned_to_employee", "no_longer_eligible", "over_limit"]],
    ["review.kind", ["assign", "reassign", "remove"]],
    ["committed", ["assign", "reassign", "remove", "confirmed", "people"]],
    ["rejected.reason", ["invalid_request", "forbidden", "date_changed", "operation_reused", "database", "session", "unavailable"]],
    ["unknown", ["checking", "failed", "not_found", "unreadable"]],
    ["allocate.mode", ["single", "singleHint", "distribute", "distributeHint"]],
    ["review.paused", ["offline", "not_live"]],
  ])("every %s variant is worded in both languages", (group, names) => {
    for (const name of names) {
      expect(dig(bulk(en), `${group}.${name}`) ?? dig(bulk(en), `${group}.${name}_plural`)).toBeTruthy();
      expect(dig(bulk(es), `${group}.${name}`) ?? dig(bulk(es), `${group}.${name}_plural`)).toBeTruthy();
    }
  });

  it("every validation id has a sentence for every state, in both languages", () => {
    for (const id of ["rooms_eligible", "staff_verified", "ownership_unchanged", "capacity_rules"]) {
      for (const state of ["pass", "fail", "attention", "unknown"]) {
        expect(dig(bulk(en), `review.validation.${id}.${state}`)).toBeTruthy();
        expect(dig(bulk(es), `review.validation.${id}.${state}`)).toBeTruthy();
      }
    }
  });

  it("resolves plurals the way the app's i18next does (key / key_plural), in both languages", () => {
    for (const lang of ["en", "es"] as const) {
      const t = makeTranslator(lang);
      const one = t("assignments.v2.bulk.review.title", { count: 1 });
      const many = t("assignments.v2.bulk.review.title", { count: 4 });
      expect(one).not.toBe("assignments.v2.bulk.review.title");
      expect(one).toContain("1");
      expect(many).toContain("4");
      expect(one).not.toBe(many.replace("4", "1"));
      expect(t("assignments.v2.bulk.committed.confirmed", { count: 6 })).toContain("6");
      expect(t("assignments.v2.bulk.indicator.changes", { count: 1 })).not.toBe(t("assignments.v2.bulk.indicator.changes", { count: 2 }).replace("2", "1"));
    }
  });

  it("no placeholder is lost in translation", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
    const broken: string[] = [];
    for (const key of enKeys) {
      const english = dig(bulk(en), key) ?? "";
      const spanish = dig(bulk(es), key) ?? "";
      if (JSON.stringify(placeholders(english)) !== JSON.stringify(placeholders(spanish))) broken.push(key);
    }
    expect(broken).toEqual([]);
  });

  it("no sentence is left untranslated", () => {
    const same = [...enKeys].filter((key) => {
      const english = dig(bulk(en), key) ?? "";
      return english.split(" ").length > 3 && english === dig(bulk(es), key);
    });
    expect(same).toEqual([]);
  });

  it("uses the app's terms: camarera / habitación, never 'housekeeper' or 'room' in Spanish", () => {
    // Placeholders such as {{room}} are variable names, not words.
    const offending = [...esKeys].filter((key) => /\b(housekeepers?|rooms?)\b/i.test((dig(bulk(es), key) ?? "").replace(/\{\{\w+\}\}/g, "")));
    expect(offending).toEqual([]);
  });
});
