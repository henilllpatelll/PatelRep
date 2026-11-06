/* ─── PatelRep Design System V2 — "Precision Slate + Electric Blue" ──────────
   Single source of truth for the V2 palette on MOBILE. Pure TypeScript with
   no react-native import so the web workspace's parity test can import this
   file directly (apps/web/lib/design/designV2Tokens.test.ts).

   Nothing here replaces `tokens.ts`. V2 is only ever read through
   `getThemeTokensV2()`, and only `useTheme()` inside an active
   `<DesignV2Scope>` returns it (see lib/design/DesignV2Scope.tsx). The legacy
   "Evening Lobby" tokens and their protected status contract are untouched.

   Contrast: every text/background pairing below is asserted in
   __tests__/lib/design/tokensV2.test.ts (≥4.5:1 text, ≥3:1 essential UI). */

export type ThemeModeV2 = "light" | "dark";

/** The headline palette from the V2 brief plus the derived soft/line/pressed values. */
export const paletteV2 = {
  light: {
    background: "#F6F8FC",
    surface: "#FFFFFF",
    surfaceSecondary: "#EEF2F8",
    textPrimary: "#0D1728",
    textSecondary: "#536277",
    // Deviation: lighter-than-secondary text that still clears 4.5:1 on surfaceSecondary.
    textMuted: "#5B6B82",
    // Subtle separator / card edge (the brief's "Border"). NOT sufficient for form-field edges.
    border: "#DDE4EE",
    // Essential-UI edge (inputs, outlined controls): ≥3:1 on every surface. Documented addition.
    borderStrong: "#7A8BA1",
    primary: "#2563EB",
    primaryPressed: "#1D4ED8",
    primarySoft: "#EAF1FE",
    primaryLine: "#B9CDF8",
    onPrimary: "#FFFFFF",
    destructive: "#C2414B",
    onDestructive: "#FFFFFF",
    navSurface: "#0D1728",
    ai: "#7C3AED",
    aiSoft: "#F3EDFE",
    aiLine: "#D5C3FA",
    onAi: "#FFFFFF",
  },
  dark: {
    background: "#0B1220",
    surface: "#111C2E",
    surfaceSecondary: "#19263A",
    textPrimary: "#F3F7FC",
    textSecondary: "#A8B6CA",
    textMuted: "#8A9BB3",
    border: "#2A3B51",
    borderStrong: "#6B7F99",
    primary: "#60A5FA",
    primaryPressed: "#3B82F6",
    primarySoft: "rgba(96, 165, 250, 0.16)",
    primaryLine: "rgba(96, 165, 250, 0.40)",
    onPrimary: "#0B1220",
    destructive: "#F87171",
    onDestructive: "#1C0D0F",
    navSurface: "#0D1728",
    ai: "#A78BFA",
    aiSoft: "rgba(167, 139, 250, 0.12)",
    aiLine: "rgba(167, 139, 250, 0.42)",
    onAi: "#140B2E",
  },
} as const;

/** Semantic status colors. Key names mirror the legacy `statusTokens` so adapters stay 1:1.
 *  Foreground values are text-safe (≥4.5:1 on their own soft fill) and always paired with an
 *  icon + text label — color is never the only signal. */
export const statusV2 = {
  light: {
    ready: "#047857",
    clean: "#0E7490",
    inProgress: "#7C3AED",
    dirty: "#C2414B",
    occupied: "#475569",
    // Deviation: the brief says #B45309, which is 4.47:1 on surfaceSecondary; #B04F08 clears 4.5:1.
    pickup: "#B04F08",
    // Deviation: the brief's #64748B is 4.2:1 on its soft fill; #566379 clears 4.5:1.
    outOfOrder: "#566379",
    readySoft: "#E8F5EF",
    readyLine: "#A7D8C4",
    cleanSoft: "#E8F4F8",
    cleanLine: "#A6D3DF",
    inProgressSoft: "#F3EDFE",
    inProgressLine: "#D5C3FA",
    dirtySoft: "#FDF1F2",
    dirtyLine: "#EFB5BA",
    occupiedSoft: "#EDF0F4",
    occupiedLine: "#C3CCD8",
    pickupSoft: "#FCF5EA",
    pickupLine: "#EBC79C",
    outOfOrderSoft: "#EEF1F5",
    outOfOrderLine: "#C3CCD8",
  },
  dark: {
    ready: "#34D399",
    clean: "#22D3EE",
    inProgress: "#B9A2FC",
    dirty: "#FA8686",
    occupied: "#A3B1C4",
    pickup: "#FBBF24",
    outOfOrder: "#A3B1C4",
    readySoft: "rgba(52, 211, 153, 0.14)",
    readyLine: "rgba(52, 211, 153, 0.40)",
    cleanSoft: "rgba(34, 211, 238, 0.14)",
    cleanLine: "rgba(34, 211, 238, 0.40)",
    inProgressSoft: "rgba(185, 162, 252, 0.14)",
    inProgressLine: "rgba(185, 162, 252, 0.40)",
    dirtySoft: "rgba(250, 134, 134, 0.14)",
    dirtyLine: "rgba(250, 134, 134, 0.40)",
    occupiedSoft: "rgba(163, 177, 196, 0.14)",
    occupiedLine: "rgba(163, 177, 196, 0.40)",
    pickupSoft: "rgba(251, 191, 36, 0.14)",
    pickupLine: "rgba(251, 191, 36, 0.40)",
    outOfOrderSoft: "rgba(163, 177, 196, 0.14)",
    outOfOrderLine: "rgba(163, 177, 196, 0.40)",
  },
} as const;

