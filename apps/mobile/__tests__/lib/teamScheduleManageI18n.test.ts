import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/* Team Scheduling Phase 3 words: every English string has a Spanish twin that keeps the same placeholders, and every
   failure the app can classify has words of its own. */

type Tree = { [key: string]: string | Tree };

function flatten(node: string | Tree, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  return Object.entries(node).reduce<Record<string, string>>((all, [key, value]) => ({ ...all, ...flatten(value, prefix ? `${prefix}.${key}` : key) }), {});
}

const english = flatten((en as unknown as { teamSchedule: Tree }).teamSchedule.manage, "manage");
const spanish = flatten((es as unknown as { teamSchedule: Tree }).teamSchedule.manage, "manage");
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe("teamSchedule.manage locale files", () => {
  it("has the same keys in English and Spanish", () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
  });

  it("keeps every placeholder in the Spanish text", () => {
    for (const [key, text] of Object.entries(english)) expect({ key, placeholders: placeholders(spanish[key]) }).toEqual({ key, placeholders: placeholders(text) });
  });

  it("has no empty strings", () => {
    for (const [key, text] of [...Object.entries(english), ...Object.entries(spanish)]) expect({ key, empty: text.trim() === "" }).toEqual({ key, empty: false });
  });

  it("words every kind of write failure", () => {
    const kinds = ["version_conflict", "schedule_conflict", "duplicate", "policy_blocked", "locked", "attendance", "forbidden", "not_found", "inactive", "department", "invalid", "signed_out", "unconfirmed", "unknown"];
    for (const kind of kinds) {
      expect(english[`manage.failure.${kind}.title`]).toBeTruthy();
      expect(english[`manage.failure.${kind}.body`]).toBeTruthy();
    }
  });

  it("never promises a draft or a notification the system does not send yet", () => {
    for (const text of [...Object.values(english), ...Object.values(spanish)]) expect(text.toLowerCase()).not.toMatch(/draft saved|have been notified|were notified|borrador guardado|fueron notificados/);
    expect(english["manage.form.immediate"]).toMatch(/not notified/i);
  });
});
