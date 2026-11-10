import fs from "fs";
import path from "path";
import React from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { render } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { lightTheme } from "@/components/shared/tokens";
import { lightThemeV2 } from "@/components/shared/tokensV2";

/* Design System V2 Phase 5 (Engineer + Chief Engineer): the role gate, the flag-off contract, the theme-aware
   category chips, and a guard that no engineering file keeps an un-migrated uppercase micro-label. */


jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator("en"), i18n: { language: "en", resolvedLanguage: "en" } }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => "light" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text: RNText } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => ReactRuntime.createElement(RNText, null, name) };
});

import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { isEngineeringV2Role, isHousekeeperV2Role, isInspectorSupervisorV2Role, isV2SurfaceRole } from "@/lib/design/housekeeperV2";
import { CATEGORY_META, useCategoryMeta } from "@/components/engineering/WorkOrderCard";
import { WorkOrderNextAction } from "@/components/engineering/workorder/WorkOrderNextAction";

const flat = (node: { props: Record<string, unknown> }) => StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) as TextStyle;
// V2 is unconditional: the first argument is kept only so existing call sites read the same.
const gated = (_enabled: boolean, ui: React.ReactElement) => render(<DesignV2Scope>{ui}</DesignV2Scope>);

beforeEach(() => {
});

describe("role gate", () => {
  it("Engineer and Chief Engineer are in the migrated surface; Front Desk and GM are not", () => {
    for (const role of ["engineer", "chief_engineer"]) {
      expect(isEngineeringV2Role(role)).toBe(true);
      expect(isV2SurfaceRole(role)).toBe(true);
    }
    for (const role of ["front_desk", "gm", "housekeeper", "inspector", "housekeeping_supervisor", "", null, undefined]) {
      expect(isEngineeringV2Role(role as string)).toBe(false);
    }
    // Phase 6 deliberately moved Front Desk and GM into the migrated surface.
    for (const role of ["front_desk", "gm"]) expect(isV2SurfaceRole(role)).toBe(true);
    for (const role of ["", null, undefined]) expect(isV2SurfaceRole(role as string)).toBe(false);
  });

  it("earlier phase gates are unchanged", () => {
    expect(isHousekeeperV2Role("housekeeper")).toBe(true);
    expect(isHousekeeperV2Role("engineer")).toBe(false);
    expect(isInspectorSupervisorV2Role("engineer")).toBe(false);
    expect(isInspectorSupervisorV2Role("inspector")).toBe(true);
  });
});

describe("theme-aware category chips", () => {
  function Probe() {
    const meta = useCategoryMeta();
    return <>{React.createElement("Probe" as never, { testID: "meta", meta } as never)}</>;
  }
  const read = (enabled: boolean) => gated(enabled, <Probe />).getByTestId("meta").props.meta as typeof CATEGORY_META;

  it("inside the scope: the same categories and icons, coloured from the V2 theme", () => {
    const meta = read(true);
    expect(Object.keys(meta)).toEqual(Object.keys(CATEGORY_META));
    for (const key of Object.keys(CATEGORY_META)) expect(meta[key].icon).toBe(CATEGORY_META[key].icon);
    expect(meta.plumbing.fg).toBe(lightThemeV2.status.clean);
    expect(meta.safety.bg).toBe(lightThemeV2.status.dirtySoft);
  });

});

describe("engineering presentation follows the scope", () => {
  it("scope on: sentence-case kicker; off: the legacy uppercase micro-label", () => {
    const on = gated(true, <WorkOrderNextAction step="viewRecord" barVisible={false} />);
    expect(flat(on.getByText("Next step")).textTransform).toBe("none");
  });
});

describe("un-migrated uppercase guard", () => {
  const roots = [
    "components/engineering",
    "app/(app)/work-orders",
    "app/(app)/pm-schedules",
    "app/(app)/assets",
    "app/(app)/more",
    "app/(app)/engineering-sync",
    "app/(app)/room-status",
    "app/(app)/team",
  ];
  // The printed QR label is a physical sticker: fixed black on white by design, never themed.
  const EXEMPT = new Set(["app/(app)/assets/label/[assetId].tsx"]);
  const base = path.resolve(__dirname, "../..");
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  it("every engineering file with an uppercase style or toUpperCase layers the V2 text helper", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(path.join(base, root))) {
        const rel = path.relative(base, file).split(path.sep).join("/");
        if (EXEMPT.has(rel)) continue;
        const src = fs.readFileSync(file, "utf8");
        if (/textTransform:\s*"uppercase"|\.toUpperCase\(\)/.test(src) && !src.includes("useV2Text")) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
