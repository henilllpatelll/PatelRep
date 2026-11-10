import { Platform, StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";

/** Reactive Design V2 typography for static StyleSheets.
 *
 *  Legacy styles used shouted micro labels, tracked caps, sub-12 sizes and IBM Plex Mono / Instrument Serif
 *  accents; Design V2 uses sentence case, no tracking, a 12 floor and the system sans (tabular for figures).
 *  V2 is the permanent design for every hotel and role, so `useIsDesignV2()` is always true and the V2 variant is
 *  always the one returned. `createTypographyStyles` still builds both variants of a sheet up front from pure inputs
 *  (the legacy variant is retained only until the remaining legacy branches are deleted); nothing is decided at
 *  module initialization and no flag, scope or hotel setting can select the legacy variant.
 *
 *  Usage: `const useStyles = createTypographyStyles((t) => ({ kicker: { fontSize: t.labelSize(11), letterSpacing:
 *  t.tracking(1), textTransform: t.labelCase }, num: { fontFamily: t.mono } }));` then `const styles = useStyles();`
 *  inside each component. Print/QR labels keep a
 *  literal `textTransform: "uppercase"` and never use this module. */

/** Platform system sans, set explicitly: an undefined fontFamily does not override a legacy font on every platform. */
export const V2_SANS = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
}) as string;

const LEGACY_MONO = Platform.select({
  ios: "IBMPlexMono_500Medium",
  android: "IBMPlexMono_500Medium",
  default: "monospace",
}) as string;
const LEGACY_SERIF = "InstrumentSerif_400Regular";

export interface TypographyMode {
  v2: boolean;
  /** IBM Plex Mono (legacy) / system sans (V2). */
  mono: string;
  /** Instrument Serif (legacy) / system sans (V2). */
  serif: string;
  /** `uppercase` (legacy) / `none` (V2). */
  labelCase: "uppercase" | "none";
  /** Legacy tracking / 0 in V2. */
  tracking: (legacy: number) => number;
  /** Legacy size / never below 12 in V2. */
  labelSize: (legacy: number) => number;
}

export const LEGACY_TYPOGRAPHY: TypographyMode = {
  v2: false,
  mono: LEGACY_MONO,
  serif: LEGACY_SERIF,
  labelCase: "uppercase",
  tracking: (legacy) => legacy,
  labelSize: (legacy) => legacy,
};

export const V2_TYPOGRAPHY: TypographyMode = {
  v2: true,
  mono: V2_SANS,
  serif: V2_SANS,
  labelCase: "none",
  tracking: () => 0,
  labelSize: (legacy) => Math.max(legacy, 12),
};

/** Marker used only to find which style entries asked for the mono face, so V2 can give their figures tabular digits. */
const MONO_PROBE = "__patelrep_mono_probe__";

type Style = ViewStyle | TextStyle | ImageStyle;

/** Build both variants once and return a hook that selects the live one. Safe to call at module level: it reads
 *  no tenant state. In V2 every entry that used the mono face also gets tabular digits (system sans is
 *  proportional, so figures such as room numbers and timers would otherwise jitter). */
export function createTypographyStyles<T extends { [K in keyof T]: Style }>(factory: (t: TypographyMode) => T): () => T {
  const legacy = StyleSheet.create(factory(LEGACY_TYPOGRAPHY));
  const v2Raw = factory(V2_TYPOGRAPHY) as Record<string, Style>;
  const probe = factory({ ...V2_TYPOGRAPHY, mono: MONO_PROBE }) as Record<string, Style>;
  const v2Entries: Record<string, Style> = {};
  for (const key of Object.keys(v2Raw)) {
    const usesMono = (probe[key] as TextStyle | undefined)?.fontFamily === MONO_PROBE;
    v2Entries[key] = usesMono ? { ...(v2Raw[key] as TextStyle), fontVariant: ["tabular-nums"] } : v2Raw[key];
  }
  const v2 = StyleSheet.create(v2Entries as unknown as T);
  return function useTypographyStyles(): T {
    return useIsDesignV2() ? v2 : legacy;
  };
}

/** The live typography mode for styles that are built inside a component (`useMemo(() => makeStyles(theme, t), [theme, t])`).
 *  The two modes are module constants, so the reference is stable until the decision actually flips. */
export function useTypography(): TypographyMode {
  return useIsDesignV2() ? V2_TYPOGRAPHY : LEGACY_TYPOGRAPHY;
}
