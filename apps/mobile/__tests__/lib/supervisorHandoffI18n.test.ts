import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/** The shift handoff reads in English AND Spanish: same keys, same {{placeholders}}, real Spanish, and every key the
 *  handoff code asks for exists (a missing key would put a raw key on a manager-facing screen). */

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
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const NAMESPACES = ["supervisorHandoff", "logbook.report"];
// Words that are legitimately identical in both languages, or placeholders only.
const SAME_IN_BOTH = new Set(["supervisorHandoff.notes.counter"]);

describe.each(NAMESPACES)("%s", (namespace) => {
  const enLeaves = leaves(node(en, namespace) as Tree, `${namespace}.`);
  const esLeaves = leaves(node(es, namespace) as Tree, `${namespace}.`);

  it("has the same keys in English and Spanish", () => {
    expect(Object.keys(esLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
  });

  it("keeps the same placeholders in both languages", () => {
    for (const key of Object.keys(enLeaves)) expect(placeholders(esLeaves[key])).toEqual(placeholders(enLeaves[key]));
  });

  it("has real Spanish, not copied English", () => {
    for (const key of Object.keys(enLeaves)) {
      if (SAME_IN_BOTH.has(key)) continue;
      expect(esLeaves[key]).not.toBe(enLeaves[key]);
    }
  });

  it("has no empty strings", () => {
    for (const value of [...Object.values(enLeaves), ...Object.values(esLeaves)]) expect(value.trim()).not.toBe("");
  });
});

describe("keys used by the handoff code", () => {
  const files = [
    "../../components/supervisor/handoff/ShiftHandoffSheet.tsx",
    "../../components/supervisor/handoff/HandoffParts.tsx",
    "../../app/(app)/logbook/[entryId].tsx",
  ].map((relative) => readFileSync(resolve(__dirname, relative), "utf8"));
  const source = files.join("\n");
  const has = (tree: unknown, key: string) => typeof node(tree, key) === "string";

  it("every literal key exists in both languages", () => {
    const keys = [...source.matchAll(/\bt\(\s*"((?:supervisorHandoff|logbook\.report)[\w.]*)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect([key, has(en, key)]).toEqual([key, true]);
      expect([key, has(es, key)]).toEqual([key, true]);
    }
  });

  it("every computed key family is fully defined", () => {
    const families: Array<[string, string[]]> = [
      ["supervisorHandoff.steps", ["prepare", "review", "confirm"]],
      ["supervisorHandoff.blockers", ["boardLoading", "boardUnavailable", "boardStale", "inspectionsLoading", "inspectionsUnavailable", "inspectionsStale", "dayMismatch", "offline"]],
      ["supervisorHandoff.review.changes", ["rooms", "inspections", "unresolved", "date"]],
      ["supervisorHandoff.confirm", ["records", "open", "clock"]],
      ["supervisorHandoff.saved", ["managersComplete", "managersNone", "managersFailed", "managersUnknown"]],
      ["supervisorHandoff.failure", ["countsChanged", "departmentMissing", "departmentAmbiguous", "dateOutOfRange", "forbidden", "signedOut", "rejected", "unconfirmed", "notSaved", "verifyFailed", "notifyFailed"]],
    ];
    for (const [prefix, names] of families) {
      for (const name of names) {
        expect([`${prefix}.${name}`, has(en, `${prefix}.${name}`)]).toEqual([`${prefix}.${name}`, true]);
        expect([`${prefix}.${name}`, has(es, `${prefix}.${name}`)]).toEqual([`${prefix}.${name}`, true]);
      }
    }
  });

  it("the plural forms exist for the counted lines", () => {
    for (const key of ["awaiting", "unassigned", "blocked"]) {
      expect(has(en, `supervisorHandoff.unfinished.${key}_plural`)).toBe(true);
      expect(has(es, `supervisorHandoff.unfinished.${key}_plural`)).toBe(true);
    }
  });
});
