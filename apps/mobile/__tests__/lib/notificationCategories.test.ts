import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { CATEGORY_ICONS, isKnownCategory } from "@/lib/notifications/categories";

/** The backend's category table is the contract: every key it can list must be switchable on mobile. */
function backendCategoryKeys(): string[] {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../api/services/notify.py"), "utf8");
  const block = source.slice(source.indexOf("CATEGORIES: dict"));
  return [...block.slice(0, block.indexOf("\n}")).matchAll(/Category\("([a-z_]+)"/g)].map((m) => m[1]);
}

describe("notification category contract", () => {
  const keys = backendCategoryKeys();

  it("reads the backend categories (guards the parser itself)", () => {
    expect(keys).toEqual(expect.arrayContaining(["room_assignments", "work_orders", "tasks", "schedule"]));
  });

  it.each(keys)("backend category %s has an icon and English and Spanish copy", (key) => {
    expect(isKnownCategory(key)).toBe(true);
    expect(CATEGORY_ICONS[key]).toBeTruthy();
    for (const locale of [en, es] as const) {
      const entry = (locale as any).settings.notifications.categories[key];
      expect(entry?.label).toBeTruthy();
      expect(entry?.description).toBeTruthy();
    }
  });

  it("does not treat inherited object keys or unknown categories as switchable", () => {
    expect(isKnownCategory("toString")).toBe(false);
    expect(isKnownCategory("brand_new_thing")).toBe(false);
  });
});
