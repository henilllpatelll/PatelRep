import { Platform } from "react-native";

/* ─── PatelRep Mobile — "Evening Lobby" design system ───────────────────────
   Dark warm charcoal-green chrome (tab bar, heroes) framing a warm paper
   canvas. Forest-green primary action. Status colors are a protected contract
   shared with the web app: teal ready, blue clean, rose dirty/occupied,
   amber pickup, stone out-of-order. Do not change their meanings or hues. */

export const statusTokens = {
  ready: "#0E7468",
  clean: "#285F80",
  inProgress: "#684095",
  dirty: "#A9363F",
  occupied: "#A9363F",
  pickup: "#82540F",
  outOfOrder: "#625B52",
  readySoft: "#D7EDE7",
  readyLine: "#0E7468",
  cleanSoft: "#DDEAF1",
  cleanLine: "#285F80",
  inProgressSoft: "#ECE2F6",
  inProgressLine: "#684095",
  dirtySoft: "#F6DDE0",
  dirtyLine: "#A9363F",
  pickupSoft: "#F7E8C8",
  pickupLine: "#82540F",
  outOfOrderSoft: "#EDE7DD",
  outOfOrderLine: "#625B52",
} as const;

export const darkStatusTokens = {
  ...statusTokens,
  ready: "#76CBBB",
  clean: "#79B9E0",
  inProgress: "#C1A3F5",
  dirty: "#F18A93",
  occupied: "#F18A93",
  pickup: "#E5B65D",
  outOfOrder: "#BDB5AA",
  readySoft: "rgba(14, 116, 104, 0.20)",
  readyLine: "#76CBBB",
  cleanSoft: "rgba(47, 111, 149, 0.22)",
  cleanLine: "#79B9E0",
  inProgressSoft: "rgba(104, 64, 149, 0.24)",
  inProgressLine: "#C1A3F5",
  dirtySoft: "rgba(169, 54, 63, 0.22)",
  dirtyLine: "#F18A93",
  pickupSoft: "rgba(183, 121, 31, 0.24)",
  pickupLine: "#E5B65D",
  outOfOrderSoft: "rgba(116, 109, 99, 0.24)",
  outOfOrderLine: "#BDB5AA",
} as const;

export const aiTokens = {
  primary: "#7C3AED",
  secondary: "#14B8A6",
  electric: "#38BDF8",
  soft: "rgba(124, 58, 237, 0.14)",
  line: "rgba(124, 58, 237, 0.32)",
  glow: "rgba(124, 58, 237, 0.35)",
} as const;

export const darkAiTokens = {
  primary: "#A78BFA",
  secondary: "#2DD4BF",
  electric: "#7DD3FC",
  soft: "rgba(167, 139, 250, 0.16)",
  line: "#826BC1",
  glow: "rgba(167, 139, 250, 0.42)",
} as const;

/** The light-mode "Evening Lobby" frame around the warm paper canvas. */
export const lightShellTokens = {
  bg: "#20251F",
  surface: "#2A2F28",
  raised: "#333931",
  line: "#706F61",
  ink: "#F1EDE2",
  ink2: "#B9B5A7",
  ink3: "#9A9688",
} as const;

/** A visibly deeper warm-charcoal frame around the dark content layers. */
export const darkShellTokens = {
  bg: "#090806",
  surface: "#13110F",
  raised: "#1B1814",
  line: "#625C50",
  ink: "#F1EDE2",
  ink2: "#B9B5A7",
  ink3: "#918A7E",
} as const;

// Temporary source-compatibility alias for legacy C consumers.
export const shellTokens = lightShellTokens;

export const lightTheme = {
  background: "#F8F1E7",
  surface: "#FFFDFC",
  surfaceSubtle: "#FBF9F3",
  surfaceElevated: "#FFFFFF",
  surfaceMuted: "#F0EBE1",
  textPrimary: "#2C2621",
  textSecondary: "#6E655B",
  textMuted: "#696259",
  border: "#8E8274",
  borderSubtle: "#EEE8DB",
  primary: "#2F5D50",
  primaryAction: "#4F7A5A",
  primarySoft: "#E0EBE1",
  primaryLine: "#6D8872",
  destructiveAction: "#A9363F",
  onPrimary: "#FFFFFF",
  onDestructive: "#FFFFFF",
  onDisabled: "#59665B",
  onAi: "#FFFFFF",
  accentBrass: "#C29A4A",
  accentClay: "#E8B89A",
  textDisabled: "#696259",
  accentBrassSoft: "#F4E7C6",
  accentBrassLine: "#E2C679",
  glass: "rgba(44, 38, 33, 0.03)",
  glassBorder: "rgba(44, 38, 33, 0.12)",
  shell: lightShellTokens,
  ai: aiTokens,
  status: statusTokens,
  banner: {
    offline: {
      background: "#8E2D35",
      foreground: "#FFFFFF",
      border: "#F3B1B7",
    },
  },
  toast: {
    success: {
      background: "#176B5B",
      foreground: "#FFFFFF",
      border: "#BFE4D6",
    },
    error: {
      background: "#92303A",
      foreground: "#FFFFFF",
      border: "#F3B1B7",
    },
    info: {
      background: "#245F82",
      foreground: "#FFFFFF",
      border: "#B5D9ED",
    },
  },
} as const;

