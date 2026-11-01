import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [prefix + key] : flatten(value, prefix + key + ".")));
}

describe("PM screen strings", () => {
  it("English and Spanish have exactly the same pm keys", () => {
    const enKeys = new Set(flatten((en as unknown as { pm: Tree }).pm));
    const esKeys = new Set(flatten((es as unknown as { pm: Tree }).pm));
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it.each([
    ["pm.views", ["today", "plan", "history"]],
    ["pm.plan", ["week", "calendar"]],
    ["pm.today", ["continue", "needsAttention", "nothingElseToday", "progress", "viewPlan", "viewPlanMore"]],
    ["pm.filter", ["titleActive", "allStatuses", "showResults"]],
    ["pm.history", ["followUp", "openEquipment"]],
    ["pm.detail", ["checklist", "version", "steps", "photosRequired", "stepsWithPhoto", "mostRecent"]],
  ])("%s is worded in both languages", (path, keys) => {
    const read = (locale: unknown) => path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], locale) as Record<string, string>;
    for (const locale of [en, es]) {
      const node = read(locale);
      for (const key of keys) expect(typeof node?.[key]).toBe("string");
    }
  });
});
