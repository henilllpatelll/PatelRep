import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootLayoutSource = readFileSync(
  resolve(__dirname, "../../../app/_layout.tsx"),
  "utf8",
);

describe("root app chrome", () => {
  it("keeps the PatelRep provider outside the consumer that controls splash and chrome", () => {
    expect(rootLayoutSource).toMatch(
      /<ThemeProvider>\s*<RootChrome\s*\/>\s*<\/ThemeProvider>/,
    );
    expect(rootLayoutSource).toMatch(
      /function RootChrome\(\)[\s\S]*useAppearancePreference\(\)/,
    );
  });

  it("does not expose navigator chrome before appearance hydration", () => {
    expect(rootLayoutSource).toContain("if (!isHydrated) return null;");
    expect(rootLayoutSource).toMatch(
      /if \(!isLoading && isHydrated\)\s*\{\s*(?:void )?SplashScreen\.hideAsync\(\)/,
    );
    expect(rootLayoutSource).toMatch(
      /\}, \[isLoading, isHydrated\]\);/,
    );
  });

  it("drives navigation and status chrome from one effective mode", () => {
    expect(rootLayoutSource).toContain(
      "<NavigationThemeProvider value={getNavigationTheme(mode)}>",
    );
    expect(rootLayoutSource).toMatch(
      /<StatusBar[\s\S]*style=\{mode === "dark" \? "light" : "dark"\}/,
    );
    expect(rootLayoutSource).toContain(
      "backgroundColor={theme.shell.bg}",
    );
    expect(rootLayoutSource).toContain("animated={false}");
    expect(rootLayoutSource).not.toContain('StatusBar style="auto"');
  });

  it("does not animate appearance changes", () => {
    expect(rootLayoutSource).not.toMatch(
      /\b(?:LayoutAnimation|Animated|crossfade)\b/,
    );
    expect(rootLayoutSource).not.toMatch(
      /animationEnabled|transitionSpec|cardStyleInterpolator/,
    );
  });
});
