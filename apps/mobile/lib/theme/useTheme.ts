import { useMemo } from "react";
import {
  darkHousekeeperAccent,
  getThemeTokens,
  housekeeperAccent,
  type ThemeTokens,
} from "@/components/shared/tokens";
import { getThemeTokensV2 } from "@/components/shared/tokensV2";
import { useDesignV2Scope } from "@/lib/design/DesignV2Scope";
import { isDesignV2Enabled } from "@/lib/design/designV2";
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
 *  affordances). Returns V2 tokens whenever the preview flag is on, following the app's
 *  system/light/dark preference, and the untouched legacy tokens otherwise. Screens must keep
 *  using `useTheme()`: this hook exists so chrome can modernize without recoloring unmigrated
 *  screens. */
export function useChromeTheme(): ThemeTokens {
  const appMode = useThemeMode();
  return useMemo(
    () => (isDesignV2Enabled() ? (getThemeTokensV2(appMode) as unknown as ThemeTokens) : getThemeTokens(appMode)),
    [appMode],
  );
}

export function useHousekeeperAccent() {
  const mode = useThemeMode();
  return mode === "dark" ? darkHousekeeperAccent : housekeeperAccent;
}
