import { Platform } from "react-native";

/* ─── PatelRep Mobile — "Evening Lobby" design system ───────────────────────
   Dark warm charcoal-green chrome (tab bar, heroes) framing a warm paper
   canvas. Forest-green primary action. Status colors are a protected contract
   shared with the web app: teal ready, blue clean, rose dirty/occupied,
   amber pickup, stone out-of-order. Do not change their meanings or hues. */

export const statusTokens = {
  ready: "#0E7468",
  clean: "#2F6F95",
  dirty: "#A9363F",
  occupied: "#A9363F",
  pickup: "#B7791F",
  outOfOrder: "#746D63",
  readySoft: "#D7EDE7",
  readyLine: "#A7D2C9",
  cleanSoft: "#DDEAF1",
  cleanLine: "#ACC9DB",
  dirtySoft: "#F6DDE0",
  dirtyLine: "#E7A9B0",
  pickupSoft: "#F7E8C8",
  pickupLine: "#E4C174",
  outOfOrderSoft: "#EDE7DD",
  outOfOrderLine: "#D5CAB8",
} as const;

export const darkStatusTokens = {
  ...statusTokens,
  readySoft: "rgba(14, 116, 104, 0.20)",
  cleanSoft: "rgba(47, 111, 149, 0.22)",
  dirtySoft: "rgba(169, 54, 63, 0.22)",
  pickupSoft: "rgba(183, 121, 31, 0.24)",
  outOfOrderSoft: "rgba(116, 109, 99, 0.24)",
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
  line: "rgba(167, 139, 250, 0.36)",
  glow: "rgba(167, 139, 250, 0.42)",
} as const;

/** The dark "Evening Lobby" chrome — a designed constant across themes.
 *  Used for the tab bar, screen heroes, and AI surfaces. */
export const shellTokens = {
  bg: "#20251F",
  surface: "#2A2F28",
  raised: "#333931",
  line: "#3A4038",
  ink: "#F1EDE2",
  ink2: "#B9B5A7",
  ink3: "#84816F",
} as const;

export const lightTheme = {
  background: "#F8F1E7",
  surface: "#FFFDFC",
  surfaceSubtle: "#FBF9F3",
  surfaceMuted: "#F0EBE1",
  textPrimary: "#2C2621",
  textSecondary: "#766D63",
  textMuted: "#807A70",
  border: "#E4D6C4",
  borderSubtle: "#EEE8DB",
  primary: "#2F5D50",
  primaryAction: "#4F7A5A",
  primarySoft: "#E0EBE1",
  primaryLine: "#B9CFBC",
  accentBrass: "#C29A4A",
  accentClay: "#E8B89A",
  shell: shellTokens,
  ai: aiTokens,
  status: statusTokens,
} as const;

export const darkTheme = {
  background: "#0F0D0B",
  surface: "#191512",
  surfaceElevated: "#232019",
  surfaceMuted: "#2B2720",
  textPrimary: "#F1EDE4",
  textSecondary: "#C5BEAF",
  textMuted: "#918A7E",
  border: "#353026",
  borderSubtle: "#2B2720",
  primary: "#6FA086",
  primaryAction: "#7EA889",
  primarySoft: "rgba(126, 168, 137, 0.18)",
  primaryLine: "rgba(126, 168, 137, 0.36)",
  accentBrass: "#D0A85A",
  accentClay: "#C98262",
  glass: "rgba(255, 255, 255, 0.06)",
  glassBorder: "rgba(255, 255, 255, 0.10)",
  shell: shellTokens,
  ai: darkAiTokens,
  status: darkStatusTokens,
} as const;

export type ThemeMode = "light" | "dark";

export function getThemeTokens(mode: ThemeMode = "light") {
  return mode === "dark" ? darkTheme : lightTheme;
}

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

export const R = { sm: 8, md: 12, lg: 16, xl: 20 } as const;
export const S = { page: 18, card: 16, cardGap: 15, sectionGap: 22 } as const;

export const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

export const displayFont = undefined;
