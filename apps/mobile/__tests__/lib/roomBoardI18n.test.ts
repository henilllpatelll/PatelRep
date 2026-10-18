import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/** The Room Board's new states read in English AND Spanish: same keys and placeholders, real Spanish, and every
 *  key the board code asks for exists (a missing key would put a raw key on a supervisor's screen). */

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

const OWNED = ["roomBoard.state", "roomBoard.statusMeaning"];
const SINGLE = ["roomBoard.assigneeUnknown", "roomBoard.assigneeUnknownShort"];

describe.each(OWNED)("%s", (namespace) => {
  const enLeaves = leaves(node(en, namespace) as Tree, `${namespace}.`);
  const esLeaves = leaves(node(es, namespace) as Tree, `${namespace}.`);

  it("has the same keys and placeholders in English and Spanish", () => {
    expect(Object.keys(esLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
    for (const key of Object.keys(enLeaves)) expect(placeholders(esLeaves[key])).toEqual(placeholders(enLeaves[key]));
  });

  it("has real Spanish, not copied English", () => {
    for (const key of Object.keys(enLeaves)) expect(esLeaves[key]).not.toBe(enLeaves[key]);
  });
});

describe("roomBoard single keys", () => {
  it.each(SINGLE)("%s exists in both languages", (key) => {
    expect(typeof node(en, key)).toBe("string");
    expect(typeof node(es, key)).toBe("string");
    expect(node(es, key)).not.toBe(node(en, key));
  });
});

describe("every roomBoard key the code asks for exists", () => {
  const source = [
    "../../app/(app)/room-board/index.tsx",
    "../../lib/housekeeping/roomBoardModel.ts",
  ]
    .map((file) => readFileSync(resolve(__dirname, file), "utf8"))
    .join("\n");
  const literal = [...source.matchAll(/["'`](roomBoard\.(?:state|statusMeaning|assigneeUnknown\w*)[\w.${}]*)["'`]/g)].map((m) => m[1]);

  it("finds the keys in the source", () => {
    expect(literal.length).toBeGreaterThan(8);
  });

  it.each([...new Set(literal)].filter((key) => !key.includes("${")))("%s is defined in en and es", (key) => {
    expect(typeof node(en, key)).toBe("string");
    expect(typeof node(es, key)).toBe("string");
  });

  it("covers every status the model can classify (statusMeaning.<CODE> and UNKNOWN)", () => {
    for (const code of ["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE", "UNKNOWN"]) {
      expect(typeof node(en, `roomBoard.statusMeaning.${code}`)).toBe("string");
      expect(typeof node(es, `roomBoard.statusMeaning.${code}`)).toBe("string");
    }
  });
});
