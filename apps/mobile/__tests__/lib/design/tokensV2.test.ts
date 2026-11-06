import {
  darkStatusTokens,
  darkTheme,
  lightTheme,
  statusTokens,
} from "@/components/shared/tokens";
import {
  darkThemeV2,
  elevationV2,
  getThemeTokensV2,
  lightThemeV2,
  paletteV2,
  radiusV2,
  spaceV2,
  statusV2,
  touchV2,
  typeV2,
} from "@/components/shared/tokensV2";
import {
  compositedContrastRatio,
  contrastRatio,
  parseColor,
} from "@/__tests__/helpers/contrast";

const TEXT = 4.5;
const UI = 3;

/** Compile-time proof that V2 has the exact key shape of the legacy theme (strings widened). */
type Widen<T> = T extends string
  ? string
  : T extends object
    ? { -readonly [K in keyof T]: Widen<T[K]> }
    : T;
export const _lightShape: Widen<typeof lightTheme> = lightThemeV2;
export const _darkShape: Widen<typeof darkTheme> = darkThemeV2;

/** Contrast of `fg` over a (possibly translucent) fill that sits on `base`. */
function onFill(fg: string, fill: string, base: string): number {
  return parseColor(fill).alpha === 1
    ? contrastRatio(fg, fill)
    : compositedContrastRatio(fg, fill, base);
}

function leafKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe.each(["light", "dark"] as const)("Design V2 %s palette", (mode) => {
  const p = paletteV2[mode];
  const s = statusV2[mode];
  const theme = getThemeTokensV2(mode);
  const surfaces = { background: p.background, surface: p.surface, surfaceSecondary: p.surfaceSecondary };

  it.each(Object.entries(surfaces))("text tiers are >= 4.5:1 on %s", (_name, bg) => {
    expect(contrastRatio(p.textPrimary, bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(p.textSecondary, bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(p.textMuted, bg)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(Object.entries(surfaces))("primary action text/icon is >= 4.5:1 on %s", (_name, bg) => {
    expect(contrastRatio(p.primary, bg)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(Object.entries(surfaces))("form-field edge (borderStrong) is >= 3:1 on %s", (_name, bg) => {
    expect(contrastRatio(p.borderStrong, bg)).toBeGreaterThanOrEqual(UI);
  });

  it("filled controls keep readable labels, idle and pressed", () => {
    expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(p.onPrimary, p.primaryPressed)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(p.onDestructive, p.destructive)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(p.onAi, p.ai)).toBeGreaterThanOrEqual(TEXT);
  });

  it("accent and AI text are readable on their soft fills", () => {
    for (const base of Object.values(surfaces)) {
      expect(onFill(p.primary, p.primarySoft, base)).toBeGreaterThanOrEqual(TEXT);
      expect(onFill(p.ai, p.aiSoft, base)).toBeGreaterThanOrEqual(TEXT);
    }
    expect(contrastRatio(p.ai, p.surface)).toBeGreaterThanOrEqual(TEXT);
  });

  const statusNames = ["ready", "clean", "inProgress", "dirty", "occupied", "pickup", "outOfOrder"] as const;
  describe.each(statusNames)("status %s", (name) => {
    const fg = s[name];
    const soft = s[`${name}Soft` as keyof typeof s] as string;
    it("text/icon is >= 4.5:1 on its soft fill over every surface", () => {
      for (const base of Object.values(surfaces)) {
        expect(onFill(fg, soft, base)).toBeGreaterThanOrEqual(TEXT);
      }
    });
    it("text/icon is >= 4.5:1 directly on every surface", () => {
      for (const base of Object.values(surfaces)) {
        expect(contrastRatio(fg, base)).toBeGreaterThanOrEqual(TEXT);
      }
    });
  });

  it("navigation chrome text is readable on the dark shell", () => {
    expect(contrastRatio(theme.shell.ink, theme.shell.bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(theme.shell.ink2, theme.shell.bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(theme.shell.ink3, theme.shell.bg)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(theme.shell.ink, theme.shell.raised)).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(theme.shell.ink2, theme.shell.raised)).toBeGreaterThanOrEqual(TEXT);
  });

  it("toast and offline banner foregrounds are readable", () => {
    for (const t of Object.values(theme.toast)) {
      expect(contrastRatio(t.foreground, t.background)).toBeGreaterThanOrEqual(TEXT);
    }
    expect(
      contrastRatio(theme.banner.offline.foreground, theme.banner.offline.background),
    ).toBeGreaterThanOrEqual(TEXT);
  });

  it("disabled label stays >= 3:1 on the disabled fill (exempt from AA, kept legible)", () => {
    for (const base of Object.values(surfaces)) {
      expect(onFill(theme.onDisabled, theme.primarySoft, base)).toBeGreaterThanOrEqual(UI);
    }
  });
});

describe("Design V2 contract", () => {
  it("uses the exact headline palette from the V2 brief", () => {
    expect(paletteV2.light).toMatchObject({
      background: "#F6F8FC",
      surface: "#FFFFFF",
      surfaceSecondary: "#EEF2F8",
      textPrimary: "#0D1728",
      textSecondary: "#536277",
      border: "#DDE4EE",
      primary: "#2563EB",
      navSurface: "#0D1728",
      ai: "#7C3AED",
    });
    expect(paletteV2.dark).toMatchObject({
      background: "#0B1220",
      surface: "#111C2E",
      surfaceSecondary: "#19263A",
      textPrimary: "#F3F7FC",
      textSecondary: "#A8B6CA",
      border: "#2A3B51",
      primary: "#60A5FA",
      ai: "#A78BFA",
    });
  });

  it("keeps the briefed light status colors except the two documented deviations", () => {
    expect(statusV2.light).toMatchObject({
      ready: "#047857",
      clean: "#0E7490",
      inProgress: "#7C3AED",
      dirty: "#C2414B",
      occupied: "#475569",
    });
    // Brief says #B45309; that is 4.47:1 on surfaceSecondary, so V2 ships #B04F08.
    expect(statusV2.light.pickup).toBe("#B04F08");
    // Brief says #64748B; that is 4.2:1 on its own soft fill, so V2 ships #566379.
    expect(statusV2.light.outOfOrder).toBe("#566379");
  });

  it("has exactly the legacy theme's keys (plus none missing) in both modes", () => {
    const legacyLight = leafKeys(lightTheme);
    const v2Light = leafKeys(lightThemeV2);
    expect(v2Light).toEqual(expect.arrayContaining(legacyLight));
    const legacyDark = leafKeys(darkTheme);
    const v2Dark = leafKeys(darkThemeV2);
    expect(v2Dark).toEqual(expect.arrayContaining(legacyDark));
  });

  it("exposes every legacy status key so adapters stay 1:1", () => {
    expect(Object.keys(statusV2.light)).toEqual(expect.arrayContaining(Object.keys(statusTokens)));
    expect(Object.keys(statusV2.dark)).toEqual(expect.arrayContaining(Object.keys(darkStatusTokens)));
  });

  it("keeps the legacy 'Evening Lobby' tokens byte-for-byte (V2 never rewrites them)", () => {
    expect(lightTheme.background).toBe("#F8F1E7");
    expect(lightTheme.primaryAction).toBe("#4F7A5A");
    expect(darkTheme.background).toBe("#0F0D0B");
    expect(statusTokens.ready).toBe("#0E7468");
    expect(statusTokens.dirty).toBe("#A9363F");
    expect(statusTokens.occupied).toBe("#A9363F");
    expect(darkStatusTokens.ready).toBe("#76CBBB");
    expect(getThemeTokensV2("light")).not.toBe(lightTheme);
  });

  it("defines scales that match the documented standards", () => {
    expect(radiusV2.card).toBe(16);
    expect(radiusV2.hero).toBe(18);
    expect(radiusV2.card).toBeGreaterThanOrEqual(14);
    expect(radiusV2.hero).toBeLessThanOrEqual(18);
    expect(touchV2.min).toBeGreaterThanOrEqual(44);
    expect(touchV2.comfortable).toBeGreaterThanOrEqual(48);
    expect(spaceV2.page).toBe(16);
    expect(typeV2.body.fontSize).toBeGreaterThanOrEqual(16);
    expect(typeV2.micro.fontSize).toBeGreaterThanOrEqual(12);
    expect(elevationV2.dark.card.shadowOpacity).toBe(0);
  });
});
