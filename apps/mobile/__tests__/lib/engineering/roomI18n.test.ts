import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { localeHasKey, makeTranslator } from "../../helpers/i18n";
import { ROOM_MAINTENANCE_FILTERS, ROOM_OCCUPANCY_FILTERS, ROOM_QUICK_FILTERS, ROOM_SORTS } from "@/lib/engineering/roomModel";
import { AVAILABILITY_TYPES } from "@/lib/engineering/roomAvailability";
import { ASSET_IMPACTS, LOCATION_SUGGESTIONS, REPORT_CATEGORIES, REPORT_PRIORITIES, REPORT_SOURCES } from "@/lib/engineering/reportIssue";

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));

const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [
  "app/(app)/room-status",
  "app/(app)/work-orders/new.tsx",
  "components/engineering/rooms",
  "components/engineering/report",
].flatMap((entry) => {
  const full = path.join(ROOT, entry);
  return fs.statSync(full).isDirectory() ? fs.readdirSync(full).map((f) => path.join(full, f)) : [full];
});

/** Every literal `t("...")` key the Phase 7 screens ask for. */
function staticKeys(): string[] {
  const keys = new Set<string>();
  for (const file of SOURCES.filter((f) => /\.tsx?$/.test(f))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) keys.add(match[1]);
  }
  return [...keys];
}

describe("Engineering Rooms and Report an Issue strings", () => {
  it.each(["en", "es"] as const)("%s carries every literal key the screens use", (language) => {
    const missing = staticKeys().filter((key) => !localeHasKey(language, key) && !localeHasKey(language, `${key}_plural`));
    expect(missing).toEqual([]);
  });

  it.each(["engRooms", "report"] as const)("English and Spanish have exactly the same %s keys", (namespace) => {
    const enKeys = new Set(flatten((en as unknown as Record<string, Tree>)[namespace]));
    const esKeys = new Set(flatten((es as unknown as Record<string, Tree>)[namespace]));
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  const dynamic: Array<[string, readonly string[]]> = [
    ["engRooms.quick", ROOM_QUICK_FILTERS],
    ["engRooms.occupancy", ROOM_OCCUPANCY_FILTERS],
    ["engRooms.availability", ["out_of_order", "out_of_service", "unrecorded_down"]],
    ["engRooms.periodStatus", ["ACTIVE", "RELEASED", "CANCELLED"]],
    ["engRooms.filter.maintenanceOptions", ROOM_MAINTENANCE_FILTERS],
    ["engRooms.filter.sortOptions", ROOM_SORTS],
    ["engRooms.down.types", AVAILABILITY_TYPES],
    ["engRooms.down.typeHints", AVAILABILITY_TYPES],
    ["engRooms.down.presets", ["in_2h", "in_4h", "tonight", "tomorrow", "in_3d", "in_1w", "custom"]],
    ["engRooms.down.errors", ["type_required", "reason_required", "return_required", "return_past", "return_too_far", "details_too_long"]],
    ["report.priority.hints", REPORT_PRIORITIES],
    ["report.more.sources", REPORT_SOURCES],
    ["report.more.impacts", ASSET_IMPACTS],
    ["report.more.impactHints", ASSET_IMPACTS],
    ["report.location.suggestions", LOCATION_SUGGESTIONS],
    ["workOrders.category", REPORT_CATEGORIES],
    ["workQueue.priority", REPORT_PRIORITIES],
    ["report.errors", ["location_required", "location_too_long", "title_required", "emergency_unconfirmed", "asset_room_mismatch", "impact_needs_asset", "room_down_needs_room"]],
  ];

  it.each(dynamic)("every %s variant is worded in both languages", (group, variants) => {
    for (const variant of variants) {
      expect(localeHasKey("en", `${group}.${variant}`)).toBe(true);
      expect(localeHasKey("es", `${group}.${variant}`)).toBe(true);
    }
  });

  it("room statuses the server can return are worded, so a release result never shows a raw code", () => {
    for (const status of ["DIRTY", "IN_PROGRESS", "PICKUP", "CLEAN", "INSPECTED", "OCCUPIED", "OOO"]) {
      expect(localeHasKey("en", `roomStatus.statusLabels.${status}`)).toBe(true);
      expect(localeHasKey("es", `roomStatus.statusLabels.${status}`)).toBe(true);
    }
  });

  it("plurals follow the app's i18next v3 convention in both languages", () => {
    for (const language of ["en", "es"] as const) {
      const t = makeTranslator(language);
      expect(t("engRooms.maintenanceActive", { count: 1 })).not.toBe(t("engRooms.maintenanceActive", { count: 3 }));
      for (const key of [
        "engRooms.resultCount",
        "engRooms.withColleagues",
        "engRooms.down.inDays",
        "engRooms.detail.assetRepairs",
        "report.fields.remaining",
        "report.success.photosFailed",
        "report.success.photosNotSaved",
        "report.pending.waiting",
        "report.pending.syncing",
      ]) {
        const one = t(key, { count: 1 });
        const many = t(key, { count: 3 });
        expect(one).toContain("1");
        expect(many).toContain("3");
        expect(one).not.toBe(many);
        expect(one).not.toBe(key);
      }
    }
  });

  it("never claims the PMS was updated, in either language", () => {
    for (const language of ["en", "es"] as const) {
      const t = makeTranslator(language);
      const note = t("engRooms.pmsNote");
      expect(note).not.toBe("engRooms.pmsNote");
      expect(note.toLowerCase()).toMatch(/does not|no envía/);
    }
  });
});
