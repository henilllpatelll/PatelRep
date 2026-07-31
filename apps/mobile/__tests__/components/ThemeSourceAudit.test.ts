import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import {
  darkTheme,
  lightTheme,
} from "@/components/shared/tokens";

const mobileRoot = resolve(__dirname, "../..");
const runtimeRoots = ["app", "components", "lib"] as const;

function collectRuntimeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      return collectRuntimeFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const runtimeFiles = runtimeRoots.flatMap((root) =>
  collectRuntimeFiles(resolve(mobileRoot, root)),
);

const runtimeSources = new Map(
  runtimeFiles.map((path) => [
    relative(mobileRoot, path).replaceAll("\\", "/"),
    readFileSync(path, "utf8"),
  ]),
);

function source(path: string): string {
  const value = runtimeSources.get(path);
  if (!value) {
    throw new Error(`Runtime inventory is missing ${path}`);
  }
  return value;
}

function leafPaths(
  value: unknown,
  prefix = "",
): string[] {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function localeLeafKeys(path: string): string[] {
  return leafPaths(
    JSON.parse(readFileSync(resolve(mobileRoot, path), "utf8")),
  ).sort();
}

describe("app-wide theme source inventory", () => {
  it("covers the complete app, component, and library runtime trees", () => {
    expect(runtimeFiles.length).toBeGreaterThan(70);
    expect([...runtimeSources.keys()]).toEqual(
      expect.arrayContaining([
        "app/_layout.tsx",
        "app/(app)/_layout.tsx",
        "app/(app)/profile/index.tsx",
        "app/(app)/copilot/index.tsx",
        "components/shared/tokens.ts",
        "components/ui/Button.tsx",
        "lib/theme/ThemeProvider.tsx",
        "lib/theme/ToastProvider.tsx",
      ]),
    );
  });

  it("rejects frozen C-token reads outside the compatibility declaration", () => {
    const offenders = [...runtimeSources.entries()].flatMap(
      ([path, fileSource]) => {
        const auditedSource =
          path === "components/shared/tokens.ts"
            ? fileSource.replace(/^.*\bC\..*$/gm, "")
            : fileSource;
        return /\bC\./.test(auditedSource) ? [path] : [];
      },
    );

    expect(offenders).toEqual([]);
  });

  it("keeps status and navigator chrome explicit and transition-free", () => {
    const rootSource = source("app/_layout.tsx");
    const profileSource = source("app/(app)/profile/index.tsx");
    const providerSource = source("lib/theme/ThemeProvider.tsx");
    const switchingSources = [
      rootSource,
      profileSource,
      providerSource,
    ].join("\n");

    expect(rootSource).not.toMatch(
      /<StatusBar\b[^>]*\bstyle\s*=\s*["']auto["']/,
    );
    expect(rootSource).toMatch(
      /style=\{mode === "dark" \? "light" : "dark"\}/,
    );
    expect(rootSource).toContain("animated={false}");
    expect(switchingSources).not.toMatch(
      /\b(?:Animated|LayoutAnimation)\b/,
    );
    expect(switchingSources).not.toMatch(
      /\b(?:crossfade|transitionSpec|cardStyleInterpolator)\b/,
    );
  });

  it("keeps light and dark semantic token shapes recursively compatible", () => {
    expect(leafPaths(lightTheme).sort()).toEqual(
      leafPaths(darkTheme).sort(),
    );
  });
});

describe("protected theme exceptions and integration links", () => {
  it("preserves Copilot D-11 dark content while surrounding chrome remains reactive", () => {
    const copilotSource = source("app/(app)/copilot/index.tsx");
    const protectedLayoutSource = source("app/(app)/_layout.tsx");
    const rootSource = source("app/_layout.tsx");

    expect(copilotSource).toMatch(
      /import\s*\{\s*darkTheme\s*\}\s*from\s*["']@\/components\/shared\/tokens["']/,
    );
    expect(copilotSource.match(/\bdarkTheme\./g)?.length).toBeGreaterThan(15);
    expect(copilotSource).not.toMatch(
      /import\s*\{[^}]*\buseTheme\b[^}]*\}/,
    );
    expect(copilotSource).not.toMatch(/\buseTheme\(\)/);

    expect(rootSource).toContain(
      "<NavigationThemeProvider value={getNavigationTheme(mode)}>",
    );
    expect(protectedLayoutSource).toContain("const theme = useTheme();");
    expect(protectedLayoutSource).toContain(
      "tabBarActiveTintColor: theme.shell.ink",
    );
    expect(protectedLayoutSource).toContain(
      "backgroundColor: theme.shell.bg",
    );
    expect(protectedLayoutSource).toContain(
      "backgroundColor: theme.ai.primary",
    );
  });

  it("keeps the real Profile appearance selector radio-semantic and direct", () => {
    const profileSource = source("app/(app)/profile/index.tsx");

    expect(profileSource).toContain('accessibilityRole="radiogroup"');
    expect(profileSource).toContain('accessibilityRole="radio"');
    expect(profileSource).toContain(
      "accessibilityState={{ selected: active }}",
    );
    expect(profileSource).toContain(
      "onPress={() => void setPreference(option.value)}",
    );
    expect(profileSource).toContain(
      "testID={`appearance-${option.value}`}",
    );
    expect(profileSource).toMatch(
      /segment:\s*\{[\s\S]*?minHeight:\s*44/,
    );
  });

  it("keeps role navigation delegated to the existing authoritative matrix", () => {
    const protectedLayoutSource = source("app/(app)/_layout.tsx");
    const roleTabsTestSource = readFileSync(
      resolve(mobileRoot, "__tests__/lib/roleTabs.test.ts"),
      "utf8",
    );

    expect(protectedLayoutSource).toContain(
      "ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole",
    );
    expect(protectedLayoutSource).toContain(
      "const visibleTabs = effectiveRole ? getTabsForRole(effectiveRole) : [];",
    );
    expect(roleTabsTestSource).toContain(
      'describe("getTabsForRole"',
    );
    expect(roleTabsTestSource).toContain(
      'getTabsForRole("housekeeper")',
    );
    expect(roleTabsTestSource).toContain(
      'getTabsForRole("housekeeping_supervisor")',
    );
    expect(roleTabsTestSource).toContain(
      'getTabsForRole("engineer")',
    );
  });
});

describe("staff-facing locale contract", () => {
  it("keeps every English and Spanish locale leaf key paired", () => {
    const english = localeLeafKeys("i18n/locales/en.json");
    const spanish = localeLeafKeys("i18n/locales/es.json");

    expect(english.length).toBeGreaterThan(900);
    expect(spanish).toEqual(english);
  });
});
