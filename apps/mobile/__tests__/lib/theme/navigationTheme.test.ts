import { readFileSync } from "node:fs";
import { DefaultTheme } from "@react-navigation/native";
import { getThemeTokens, type ThemeMode } from "@/components/shared/tokens";
import { getNavigationTheme } from "@/lib/theme/navigationTheme";

describe("getNavigationTheme", () => {
  it.each(["light", "dark"] as const)(
    "maps the %s PatelRep tokens to the complete native navigation theme",
    (mode: ThemeMode) => {
      const tokens = getThemeTokens(mode);

      expect(getNavigationTheme(mode)).toEqual({
        dark: mode === "dark",
        colors: {
          primary: tokens.primary,
          background: tokens.background,
          card: tokens.shell.surface,
          text: tokens.shell.ink,
          border: tokens.shell.line,
          notification: tokens.status.dirty,
        },
        fonts: DefaultTheme.fonts,
      });
    },
  );

  it("returns distinct light and dark snapshots", () => {
    const light = getNavigationTheme("light");
    const dark = getNavigationTheme("dark");

    expect(light).not.toBe(dark);
    expect(light).not.toEqual(dark);
  });

  it("does not read the frozen light-only C compatibility tokens", () => {
    const source = readFileSync(
      require.resolve("@/lib/theme/navigationTheme"),
      "utf8",
    );

    expect(source).not.toMatch(/\bC\./);
    expect(source).not.toMatch(/\bimport\s*\{[^}]*\bC\b[^}]*\}/);
  });
});
