import type { TextStyle } from "react-native";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";

/** Phase 3 (Housekeeper) V2 presentation fragments.
 *
 *  Legacy Housekeeper text used shouting micro-labels, Instrument Serif headline accents and IBM Plex
 *  Mono figures. Inside an active `<DesignV2Scope>` these fragments are layered on top of the existing
 *  style (later array entries win); outside it every field is `null`, so React Native ignores them and
 *  the legacy look is byte-for-byte what it was.
 *
 *  Usage: `const x = useV2Text(); <Text style={[styles.kicker, x.label]} />`. */

/** Section label / eyebrow / kicker: sentence case, no tracking, readable size. */
const LABEL: TextStyle = { textTransform: "none", letterSpacing: 0, fontSize: 13, lineHeight: 18, fontWeight: "600" };
/** Figures (room numbers, timers, counts): system sans with tabular digits. */
const NUM: TextStyle = { fontFamily: undefined, fontVariant: ["tabular-nums"], letterSpacing: 0 };
/** Large display room number / greeting: system bold, tight tracking, tabular digits. */
const DISPLAY: TextStyle = { fontFamily: undefined, fontWeight: "700", letterSpacing: -0.4, fontVariant: ["tabular-nums"] };
/** Title (greeting, sheet title): system bold. */
const TITLE: TextStyle = { fontFamily: undefined, fontWeight: "700", letterSpacing: -0.2 };

export interface V2Text {
  active: boolean;
  label: TextStyle | null;
  num: TextStyle | null;
  display: TextStyle | null;
  title: TextStyle | null;
}

const OFF: V2Text = { active: false, label: null, num: null, display: null, title: null };
const ON: V2Text = { active: true, label: LABEL, num: NUM, display: DISPLAY, title: TITLE };

export function useV2Text(): V2Text {
  return useIsDesignV2() ? ON : OFF;
}

/** Roles whose surface is migrated to V2 in Phase 3. */
export function isHousekeeperV2Role(role: string | null | undefined): boolean {
  return role === "housekeeper";
}
