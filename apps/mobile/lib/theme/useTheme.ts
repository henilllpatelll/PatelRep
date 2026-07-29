import { useMemo } from "react";
import { getThemeTokens } from "@/components/shared/tokens";
import { useThemeMode } from "./ThemeProvider";

export function useTheme() {
  const mode = useThemeMode();
  return useMemo(() => getThemeTokens(mode), [mode]);
}
