import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { TemplateUnavailableReason } from "@/lib/inspections/templates";

/* The legacy Inspect screen names WHY a room cannot be inspected when no checklist can be chosen. Every reason the
   selector can return needs words in both languages, or a raw key would land on a supervisor's screen. */

const REASONS: TemplateUnavailableReason[] = ["no_templates", "no_usable_template", "no_default", "room_type_unknown", "invalid_templates"];
const get = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], tree);
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("inspection checklist error copy", () => {
  it.each([...REASONS, "unavailable"])("has English and Spanish text for inspect.template.%s", (key) => {
    const english = get(en, `inspect.template.${key}`);
    const spanish = get(es, `inspect.template.${key}`);
    expect(typeof english).toBe("string");
    expect(typeof spanish).toBe("string");
    expect(spanish).not.toBe(english);
    expect(placeholders(spanish as string)).toEqual(placeholders(english as string));
  });

  it("has no keys the selector cannot produce, apart from the load failure", () => {
    const keys = Object.keys(get(en, "inspect.template") as object).sort();
    expect(keys).toEqual([...REASONS, "unavailable"].sort());
    expect(Object.keys(get(es, "inspect.template") as object).sort()).toEqual(keys);
  });
});
