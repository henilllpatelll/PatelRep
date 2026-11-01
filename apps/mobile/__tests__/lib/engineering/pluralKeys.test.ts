import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/**
 * The app runs i18next with `compatibilityJSON: "v3"`, so a plural is `key` + `key_plural`. A `key_one` / `key_other`
 * pair is never looked up and the screen prints the raw key. Screen tests with a mocked `t` cannot see that, so these
 * resolve the engineering counts through the real i18next instance, in both languages.
 */
const COUNTED = [
  "engineeringTeam.pmOverdueCount",
  "engineeringTeam.roomsDown",
  "engineeringTeam.load.active",
  "engineeringTeam.load.urgent",
  "engineeringTeam.load.onHold",
  "engineeringTeam.load.overdue",
  "engineeringSync.waiting",
  "engineeringSync.attention",
];

describe.each(["en", "es"] as const)("engineering counted labels (%s)", (lng) => {
  const t = i18n.getFixedT(lng);

  it.each(COUNTED)("%s resolves for one and for several, never to the raw key", (key) => {
    for (const count of [1, 3]) {
      const text = t(key, { count, late: 0 });
      expect(text).not.toBe(key);
      expect(text).toContain(String(count));
      expect(text).not.toMatch(/\{\{/);
    }
  });
});

describe("engineering namespaces use the v3 plural format", () => {
  const stray = (tree: unknown, path: string[] = []): string[] =>
    Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? stray(value, [...path, key])
        : /_(one|other|zero|few|many)$/.test(key)
          ? [[...path, key].join(".")]
          : []
    );

  it.each([
    ["en", en],
    ["es", es],
  ])("%s has no _one/_other keys under engineeringTeam or engineeringSync", (_lng, tree) => {
    const scoped = tree as unknown as Record<string, unknown>;
    expect([...stray(scoped.engineeringTeam, ["engineeringTeam"]), ...stray(scoped.engineeringSync, ["engineeringSync"])]).toEqual([]);
  });
});
