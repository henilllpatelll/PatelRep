import fs from "fs";
import path from "path";
import React from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { act, render } from "@testing-library/react-native";

let mockMode: "light" | "dark" = "light";
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));
jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/api/client", () => ({
  ApiError: class extends Error {},
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/auth/secureSessionStorage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

import { SectionLabel } from "@/components/shared/mobileHandoff";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import {
  LEGACY_TYPOGRAPHY,
  V2_SANS,
  V2_TYPOGRAPHY,
  createTypographyStyles,
  useTypography,
} from "@/lib/design/reactiveTypography";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile, UserRole } from "@/lib/supabase";

const ROLES: UserRole[] = ["housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm"];
const MOBILE_ROOT = path.resolve(__dirname, "../../..");

const user = (id: string, tenant: string, role: UserRole = "gm"): UserProfile =>
  ({ id, tenant_id: tenant, role, full_name: "Test", language_pref: "en" }) as UserProfile;

const useSheet = createTypographyStyles((t) => ({
  kicker: { fontSize: t.labelSize(10.5), letterSpacing: t.tracking(1.2), textTransform: t.labelCase, fontWeight: "700" },
  big: { fontSize: 14, letterSpacing: t.tracking(0.4), textTransform: t.labelCase },
  num: { fontFamily: t.mono, fontSize: 28 },
  accent: { fontFamily: t.serif, fontSize: 22 },
  plain: { fontSize: 15 },
}));

function Sheet({ children = "Habitaciones sucias" }: { children?: string }) {
  const styles = useSheet();
  return (
    <View>
      <Text testID="kicker" style={styles.kicker}>{children}</Text>
      <Text testID="big" style={styles.big}>{children}</Text>
      <Text testID="num" style={styles.num}>101</Text>
      <Text testID="accent" style={styles.accent}>Hola</Text>
      <Text testID="plain" style={styles.plain}>x</Text>
    </View>
  );
}
const scoped = (ui: React.ReactElement) => <DesignV2Scope>{ui}</DesignV2Scope>;
const flat = (r: ReturnType<typeof render>, id: string) => StyleSheet.flatten(r.getByTestId(id).props.style) as TextStyle;

beforeEach(() => {
  mockMode = "light";
  useAppStore.getState().setUser(null);
});

describe("typography modes (pure, flag-free)", () => {
  it("legacy is exactly the previous static presentation", () => {
    expect(LEGACY_TYPOGRAPHY.labelCase).toBe("uppercase");
    expect(LEGACY_TYPOGRAPHY.tracking(0.9)).toBe(0.9);
    expect(LEGACY_TYPOGRAPHY.labelSize(10.5)).toBe(10.5);
    expect(LEGACY_TYPOGRAPHY.serif).toBe("InstrumentSerif_400Regular");
    expect(String(LEGACY_TYPOGRAPHY.mono)).toMatch(/IBMPlexMono_500Medium|monospace/);
  });
  it("V2 is sentence case, no tracking, a 12 floor and the system sans", () => {
    expect(V2_TYPOGRAPHY.labelCase).toBe("none");
    expect(V2_TYPOGRAPHY.tracking(0.9)).toBe(0);
    expect(V2_TYPOGRAPHY.labelSize(10.5)).toBe(12);
    expect(V2_TYPOGRAPHY.labelSize(14)).toBe(14);
    expect(V2_TYPOGRAPHY.mono).toBe(V2_SANS);
    expect(V2_TYPOGRAPHY.serif).toBe(V2_SANS);
  });
});

