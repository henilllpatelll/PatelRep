/* Design System V2 is the permanent design for every hotel and role. There is no tenant flag, preview variable,
   scope gate or activation sync: these tests pin that nothing can bring the legacy look back. */
import fs from "fs";
import path from "path";
import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";

let mockMode: "light" | "dark" = "light";
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));

import { darkThemeV2, lightThemeV2 } from "@/components/shared/tokensV2";
import { DesignV2Scope, useDesignV2Scope, useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { useChromeTheme, useHousekeeperAccent, useTheme } from "@/lib/theme/useTheme";

const MOBILE_ROOT = path.resolve(__dirname, "../../..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "../..");
const read = (rel: string, root = MOBILE_ROOT) => fs.readFileSync(path.join(root, rel), "utf8");

const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(MOBILE_ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : walk(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });

function Probe() {
  const theme = useTheme();
  const chrome = useChromeTheme();
  const accent = useHousekeeperAccent();
  return (
    <>
      <Text testID="action">{theme.primaryAction}</Text>
      <Text testID="chrome">{chrome.primaryAction}</Text>
      <Text testID="accent">{accent.bg}</Text>
      <Text testID="v2">{String(useIsDesignV2())}</Text>
      <Text testID="scope">{String(useDesignV2Scope().active)}</Text>
    </>
  );
}

beforeEach(() => {
  mockMode = "light";
});

describe("V2 with no provider, no scope and no tenant setting", () => {
  it.each([
    ["light", lightThemeV2],
    ["dark", darkThemeV2],
  ] as const)("screens, chrome and the housekeeper accent are V2 (%s)", (mode, theme) => {
    mockMode = mode;
    const r = render(<Probe />);
    expect(r.getByTestId("action").props.children).toBe(theme.primaryAction);
    expect(r.getByTestId("chrome").props.children).toBe(theme.primaryAction);
    expect(r.getByTestId("accent").props.children).toBe(theme.primary);
    expect(r.getByTestId("v2").props.children).toBe("true");
    expect(r.getByTestId("scope").props.children).toBe("true");
  });

  it("a scope only pins light/dark; it can never switch V2 off", () => {
    const r = render(
      <DesignV2Scope mode="dark">
        <Probe />
      </DesignV2Scope>,
    );
    expect(r.getByTestId("action").props.children).toBe(darkThemeV2.primaryAction);
    expect(r.getByTestId("v2").props.children).toBe("true");
  });
});

describe("no activation logic remains", () => {
  const sources = ["app", "components", "lib", "stores", "i18n"].flatMap(walk);

  it.each([
    "lib/design/designV2.ts",
    "lib/design/designV2Store.ts",
    "lib/design/useDesignV2Active.ts",
    "lib/design/useDesignV2Sync.ts",
    "app/design-v2-preview.tsx",
  ])("%s is gone", (rel) => {
    expect(fs.existsSync(path.join(MOBILE_ROOT, rel))).toBe(false);
  });

  it("nothing reads the retired flag, the preview variable or the old decision functions", () => {
    const offenders = sources.filter((f) =>
      /design_v2|DESIGN_V2_PREVIEW|isDesignV2Enabled|isDesignV2Preview|useDesignV2Active|useDesignV2Sync|useDesignV2Store|enabled_features/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("the only public Design V2 hooks are the always-true scope helpers", () => {
    expect(read("lib/design/DesignV2Scope.tsx")).not.toMatch(/process\.env|enabled\b|useDesignV2Active/);
  });

  it("the signed-in layout has no gate, preview dependency or legacy tab bar", () => {
    const layout = read("app/(app)/_layout.tsx");
    expect(layout).not.toMatch(/isV2SurfaceRole|DesignV2Scope|designV2\b|tabBarActiveTintColor: theme\.shell/);
    expect(layout).toContain("buildTabScreenOptionsV2(chrome, insets.bottom, navTabs.length)");
  });

  it("the sign-in stack is V2 without a scope or a hotel setting", () => {
    const layout = read("app/(auth)/_layout.tsx");
    expect(layout).not.toMatch(/DesignV2Scope|enabled|process\.env/);
  });

  it("no EAS profile, example env file or workflow sets a preview variable", () => {
    expect(read("eas.json")).not.toMatch(/DESIGN_V2/);
    expect(read(".env.example")).not.toMatch(/DESIGN_V2/);
    const wf = path.join(REPO_ROOT, ".github/workflows");
    const offenders = fs.readdirSync(wf).filter((n) => /DESIGN_V2_PREVIEW/.test(fs.readFileSync(path.join(wf, n), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the account-switch path no longer holds any design state", () => {
    expect(read("stores/appStore.ts")).not.toMatch(/design/i);
  });
});
