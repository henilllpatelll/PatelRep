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

const OWNED = [
  "roomBoard.state",
  "roomBoard.statusMeaning",
  "roomBoard.header",
  "roomBoard.card",
  "roomBoard.attention",
  "roomBoard.seg",
  "roomBoard.search",
  "roomBoard.filters",
  "roomBoard.sort",
  "roomBoard.results",
  "roomBoard.empty",
  "roomBoard.segmentEmptyBody",
  "roomBoard.jump",
  "roomBoard.detail",
];
// Words that are the same in both languages on purpose.
const SAME_IN_SPANISH = new Set(["roomBoard.attention.vip", "roomBoard.card.detail.vip", "roomBoard.filters.flag.vip", "roomBoard.filters.chipFloor", "roomBoard.detail.flag.vip", "roomBoard.detail.dayAt", "roomBoard.detail.cleaning.minutes", "roomBoard.detail.workOrder.priority.normal"]);
const SINGLE = [
  "roomBoard.assigneeUnknown",
  "roomBoard.unassigned",
  "roomBoard.showAll",
  "roomBoard.building",
  "roomBoard.buildingNone",
  "roomBoard.floorUnknown",
  "roomBoard.roomCountOf",
  "roomBoard.segmentEmpty",
];

describe.each(OWNED)("%s", (namespace) => {
  const enLeaves = leaves(node(en, namespace) as Tree, `${namespace}.`);
  const esLeaves = leaves(node(es, namespace) as Tree, `${namespace}.`);

  it("has the same keys and placeholders in English and Spanish", () => {
    expect(Object.keys(esLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
    for (const key of Object.keys(enLeaves)) expect(placeholders(esLeaves[key])).toEqual(placeholders(enLeaves[key]));
  });

  it("has real Spanish, not copied English", () => {
    for (const key of Object.keys(enLeaves)) if (!SAME_IN_SPANISH.has(key)) expect(esLeaves[key]).not.toBe(enLeaves[key]);
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
    "../../lib/housekeeping/roomBoardView.ts",
    "../../components/supervisor/board/BoardHeader.tsx",
    "../../components/supervisor/board/BoardReadinessCard.tsx",
    "../../components/supervisor/board/BoardSegmentBar.tsx",
    "../../lib/housekeeping/roomBoardFilters.ts",
    "../../lib/housekeeping/roomBoardQuery.ts",
    "../../lib/housekeeping/roomBoardSort.ts",
    "../../components/supervisor/board/BoardSearchBar.tsx",
    "../../components/supervisor/board/BoardFilterSheet.tsx",
    "../../components/supervisor/board/BoardActiveFilters.tsx",
    "../../components/supervisor/board/FloorJumpBar.tsx",
    "../../components/supervisor/board/BoardStates.tsx",
    "../../components/supervisor/board/RoomListRow.tsx",
    "../../lib/housekeeping/roomDetailView.ts",
    "../../components/supervisor/RoomDetailSheet.tsx",
    "../../components/supervisor/detail/RoomDetailParts.tsx",
    "../../components/supervisor/detail/RoomActionsList.tsx",
  ]
    .map((file) => readFileSync(resolve(__dirname, file), "utf8"))
    .join("\n");
  const literal = [...source.matchAll(/["'`](roomBoard\.(?:state|statusMeaning|header|card|attention|seg|search|filters|sort|results|empty|segmentEmptyBody|jump|detail|assigneeUnknown\w*|unassigned|showAll|building\w*|floorUnknown|roomCountOf|segmentEmpty)[\w.${}]*)["'`]/g)].map((m) => m[1]);

  it("finds the keys in the source", () => {
    expect(literal.length).toBeGreaterThan(8);
  });

  it.each([...new Set(literal)].filter((key) => !key.includes("${")))("%s is defined in en and es", (key) => {
    expect(typeof node(en, key)).toBe("string");
    expect(typeof node(es, key)).toBe("string");
  });

  it("covers every dynamic filter, sort and empty-segment key the code builds from a template", () => {
    const groups: Record<string, string[]> = {
      "roomBoard.filters.status": ["toClean", "working", "toInspect", "ready", "outOfOrder", "outOfService", "unrecognized"],
      "roomBoard.filters.flag": ["unassigned", "arrivalsToday", "departuresToday", "vip", "dnd", "workOrder", "urgent", "risk"],
      "roomBoard.sort": ["priority", "roomNumber", "departure", "arrival", "status", "floor"],
      "roomBoard.segmentEmptyBody": ["toClean", "working", "toInspect", "ready"],
    };
    for (const [prefix, keys] of Object.entries(groups)) {
      for (const key of keys) {
        expect(typeof node(en, `${prefix}.${key}`)).toBe("string");
        expect(typeof node(es, `${prefix}.${key}`)).toBe("string");
      }
    }
  });

  it("covers every status the model can classify (statusMeaning.<CODE> and UNKNOWN)", () => {
    for (const code of ["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE", "UNKNOWN"]) {
      expect(typeof node(en, `roomBoard.statusMeaning.${code}`)).toBe("string");
      expect(typeof node(es, `roomBoard.statusMeaning.${code}`)).toBe("string");
    }
  });
});

describe("pluralised keys resolve under the app's real i18n config (v3 plurals: key / key_plural)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18n = require("@/i18n").default as import("i18next").i18n;
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    ["en", "roomBoard.card.totalRooms", 1, "1 room total"],
    ["en", "roomBoard.card.totalRooms", 95, "95 total rooms"],
    ["en", "roomBoard.card.unrecognized", 2, "2 rooms have a status the app doesn't recognize"],
    ["en", "roomBoard.header.liveSeconds", 1, "Live · Updated 1 second ago"],
    ["en", "roomBoard.header.liveSeconds", 20, "Live · Updated 20 seconds ago"],
    ["en", "roomBoard.header.liveMinutes", 3, "Live · Updated 3 minutes ago"],
    ["es", "roomBoard.card.totalRooms", 1, "1 cuarto en total"],
    ["es", "roomBoard.card.totalRooms", 95, "95 cuartos en total"],
    ["es", "roomBoard.header.liveSeconds", 20, "En vivo · Actualizado hace 20 segundos"],
    ["es", "roomBoard.header.liveMinutes", 1, "En vivo · Actualizado hace 1 minuto"],
  ])("%s %s (%i)", async (lng, key, count, expected) => {
    await i18n.changeLanguage(lng);
    expect(i18n.t(key, { count })).toBe(expected);
  });
});
