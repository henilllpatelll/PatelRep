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
import { DESIGN_V2_CONTEXT_MAX_AGE_MS, designV2OwnerKey, useDesignV2Store } from "@/lib/design/designV2Store";
import { isV2SurfaceRole } from "@/lib/design/housekeeperV2";
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

/** What the hotel said, as the refresh would store it for the current person (the transport is covered elsewhere). */
const setHotelAnswer = (enabled: boolean, who = useAppStore.getState().user) =>
  act(() => {
    useDesignV2Store.getState().apply({ ownerKey: designV2OwnerKey(who) as string, enabled, fetchedAt: Date.now() });
  });

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

const LEGACY_MONO = LEGACY_TYPOGRAPHY.mono;

beforeEach(() => {
  mockMode = "light";
  useDesignV2Store.getState().clear();
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

describe("static sheets follow the live flag in place (no remount)", () => {
  it("defaults to the exact legacy presentation (signed out, nothing read)", () => {
    const r = render(scoped(<Sheet />));
    expect(flat(r, "kicker")).toMatchObject({ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: "700" });
    expect(flat(r, "big")).toMatchObject({ fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase" });
    expect(flat(r, "num")).toMatchObject({ fontFamily: LEGACY_MONO, fontSize: 28 });
    expect(flat(r, "num").fontVariant).toBeUndefined();
    expect(flat(r, "accent")).toMatchObject({ fontFamily: "InstrumentSerif_400Regular" });
    expect(flat(r, "plain")).toEqual({ fontSize: 15 });
  });

  it("ON -> OFF -> ON in one mounted tree, restoring the legacy styles byte-for-byte", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(scoped(<Sheet />));
    const legacy = ["kicker", "big", "num", "accent", "plain"].map((id) => flat(r, id));

    setHotelAnswer(true);
    expect(flat(r, "kicker")).toMatchObject({ fontSize: 12, letterSpacing: 0, textTransform: "none", fontWeight: "700" });
    expect(flat(r, "big")).toMatchObject({ fontSize: 14, letterSpacing: 0, textTransform: "none" });
    expect(flat(r, "num")).toMatchObject({ fontFamily: V2_SANS, fontSize: 28, fontVariant: ["tabular-nums"] });
    expect(flat(r, "accent")).toMatchObject({ fontFamily: V2_SANS });
    expect(flat(r, "accent").fontVariant).toBeUndefined();
    expect(flat(r, "plain")).toEqual({ fontSize: 15 });

    setHotelAnswer(false);
    expect(["kicker", "big", "num", "accent", "plain"].map((id) => flat(r, id))).toEqual(legacy);

    setHotelAnswer(true);
    expect(flat(r, "kicker").textTransform).toBe("none");
    expect(flat(r, "num").fontFamily).toBe(V2_SANS);
  });

  it("outside an active scope (flag on but role-gated off, or no scope) it is exactly legacy", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const gatedOff = render(
      <DesignV2Scope enabled={false}>
        <Sheet />
      </DesignV2Scope>,
    );
    const bare = render(<Sheet />);
    setHotelAnswer(true);
    for (const r of [gatedOff, bare]) {
      expect(flat(r, "kicker")).toMatchObject({ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase" });
      expect(flat(r, "num").fontFamily).toBe(LEGACY_MONO);
    }
  });

  it("one mounted instance is never remounted by a toggle", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    let mounts = 0;
    function Counted() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <Sheet />;
    }
    const r = render(scoped(<Counted />));
    setHotelAnswer(true);
    setHotelAnswer(false);
    setHotelAnswer(true);
    expect(mounts).toBe(1);
    expect(flat(r, "kicker").textTransform).toBe("none");
  });

  it.each(ROLES.flatMap((role) => (["light", "dark"] as const).map((mode) => [role, mode] as const)))(
    "%s / %s: toggles ON -> OFF -> ON with the role's surface scope",
    (role, mode) => {
      mockMode = mode;
      useAppStore.getState().setUser(user("u1", "A", role));
      const r = render(
        <DesignV2Scope enabled={isV2SurfaceRole(role)}>
          <Sheet />
        </DesignV2Scope>,
      );
      expect(isV2SurfaceRole(role)).toBe(true);
      expect(flat(r, "kicker").textTransform).toBe("uppercase");
      setHotelAnswer(true);
      expect(flat(r, "kicker")).toMatchObject({ textTransform: "none", letterSpacing: 0, fontSize: 12 });
      expect(flat(r, "num").fontFamily).toBe(V2_SANS);
      setHotelAnswer(false);
      expect(flat(r, "kicker")).toMatchObject({ textTransform: "uppercase", letterSpacing: 1.2, fontSize: 10.5 });
      expect(flat(r, "num").fontFamily).toBe(LEGACY_MONO);
      setHotelAnswer(true);
      expect(flat(r, "kicker").textTransform).toBe("none");
    },
  );

  it.each(["Habitaciones sucias", "Dirty rooms", "Órdenes de trabajo — ¡Urgente!"])(
    "English / Spanish text is never rewritten by the style layer: %s",
    (label) => {
      useAppStore.getState().setUser(user("u1", "A"));
      const r = render(scoped(<Sheet>{label}</Sheet>));
      setHotelAnswer(true);
      expect(r.getByTestId("kicker").props.children).toBe(label);
      expect(flat(r, "kicker").textTransform).toBe("none");
      setHotelAnswer(false);
      expect(r.getByTestId("kicker").props.children).toBe(label);
      expect(flat(r, "kicker").textTransform).toBe("uppercase");
    },
  );

  it("real shared component (SectionLabel + its mono hint) re-styles live", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(scoped(<SectionLabel hint="12">Etiqueta</SectionLabel>));
    const label = () => StyleSheet.flatten(r.getByText("Etiqueta").props.style) as TextStyle;
    const hint = () => StyleSheet.flatten(r.getByText("12").props.style) as TextStyle;
    expect(label().textTransform).toBe("uppercase");
    expect(hint().fontFamily).toBe(LEGACY_MONO);
    setHotelAnswer(true);
    expect(label()).toMatchObject({ textTransform: "none", letterSpacing: 0 });
    expect(label().fontSize).toBeGreaterThanOrEqual(12);
    expect(hint()).toMatchObject({ fontFamily: V2_SANS, fontVariant: ["tabular-nums"] });
    setHotelAnswer(false);
    expect(label().textTransform).toBe("uppercase");
    expect(hint().fontFamily).toBe(LEGACY_MONO);
  });

  it("useTypography() gives memoizable stable modes that flip with the flag", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const seen: unknown[] = [];
    function Spy() {
      seen.push(useTypography());
      return null;
    }
    render(scoped(<Spy />));
    setHotelAnswer(true);
    setHotelAnswer(true);
    setHotelAnswer(false);
    expect(seen[0]).toBe(LEGACY_TYPOGRAPHY);
    expect(seen).toContain(V2_TYPOGRAPHY);
    expect(seen[seen.length - 1]).toBe(LEGACY_TYPOGRAPHY);
  });
});

