import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/* The history, record and timeline screens ship in English and Spanish with parity: the same keys, the same
   placeholders, real Spanish, and no key the code asks for is missing. */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...all, [full]: value } : { ...all, ...leaves(value, full) };
  }, {});
}

const historyEn = leaves((en as unknown as { inspect: { history: Tree } }).inspect.history, "inspect.history");
const historyEs = leaves((es as unknown as { inspect: { history: Tree } }).inspect.history, "inspect.history");
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

/** Strings that are legitimately the same in both languages. */
const SAME_IN_BOTH = new Set([
  "inspect.history.period.range", // "{{from}} – {{to}}"
  "inspect.history.period.presetLabel", // "{{preset}} · {{range}}"
  "inspect.history.insights.atLeast", // "{{count}}+"
  "inspect.history.record.when", // "{{date}} · {{time}}"
  "inspect.history.record.sectionTally", // "{{passed}}/{{total}}"
  "inspect.history.record.answerA11y", // "{{item}}: {{result}}"
  "inspect.history.record.answer.na", // "N/A"
  "inspect.history.record.info.inspector", // "Inspector" in both
  "inspect.history.filter.inspector",
  "inspect.history.filter.inspectorChipUnknown",
  "inspect.history.filter.inspectorChip", // "Inspector: {{name}}"
  "inspect.history.insights.trendScale", // "0–100%" / "0–100 %"
]);

const ROOTS = ["components", "lib", "app"].map((dir) => path.join(__dirname, "../../../../", dir));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("history copy", () => {
  it("is a substantial set", () => {
    expect(Object.keys(historyEn).length).toBeGreaterThan(150);
  });

  it("has exactly the same keys in English and Spanish", () => {
    expect(Object.keys(historyEs).sort()).toEqual(Object.keys(historyEn).sort());
  });

  it.each(Object.keys(historyEn))("%s: same placeholders in both languages", (key) => {
    expect(placeholders(historyEs[key])).toEqual(placeholders(historyEn[key]));
  });

  it("the Spanish is Spanish: it differs from the English wherever it should", () => {
    const copied = Object.keys(historyEn).filter((key) => historyEs[key] === historyEn[key] && !SAME_IN_BOTH.has(key));
    expect(copied).toEqual([]);
  });

  it("every plural has both forms in both languages", () => {
    for (const tree of [historyEn, historyEs]) {
      for (const key of Object.keys(tree)) {
        if (key.endsWith("_plural")) expect(tree[key.replace(/_plural$/, "")]).toBeDefined();
      }
    }
  });

  it("every key the code asks for exists in both languages, including the ones built from a fixed set", () => {
    const literal = new Set<string>();
    const dynamic = new Set<string>();
    for (const file of ROOTS.flatMap(sourceFiles)) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/["'](inspect\.history\.[A-Za-z0-9_.]+)["']/g)) literal.add(match[1]);
      for (const match of text.matchAll(/`(inspect\.history\.[^`]+)`/g)) (match[1].includes("${") ? dynamic : literal).add(match[1]);
    }
    expect(literal.size).toBeGreaterThan(80);
    const missing = [...literal].filter((key) => !(key in historyEn) && !(`${key}_plural` in historyEn));
    // a key naming a whole group (e.g. a prefix used with a suffix) is fine
    const realMissing = missing.filter((key) => !Object.keys(historyEn).some((known) => known.startsWith(`${key}.`)));
    expect(realMissing).toEqual([]);
    // keys built from a fixed set: each member must exist
    const sets: Record<string, string[]> = {
      "inspect.history.result.${": ["passed", "failed", "conditional", "unknown"],
      "inspect.history.period.${": ["today", "yesterday", "7d", "30d", "90d", "custom"],
      "inspect.history.filter.resultOption.${": ["all", "passed", "failed", "conditional"],
      "inspect.history.filter.typeOption.${": ["all", "initial", "reinspection"],
      "inspect.history.filter.problem.${": ["invalid", "reversed", "future", "too_long"],
      "inspect.history.record.info.${": ["inspector", "housekeeper", "template", "service", "type"],
      "inspect.history.record.answer.${": ["pass", "fail", "na", "unknown"],
      "inspect.history.record.type.${": ["initial", "reinspection"],
      "inspect.history.timeline.event.${": ["original", "inspection_failed", "inspection_passed", "correction_created", "reassigned", "escalated", "work_started", "work_submitted", "task_completed", "reinspection_failed", "reinspection_passed", "other"],
      "inspect.history.timeline.failure.${": ["not_found", "forbidden", "offline", "error"],
    };
    for (const [prefix, members] of Object.entries(sets)) {
      expect([...dynamic].some((key) => key.startsWith(prefix))).toBe(true);
      const base = prefix.replace(/\.\$\{$/, "");
      for (const member of members) expect(`${base}.${member}` in historyEn).toBe(true);
    }
    // record.failure.<kind>.title/body and record.service.* are used directly
    for (const kind of ["not_found", "forbidden", "offline", "error"]) {
      expect(`inspect.history.record.failure.${kind}.title` in historyEn).toBe(true);
      expect(`inspect.history.record.failure.${kind}.body` in historyEn).toBe(true);
    }
    expect("inspect.history.record.service.STAY" in historyEn && "inspect.history.record.service.DEP" in historyEn).toBe(true);
  });
});
