import { useMemo } from "react";
import {
  darkHousekeeperAccent,
  getThemeTokens,
  housekeeperAccent,
  type ThemeTokens,
} from "@/components/shared/tokens";
import { getThemeTokensV2 } from "@/components/shared/tokensV2";
import { useDesignV2Scope } from "@/lib/design/DesignV2Scope";
import { useDesignV2Active } from "@/lib/design/useDesignV2Active";
import { useThemeMode } from "./ThemeProvider";

export function useTheme(): ThemeTokens {
  const appMode = useThemeMode();
  const scope = useDesignV2Scope();
  const mode = scope.mode ?? appMode;
  return useMemo(
    // V2 has the exact same key shape as the legacy theme (asserted at compile time in
    // __tests__/lib/design/tokensV2.test.ts); only the literal color strings differ.
    () => (scope.active ? (getThemeTokensV2(mode) as unknown as ThemeTokens) : getThemeTokens(mode)),
    [mode, scope.active],
  );
}

/** Theme for SHARED CHROME that sits outside any `<DesignV2Scope>` (the tab bar and layout-level
 *  affordances). Returns V2 tokens whenever Design V2 is active (hotel flag or development preview), following the app's
 *  system/light/dark preference, and the untouched legacy tokens otherwise. Screens must keep
 *  using `useTheme()`: this hook exists so chrome can modernize without recoloring unmigrated
 *  screens. */
export function useChromeTheme(): ThemeTokens {
  const appMode = useThemeMode();
  const designV2 = useDesignV2Active();
  return useMemo(
    () => (designV2 ? (getThemeTokensV2(appMode) as unknown as ThemeTokens) : getThemeTokens(appMode)),
    [appMode, designV2],
  );
}

export function useHousekeeperAccent() {
  const mode = useThemeMode();
  const theme = useTheme();
  const v2 = useDesignV2Scope().active;
  // Design System V2 retires the Housekeeper-only terracotta: the confirm control uses the one primary blue.
  // Dark slate track + blue fill keeps the hold progress clearly visible; `fg` is the label colour that reads on both.
  if (v2) return { bg: theme.primary, bgPressed: theme.shell.bg, soft: theme.primarySoft, softLine: theme.primaryLine, fg: theme.shell.ink };
  return mode === "dark" ? darkHousekeeperAccent : housekeeperAccent;
}
