import { Platform, type TextStyle } from "react-native";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { useTheme } from "@/lib/theme/useTheme";

/** Phase 3 (Housekeeper) V2 presentation fragments.
 *
 *  Legacy Housekeeper text used shouting micro-labels, Instrument Serif headline accents and IBM Plex
 *  Mono figures. Inside an active `<DesignV2Scope>` these fragments are layered on top of the existing
 *  style (later array entries win); outside it every field is `null`, so React Native ignores them and
 *  the legacy look is byte-for-byte what it was.
 *
 *  Usage: `const x = useV2Text(); <Text style={[styles.kicker, x.label]} />`. */

/** System sans, set explicitly: an `undefined` fontFamily does not override the legacy serif/mono on every platform. */
const SANS = Platform.select({ ios: "System", android: "sans-serif", default: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }) as string;

/** Section label / eyebrow / kicker: sentence case, no tracking, readable size. */
const LABEL: TextStyle = { textTransform: "none", letterSpacing: 0, fontSize: 13, lineHeight: 18, fontWeight: "600" };
/** Figures (room numbers, timers, counts): system sans with tabular digits. */
const NUM: TextStyle = { fontFamily: SANS, fontVariant: ["tabular-nums"], letterSpacing: 0 };
/** Large display room number / greeting: system bold, tight tracking, tabular digits. */
const DISPLAY: TextStyle = { fontFamily: SANS, fontWeight: "700", letterSpacing: -0.4, fontVariant: ["tabular-nums"] };
/** Status pill text: sentence case, no tracking, never below 12 so a status word stays readable. */
const PILL: TextStyle = { textTransform: "none", letterSpacing: 0.1, fontSize: 12, lineHeight: 16, fontWeight: "600" };
/** Title (greeting, sheet title): system bold. */
const TITLE: TextStyle = { fontFamily: SANS, fontWeight: "700", letterSpacing: -0.2 };

export interface V2Text {
  active: boolean;
  label: TextStyle | null;
  num: TextStyle | null;
  display: TextStyle | null;
  title: TextStyle | null;
  /** Status pill / badge text (was an uppercase 10.5 micro-label). */
  pill: TextStyle | null;
  /** Section kickers were shouted in capitals; V2 keeps the translated sentence case. Outside the scope: uppercase, as before. */
  caps: (text: string) => string;
  /** Edge colour for a card-like surface: the V2 separator edge inside the scope, the existing theme border
   *  (the strong form-field edge) everywhere else. Inputs keep `theme.border`. */
  edge: string;
}

const OFF = { active: false, label: null, num: null, display: null, title: null, pill: null, caps: (text: string) => text.toUpperCase() } as const;
const ON = { active: true, label: LABEL, num: NUM, display: DISPLAY, title: TITLE, pill: PILL, caps: (text: string) => text } as const;

export function useV2Text(): V2Text {
  const v2 = useIsDesignV2();
  const theme = useTheme();
  return { ...(v2 ? ON : OFF), edge: v2 ? theme.borderSubtle : theme.border };
}

/** Roles whose surface is migrated to V2 in Phase 3. */
export function isHousekeeperV2Role(role: string | null | undefined): boolean {
  return role === "housekeeper";
}

/** Phase 4: Inspector and Housekeeping Supervisor. Their surfaces are scoped exactly like the Housekeeper's. */
export function isInspectorSupervisorV2Role(role: string | null | undefined): boolean {
  return role === "inspector" || role === "housekeeping_supervisor";
}

/** Phase 5: Engineer and Chief Engineer. Their whole surface (five tabs, hidden routes, sheets) is scoped like the others. */
export function isEngineeringV2Role(role: string | null | undefined): boolean {
  return role === "engineer" || role === "chief_engineer";
}

/** Every role whose whole surface is inside `<DesignV2Scope>` while the preview flag is on (Phases 3 + 4 + 5).
 *  Front Desk and GM stay outside until their own phases. */
export function isV2SurfaceRole(role: string | null | undefined): boolean {
  return isHousekeeperV2Role(role) || isInspectorSupervisorV2Role(role) || isEngineeringV2Role(role);
}
