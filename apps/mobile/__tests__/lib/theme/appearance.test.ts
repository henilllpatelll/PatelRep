import {
  normalizeAppearancePreference,
  resolveThemeMode,
} from "@/lib/theme/appearance";

describe("normalizeAppearancePreference", () => {
  it.each([null, undefined, "", "SYSTEM", "sepia", "{broken-json"])(
    "normalizes absent or invalid value %p to system",
    (value) => {
      expect(normalizeAppearancePreference(value)).toBe("system");
    },
  );

  it.each(["system", "light", "dark"] as const)(
    "preserves valid preference %s",
    (preference) => {
      expect(normalizeAppearancePreference(preference)).toBe(preference);
    },
  );
});

describe("resolveThemeMode", () => {
  it("uses the dark system scheme while System is selected", () => {
    expect(resolveThemeMode("system", "dark")).toBe("dark");
  });

  it.each(["light", "unspecified", null, undefined] as const)(
    "uses light for System with OS scheme %p",
    (systemScheme) => {
      expect(resolveThemeMode("system", systemScheme)).toBe("light");
    },
  );

  it.each(["light", "dark", "unspecified", null, undefined] as const)(
    "keeps an explicit Light choice when OS scheme is %p",
    (systemScheme) => {
      expect(resolveThemeMode("light", systemScheme)).toBe("light");
    },
  );

  it.each(["light", "dark", "unspecified", null, undefined] as const)(
    "keeps an explicit Dark choice when OS scheme is %p",
    (systemScheme) => {
      expect(resolveThemeMode("dark", systemScheme)).toBe("dark");
    },
  );
});
