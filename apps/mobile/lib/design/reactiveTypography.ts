import { Platform, StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";

/** Reactive Design V2 typography for static StyleSheets.
 *
 *  Legacy styles used shouted micro labels, tracked caps, sub-12 sizes and IBM Plex Mono / Instrument Serif
 *  accents; Design V2 uses sentence case, no tracking, a 12 floor and the system sans (tabular for figures).
 *  Those choices used to be evaluated when the bundle loaded, before anyone signed in, so a tenant-activated
 *  phone could not follow the `design_v2` flag. Nothing tenant-dependent is decided at module initialization
 *  any more: `createTypographyStyles` builds BOTH variants of a sheet up front from pure, flag-free inputs and the
 *  returned hook picks one at render time from the enclosing `<DesignV2Scope>` (`useIsDesignV2`), the same source the
 *  colors, tokens and `useV2Text()` overlays use, so typography can never disagree with them: a subtree outside an
 *  active scope (flag off, or a role gate) is exactly legacy. The scope follows the live flag, so toggling it
 *  re-styles mounted components in place: no remount, no restart.
 *
 *  Usage: `const useStyles = createTypographyStyles((t) => ({ kicker: { fontSize: t.labelSize(11), letterSpacing:
 *  t.tracking(1), textTransform: t.labelCase }, num: { fontFamily: t.mono } }));` then `const styles = useStyles();`
 *  inside each component. Legacy output is byte-identical to the previous static sheet. Print/QR labels keep a
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
