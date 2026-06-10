import { Platform } from "react-native";

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

export const lightTheme = {
  background: "#F8F1E7",
  surface: "#FFFDFC",
  surfaceSubtle: "#FBF7F0",
  surfaceMuted: "#F1E9DD",
  textPrimary: "#2C2621",
  textSecondary: "#766D63",
  textMuted: "#9A9084",
  border: "#E4D6C4",
  borderSubtle: "#EFE5D6",
  primary: "#2F5D50",
  primaryAction: "#4F7A5A",
  primarySoft: "#E0EBE1",
  primaryLine: "#B9CFBC",
  accentBrass: "#C29A4A",
  accentClay: "#E8B89A",
  status: statusTokens,
} as const;

export const darkTheme = {
  background: "#171310",
  surface: "#211B17",
  surfaceElevated: "#2A231E",
  surfaceMuted: "#302821",
  textPrimary: "#F4EDE3",
  textSecondary: "#B8AA9A",
  textMuted: "#8F8172",
  border: "#3A3028",
  borderSubtle: "#302821",
  primary: "#6FA086",
  primaryAction: "#7EA889",
  primarySoft: "rgba(126, 168, 137, 0.18)",
  primaryLine: "rgba(126, 168, 137, 0.36)",
  accentBrass: "#D0A85A",
  accentClay: "#C98262",
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
  ai: "#5A3F8C",
  aiSoft: "#EEE8F6",
  aiLine: "#CDBFDF",
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
