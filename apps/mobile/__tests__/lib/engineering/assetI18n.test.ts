import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { localeHasKey, makeTranslator } from "../../helpers/i18n";
import {
  ASSET_MAINTENANCE_FILTERS,
  ASSET_QUICK_FILTERS,
  ASSET_RELIABILITY_FILTERS,
  ASSET_SERVICE_STATUSES,
  ASSET_SORTS,
} from "@/lib/engineering/assetModel";

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));

const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [
  "app/(app)/assets",
  "components/engineering/assets",
].flatMap((entry) => {
  const full = path.join(ROOT, entry);
  return fs.statSync(full).isDirectory() ? fs.readdirSync(full).map((f) => path.join(full, f)) : [full];
});

/** Every literal `t("...")` key the asset screens ask for. */
function staticKeys(): string[] {
  const keys = new Set<string>();
  for (const file of SOURCES.filter((f) => /\.tsx?$/.test(f))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) keys.add(match[1]);
  }
  return [...keys];
}

describe("asset screen strings", () => {
  it.each(["en", "es"] as const)("%s carries every literal key the screens use", (language) => {
    const missing = staticKeys().filter((key) => !localeHasKey(language, key) && !localeHasKey(language, `${key}_plural`));
    expect(missing).toEqual([]);
  });

  it("English and Spanish have exactly the same asset keys", () => {
    const enKeys = new Set(flatten((en as unknown as { assets: Tree }).assets));
    const esKeys = new Set(flatten((es as unknown as { assets: Tree }).assets));
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  const dynamic: Array<[string, readonly string[]]> = [
    ["assets.status", ASSET_SERVICE_STATUSES],
    ["assets.quick", ASSET_QUICK_FILTERS],
    ["assets.sections", ["overview", "maintenance", "readings", "history"]],
    ["assets.filter.maintenanceOptions", ASSET_MAINTENANCE_FILTERS],
    ["assets.filter.reliabilityOptions", ASSET_RELIABILITY_FILTERS],
    ["assets.filter.sortOptions", ASSET_SORTS],
    ["assets.scan.outcome", ["invalid", "not_found", "ambiguous", "forbidden", "offline", "failed"]],
    ["assets.signals.band", ["high", "elevated", "low", "unknown"]],
    ["assets.readings.recorded", ["normal", "warning", "critical", "toast"]],
    ["assets.readings.direction", ["rising", "falling", "flat"]],
    ["assets.readings.errors", ["required", "invalid", "out_of_range", "too_precise", "notes_too_long", "offline", "forbidden", "rejected", "failed", "unconfirmed"]],
    ["assets.history.events", ["downtime_started", "downtime_restored", "work_order_created", "repair_completed", "pm_completed", "reading_recorded", "downtime_started_out_of_service", "downtime_started_degraded"]],
    ["assets.history.docType", ["file", "photo", "measurement", "checklist_result", "signature", "attestation", "external_certificate"]],
    ["assets.workOrders.verification", ["passed", "failed", "follow_up_required"]],
  ];

  it.each(dynamic)("every %s variant is worded in both languages", (group, variants) => {
    for (const variant of variants) {
      expect(localeHasKey("en", `${group}.${variant}`)).toBe(true);
      expect(localeHasKey("es", `${group}.${variant}`)).toBe(true);
    }
  });

  it("plurals follow the app's i18next v3 convention in both languages", () => {
    for (const language of ["en", "es"] as const) {
      const t = makeTranslator(language);
      for (const key of ["assets.resultCount", "assets.card.activeRepairs", "assets.signals.open", "assets.detail.activeRepairsCount", "assets.maintenance.failed"]) {
        const one = t(key, { count: 1 });
        const many = t(key, { count: 3 });
        expect(one).toContain("1");
        expect(many).toContain("3");
        expect(one).not.toBe(many);
        expect(one).not.toBe(key);
      }
    }
  });

  it("no string shows a raw template token in English", () => {
    const t = makeTranslator("en");
    expect(t("assets.resultCount", { count: 1 })).toBe("1 asset");
    expect(t("assets.resultCount", { count: 250 })).toBe("250 assets");
  });
});