export const darkTheme = {
  background: "#0F0D0B",
  surface: "#191512",
  // Sits between background and surface, mirroring lightTheme.surfaceSubtle's position
  // (lighter than background, dimmer than surface) — added so useTheme() screen migrations
  // that read C.surface2 have a same-shape reactive key in both themes (Wave 0 precedent).
  surfaceSubtle: "#141110",
  surfaceElevated: "#232019",
  surfaceMuted: "#2B2720",
  textPrimary: "#F1EDE4",
  textSecondary: "#C5BEAF",
  textMuted: "#9B9488",
  border: "#71685B",
  borderSubtle: "#2B2720",
  primary: "#6FA086",
  primaryAction: "#7EA889",
  primarySoft: "rgba(126, 168, 137, 0.18)",
  primaryLine: "#587C66",
  destructiveAction: "#E27B84",
  onPrimary: "#0F1A14",
  onDestructive: "#1C0D0F",
  onDisabled: "#B5C8B7",
  onAi: "#1A102A",
  accentBrass: "#D0A85A",
  accentClay: "#C98262",
  textDisabled: "#9B9488",
  accentBrassSoft: "rgba(208, 168, 90, 0.20)",
  accentBrassLine: "rgba(208, 168, 90, 0.40)",
  glass: "rgba(255, 255, 255, 0.06)",
  glassBorder: "rgba(255, 255, 255, 0.10)",
  shell: darkShellTokens,
  ai: darkAiTokens,
  status: darkStatusTokens,
  banner: {
    offline: {
      background: "#D96D76",
      foreground: "#1C0D0F",
      border: "#5E1D25",
    },
  },
  toast: {
    success: {
      background: "#5FAF9E",
      foreground: "#101714",
      border: "#184C42",
    },
    error: {
      background: "#E27B84",
      foreground: "#1C0D0F",
      border: "#6B202A",
    },
    info: {
      background: "#6EADD2",
      foreground: "#0D161C",
      border: "#214F69",
    },
  },
} as const;

export type ThemeMode = "light" | "dark";

export function getThemeTokens(mode: ThemeMode = "light") {
  return mode === "dark" ? darkTheme : lightTheme;
}

export type ThemeTokens = ReturnType<typeof getThemeTokens>;

export const C = {
  paper: lightTheme.background,
  surface: lightTheme.surface,
  surface2: lightTheme.surfaceSubtle,
  surface3: lightTheme.surfaceMuted,
  line: lightTheme.border,
  line2: lightTheme.borderSubtle,
  ink: lightTheme.textPrimary,
  ink2: lightTheme.textSecondary,
  ink3: lightTheme.textMuted,
  ink4: "#B7AA99",
  primary: lightTheme.primary,
  accent: lightTheme.primaryAction,
  accentSoft: lightTheme.primarySoft,
  accentLine: lightTheme.primaryLine,
  brass: lightTheme.accentBrass,
  brassSoft: "#F4E7C6",
  brassLine: "#E2C679",
  clay: lightTheme.accentClay,
  shell: shellTokens.bg,
  shellSurface: shellTokens.surface,
  shellRaised: shellTokens.raised,
  shellLine: shellTokens.line,
  shellInk: shellTokens.ink,
  shellInk2: shellTokens.ink2,
  shellInk3: shellTokens.ink3,
  ready: statusTokens.ready,
  readySoft: statusTokens.readySoft,
  readyLine: statusTokens.readyLine,
  caution: statusTokens.pickup,
  cautionSoft: statusTokens.pickupSoft,
  cautionLine: statusTokens.pickupLine,
  alert: statusTokens.dirty,
  alertSoft: statusTokens.dirtySoft,
  alertLine: statusTokens.dirtyLine,
  info: statusTokens.clean,
  infoSoft: statusTokens.cleanSoft,
  infoLine: statusTokens.cleanLine,
  occupied: statusTokens.occupied,
  ooo: statusTokens.outOfOrder,
  oooSoft: statusTokens.outOfOrderSoft,
  oooLine: statusTokens.outOfOrderLine,
  ai: aiTokens.primary,
  aiSecondary: aiTokens.secondary,
  aiElectric: aiTokens.electric,
  aiSoft: aiTokens.soft,
  aiLine: aiTokens.line,
  aiGlow: aiTokens.glow,
  glass: darkTheme.glass,
  glassBorder: darkTheme.glassBorder,
  fontFamily: undefined as undefined,
} as const;

/** Housekeeper-Home-only accent (hold-to-confirm sheet, end-of-shift CTA) — scoped
 *  to those new components, not part of the cross-role theme.primary/primaryAction
 *  contract used by every other screen. */
export const housekeeperAccent = {
  bg: "#B8431C",
  bgPressed: "#8F3315",
  soft: "#F7E4D8",
  softLine: "#E8B89A",
} as const;

export const darkHousekeeperAccent = {
  bg: "#D97A4C",
  bgPressed: "#C15F31",
  soft: "rgba(217, 122, 76, 0.18)",
  softLine: "rgba(217, 122, 76, 0.40)",
} as const;

export const R = { sm: 8, md: 12, lg: 16, xl: 20 } as const;
export const S = { page: 18, card: 16, cardGap: 15, sectionGap: 22 } as const;

/** IBM Plex Mono, loaded via useFonts() in app/_layout.tsx. Falls back to the
 *  platform monospace until the font finishes loading (pre-load frame only —
 *  the splash screen stays up until fontsLoaded, so this fallback is rarely
 *  visible in practice). */
export const monoFont = Platform.select({
  ios: "IBMPlexMono_500Medium",
  android: "IBMPlexMono_500Medium",
  default: "monospace",
}) as string;

/** Instrument Serif — headline accents only (greeting, focus-card room
 *  number), per the "Mobile Home - housekeeper" design import. Not a
 *  general-purpose display font; most text stays on the system sans-serif. */
export const serifFont = "InstrumentSerif_400Regular";

export const displayFont = undefined;