describe("account, hotel and sign-out changes", () => {
  it("switching account or hotel drops to legacy at once; the previous design never shows", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(scoped(<Sheet />));
    setHotelAnswer(true);
    expect(flat(r, "kicker").textTransform).toBe("none");

    act(() => useAppStore.getState().setUser(user("u2", "A")));
    expect(flat(r, "kicker").textTransform).toBe("uppercase");

    setHotelAnswer(true);
    act(() => useAppStore.getState().setUser(user("u2", "B")));
    expect(flat(r, "kicker").textTransform).toBe("uppercase");
    expect(flat(r, "num").fontFamily).toBe(LEGACY_MONO);
  });

  it("hotel A on / hotel B off stay independent for the same device", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(scoped(<Sheet />));
    setHotelAnswer(true);
    act(() => useAppStore.getState().setUser(user("u1", "B")));
    setHotelAnswer(false);
    expect(flat(r, "kicker").textTransform).toBe("uppercase");
    act(() => useAppStore.getState().setUser(user("u1", "A")));
    expect(flat(r, "kicker").textTransform).toBe("uppercase");
    setHotelAnswer(true);
    expect(flat(r, "kicker").textTransform).toBe("none");
  });

  it("sign-out reverts to legacy immediately", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(scoped(<Sheet />));
    setHotelAnswer(true);
    act(() => useAppStore.getState().setUser(null));
    expect(flat(r, "kicker").textTransform).toBe("uppercase");
  });
});

describe("offline expiry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a read that ages out reverts the mounted tree by itself, and only then", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(scoped(<Sheet />));
    setHotelAnswer(true);
    expect(flat(r, "kicker").textTransform).toBe("none");
    act(() => {
      jest.advanceTimersByTime(DESIGN_V2_CONTEXT_MAX_AGE_MS - 1_000);
    });
    expect(flat(r, "kicker").textTransform).toBe("none");
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(flat(r, "kicker").textTransform).toBe("uppercase");
    expect(flat(r, "num").fontFamily).toBe(LEGACY_MONO);
    // A fresh read brings it back.
    setHotelAnswer(true);
    expect(flat(r, "kicker").textTransform).toBe("none");
  });

  it("many subscribers share one timer and it is released on unmount", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const many = render(
      scoped(
        <View>
          {Array.from({ length: 40 }, (_, i) => (
            <Sheet key={i} />
          ))}
        </View>,
      ),
    );
    setHotelAnswer(true);
    expect(jest.getTimerCount()).toBe(1);
    many.unmount();
    expect(jest.getTimerCount()).toBe(0);
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