/** Dark navigation chrome (tab bar, sidebar). Dark in BOTH modes per the brief. */
const shellV2 = {
  light: {
    bg: "#0D1728",
    surface: "#14213A",
    raised: "#1B2A45",
    line: "#2F4260",
    ink: "#F3F7FC",
    ink2: "#A8B6CA",
    ink3: "#8A9BB3",
  },
  dark: {
    bg: "#070D18",
    surface: "#0D1728",
    raised: "#14213A",
    line: "#2A3B51",
    ink: "#F3F7FC",
    ink2: "#A8B6CA",
    ink3: "#8A9BB3",
  },
} as const;

const aiV2 = {
  light: {
    primary: paletteV2.light.ai,
    secondary: "#0E7490",
    electric: "#2563EB",
    soft: paletteV2.light.aiSoft,
    line: paletteV2.light.aiLine,
    glow: "rgba(124, 58, 237, 0.18)",
  },
  dark: {
    primary: paletteV2.dark.ai,
    secondary: "#22D3EE",
    electric: "#60A5FA",
    soft: paletteV2.dark.aiSoft,
    line: paletteV2.dark.aiLine,
    glow: "rgba(167, 139, 250, 0.28)",
  },
} as const;

function buildTheme(mode: ThemeModeV2) {
  const p = paletteV2[mode];
  const s = statusV2[mode];
  const dark = mode === "dark";
  return {
    background: p.background,
    surface: p.surface,
    surfaceSubtle: p.surfaceSecondary,
    surfaceElevated: p.surface,
    surfaceMuted: p.surfaceSecondary,
    textPrimary: p.textPrimary,
    textSecondary: p.textSecondary,
    textMuted: p.textMuted,
    // `border` is the essential-UI edge so existing components (outlined buttons, inputs) stay
    // accessible; V2 cards/separators use `borderSubtle` (the brief's #DDE4EE / #2A3B51).
    border: p.borderStrong,
    borderSubtle: p.border,
    primary: p.primaryPressed,
    primaryAction: p.primary,
    primarySoft: p.primarySoft,
    primaryLine: p.primaryLine,
    destructiveAction: p.destructive,
    onPrimary: p.onPrimary,
    onDestructive: p.onDestructive,
    onDisabled: dark ? "#8A9BB3" : "#64748B",
    onAi: p.onAi,
    accentBrass: s.pickup,
    accentClay: s.dirty,
    textDisabled: p.textMuted,
    accentBrassSoft: s.pickupSoft,
    accentBrassLine: s.pickupLine,
    glass: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(13, 23, 40, 0.03)",
    glassBorder: dark ? "rgba(255, 255, 255, 0.10)" : "rgba(13, 23, 40, 0.10)",
    shell: shellV2[mode],
    ai: aiV2[mode],
    status: s,
    banner: {
      offline: dark
        ? { background: "#F87171", foreground: "#1C0D0F", border: "#5E1D25" }
        : { background: "#B42318", foreground: "#FFFFFF", border: "#F3B1B7" },
    },
    toast: dark
      ? {
          success: { background: "#34D399", foreground: "#06231A", border: "#0F5C44" },
          error: { background: "#F87171", foreground: "#1C0D0F", border: "#6B202A" },
          info: { background: "#60A5FA", foreground: "#0B1220", border: "#1E4E8C" },
        }
      : {
          success: { background: "#047857", foreground: "#FFFFFF", border: "#A7D8C4" },
          error: { background: "#B42318", foreground: "#FFFFFF", border: "#F3B1B7" },
          info: { background: "#1D4ED8", foreground: "#FFFFFF", border: "#B9CDF8" },
        },
  };
}

export const lightThemeV2 = buildTheme("light");
export const darkThemeV2 = buildTheme("dark");

export function getThemeTokensV2(mode: ThemeModeV2 = "light") {
  return mode === "dark" ? darkThemeV2 : lightThemeV2;
}

export type ThemeTokensV2 = ReturnType<typeof getThemeTokensV2>;

/* ─── Non-color scales (mode independent) ─────────────────────────────── */

/** Typography roles. System sans-serif; numbers use tabular figures at the call site. */
export const typeV2 = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.2 },
  headline: { fontSize: 18, lineHeight: 24, fontWeight: "600", letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400", letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: "600", letterSpacing: 0 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600", letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500", letterSpacing: 0 },
  micro: { fontSize: 12, lineHeight: 16, fontWeight: "500", letterSpacing: 0.1 },
} as const;

export type TypeRoleV2 = keyof typeof typeV2;

/** 4-pt spacing scale. `page` is the horizontal gutter on phones. */
export const spaceV2 = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, page: 16 } as const;

/** Radii. Cards 16 (hero 18); controls 14; chips/pills fully round. */
export const radiusV2 = { sm: 8, chip: 10, input: 12, control: 14, card: 16, hero: 18, sheet: 24, pill: 999 } as const;

/** Restrained elevation. Dark mode relies on borders instead of shadows. */
export const elevationV2 = {
  light: { card: { shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 } },
  dark: { card: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 } },
} as const;

/** Minimum touch targets (dp): iOS HIG 44, Material 48 for the primary action. */
export const touchV2 = { min: 44, comfortable: 48, primary: 56 } as const;
