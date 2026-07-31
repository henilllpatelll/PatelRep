import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootLayoutSource = readFileSync(
  resolve(__dirname, "../../../app/_layout.tsx"),
  "utf8",
);
const protectedLayoutSource = readFileSync(
  resolve(__dirname, "../../../app/(app)/_layout.tsx"),
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

describe("protected navigation chrome", () => {
  it("resolves every runtime chrome color from the active theme", () => {
    expect(rootLayoutSource).not.toMatch(/\bC\./);
    expect(protectedLayoutSource).not.toMatch(/\bC\./);
    expect(protectedLayoutSource).toContain("const theme = useTheme();");
    expect(protectedLayoutSource).toContain(
      "tabBarActiveTintColor: theme.shell.ink",
    );
    expect(protectedLayoutSource).toContain(
      "tabBarInactiveTintColor: theme.shell.ink3",
    );
    expect(protectedLayoutSource).toContain(
      "backgroundColor: theme.shell.bg",
    );
    expect(protectedLayoutSource).toContain(
      "borderTopColor: theme.shell.line",
    );
    expect(protectedLayoutSource).toContain(
      "headerStyle: { backgroundColor: theme.shell.surface }",
    );
    expect(protectedLayoutSource).toContain(
      "backgroundColor: theme.ai.primary",
    );
    expect(protectedLayoutSource).toContain("shadowColor: theme.ai.primary");
    expect(protectedLayoutSource).toContain(
      'color={theme.onAi}',
    );
  });

  it("keeps role tabs, hidden routes, and badges on their existing data paths", () => {
    expect(protectedLayoutSource).toContain(
      "const visibleTabs = effectiveRole ? getTabsForRole(effectiveRole) : [];",
    );
    expect(protectedLayoutSource).toContain(
      "{visibleTabs.map((tab) => (",
    );
    expect(protectedLayoutSource).toContain(
      "{ALL_ROLE_TAB_ROUTES.filter((name) => !visibleNames.has(name)).map((name) => (",
    );
    expect(protectedLayoutSource).toContain(
      "{HIDDEN_APP_ROUTES.map((name) => (",
    );
    expect(protectedLayoutSource).toMatch(
      /name=\{name\} options=\{\{ href: null \}\}/,
    );
    expect(protectedLayoutSource).toMatch(
      /tabBarBadge:\s*name === "notifications\/index" && unreadCount > 0/,
    );
    expect(protectedLayoutSource).toContain(
      'listeners={name === "notifications/index" ? { focus: () => setUnreadCount(0) } : undefined}',
    );
  });

  it("translates tab and Copilot accessibility labels without changing destinations", () => {
    expect(protectedLayoutSource).toMatch(
      /title: t\(tab\.titleKey\),[\s\S]*tabBarAccessibilityLabel: t\(tab\.titleKey\),[\s\S]*tabBarIcon:/,
    );
    expect(protectedLayoutSource).toContain(
      'accessibilityLabel={t("tabs.copilot")}',
    );
    expect(protectedLayoutSource).toContain(
      'router.push("/(app)/copilot" as never)',
    );
  });
});
