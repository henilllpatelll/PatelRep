import { useMemo } from "react";
import type { ThemeTokens } from "@/components/shared/tokens";
import { getThemeTokensV2 } from "@/components/shared/tokensV2";
import { useDesignV2Scope } from "@/lib/design/DesignV2Scope";
import { useThemeMode } from "./ThemeProvider";

export function useTheme(): ThemeTokens {
  const appMode = useThemeMode();
  const scope = useDesignV2Scope();
  const mode = scope.mode ?? appMode;
  return useMemo(
    // V2 has the exact same key shape as the legacy theme (asserted at compile time in
    // __tests__/lib/design/tokensV2.test.ts); only the literal color strings differ.
    () => getThemeTokensV2(mode) as unknown as ThemeTokens,
    [mode],
  );
}

/** Theme for shared chrome (tab bar, layout-level affordances): V2 tokens following the app's system/light/dark
 *  preference. Identical to `useTheme()` outside a pinned `<DesignV2Scope mode>`. */
export function useChromeTheme(): ThemeTokens {
  const appMode = useThemeMode();
  return useMemo(() => getThemeTokensV2(appMode) as unknown as ThemeTokens, [appMode]);
}

export function useHousekeeperAccent() {
  const theme = useTheme();
  // Design System V2 retires the Housekeeper-only terracotta: the confirm control uses the one primary blue.
  // Dark slate track + blue fill keeps the hold progress clearly visible; `fg` is the label colour that reads on both.
  return { bg: theme.primary, bgPressed: theme.shell.bg, soft: theme.primarySoft, softLine: theme.primaryLine, fg: theme.shell.ink };
}
