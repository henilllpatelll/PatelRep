import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/**
 * Phase 5 (procedures, translations, guidance) must read in English AND Spanish: the same keys, the same
 * {{placeholders}}, real Spanish rather than copied English, and every key the new screens ask for present.
 */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out[`${prefix}${key}`] = value;
    else Object.assign(out, leaves(value, `${prefix}${key}.`));
  }
  return out;
}
const node = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((n, part) => (n as Tree | undefined)?.[part], tree);
const has = (tree: unknown, path: string) => typeof node(tree, path) === "string";
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const NAMESPACES = ["sop", "tasks.hk.translate"];
const SINGLE_KEYS = ["tasks.hk.help.findProcedure", "rooms.help.findProcedure"];
// Proper names, or words that are legitimately identical in both languages.
const SAME_IN_BOTH = new Set(["sop.general", "tasks.hk.translate.language.en", "tasks.hk.translate.language.es"]);

describe.each(NAMESPACES)("%s", (namespace) => {
  const enLeaves = leaves(node(en, namespace) as Tree, `${namespace}.`);
  const esLeaves = leaves(node(es, namespace) as Tree, `${namespace}.`);

  it("has the same keys in English and Spanish", () => {
    expect(Object.keys(esLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
  });

  it("keeps the same placeholders in both languages", () => {
    for (const key of Object.keys(enLeaves)) expect(placeholders(esLeaves[key])).toEqual(placeholders(enLeaves[key]));
  });

  it("has Spanish that is not copied English", () => {
    const copied = Object.keys(enLeaves).filter((key) => !SAME_IN_BOTH.has(key) && enLeaves[key] === esLeaves[key]);
    expect(copied).toEqual([]);
  });
});

it.each(SINGLE_KEYS)("%s exists in both languages and differs", (key) => {
  expect(has(en, key)).toBe(true);
  expect(has(es, key)).toBe(true);
  expect(node(es, key)).not.toBe(node(en, key));
});

describe("every sop.* / translate key the screens ask for exists", () => {
  const FILES = [
    "app/(app)/sop/index.tsx",
    "app/(app)/sop/[sopId].tsx",
    "components/sop/SourceCitationCard.tsx",
    "components/sop/SopAnswerNotes.tsx",
    "components/sop/ProcedureLinks.tsx",
    "components/tasks/TaskTranslation.tsx",
    "lib/sop/citations.ts",
  ].map((file) => resolve(__dirname, "../..", file));
  const source = FILES.map((file) => readFileSync(file, "utf8")).join("\n");
  const literal = [...source.matchAll(/\bt\(\s*"((?:sop|tasks\.hk\.translate)\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
  const dynamic: string[] = [];

  for (const unit of ["justNow", "minutes", "hours", "days"]) dynamic.push(`sop.cache.saved_${unit}`);
  for (const reason of ["no_documents", "no_match", "insufficient", "conflict", "unverified_figures"]) dynamic.push(`sop.notes.reason.${reason}`);
  for (const code of ["en", "es"]) dynamic.push(`sop.notes.language.${code}`, `tasks.hk.translate.language.${code}`, `sop.detail.q.translate_${code}`);

  it("covers every literal key in the new files", () => {
    expect(literal.length).toBeGreaterThan(20);
    for (const key of [...new Set([...literal, ...dynamic])]) {
      expect({ key, en: has(en, key) }).toEqual({ key, en: true });
      expect({ key, es: has(es, key) }).toEqual({ key, es: true });
    }
  });

  it("reads each file once (guards the scan above)", () => {
    for (const file of FILES) expect(statSync(file).isFile()).toBe(true);
    expect(readdirSync(join(__dirname, "../..", "components/sop")).length).toBe(3);
  });
});
