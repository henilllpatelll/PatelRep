import { useMemo } from "react";
import { darkHousekeeperAccent, getThemeTokens, housekeeperAccent } from "@/components/shared/tokens";
import { useThemeMode } from "./ThemeProvider";

export function useTheme() {
  const mode = useThemeMode();
  return useMemo(() => getThemeTokens(mode), [mode]);
}

export function useHousekeeperAccent() {
  const mode = useThemeMode();
  return mode === "dark" ? darkHousekeeperAccent : housekeeperAccent;
}
