import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/* The chief Home reads these keys through the real i18next instance in both languages. A missing Spanish key would print
   the raw key on a manager's phone, and a stray `_one`/`_other` plural is never looked up (v3 format). */

const enChief = (en as { home: { chief: Record<string, string> } }).home.chief;
const esChief = (es as { home: { chief: Record<string, string> } }).home.chief;

describe("home.chief strings", () => {
  it("has exactly the same keys in English and Spanish", () => {
    expect(Object.keys(esChief).sort()).toEqual(Object.keys(enChief).sort());
  });

  it.each(["en", "es"] as const)("resolves every key to text in %s, with no raw key or unfilled placeholder", (lng) => {
    const t = i18n.getFixedT(lng);
    for (const key of Object.keys(enChief)) {
      const text = t(`home.chief.${key}`, { count: 2, name: "Casey", time: "7:00 AM", floor: 3 });
      expect(text).not.toBe(`home.chief.${key}`);
      expect(text).not.toMatch(/\{\{/);
    }
  });

  it("translates the Spanish text rather than copying English for the user-facing headings", () => {
    for (const key of ["heading", "cardNeedsOwner", "cardInProgress", "cardOnHold", "prioritiesTitle", "workloadTitle", "quickAssign", "quickTeam", "quickPm", "quickAssets"]) {
      expect(esChief[key]).not.toBe(enChief[key]);
    }
  });

  it("uses only the v3 plural format", () => {
    for (const key of [...Object.keys(enChief), ...Object.keys(esChief)]) expect(key).not.toMatch(/_(one|other|zero|few|many)$/);
  });
});
