import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/** Phase 3 strings: every key exists in both languages, with the same {{placeholders}}, and none is empty. */

type Json = { [key: string]: Json | string };

function leaves(node: Json | string, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
}

const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((token) => token.replace(/\s/g, "")).sort();

const PHASE3 = [
  /^home\.current\.(more|moreA11y|whyA11y)$/,
  /^home\.message\./,
  /^home\.attentionCenter\./,
  /^home\.roomActions\./,
  /^home\.whySheet\./,
  /^home\.issue\./,
  /^home\.progressSheet\./,
  /^rooms\.detail\.actionUnavailable$/,
];

describe("Phase 3 locale strings", () => {
  const english = new Map(leaves(en as Json));
  const spanish = new Map(leaves(es as Json));
  const keys = [...english.keys()].filter((key) => PHASE3.some((pattern) => pattern.test(key)));

  it("covers the whole Phase 3 surface", () => {
    expect(keys.length).toBeGreaterThan(100);
  });

  it.each(keys)("%s exists in Spanish with the same placeholders", (key) => {
    const spanishText = spanish.get(key);
    expect(spanishText).toBeTruthy();
    expect(placeholders(spanishText as string)).toEqual(placeholders(english.get(key) as string));
  });

  it("never claims an acknowledgement the server does not record", () => {
    for (const [key, text] of english) {
      if (!key.startsWith("home.message.")) continue;
      expect(text.toLowerCase()).not.toMatch(/acknowledg/);
    }
    expect(english.get("home.message.markRead")).toBe("Mark as read");
  });
});