describe("static sheets are always V2 (no flag, scope or hotel setting)", () => {
  const expectV2 = (r: ReturnType<typeof render>) => {
    expect(flat(r, "kicker")).toMatchObject({ textTransform: "none", letterSpacing: 0 });
    expect(flat(r, "kicker").fontSize).toBeGreaterThanOrEqual(12);
    expect(flat(r, "num")).toMatchObject({ fontFamily: V2_SANS, fontVariant: ["tabular-nums"] });
    expect(flat(r, "accent").fontFamily).toBe(V2_SANS);
    expect(flat(r, "plain").fontSize).toBe(15);
  };

  it("renders V2 with no scope at all (a modal, toast or sheet mounted outside the layout)", () => {
    expectV2(render(<Sheet />));
  });

  it("renders V2 inside a scope, and a pinned mode does not change typography", () => {
    expectV2(render(scoped(<Sheet />)));
    expectV2(render(<DesignV2Scope mode="dark"><Sheet /></DesignV2Scope>));
  });

  it.each(ROLES.flatMap((role) => (["light", "dark"] as const).map((mode) => [role, mode] as const)))(
    "every role keeps V2 typography in either appearance (%s, %s)",
    (role, mode) => {
      mockMode = mode;
      useAppStore.getState().setUser(user("u1", "A", role));
      expectV2(render(<Sheet />));
    },
  );

  it("English and Spanish text is never altered by the style layer", () => {
    for (const text of ["Dirty rooms", "Habitaciones sucias"]) {
      const r = render(<Sheet>{text}</Sheet>);
      expect(r.getAllByText(text)).toHaveLength(2);
      r.unmount();
    }
  });

  it("switching account or hotel can never restore legacy styling", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(<Sheet />);
    expectV2(r);
    act(() => useAppStore.getState().setUser(user("u2", "B", "housekeeper")));
    expectV2(r);
    act(() => useAppStore.getState().setUser(null));
    expectV2(r);
  });

  it("a real shared component (SectionLabel + its numeric hint) is V2", () => {
    const r = render(<SectionLabel hint="12">Etiqueta</SectionLabel>);
    const label = StyleSheet.flatten(r.getByText("Etiqueta").props.style) as TextStyle;
    const hint = StyleSheet.flatten(r.getByText("12").props.style) as TextStyle;
    expect(label).toMatchObject({ textTransform: "none", letterSpacing: 0 });
    expect(hint).toMatchObject({ fontFamily: V2_SANS, fontVariant: ["tabular-nums"] });
  });

  it("useTypography() returns the stable V2 mode", () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useTypography());
      return null;
    }
    const r = render(<Probe />);
    r.rerender(<Probe />);
    expect(seen[0]).toBe(V2_TYPOGRAPHY);
    expect(seen[1]).toBe(seen[0]);
  });
});

describe("source contracts", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(MOBILE_ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : walk(rel);
      return /\.(ts|tsx)$/.test(e.name) ? [rel.replace(/\\/g, "/")] : [];
    });
  const read = (rel: string) => fs.readFileSync(path.join(MOBILE_ROOT, rel), "utf8");
  const sources = ["app", "components", "lib", "stores"].flatMap(walk);

  it("no module-level StyleSheet decides typography from the flag", () => {
    const offenders = sources.filter((f) => /StyleSheet\.create\([\s\S]*\b(monoFont|serifFont|microLabel(Case|Size|Tracking))\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the bundle-time micro-label helper is gone and the font constants no longer read the flag", () => {
    expect(fs.existsSync(path.join(MOBILE_ROOT, "lib/design/microLabel.ts"))).toBe(false);
    expect(sources.filter((f) => /design\/microLabel/.test(read(f)))).toEqual([]);
    expect(read("components/shared/tokens.ts")).not.toMatch(/isDesignV2Enabled|designV2/);
  });

  it("the typography module reads no tenant state and no environment at initialization", () => {
    const src = read("lib/design/reactiveTypography.ts");
    expect(src).not.toMatch(/isDesignV2Enabled|useDesignV2Store|process\.env/);
  });

  it("print and QR labels keep their intentional uppercase and never use the reactive layer", () => {
    const src = read("app/(app)/assets/label/[assetId].tsx");
    expect(src).toMatch(/textTransform:\s*"uppercase"/);
    expect(src).not.toMatch(/reactiveTypography|useTypography|createTypographyStyles/);
  });
});
